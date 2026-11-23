from typing import Dict

from direct.directnotify import DirectNotifyGlobal
from direct.distributed.PyDatagram import PyDatagram
from direct.distributed.PyDatagramIterator import PyDatagramIterator
from game.fairies.ai import StaffTiers
from game.fairies.ai.FairiesAIMsgTypes import *
from game.fairies.ai.DatabaseObject import DatabaseObject
from game.fairies.fairy.DistributedFairyPlayerAI import DistributedFairyPlayerAI
from game.fairies.distributed.FairiesRealmAI import FairiesRealmAI
from game.fairies.distributed.FairiesGlobals import *
from game.fairies.distributed.RealmGlobals import OBJECT_TYPE_REALM
from game.fairies.distributed.RealmPopulation import RealmPopulationRegistry
from game.fairies.housing.FairiesHomeRealmAI import FairiesHomeRealmAI
from game.fairies.distributed.MongoInterface import MongoInterface
from game.fairies.meadow.DistributedMeadowAI import DistributedMeadowAI
from game.fairies.meadow.IngredientSpawnMgrAI import IngredientSpawnMgrAI
from game.fairies.meadow.GiveawaySpawnMgrAI import GiveawaySpawnMgrAI
from game.fairies.meadow.HuntSpawnMgrAI import HuntSpawnMgrAI
from game.fairies.minigame import MinigameConstants
from game.fairies.minigame.DistributedTalentMinigameAI import DistributedTalentMinigameAI
from game.fairies.minigame.DistributedCraftingMinigameAI import DistributedCraftingMinigameAI
from game.fairies.gateway.GatewayManagerAI import GatewayManagerAI
from game.fairies.uberdog import HolidayManagerUD
from game.fairies.fairy.npc.DistributedFairyQuestNPCAI import DistributedFairyQuestNPCAI
from game.fairies.fairy.npc.QuestMgr import QuestMgr
from paths import WEB
from game.fairies.fairy.npc.DistributedFairyShopkeeperNPCAI import DistributedFairyShopkeeperNPCAI
from game.fairies.minigame.DistributedMatchGameAI import DistributedMatchGameAI
from game.fairies.minigame.DistributedCrazyEightsAI import DistributedCrazyEightsAI
from game.fairies.minigame.DistributedDerbyCartRacingAI import DistributedDerbyCartRacingAI
from game.fairies.fairy import FamousFairyData
from game.fairies.fairy import PuppetControl
from game.fairies.show.ShowManagerAI import ShowManagerAI
from game.fairies.badges.EmoteBadgesAI import EmoteBadgesAI
from game.fairies.ai import ZoneConstants
from game.fairies.ai.FairiesMagicWordManagerAI import FairiesMagicWordManagerAI
from game.fairies.magicwords.queue import startDistrictPolling
from game.fairies.ai.FairyExperienceManagerAI import FairyExperienceManagerAI
from game.fairies.ai.PetMgrAI import PetMgrAI
from game.fairies.pet import pet_state
from game.fairies.shop.data import SHOPS
from game.otp.ai.AIDistrict import AIDistrict
from game.otp.server.ServerBase import ServerBase
from game.otp.server.ServerGlobals import PIXIE_HOLLOW
from game.fairies.fairy.npc.QuestZoneData import QUEST_ZONES


