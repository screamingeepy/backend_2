import time

from direct.directnotify.DirectNotifyGlobal import directNotify

from game.otp.distributed.DistributedDistrictAI import DistributedDistrictAI

from game.fairies.housing.HouseConstants import HOUSING_ZONE_OFFSET, isValidRoomType
from game.fairies.housing.DistributedHomeItemAI import DistributedHomeItemAI
from game.fairies.housing.DistributedHomeAI import DistributedHomeAI
from game.fairies.housing.DistributedPartyAI import DistributedPartyAI
from game.fairies.housing.DistributedPartyMatchMakerAI import DistributedPartyMatchMakerAI
from game.fairies.housing import PartyConstants
from game.fairies.minigame.DistributedMultiplayerMinigameAI import DistributedMultiplayerMinigameAI
from game.fairies.housing.DistributedSurpriseAI import (
    DistributedSurpriseAI,
    TYPE_POST_OFFICE_POSTCARDS,
    TYPE_POST_OFFICE_GIFT_SETS,
)
from game.fairies.housing.HomeItems import returnPlacedItemsToStorage
from game.fairies.housing import HomeGames
from game.fairies.housing.DistributedHomeHotspotAI import DistributedHomeHotspotAI
from game.fairies.housing.DistributedGardenPlotAI import DistributedGardenPlotAI
from game.fairies.housing import GardenData
from game.fairies.housing.HouseConstants import ROOM_TYPE_HOME
from game.fairies.pet import pet_state

POST_OFFICE_SURPRISE_POS = (0, 0) # Dummy, client doesn't seem to need

class FairiesHomeRealmAI(DistributedDistrictAI):
    """ai half of the client's FairiesHomeRealm, one realm per home owner holding their furniture"""
    notify = directNotify.newCategory("FairiesHomeRealmAI")

    def __init__(self, air, ownerId, name="Home Realm"):
        DistributedDistrictAI.__init__(self, air, name)

        self.ownerId = ownerId
        # Everything in a home realm lives in the owner's housing zone.
        self.ownerZone = ownerId + HOUSING_ZONE_OFFSET
        # inv_id -> DistributedHomeItemAI currently generated in this realm.
        self.homeItems = {}
        # The single DistributedHome object for this realm (the house itself).
        self.home = None
        # DistributedSurpriseAI objects for the owner's waiting Post Office mail.
        self.postOfficeSurprises = []
        # The DistributedPartyAI running in the house, if the owner started one.
        self.party = None
        # The party game lobby up in the house, and the game room it launched.
        self.partyGameLobby = None
        self.partyGame = None
        # tag -> DistributedHomeHotspotAI for each game table put out from the pouch.
        self.homeGames = {}
        # plotNum -> DistributedGardenPlotAI for each plot of the owner's garden.
        self.gardenPlots = {}
        # The tag last handed to the owner for a table they're still placing.
        self.pendingHotspotTag = None

    def _fairies(self):
        return self.air.mongoInterface.mongodb.fairies

    def loadHomeItems(self):
        # Generate a DistributedHomeItem for each piece of furniture the owner
        # has placed. Called right after the realm is generated.
        fairy = self._fairies().find_one({"_id": self.ownerId})
        if not fairy:
            return

        for item in fairy.get("avatar", {}).get("items", []):
            # A placed item is marked by its `home` sub-doc; it stays in
            # "Storage" so the client keeps its return-to-storage flow.
            if item.get("home"):
                self._generateHomeItem(item)

    def loadPostOfficeSurprises(self):
        # a mailbox for each kind of mail the owner has waiting, visitors see it closed
        messages = self.air.mongoInterface.mongodb.messages

        for typeId in (TYPE_POST_OFFICE_POSTCARDS, TYPE_POST_OFFICE_GIFT_SETS):
            if messages.count_documents({"recipient_id": self.ownerId, "type": typeId}) == 0:
                continue

            self.ensurePostOfficeSurprise(typeId)

    def ensurePostOfficeSurprise(self, typeId):
        # mail landed while the realm was up, so put the mailbox out now
        self._pruneDeletedSurprises()

        for surprise in self.postOfficeSurprises:
            if surprise.getTypeId() == typeId:
                # Mailbox for this kind of mail is already out; opening it pulls
                # everything waiting over HTTP, so one is enough.
                return surprise

        surprise = DistributedSurpriseAI(
            self.air, typeId=typeId,
            x=POST_OFFICE_SURPRISE_POS[0], y=POST_OFFICE_SURPRISE_POS[1])
        self.air.generateWithRequired(surprise, self.getDoId(), self.ownerZone)
        self.postOfficeSurprises.append(surprise)
        return surprise

    def _pruneDeletedSurprises(self):
        # mailboxes delete themselves once cleared, drop the dead entries so new mail gets a fresh one
        self.postOfficeSurprises = [
            surprise for surprise in self.postOfficeSurprises
            if not surprise.isDeleted()
            and not getattr(surprise, "_DOAI_requestedDelete", False)]

    def generateHome(self):
        # Generate the realm's DistributedHome
        if self.home is not None:
            return

        fairy = self._fairies().find_one({"_id": self.ownerId}, {"address": 1})
        address = (fairy or {}).get("address") or "1234CatepillerCorral"

        home = DistributedHomeAI(self.air, realm=self, address=address)
        # Parent to the realm in the owner's housing zone, exactly like the
        # furniture, so everyone who enters the realm generates it.
        self.air.generateWithRequired(home, self.getDoId(), self.ownerZone)
        self.home = home

        # seat the pet if it is resting, an active pet follows its owner in on its own
        self.refreshRestingPet()

    def refreshRestingPet(self):
        # re-read the pet and seat or clear it, also called when the owner rests or unrests it at home
        if self.home is None:
            return

        pet = pet_state.loadPetAndApplyDecay(self.air, self.ownerId)
        if pet_state.hasPet(pet) and pet.get("status") == pet_state.ANIMAL_FRIEND_RESTING:
            dna = pet_state.petDNATuple(pet)
        else:
            # Empty DNA: the client reads itemId 0 as "get up and follow me"
            # when it is your own home, or "no pet here" otherwise.
            dna = list(pet_state.EMPTY_PET_DNA)

        if dna != self.home.restingPetDNA:
            self.home.setRestingPetDNA(dna)

    # --- Parties ---

    def startParty(self, avatarId, themeId, nameIds):
        # the owner asked for a party, createParty is clsend so check everything again
        if avatarId != self.ownerId:
            self.notify.warning(
                "createParty in %s's home from %s, not the owner - ignoring"
                % (self.ownerId, avatarId))
            return

        if self.party is not None:
            self.notify.warning("createParty from %s, who already has a party" % avatarId)
            return

        if not PartyConstants.isValidTheme(themeId) or not PartyConstants.isValidName(nameIds):
            self.notify.warning(
                "createParty from %s with bad theme %r or name %r" % (avatarId, themeId, nameIds))
            return

        avatar = self.air.doId2do.get(avatarId)
        if avatar is None or avatar.zoneId != self.ownerZone:
            self.notify.warning(
                "createParty from %s, who isn't standing in their home" % avatarId)
            return

        # starting a party spends the decoration
        if not self.air.inventoryManager.removeIngredientsFromPouch(
                avatarId, PartyConstants.decorationItemId(themeId), 1):
            self.notify.warning(
                "createParty from %s without a theme %s decoration in their pouch"
                % (avatarId, themeId))
            return

        avatar.d_syncPouchAfterChanges()

        now = int(time.time())
        self.party = DistributedPartyAI(
            self.air, self, themeId, nameIds,
            startTime=now, expiration=now + PartyConstants.partyDurationSecs())

        # tell the guardian first, it supplies the decorations everyone reloads with
        self.sendPartyUpdate()
        self.air.generateWithRequired(self.party, self.getDoId(), self.ownerZone)

        self.notify.info(
            "%s started a theme %s party in realm %s" % (avatarId, themeId, self.getDoId()))

    def endParty(self, reason):
        party = self.party
        if party is None:
            return

        self.party = None
        party.realm = None

        # No new games once the party is over. A game already being played runs
        # to its end; its players come back to a plain house.
        self.closePartyGameLobby("the party ended")

        # guardian first again, so teleports say no decorations
        self.sendPartyUpdate()
        party.requestDelete()

        self.notify.info("Ended %s's party because %s" % (self.ownerId, reason))

    def sendPartyUpdate(self):
        self.air.sendPartyUpdateToRealmGuardian(self.getDoId(), self.ownerId, self.party)

    # --- Party games ---

    def startPartyGame(self, avatarId, gameId):
        # The host picked a game in the party panel (PartyPanel.placeItem ->
        # DistributedFairyPlayer.requestMatchMaker). Put a lobby up in the house.
        if avatarId != self.ownerId:
            self.notify.warning(
                "party game requested in %s's home by %s, not the host" % (self.ownerId, avatarId))
            return

        if self.party is None:
            self.notify.warning("party game requested by %s with no party on" % avatarId)
            return

        if self.partyGameLobby is not None or self.partyGame is not None:
            self.notify.warning("party game requested by %s while one is already going" % avatarId)
            return

        if gameId not in PartyConstants.PARTY_GAME_IDS:
            self.notify.warning("party game requested by %s for game %r, not a party game" % (avatarId, gameId))
            return

        avatar = self.air.doId2do.get(avatarId)
        if avatar is None or avatar.zoneId != self.ownerZone:
            self.notify.warning("party game requested by %s, who isn't in their house" % avatarId)
            return

        # spent when the game triggers, see triggerPartyGame
        itemId = PartyConstants.partyGameItemId(gameId)
        if not any(item == itemId and amount > 0
                   for item, _slot, amount in self.air.inventoryManager.getPouch(avatarId)):
            self.notify.warning("party game %s requested by %s, who doesn't own it" % (gameId, avatarId))
            return

        lobby = DistributedPartyMatchMakerAI(self.air, self, avatarId, gameId)
        self.partyGameLobby = lobby
        self.air.generateWithRequired(lobby, self.getDoId(), self.ownerZone)

        self.notify.info("%s opened a lobby for party game %s" % (avatarId, gameId))

    # one use of the game ticks off the host's pouch and the entry goes at zero
    # a cancelled lobby never gets here, and placed tables aren't spent (loadHomeGames)
    def spendPartyGame(self, gameId):
        itemId = PartyConstants.partyGameItemId(gameId)

        if not self.air.inventoryManager.removeIngredientsFromPouch(self.ownerId, itemId, 1):
            self.notify.warning("%s's party game %s was already gone from the pouch" % (self.ownerId, gameId))
            return

        host = self.air.doId2do.get(self.ownerId)
        if host is not None:
            host.d_syncPouchAfterChanges()

    def closePartyGameLobby(self, reason):
        lobby = self.partyGameLobby
        if lobby is None:
            return

        self.partyGameLobby = None
        lobby.requestDelete()

        self.notify.info("Closed %s's party game lobby because %s" % (self.ownerId, reason))

    def triggerPartyGame(self, lobby):
        if lobby is not self.partyGameLobby or self.partyGame is not None:
            return

        # A hosted game zone, not a district dynamic zone: the client only treats a
        # zone at or above HOSTED_GAME_ZONE_START as a multiplayer game room.
        zoneId = self.air.allocHostedGameZone()

        game = DistributedMultiplayerMinigameAI(
            self.air, self, lobby.gameId, lobby.leader, lobby.players)
        self.partyGame = game
        self.air.partyGames[zoneId] = game

        # Under the district, which is what the players' PlayerStruct.district
        # names and so where toGameMatch flies them.
        self.air.generateWithRequired(game, self.air.districtId, zoneId)

        lobby.d_setGameTriggered(zoneId)
        self.spendPartyGame(lobby.gameId)

        if self.home is not None:
            self.home.b_setMinigame(lobby.gameId, lobby.players)

        self.partyGameLobby = None
        lobby.scheduleDelete(PartyConstants.LOBBY_LINGER_SECS)

        self.notify.info(
            "Party game %s for %d fairies from %s's home is in zone %s"
            % (lobby.gameId, len(lobby.players), self.ownerId, zoneId))

    # the home's list is who is away playing, and a fairy who dropped out is no longer away,
    # left on it they'd get the game's panel back at their next login
    def partyGamePlayerLeft(self, game, avId):
        if game is not self.partyGame or self.home is None:
            return

        remaining = [player for player in self.home.minigamePlayers if player[0] != avId]
        if len(remaining) != len(self.home.minigamePlayers):
            self.home.b_setMinigame(self.home.minigameId, remaining)

    def closePartyGame(self, game, reason):
        if game is not self.partyGame:
            return

        self.partyGame = None
        self.air.partyGames.pop(game.zoneId, None)

        if self.home is not None:
            self.home.b_setMinigame(0, [])

        game.realm = None
        game.close()

        self.notify.info("Closed %s's party game because %s" % (self.ownerId, reason))

    # --- Game tables ---

    def loadHomeGames(self):
        # Put back out the tables the owner left in their home and garden.
        fairy = self._fairies().find_one({"_id": self.ownerId}, {"homeGames": 1})
        if not fairy:
            return

        records = fairy.get("homeGames", [])
        kept = []
        changed = False

        for record in records:
            tag = record.get("tag")

            if tag in self.homeGames or not HomeGames.MIN_TAG <= (tag or 0) <= HomeGames.MAX_TAG:
                continue

            if not record.get("spent"):
                # put out before a placed game left the pouch, so it's still in there
                if not self.air.inventoryManager.removeIngredientsFromPouch(self.ownerId, record["item_id"], 1):
                    continue
                record["spent"] = True
                changed = True

            kept.append(record)
            self._generateHomeGame(record)

        if changed or len(kept) != len(records):
            self._fairies().update_one({"_id": self.ownerId}, {"$set": {"homeGames": kept}})
            self._syncOwnerPouch()

    def _syncOwnerPouch(self):
        owner = self.air.doId2do.get(self.ownerId)
        if owner is not None:
            owner.d_syncPouchAfterChanges()

    def _generateHomeGame(self, record):
        table = DistributedHomeHotspotAI(
            self.air, self.ownerId,
            tagId=record["tag"], gameItemId=record["item_id"],
            hotspotId=record["hotspot_id"], invId=record["inv_id"],
            x=record["x"], y=record["y"], roomId=record["roomId"])

        self.air.generateWithRequired(table, self.getDoId(), self.ownerZone)
        self.homeGames[table.tagId] = table

        # The game itself. Clicking the table opens the launcher for whichever
        # meadow game in the zone has the table's tag as its hotspot id.
        game = HomeGames.createTableGame(self.air, table.gameItemId, self.ownerId)
        if game is not None:
            game.setGameInfo(table.gameItemId, game.minPlayers, game.maxPlayers, 0, table.tagId)
            game.setPosition(table.x, table.y)
            self.air.generateWithRequired(game, self.getDoId(), self.ownerZone)
            table.game = game

        return table

    def _deleteHomeGame(self, table):
        if table.game is not None:
            table.game.requestDelete()
            table.game = None
        table.requestDelete()

    def _freeHotspotTag(self):
        for tag in range(HomeGames.MIN_TAG, HomeGames.MAX_TAG + 1):
            if tag not in self.homeGames:
                return tag

        return None

    def requestHotspotTag(self, avatarId):
        # the client asks in its own home or garden only, a new ask replaces any pending tag
        if avatarId != self.ownerId:
            self.notify.warning(
                "hotspot tag requested in %s's home by %s, not the owner" % (self.ownerId, avatarId))
            return

        tag = self._freeHotspotTag()
        if tag is None:
            self.notify.warning("no free hotspot tag left in %s's home" % self.ownerId)
            return

        self.pendingHotspotTag = tag
        self.home.sendUpdateToAvatarId(avatarId, "setNewHotspotTagId", [tag])

    def requestDropGame(self, invId, gameItemId, hotspotId, x, y, depth, roomId,
                        dropChance, tagId):
        # ActivityManager.dispatchGameDrop: the owner set the placeholder table down.
        # The argument order is the client's, not the dc parameter names'.
        avatarId = self.air.getAvatarIdFromSender()

        if avatarId != self.ownerId:
            self.notify.warning(
                "requestDropGame in %s's home from %s, not the owner" % (self.ownerId, avatarId))
            return

        avatar = self.air.doId2do.get(avatarId)
        if avatar is None or avatar.zoneId != self.ownerZone:
            self.notify.warning("requestDropGame from %s, who isn't in their home" % avatarId)
            return

        if tagId != self.pendingHotspotTag or tagId in self.homeGames:
            self.notify.warning(
                "requestDropGame from %s with tag %s, expected %s"
                % (avatarId, tagId, self.pendingHotspotTag))
            return

        if (not HomeGames.isGameItem(gameItemId)
                or HomeGames.tableHotspots().get(gameItemId) != hotspotId):
            self.notify.warning(
                "requestDropGame from %s for item %s as hotspot %s, not a game table"
                % (avatarId, gameItemId, hotspotId))
            return

        # A pouch entry's inventory id is its item id (InventoryEntryRequest
        # .createFromStackable), and that's what the client hands back.
        if invId != gameItemId:
            self.notify.warning(
                "requestDropGame from %s with inventory id %s for item %s"
                % (avatarId, invId, gameItemId))
            return

        if not isValidRoomType(roomId):
            self.notify.warning("requestDropGame from %s into room %r" % (avatarId, roomId))
            return

        if sum(1 for table in self.homeGames.values()
               if table.roomId == roomId) >= HomeGames.MAX_TABLES_PER_ROOM:
            self.notify.warning("requestDropGame from %s, room %s is full" % (avatarId, roomId))
            return

        # a placed game leaves the pouch, so there has to be one in it
        if not self.air.inventoryManager.removeIngredientsFromPouch(avatarId, gameItemId, 1):
            self.notify.warning("requestDropGame from %s for item %s, who has none in the pouch" % (avatarId, gameItemId))
            return

        self.pendingHotspotTag = None

        record = {
            "tag": tagId,
            "item_id": gameItemId,
            "hotspot_id": hotspotId,
            "inv_id": invId,
            "x": HomeGames.clampPosition(x),
            "y": HomeGames.clampPosition(y),
            "roomId": roomId,
            "spent": True,
        }
        self._fairies().update_one({"_id": self.ownerId}, {"$push": {"homeGames": record}})
        self._generateHomeGame(record)
        self._syncOwnerPouch()

        self.notify.info(
            "%s put a table for game %s in room %s of their home (tag %s)"
            % (avatarId, gameItemId, roomId, tagId))

    def removeHomeHotspotObject(self, doId):
        # "Return" on a placed table (MeadowHomeHotspot.onRemoveHotspot, MeadowGameLauncher.onRemoveGame)
        # the game goes back in the pouch
        avatarId = self.air.getAvatarIdFromSender()
        if avatarId != self.ownerId:
            self.notify.warning(
                "removeHomeHotspotObject in %s's home from %s, not the owner"
                % (self.ownerId, avatarId))
            return

        table = next((table for table in self.homeGames.values() if table.doId == doId), None)
        if table is None:
            self.notify.warning("removeHomeHotspotObject from %s for unknown object %s" % (avatarId, doId))
            return

        # Not out from under a game being played at it.
        if table.game is not None and table.game.players:
            self.notify.warning(
                "removeHomeHotspotObject from %s for table %s, which has players seated"
                % (avatarId, table.tagId))
            return

        self._removeHomeGame(table)

    def _removeHomeGame(self, table):
        self.homeGames.pop(table.tagId, None)
        self._fairies().update_one(
            {"_id": self.ownerId}, {"$pull": {"homeGames": {"tag": table.tagId}}})
        self._deleteHomeGame(table)
        self.air.inventoryManager.addIngredientsToPouch(self.ownerId, table.gameItemId, 1, -1)
        self._syncOwnerPouch()

    def loadGardenPlots(self):
        # a plot for every spot the garden has room for, growing or empty (client only mounts them in the garden)
        fairy = self._fairies().find_one(
            {"_id": self.ownerId}, {"gardenType": 1, "gardenPlots": 1})

        gardenType = (fairy or {}).get("gardenType") or GardenData.DEFAULT_GARDEN_TYPE
        records = {
            record.get("plotNum"): record
            for record in (fairy or {}).get("gardenPlots", [])
        }

        plotNumbers = GardenData.plotNumbers(gardenType)

        if not plotNumbers:
            self.notify.warning(
                f"garden type {gardenType} has no plots; fairy {self.ownerId} "
                "gets a garden they cannot plant in")
            return

        for plotNum in plotNumbers:
            plot = DistributedGardenPlotAI(
                self.air, self.ownerId, plotNum, records.get(plotNum))

            self.air.generateWithRequired(plot, self.getDoId(), self.ownerZone)
            self.gardenPlots[plotNum] = plot

    def _generateHomeItem(self, item):
        home = item["home"]
        # only send non-zero colors, 0 means undyed and would override the item's defaults
        colorIds = [c for c in (item.get("color1", 0), item.get("color2", 0)) if c]

        homeItem = DistributedHomeItemAI(
            self.air, self.ownerId,
            invId=item["inv_id"],
            itemId=item["item_id"],
            colorIds=colorIds,
            x=home["x"], y=home["y"], depth=home["depth"],
            flip=home["flip"], scale=home["scale"], roomId=home["roomId"])

        # Parent to the realm (not the district) in the owner's housing zone.
        self.air.generateWithRequired(homeItem, self.getDoId(), self.ownerZone)
        self.homeItems[item["inv_id"]] = homeItem
        return homeItem

    def addHomeObject(self, invId, x, y, depth, flip, roomId, scale):
        # the client placed a storage item, record it in a `home` sub-doc and keep it in storage

        # only house or garden placements, anything else can't be picked up again so refuse it
        if not isValidRoomType(roomId):
            self.notify.warning(
                "addHomeObject: refusing room %r for item %s in %s's home"
                % (roomId, invId, self.ownerId))
            return

        self._fairies().update_one(
            {"_id": self.ownerId, "avatar.items.inv_id": invId},
            {"$set": {
                "avatar.items.$.home": {
                    "roomId": roomId, "x": x, "y": y,
                    "depth": depth, "flip": flip, "scale": scale
                }
            }})

        homeItem = self.homeItems.get(invId)
        if homeItem is not None:
            # already have this one, it's a re-sync after a room switch so apply the new position
            homeItem.updatePlacement(x, y, depth, flip, scale, roomId)
            return

        result = self._fairies().find_one(
            {"_id": self.ownerId, "avatar.items.inv_id": invId},
            {"avatar.items.$": 1})
        if not result or not result.get("avatar", {}).get("items"):
            self.notify.warning(
                "addHomeObject: item %s not found for owner %s" % (invId, self.ownerId))
            return

        self._generateHomeItem(result["avatar"]["items"][0])

    def removeHomeObject(self, invId, doId):
        # The client took a placed item back into storage.
        self._fairies().update_one(
            {"_id": self.ownerId, "avatar.items.inv_id": invId},
            {"$set": {"avatar.items.$.location": "Storage"},
             "$unset": {"avatar.items.$.home": ""}})

        homeItem = self.homeItems.pop(invId, None)
        if homeItem is not None:
            homeItem.requestDelete()

    def clearHomeItems(self):
        returnPlacedItemsToStorage(self.air, self.ownerId)

        for homeItem in list(self.homeItems.values()):
            homeItem.requestDelete()
        self.homeItems.clear()

        # A home reset takes the house's tables down with its furniture.
        for table in [table for table in self.homeGames.values() if table.roomId == ROOM_TYPE_HOME]:
            self.homeGames.pop(table.tagId, None)
            self._deleteHomeGame(table)
        HomeGames.removeHouseTables(self.air, self.ownerId)

    def delete(self):
        # Clean up our generated furniture and the house object with the realm.
        for homeItem in list(self.homeItems.values()):
            homeItem.requestDelete()
        self.homeItems.clear()
        for table in list(self.homeGames.values()):
            self._deleteHomeGame(table)
        self.homeGames.clear()
        # Only the objects go; what is growing in them is in the database, and
        # keeps growing while nobody is here to watch.
        for plot in list(self.gardenPlots.values()):
            plot.requestDelete()
        self.gardenPlots.clear()
        self._pruneDeletedSurprises()
        for surprise in list(self.postOfficeSurprises):
            surprise.requestDelete()
        self.postOfficeSurprises.clear()
        self.closePartyGameLobby("the home realm closed")
        if self.partyGame is not None:
            self.closePartyGame(self.partyGame, "the home realm closed")
        self.endParty("the home realm closed")
        if self.home is not None:
            self.home.requestDelete()
            self.home = None
        DistributedDistrictAI.delete(self)

    def setParentingRules(self, style, rule):
        pass

    def createHomeRequest(self, avatarId):
        pass

    def setServerTime(self, refresh):
        # the party lobby countdown runs off this, so a house answers it like a meadow district
        if refresh:
            self.sendUpdateToAvatarId(
                self.air.getAvatarIdFromSender(), "setServerTime", [int(time.time())])

    def setPetState(self, avatarId, state):
        pass

    def bootRequest(self, avatarId):
        # bootRequest is clsend, only the home owner may eject someone
        senderId = self.air.getAvatarIdFromSender()
        if senderId != self.ownerId:
            self.notify.warning(
                "bootRequest for %s in %s's home from %s, not the owner - ignoring"
                % (avatarId, self.ownerId, senderId))
            return

        # An owner booting themselves would just fling them out of their own
        # home; nothing to do.
        if avatarId == self.ownerId:
            return

        # tell the booted fairy's client directly, bootedFromZone lives on the player not the realm
        self.air.sendUpdateToDoId(
            "DistributedFairyPlayer", "bootedFromZone", avatarId,
            [self.ownerZone],
            channelId=self.GetPuppetConnectionChannel(avatarId))