class FairiesAIRepository(AIDistrict, ServerBase, RealmPopulationRegistry):
    notify = DirectNotifyGlobal.directNotify.newCategory("FairiesAIRepository")

    def __init__(self, *args, **kw):
        AIDistrict.__init__(self, *args, **kw)
        ServerBase.__init__(self)
        RealmPopulationRegistry.__init__(self)

        self.mongoInterface = MongoInterface(self)
        HolidayManagerUD.bind(self.mongoInterface.mongodb)

        self.experienceManager = FairyExperienceManagerAI(self)

        # accountId -> staff tier, for everyone who has logged in as staff since
        # this district started. Read through getAccountType/isStaff.
        self.accountMap: Dict[int, str] = {}
        self.zoneToMeadow: Dict[int, DistributedMeadowAI] = {}

        # Home realms this district AI is currently hosting, keyed by doId.
        # The RealmGuardian asks us to spawn these on demand.
        self.homeRealms: Dict[int, FairiesHomeRealmAI] = {}

        # Wilderness instances this district AI is hosting, keyed by doId. The
        # WildernessGuardian asks us to spawn these when a lobby triggers.
        self.wildernessInstances: Dict[int, object] = {}

        # Party game rooms this district AI is hosting, keyed by their hosted game
        # zone. A home realm we host launches these from its party game lobby.
        self.partyGames: Dict[int, object] = {}
        self.showManager = None
        self.emoteBadges = None

    def getGameDoId(self):
        return OTP_DO_ID_FAIRIES

    def getMinDynamicZone(self):
        # Override this to return the minimum allowable value for a
        # dynamically-allocated zone id.
        return DynamicZonesBegin

    def getMaxDynamicZone(self):
        # Override this to return the maximum allowable value for a
        # dynamically-allocated zone id.

        # Note that each zone requires the use of the channel derived
        # by self.districtId + zoneId.  Thus, we cannot have any zones
        # greater than or equal to self.minChannel - self.districtId,
        # which is our first allocated doId.
        return min(self.minChannel - self.districtId, DynamicZonesEnd) - 1

    def handleConnect(self, msgType, di):
        # We subscribe to BROADCAST_MESSAGE_TO_ALL_AI as soon as we connect, so
        # another district's population report can land before we reach
        # playGame. Record it here rather than let the base class log it as an
        # unexpected message type.
        if msgType == REALM_POPULATION_UPDATE:
            self.handleRealmPopulationUpdate(di)
            return

        AIDistrict.handleConnect(self, msgType, di)

    def handlePlayGame(self, msgType, di):
        if msgType == REALM_GENERATE_REQUEST:
            self._handleRemoteGenerateRequest(di)
            return
        elif msgType == REALM_REGISTER_REQUEST:
            # The RealmGuardian (re)started and wants us to announce ourselves.
            self.registerWithRealmGuardian()
            return
        elif msgType == REALM_DELETE_REQUEST:
            self._handleRealmDeleteRequest(di)
            return
        elif msgType == REALM_MAIL_DELIVERED:
            self._handleMailDelivered(di)
            return
        elif msgType == REALM_PARTY_END_REQUEST:
            self._handlePartyEndRequest(di)
            return
        elif msgType == REALM_POPULATION_UPDATE:
            # Another district (or our own echo) reporting its headcount.
            self.handleRealmPopulationUpdate(di)
            return
        elif msgType == WILDERNESS_GENERATE_REQUEST:
            self._handleWildernessGenerateRequest(di)
            return
        elif msgType == PET_STATE_CHANGED:
            self._handlePetStateChanged(di)
            return

        AIDistrict.handlePlayGame(self, msgType, di)

    # asks whichever district holds this avatar to re-push its pet
    def d_petStateChanged(self, avatarId: int) -> None:
        dg = PyDatagram()
        dg.addServerHeader(BROADCAST_MESSAGE_TO_ALL_AI, self.ourChannel, PET_STATE_CHANGED)
        dg.addUint32(avatarId)
        self.send(dg)

    def _handlePetStateChanged(self, di):
        # Broadcast to every district AI, since the PetMgr uberdog has no idea
        # which one is holding the avatar. Only the AI that actually has it does
        # anything; the rest drop it.
        avatarId = di.getUint32()

        avatar = self.doId2do.get(avatarId)
        if avatar is not None and hasattr(avatar, "refreshPet"):
            # the owner's own client is about to look for the pet beside its fairy (the Animal Friend game's
            # kickoff animation waits on it), so the DNA goes straight to the owner as well as to the zone,
            # the broadcast alone can reach the owner after the kickoff has already given up on the pet
            print(f"[Pet] state changed for {avatarId} in zone {avatar.zoneId}, pushing the pet to its owner")
            pet = pet_state.loadPetAndApplyDecay(self, avatarId)
            # a release keeps the normal path, its screen waits on the detail refreshPet only sends then
            released = bool(pet) and pet.get("status") == pet_state.ANIMAL_FRIEND_RELEASED
            avatar.refreshPet(pet, toOwner=not released)
        else:
            print(f"[Pet] state changed for {avatarId}: not on this district")

        # If this AI is also hosting the owner's home realm, re-seat (or clear)
        # the pet sitting in the house, so toggling Rest/Unrest while standing in
        # your own home updates without having to leave and come back.
        for realm in self.homeRealms.values():
            if realm.ownerId == avatarId:
                realm.refreshRestingPet()
                break

    def sendWildernessMatchRequest(self, avId, adventureId, questId, playerStruct):
        # Forward a client's requestMatchMaker to the WildernessGuardian on the
        # uberdog (which owns the OTP_DO_ID_REALM_GUARDIAN mailbox channel).
        questGroup, questIdx = (list(questId) + [-1, -1])[:2]
        _, dislId, district, zone, name, dislName, talentId, access, level, place = playerStruct

        dg = PyDatagram()
        dg.addServerHeader(OTP_DO_ID_REALM_GUARDIAN, self.ourChannel, WILDERNESS_MATCHMAKER_REQUEST)
        dg.addUint32(avId)
        dg.addInt32(adventureId)
        dg.addInt16(questGroup)
        dg.addInt8(questIdx)
        dg.addUint32(dislId)
        dg.addUint32(district)
        dg.addUint32(zone)
        dg.addString(name)
        dg.addString(dislName)
        dg.addInt8(talentId)
        dg.addInt8(access)
        dg.addInt8(level)
        dg.addInt8(place)
        self.send(dg)

    def _handleWildernessGenerateRequest(self, di):
        context = di.getUint32()
        adventureId = di.getInt32()
        wildernessId = di.getInt32()
        leaderId = di.getUint32()
        questGroup = di.getInt16()
        questIdx = di.getInt8()
        nPlayers = di.getUint16()
        playerIds = [di.getUint32() for _ in range(nPlayers)]
        sender = self.getMsgSender()

        from game.fairies.wilderness.DistributedWildernessAI import DistributedWildernessAI
        from game.fairies.wilderness.WildernessData import WildernessData
        from game.fairies.wilderness.WildernessChallenges import challengeForAdventure

        data = WildernessData.getInstance().loadAllWildernessData()
        layout = data.getLayoutForAdventure(adventureId)
        challenge = challengeForAdventure(adventureId)

        wilderness = DistributedWildernessAI(
            self, adventureId, wildernessId, quest_id=(questGroup, questIdx))
        wilderness.leaderId = leaderId
        wilderness.setAssetURL(layout.asset_url if layout else "")
        wilderness.setCrowdBarriers(0)
        wilderness.setActiveFairies(playerIds)
        if layout:
            wilderness.setActiveBarriers(layout.dynamicBarrierIndices)

        # The client only treats the target as a multiplayer game room when the
        # zone is in the hosted-game range, so this is NOT a district dynamic zone.
        zoneId = self._allocWildernessZone()
        wilderness.generateOtpObject(
            self.district.getDoId(), zoneId, doId=self.allocateChannel())
        self.setAIReceiver(wilderness.getDoId(), self.ourChannel)
        self.wildernessInstances[wilderness.getDoId()] = wilderness

        if challenge:
            wilderness.spawnEnemies(challenge, layout)
        wilderness.spawnGatherables(layout)
        wilderness.spawnExitSign(layout)
        wilderness.armAllPlayersReady()

        self.notify.info(
            "Built wilderness instance %d (adv %d, wild %d) in zone %d for %d players, %d enemies"
            % (wilderness.getDoId(), adventureId, wildernessId, zoneId,
               len(playerIds), len(challenge)))

        dg = PyDatagram()
        dg.addServerHeader(sender, self.ourChannel, WILDERNESS_GENERATE_RESPONSE)
        dg.addUint32(context)
        dg.addUint32(wilderness.getDoId())
        dg.addUint32(self.district.getDoId())
        dg.addUint32(zoneId)
        self.send(dg)

    def _allocWildernessZone(self) -> int:
        from game.fairies.wilderness.WildernessConstants import HOSTED_GAME_ZONE_START
        nxt = getattr(self, "_nextWildernessZone", 0)
        if nxt < HOSTED_GAME_ZONE_START:
            nxt = HOSTED_GAME_ZONE_START
        self._nextWildernessZone = nxt + 1
        return nxt

    def allocHostedGameZone(self) -> int:
        # Wilderness instances and party game rooms share the hosted-game range and
        # its counter, so the two can never be handed the same zone.
        return self._allocWildernessZone()

    def homeRealmForOwner(self, ownerId: int):
        for realm in self.homeRealms.values():
            if realm.ownerId == ownerId:
                return realm
        return None

    def teardownWilderness(self, doId: int) -> None:
        wilderness = self.wildernessInstances.pop(doId, None)
        if wilderness is not None:
            wilderness.requestDelete()
            self.notify.info("Tore down wilderness instance %d" % doId)

    def leaveAnyWilderness(self, avId: int, keepZoneId: int = 0) -> None:
        # Called on avatar delete (logout/disconnect) so a player who vanishes
        # mid-run doesn't linger in activeFairies or block an empty instance
        # from being reaped, and on every zone change with the zone they landed
        # in, so walking out through the exit sign counts as leaving too.
        for wilderness in list(self.wildernessInstances.values()):
            if wilderness.zoneId == keepZoneId:
                continue
            if avId in wilderness.activeFairies:
                wilderness.onFairyLeft(avId)

    def sendRealmOccupancyUpdate(self, avatarId, ownerId, fromOwnerId=0):
        # Tell the RealmGuardian an avatar moved out of fromOwnerId's home realm
        # and into ownerId's, where 0 on either side means "no home", so it can
        # tear down empty ones.
        #
        # fromOwnerId is not just bookkeeping. Entering a home realm hosted by a
        # different district AI process migrates the avatar object to it: this
        # process deletes its copy and reports the departure while the other
        # generates a fresh one and reports the arrival, and the two race. Saying
        # which realm we believe is being left lets the guardian discard a
        # departure that the arrival has already overtaken, instead of tearing
        # down the realm the fairy just flew into.
        dg = PyDatagram()
        dg.addServerHeader(OTP_DO_ID_REALM_GUARDIAN, self.ourChannel, REALM_OCCUPANCY_UPDATE)
        dg.addUint32(avatarId)
        dg.addUint32(ownerId)
        dg.addUint32(fromOwnerId)
        self.send(dg)

    def sendMailArrivedToRealmGuardian(self, recipientId, typeId):
        # Post Office mail was just written for `recipientId`. Only the
        # RealmGuardian knows whether that fairy has a home realm up right now
        # and which district AI is hosting it, so hand it off and let it route.
        dg = PyDatagram()
        dg.addServerHeader(OTP_DO_ID_REALM_GUARDIAN, self.ourChannel, REALM_MAIL_ARRIVED)
        dg.addUint32(recipientId)
        dg.addUint32(typeId)
        self.send(dg)

    def _handleMailDelivered(self, di):
        # The RealmGuardian tells us mail landed for a home realm we host. Put
        # the mailbox out now; the owner may be standing in the room, and
        # loadPostOfficeSurprises only ever runs at realm generate.
        realmId = di.getUint32()
        typeId = di.getUint32()

        realm = self.homeRealms.get(realmId)
        if realm is None:
            # Torn down between the guardian's lookup and this message; the next
            # generate will load the mailbox from the message count anyway.
            return

        realm.ensurePostOfficeSurprise(typeId)

    def sendPartyUpdateToRealmGuardian(self, realmId, ownerId, party):
        # A home realm we host started, changed or ended (party None) its owner's
        # party. The RealmGuardian answers everyone's homeTeleportRequest, and
        # that answer is where a house's party decorations come from.
        themeId = party.themeId if party is not None else 0
        nameIds = party.nameIds if party is not None else [0, 0, 0]

        dg = PyDatagram()
        dg.addServerHeader(OTP_DO_ID_REALM_GUARDIAN, self.ourChannel, REALM_PARTY_UPDATE)
        dg.addUint32(realmId)
        dg.addUint32(ownerId)
        dg.addUint8(themeId)
        for nameId in nameIds:
            dg.addUint8(nameId)
        dg.addUint8(party.public if party is not None else 0)
        dg.addInt32(party.startTime if party is not None else 0)
        self.send(dg)

    def _handlePartyEndRequest(self, di):
        # The RealmGuardian says the owner of a home realm we host has been away
        # from home too long for their party to carry on.
        realmId = di.getUint32()

        realm = self.homeRealms.get(realmId)
        if realm is not None:
            realm.endParty("the owner was away from home too long")

    def _handleRealmDeleteRequest(self, di):
        realmId = di.getUint32()
        realm = self.homeRealms.pop(realmId, None)
        if realm is not None:
            realm.requestDelete()
            self.notify.info("Deleted home realm %d" % realmId)

    def registerWithRealmGuardian(self):
        # Tell the RealmGuardian uberdog our district doId and AI channel so it
        # can route home-realm generate requests back to this process.
        dg = PyDatagram()
        dg.addServerHeader(OTP_DO_ID_REALM_GUARDIAN, self.ourChannel, SHARDMANAGER_ONLINE)
        dg.addUint32(self.districtId)
        dg.addChannel(self.ourChannel)
        self.send(dg)

        # Registering means we (re)started, so our old headcount -- if anyone
        # still remembers one -- is stale. Publish the real one straight away.
        self.broadcastRealmPopulation()

    def _handleRemoteGenerateRequest(self, di):
        context = di.getUint32()
        objectType = di.getUint8()
        ownerId = di.getUint32()
        sender = self.getMsgSender()

        doId, parentId, zoneId = self.createRemoteObject(objectType, ownerId)

        dg = PyDatagram()
        dg.addServerHeader(sender, self.ourChannel, REALM_GENERATE_RESPONSE)
        dg.addUint32(context)
        dg.addUint32(doId)
        dg.addUint32(parentId)
        dg.addUint32(zoneId)
        self.send(dg)

    def createRemoteObject(self, objectType, ownerId):
        # Generate an object requested remotely by the RealmGuardian and return
        # (doId, parentId, zoneId). Home realms are district-siblings, so they
        # live under OTP_DO_ID_FAIRIES / OTP_ZONE_ID_DISTRICTS like a shard.
        if objectType == OBJECT_TYPE_REALM:
            realm = FairiesHomeRealmAI(self, ownerId)
            realm.generateOtpObject(
                OTP_DO_ID_FAIRIES, OTP_ZONE_ID_DISTRICTS,
                doId=self.allocateChannel())
            self.setAIReceiver(realm.getDoId(), self.ourChannel)
            realm.b_setAvailable(1)

            # Populate the realm with the owner's saved furniture.
            realm.loadHomeItems()

            # And the game tables they've dropped in from their pouch.
            realm.loadHomeGames()

            # The plots of their garden, and whatever is growing in them.
            realm.loadGardenPlots()

            # The house object itself (carries hotspots/parties and the resting pet).
            realm.generateHome()

            # Show a Post Office mailbox for any postcards/gift sets waiting.
            realm.loadPostOfficeSurprises()

            self.homeRealms[realm.getDoId()] = realm
            self.notify.info(
                "Generated home realm %d for owner %d" % (realm.getDoId(), ownerId))
            return realm.getDoId(), OTP_DO_ID_FAIRIES, OTP_ZONE_ID_DISTRICTS

        self.notify.warning("createRemoteObject: unknown object type %s" % objectType)
        return 0, 0, 0

    def createObjects(self):
        self.district = FairiesRealmAI(self, self.districtName)
        self.district.generateOtpObject(
                OTP_DO_ID_FAIRIES, OTP_ZONE_ID_DISTRICTS,
                doId=self.districtId)

        self.setAIReceiver(self.district.getDoId(), self.ourChannel)

        # Two For Tea (gameId 13072) - the Tearoom has four 2-player tables that
        # all share hotspot id 27625 in the meadow XML, distinguished only by
        # tagId (7/8/9/10). The client keys each game object by the hotspot's
        # tagId (it calls activateMeadowGameLauncher(gameId, tagId) and
        # getMeadowGameByHotSpotId(tagId)), which maps to the game's hotspotId
        # field, so we spawn one independent instance per table with its
        # hotspotId set to that tagId. Positions mirror the hotspot x/y.
        for tagId, x, y in ((7, 196, 375), (8, 364, 363), (9, 818, 361), (10, 975, 375)):
            table = DistributedMatchGameAI(self)
            table.setGameInfo(13072, 2, 2, 0, tagId)
            table.setPosition(x, y)
            table.generateWithRequired(ZoneConstants.THE_TEAROOM)

        # Crazy Cakes (gameId 13070) - the Tearoom's two Crazy Eights tables, seating
        # 2-4 each.
        for tagId, x, y in ((11, 342, 486), (12, 206, 599)):
            table = DistributedCrazyEightsAI(self)
            table.setGameInfo(13070, 2, 4, 0, tagId)
            table.setPosition(x, y)
            table.generateWithRequired(ZoneConstants.THE_TEAROOM)

        # Animal Derby (gameId 13073) - the Fairy Coliseum's six starting gates, 2-4
        # racers each. Keyed by hotspot tagId like the Tearoom tables above.
        for tagId, x, y in ((1, 535, 566), (2, 911, 612), (3, 706, 710),
                            (4, 1117, 720), (5, 1142, 541), (6, 1366, 628)):
            race = DistributedDerbyCartRacingAI(self)
            race.setGameInfo(13073, 2, 4, 0, tagId)
            race.setPosition(x, y)
            race.generateWithRequired(ZoneConstants.FAIRY_COLISEUM)

        for zoneId in ZoneConstants.GAMES_ZONE_LIST:
            minigame = DistributedTalentMinigameAI(self)
            minigame.setGameID(MinigameConstants.getGameIdForZone(zoneId))
            minigame.generateWithRequired(zoneId)

        for zoneId in ZoneConstants.CRAFTING_ZONE_LIST:
            crafting = DistributedCraftingMinigameAI(self)
            if zoneId in (ZoneConstants.MENDYS_TAILORING, ZoneConstants.BOBBINS_TAILORING):
                crafting.setProfessionID(MinigameConstants.CRAFT_TYPE_TAILORING)
            elif zoneId == ZoneConstants.DULCIES_BAKING:
                crafting.setProfessionID(MinigameConstants.CRAFT_TYPE_BAKING)
            else:  # COPPERS_TINKERING
                crafting.setProfessionID(MinigameConstants.CRAFT_TYPE_TINKERING)
            crafting.generateWithRequired(zoneId)

        for zoneId in ZoneConstants.SHOPS_ZONE_LIST + ZoneConstants.MEADOW_ZONES_LIST:
            meadow = DistributedMeadowAI(self)
            meadow.generateWithRequired(zoneId)
            self.zoneToMeadow[zoneId] = meadow

        # Pixie Postings (1200) is a "social zone" -- deliberately outside
        # MEADOW_ZONES_LIST/SHOPS_ZONE_LIST so it's not treated as a real meadow
        # elsewhere (last-meadow tracking, wilderness-return, etc). But that also
        # meant nothing ever generated a DistributedObject there: the client's
        # setInterest() for the zone had nothing to receive and never completed,
        # which is an infinite loading screen from the player's side. It still
        # needs a bare object so interest resolves.
        postings = DistributedMeadowAI(self)
        postings.generateWithRequired(ZoneConstants.PIXIE_POSTINGS)
        self.zoneToMeadow[ZoneConstants.PIXIE_POSTINGS] = postings

        # gateways follow the live holiday tags, see gateway/holidays
        self.gatewayManager = GatewayManagerAI(self)
        self.gatewayManager.start()

        # Wilderness gateway signs (open the matchmaker for their wilderness).
        from game.fairies.wilderness.WildernessGateways import WILDERNESS_GATEWAYS
        from game.fairies.wilderness.DistributedWildernessGatewayAI import DistributedWildernessGatewayAI
        for wildernessId, wgw in WILDERNESS_GATEWAYS.items():
            wgate = DistributedWildernessGatewayAI(self)
            wgate.setWildernessId(wildernessId)
            wgate.setItemId(wgw["itemId"])
            wgate.setPosition(*wgw["position"])
            wgate.setPositionByName("")
            wgate.generateWithRequired(wgw["zone"])

        self.ingredientSpawnMgr = IngredientSpawnMgrAI(self)
        self.ingredientSpawnMgr.start()

        # Giveaways stand at hand-picked coordinates and are never collected
        # away, so they take no part in the ingredient spacing rules above and
        # can go up in any order relative to them.
        self.giveawaySpawnMgr = GiveawaySpawnMgrAI(self)
        self.giveawaySpawnMgr.start()

        self.huntSpawnMgr = HuntSpawnMgrAI(self)
        self.huntSpawnMgr.start()

        # Load quest definitions
        QuestMgr.getInstance().loadQuestsFromXml(str(WEB / 'xml' / 'quests.xml'))

        # DistributedFairyQuestNPC testing
        for qzone in QUEST_ZONES:
            qgiver_ai = DistributedFairyQuestNPCAI(self)
            qzone.generateQuestZone(qgiver_ai)

        for shop in SHOPS:
            shop_ai = DistributedFairyShopkeeperNPCAI(self)
            shop.generate_shop(shop_ai)

        self.badgeManager = self.generateGlobalObject(OTP_DO_ID_FAIRIES_BADGE_MANAGER, "FairiesBadgeManager")
        self.inventoryManager = self.generateGlobalObject(OTP_DO_ID_FAIRIES_INVENTORY_MANAGER, "FairyInventoryMgr")
        self.petManager = self.generateGlobalObject(OTP_DO_ID_FAIRIES_PET_MANAGER, "PetMgr")
        self.leaderBoardManager = self.generateGlobalObject(OTP_DO_ID_LEADERBOARD_MANAGER, "LeaderBoardMgr")

        # The Magic Word Manager
        self.magicWordManager = FairiesMagicWordManagerAI(self)
        self.magicWordManager.generateOtpObject(
            self.districtId, COMMUNITY_ALERTS_ALL,
            doId=self.allocateChannel())

        # GM-portal command queue (gm-tool-plan.md Phase 1): claims a
        # district-scoped command only if its target fairy is actually here.
        # See magicwords/queue.py.
        startDistrictPolling(self)
        PuppetControl.forgetDistrictPuppets(self)
        self.showManager = ShowManagerAI(self)
        self.emoteBadges = EmoteBadgesAI(self)

        # mark district as avaliable
        self.district.b_setAvailable(1)

        if self.isProdServer():
            # Register us with the API server
            self.sendPopulation()

        # Announce ourselves to the RealmGuardian so it can spawn home realms
        # in this district AI process on demand.
        self.registerWithRealmGuardian()

        self.notify.info("Ready!")

    def updateShard(self):
        if self.isProdServer():
            # This is the production server.
            # Send our population update.
            self.sendPopulation()

        # Update the population on the district (realm) as well.
        #
        # This deliberately counts home realm visitors too. A home realm is its
        # own distributed object, but it is hosted by this district AI process,
        # so a big party in one house is real strain on everyone else in the
        # realm. Letting a district advertise itself as quiet while it carries
        # that load would just push more fairies onto it and cause lag.
        self.district.updatePopulationLevel()

        # ...and tell the rest of the cluster. Other district AIs need it to
        # answer fly-to-fairy requests aimed at us, and the RealmGuardian needs
        # it to decide where to put new home realms.
        self.broadcastRealmPopulation()

    # avatar id too, an account can own three fairies and the friends manager can't guess which is in the game
    def sendFriendManagerAccountOnline(self, accountId, avatarId):
        dg = PyDatagram()
        dg.addServerHeader(OTP_DO_ID_PLAYER_FRIENDS_MANAGER, self.ourChannel, FRIENDMANAGER_ACCOUNT_ONLINE)
        dg.addUint32(accountId)
        dg.addUint32(avatarId)
        self.send(dg)

    def sendFriendManagerAccountOffline(self, accountId, avatarId):
        dg = PyDatagram()
        dg.addServerHeader(OTP_DO_ID_PLAYER_FRIENDS_MANAGER, self.ourChannel, FRIENDMANAGER_ACCOUNT_OFFLINE)
        dg.addUint32(accountId)
        dg.addUint32(avatarId)
        self.send(dg)

    def fillInFairyPlayer(self, fairyPlayer) -> None:
        dbo = DatabaseObject(self, fairyPlayer.doId)
        # Add more fields if needed. (Good spot to look if the field you want
        # is an ownrequired field, but no required or ram.)
        dbo.readObject(fairyPlayer, ["setGold", "setExperiencePoints"])

        # the stored gold lands after this returns, so settle the shared wallet on top of it
        loaded = dbo.gotDataHandler

        def goldLoaded(do, dclass):
            loaded(do, dclass)

            if do.doId in self.doId2do:
                do._reconcileSharedGold()

        dbo.gotDataHandler = goldLoaded

        fairyPlayer.b_setDailyChancePlayed(0 if fairyPlayer.dailyChanceCanSpin() else 1)

    def readFairyPlayer(self, fairyPlayerId, fields = None, doneEvent = '') -> DistributedFairyPlayerAI:
        dbo = DatabaseObject(self, fairyPlayerId, doneEvent)
        return dbo.readFairyPlayer(fields)

    def sendPopulation(self):
        data = {
            'token': config.GetString('api-token'),
            'population': self.getPopulation(),
            'serverType': PIXIE_HOLLOW,
            'shardName': self.districtName,
            'shardId': self.districtId
        }

        headers = {
            'User-Agent': 'Sunrise Games - FairiesAIRepository'
        }

        try:
            requests.post('https://api.sunrise.games/api/setPopulation', json=data, headers=headers)
        except:
            self.notify.warning('Failed to send district population!')

    def incrementPopulation(self):
        AIDistrict.incrementPopulation(self)
        self.updateShard()

    def decrementPopulation(self):
        AIDistrict.decrementPopulation(self)
        self.updateShard()

    def setAllowModerationActions(self, accountId: int, accountType: str) -> None:
        """
        Record a staff member's tier, as broadcast by FairyClient.lua at login.

        Every district gets this, not just the one the staff member lands on --
        it is a BROADCAST_MESSAGE_TO_ALL_AI -- which is what lets them use magic
        words after flying to another district. Assignment rather than
        set-once-and-keep: a tier that changed between logins has to take.
        """
        if StaffTiers.isStaff(accountType):
            self.accountMap[accountId] = accountType
        else:
            # Not a tier we recognize. Whatever we thought before, drop it.
            self.accountMap.pop(accountId, None)

    def getAccountType(self, accountId: int) -> str:
        """
        The staff tier of an account, or Player if we have never been told.

        Deliberately not cleared when the avatar is deleted: that also happens
        on every district migration (flying between houses does it), and
        dropping the tier there would leave a GM unable to use magic words on a
        district they had already visited. The entry is rewritten at each
        login, and it grants nothing on its own -- staff status is an
        account-level thing, not an avatar-class one, so a staff member playing
        as an ordinary fairy (gm-mode off) still gets magic words.
        """
        return self.accountMap.get(accountId, StaffTiers.PLAYER)

    def isStaff(self, accountId: int) -> bool:
        return StaffTiers.isStaff(self.getAccountType(accountId))
