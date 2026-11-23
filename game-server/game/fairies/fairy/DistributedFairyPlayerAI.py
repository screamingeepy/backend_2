from datetime import datetime, timezone
import time
import random

from direct.showbase.MessengerGlobal import messenger

from game.otp.otpbase import OTPGlobals

from .DistributedFairyBaseAI import DistributedFairyBaseAI
from game.fairies.ai import AccountControl
from game.fairies.fairy import name_xml
from game.fairies.ai.BakingAssets import BAKED_ITEMS
from game.fairies.fairy.AuraMapping import AURA_MAPPING, SKIN_COLOR_MAPPING, WING_COLOR_MAPPING
from game.fairies.fairy.structs.RewardExt import RewardExt
from game.fairies.housing import GardenData
from game.fairies.fairy.structs.MiscItem import MiscItem
from game.fairies.fairy.structs.LiteInvItemExt2 import LiteInvItemExt2
from game.fairies.fairy.structs.SavedOutfit import SavedOutfit

from game.fairies.badges import badge_events, badge_state
from game.fairies.daily.DailyChanceConstants import (
    Category,
    EXCLUDE_STORAGE,
    EXCLUDE_WARDROBE,
    FREE_ACORNS,
    MEMBER_ACORNS,
    SPIN_BADGE_ID_SET,
    SPIN_ROCK_ITEM_IDS,
)
from game.fairies.daily.DailyChancePool import draw_daily_spin
from game.fairies.daily.DailyChanceGrant import grant_prize
from game.fairies.daily.TimeUtils import get_period_start

from game.fairies.housing.HouseConstants import (
    HOUSING_ZONE_OFFSET, ROOM_TYPE_HOME, isValidRoomType)
from game.fairies.housing import PartyConstants
from game.fairies.meadow import meadow_xml, TrickOrTreat
from game.fairies.ai import ZoneConstants
from game.fairies.ai import ZoneConstants
from game.fairies.fairy.npc.QuestMgr import QuestMgr, DISABLED_QUEST_IDS, QUEST_TYPE_VISIT_ZONE
from game.fairies.fairy.npc.DistributedQuest import DistributedQuest, QUEST_OBJECT_ZONE
from game.fairies.pet import pet_state, pet_xml

# Mail types that light the client's HUD gift-box; written by the shopkeeper AI.
MAIL_STATUS_POSTCARD = 4
MAIL_STATUS_GIFTSET = 5

# Shop purchases by itemId (90002 = Animal Friend instant heal, 90003 = name
# change); the client sends no price.
GLOBAL_PURCHASE_ITEMS = {
    90002: MiscItem.unpackFromTuple((90002, 8006, 0, 3, 3)),
    90003: MiscItem.unpackFromTuple((90003, 8006, 500, 200, 200)),
}

# The insta-heal potion. HealPetPanel offers this or a free trip to Elixa's
# Hospital for a healing quest. The panel falls back to a hardcoded 3 when it has
# no price for the item, so the MiscItem above matches that.
INSTA_HEAL_ID = 90002

# Mirrors the client's SavedOutfits panel: MAX_OUTFIT_TABS(14) * 2 - 1 slots.
DEFAULT_MAX_OUTFIT_SLOTS = 1
MAX_OUTFIT_SLOTS = 27
OUTFIT_SLOTS_PER_PURCHASE = 2

# Charged from gold (the client's diamonds); mirrors SavedOutfits.SLOT_COST.
OUTFIT_SLOT_COST = 10

# The order the client sends invIds in and reads a SavedOutfit struct back in.
OUTFIT_SLOT_ORDER = ("head", "necklace", "shirt", "belt", "skirt", "wrist", "ankle", "shoes")

# The slots a fairy is always dressed in.
MANDATORY_OUTFIT_SLOTS = frozenset({"shirt", "skirt", "shoes"})
MANDATORY_SLOT_NUMBERS = frozenset(
    index + 1
    for index, slot in enumerate(OUTFIT_SLOT_ORDER)
    if slot in MANDATORY_OUTFIT_SLOTS
)

# Slot number -> the field that redraws it; equipping or dyeing must send one.
EQUIP_SLOT_FIELDS = {
    1: "setHeadItem",
    2: "setNecklace",
    3: "setChestItem",
    4: "setBelt",
    5: "setSkirt",
    6: "setWrist",
    7: "setAnkle",
    8: "setShoes",
}

# An empty LiteInvItemExt2 (invId, itemId, color1, color2, howAcquired).
EMPTY_LITE_INV_ITEM = [0, 0, 0, 0, 0]

# Live: gardening and wilderness spells charge dust, cookies and cupcakes and
# level-ups give it back. Turning this off makes every charge free and every
# refill a no-op, so the meter simply stops meaning anything.
PIXIE_POWER_ENABLED = True

# casting a talent skill at a meadow talent spot
TALENT_SPOT_DUST_COST = 30

# TODO: default should be 10 and max 240 once the PixiePower rules are settled.
DEFAULT_PIXIE_POWER = 100  # the setPixiePower default in fairy.dc

class DistributedFairyPlayerAI(DistributedFairyBaseAI):
    def __init__(self, air) -> None:
        DistributedFairyBaseAI.__init__(self, air)

        self.DISLname: str = ""
        self.DISLid: int = 0
        self.gold: int = 0
        self.access: int = 0
        self.level: int = 0
        self.experiencePoints: int = 0
        self.pixiePower: int = DEFAULT_PIXIE_POWER

        self.lastMeadow: int = 0
        self.homeType: int = 0
        self.homeSubType: int = 0
        self.gardenType: int = 0

        # 0 when not in a home; the RealmGuardian tears down the empty ones.
        self.currentHomeOwner: int = 0
        # The party game room zone we're in, or 0.
        self.currentPartyGameZone: int = 0
        
        self.dailyChancePlayed: bool = False

        self.goldTradedToday: int = 0
        self.lastGoldTradeAt = None # date

        self._originalDNA = {}
        self.shopPreviewActive = False
        self.lastPoseStatus = -1
        self.activeQuests = {}

    def sendQuestHistory(self) -> None:
        doc = self.air.mongoInterface.mongodb.fairies.find_one({"_id": self.doId})
        if not doc:
            return
        history_list = []
        for entry in (doc.get("questHistory") or []):
            group = entry.get("questGroup", 0)
            bitmask = entry.get("questBitmask", 0)
            accept_time = entry.get("acceptTimeForLastDone", 0)
            history_list.append((group, bitmask, accept_time))
        self.sendUpdateToAvatarId(self.doId, "setQuestHistory", [history_list])

    def loadQuests(self) -> None:
        self.sendQuestHistory()

        doc = self.air.mongoInterface.mongodb.fairies.find_one({"_id": self.doId})
        if not doc:
            return

        quest_mgr = QuestMgr.getInstance()

        for entry in (doc.get("questState") or []):
            q_id = entry.get("questId")
            step = entry.get("currentStep", 0)

            if q_id is None:
                print(
                    f"[QuestLoad] avId={self.doId} has questState "
                    f"entry without questId: {entry}"
                )
                continue

            if q_id in DISABLED_QUEST_IDS:
                continue

            quest_definition = quest_mgr.getQuestById(q_id)
            if quest_definition is None:
                print(
                    f"[QuestLoad] avId={self.doId} has unknown questId={q_id}; "
                    "skipping stale quest record"
                )
                continue

            if q_id in self.activeQuests:
                continue

            start_time = entry.get("startTime", int(time.time()))
            accumulator = entry.get("accumulator", 0)
            q_obj = DistributedQuest(
                self.air,
                self.doId,
                q_id,
                step,
                start_time,
                accumulator,
            )
            q_obj.generateWithRequired(QUEST_OBJECT_ZONE)
            self.air.sendSetOwnerDoId(q_obj.doId, self.doId)
            self.activeQuests[q_id] = q_obj

    def announceGenerate(self):
        self.air.incrementPopulation()
        self._reportRealmOverflow()

        # Before gold is read below - moves stray pouch diamonds into gold.
        self.air.inventoryManager.migratePouchDiamonds(self.doId)

        # Fill in the missing information from the database (i.e. gold)
        self.air.fillInFairyPlayer(self)

        self.air.experienceManager.syncOnLogin(self)

        self.b_setHomeType(self._defaultHomeType())
        self.b_setGardenType(self._defaultGardenType())

        # After the level is in: the cap it clamps against moves with it.
        self.loadPixieDust()

        self.air.inventoryManager.avatarOnline(self.doId)

        self._sync_gold_trading_cap()

        self.sendUpdateToAvatarId(
            self.doId, "setGlobalPurchaseData", [list(GLOBAL_PURCHASE_ITEMS.values())]
        )

        # Pushed on generate: the client only pulls this at panel construction.
        self._pushSavedOutfitState()

        # An offline recipient never saw the live nudge, so light the box here.
        self._pushPendingMailStatus()

        self.loadQuests()

        # The meadow's AnimalFriendController reads petDNA off this object as the
        # avatar enters view and never asks again, and the profile panel reads
        # petDetail once. Neither is a required field, so nothing arrives unless
        # we push it. toOwner also sends setPetDNA straight to our own connection
        # so it survives an AI-crash reconnect (see refreshPet).
        self.refreshPet(toOwner=True)
        self.sendOwnedPetOutfits()

    def sendOwnedPetOutfits(self) -> None:
        # The pet wardrobe grays out every outfit not in this list, and
        # AnimalFriendManager uses it to tell us when there are none left to give.
        self.sendUpdateToAvatarId(self.doId, "hasPetOutfits", [pet_state.getOwnedOutfits(self.air, self.doId)])

    def d_statusUpdateFromFairy(self, fromPlayerId: int, status: int) -> None:
        # 4/5 light the HUD gift-box; it clears when we next stand in our home.
        self.sendUpdateToAvatarId(self.doId, "statusUpdateFromFairy", [fromPlayerId, status])

    def _pushPendingMailStatus(self) -> None:
        latest = self.air.mongoInterface.mongodb.messages.find_one(
            {"recipient_id": self.doId,
             "type": {"$in": [MAIL_STATUS_POSTCARD, MAIL_STATUS_GIFTSET]}},
            sort=[("created", -1)],
        )
        if not latest:
            return

        senderId = (latest.get("sender") or {}).get("fairy_id", 0)
        self.d_statusUpdateFromFairy(senderId, latest["type"])

    def delete(self):
        """
        Tear down this copy of the avatar.

        A district hop deletes and rebuilds the avatar -- which is what flying
        between two houses does -- so the occupancy update names the home we
        think we are leaving. The guardian may already have seen us arrive
        somewhere else by then, and must not act on us if it has.
        """
        # TODO: Set a post-remove message in case of an AI crash.

        self._endSweets()
        self.endShopPreview()

        # Leave any home realm we were in so it can be torn down if now empty.
        if self.currentHomeOwner:
            self.air.sendRealmOccupancyUpdate(self.doId, 0, self.currentHomeOwner)
            self.currentHomeOwner = 0

        # If we disconnected mid-run, drop us from whatever wilderness instance
        # we were in so the party list stays accurate and an emptied instance
        # gets torn down.
        self.air.leaveAnyWilderness(self.doId)
        if self.air.showManager is not None:
            self.air.showManager.fairyMoved(self.doId, 0)
        if self.air.emoteBadges is not None:
            self.air.emoteBadges.left(self.doId)

        # AIDistrict.getAvatarExitEvent is only ever sent by its debug-disconnect
        # path, so nothing listening for it (a meadow game seat, say) would hear
        # about a real logout. This is where an avatar actually leaves the district.
        messenger.send(self.air.getAvatarExitEvent(self.doId))

        self.air.sendFriendManagerAccountOffline(self.DISLid, self.doId)

        for q_id, q_obj in list(self.activeQuests.items()):
            q_obj.requestDelete()
        self.activeQuests.clear()

        self.air.decrementPopulation()

        DistributedFairyBaseAI.delete(self)

    def setDISLname(self, DISLname: str) -> None:
        self.DISLname = DISLname

    def getDISLname(self) -> str:
        return self.DISLname

    def setDISLid(self, DISLid: int) -> None:
        self.air.sendFriendManagerAccountOnline(DISLid, self.doId)

        self.DISLid = DISLid

    def getDISLid(self) -> int:
        return self.DISLid

    def setAccess(self, access: int) -> None:
        self.access = access

        if self.isPaid():
            self.sendUpdateToAvatarId(self.doId, "setAccess", [access])

    def getAccess(self) -> int:
        return self.access

    def isPaid(self) -> bool:
        return self.getAccess() == OTPGlobals.AccessFull

    def setDailyChancePlayed(self, played: int) -> None:
        self.dailyChancePlayed = played

    def getDailyChancePlayed(self) -> int:
        return self.dailyChancePlayed

    def d_setDailyChancePlayed(self, played: int) -> None:
        self.sendUpdate("setDailyChancePlayed", [played])

    def b_setDailyChancePlayed(self, played: int) -> None:
        self.dailyChancePlayed = played
        self.sendUpdate("setDailyChancePlayed", [played])

    def dailyChanceCanSpin(self) -> bool:
        doc = self.air.mongoInterface.mongodb.fairies.find_one({"_id": self.doId})
        last_spin = doc.get("dailyChanceLastSpin")

        if last_spin is None:
            return True

        # DB storage is tz unaware - make it aware
        last_spin_utc = last_spin.replace(tzinfo=timezone.utc)

        return get_period_start(last_spin_utc, "daily") != get_period_start(datetime.now(timezone.utc), "daily") 

    def recordDailyChanceSpin(self) -> None:
        # Store the timestamp in UTC
        self.air.mongoInterface.updateField(
            "fairies", "dailyChanceLastSpin", self.doId, datetime.now(timezone.utc)
        )
        self.b_setDailyChancePlayed(1)

    def endShopPreview(self) -> None:
        if not self.shopPreviewActive:
            return

        self.shopPreviewActive = False
        self.d_setFairyDNA(self.getFairyDNA())
        self.redrawFairy()

    def setActualZoneId(self, zoneId) -> None:
        if zoneId != getattr(self, "actualZoneId", zoneId):
            self.endShopPreview()

        self.actualZoneId = zoneId

        if zoneId == 50046: # Vidia's
            if self.dailyChanceCanSpin():
                self.b_setDailyChancePlayed(0)

        # A party game room still counts as being at the party in the house it was
        # launched from, so everyone leaving for a game doesn't empty the house --
        # which would tear the realm down under them, or end the party of a host who
        # went to play. Otherwise housing zones are ownerId + offset, and anything
        # else, including a wilderness instance up in the hosted-game range, is not
        # a home.
        partyGame = self.air.partyGames.get(zoneId) if ZoneConstants.isPartyGameZone(zoneId) else None

        if partyGame is not None and partyGame.realm is not None:
            homeOwner = partyGame.realm.ownerId
        elif HOUSING_ZONE_OFFSET <= zoneId < ZoneConstants.HOSTED_GAME_ZONE_START:
            homeOwner = zoneId - HOUSING_ZONE_OFFSET
        else:
            homeOwner = 0

        if zoneId != self.currentPartyGameZone:
            previousGame = self.air.partyGames.get(self.currentPartyGameZone)
            if previousGame is not None:
                previousGame.playerLeft(self.doId)
            self.currentPartyGameZone = zoneId if partyGame is not None else 0

        if partyGame is not None:
            partyGame.playerArrived(self.doId)

        if homeOwner != self.currentHomeOwner:
            previousOwner = self.currentHomeOwner
            self.currentHomeOwner = homeOwner
            self.air.sendRealmOccupancyUpdate(self.doId, homeOwner, previousOwner)

        self.air.leaveAnyWilderness(self.doId, keepZoneId=zoneId)

        if self.air.showManager is not None and not getattr(self, "famousFairyId", 0):
            self.air.showManager.fairyMoved(self.doId, zoneId)

        if badge_events.get_meadow_badge_for_zone(zoneId) is not None:
            self.air.badgeManager.d_exploreMeadow(self.doId, zoneId)

        # Quest objects deliberately do NOT follow the avatar between zones.
        # Relocating them into the avatar's visible zone gave every client in
        # that zone (including the owner) a plain generate, which the client's
        # empty initDistributedQuest() cannot read - see DistributedQuest.py.
        # The owner already holds them via the owner-generate path, which is
        # independent of location, so there is nothing to keep in sync here.
        QuestMgr.getInstance().addQuestGoalProgress(
            self.air, self.doId, QUEST_TYPE_VISIT_ZONE, amount=1, meadow_zone=zoneId)

        visitBadge = badge_events.ZONE_TO_VISIT_BADGE.get(zoneId)

        if visitBadge is not None:
            self.air.badgeManager.d_giveBadge(self.doId, visitBadge)

    def _dailyChanceExcludedBadges(self) -> set[int]:
        # Mr. Twitches postdates the client's mask, so trust our own badges.
        return badge_state.get_earned_badge_ids(self.air, self.doId, SPIN_BADGE_ID_SET)

    def _dailyChanceExcludedCategories(self, excludeMask: int) -> set[Category]:
        # Trusting the client is fine; a lie only wins an unusable prize.
        excluded = set()

        if excludeMask & EXCLUDE_WARDROBE:
            excluded.add(Category.WARDROBE)

        if excludeMask & EXCLUDE_STORAGE:
            excluded.add(Category.HOME)

        # Vidia's badges are Member-only; the manager would refuse to grant one.
        if not self.isPaid():
            excluded.add(Category.BADGE)

        return excluded

    def requestDailyChance(self, excludeMask: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        if avId != self.doId:
            self.notify.warning(
                f"requestDailyChance from {avId} but sender DO is {self.doId}"
            )
            return

        self.doDailyChance(excludeMask)

    def doDailyChance(self, excludeMask: int) -> None:
        """
        Spin Vidia's wheel and hand over whatever it lands on.

        Split out from requestDailyChance so the `daily-chance` magic word can
        reach it without having to look like a client message -- the sender
        check belongs to the client entry point, not to the spin itself.
        """
        avId = self.doId

        if not self.dailyChanceCanSpin():
            return

        prizes = draw_daily_spin(
            self.fairyDNA.gender,
            self._dailyChanceExcludedBadges(),
            self._dailyChanceExcludedCategories(excludeMask),
            MEMBER_ACORNS if self.isPaid() else FREE_ACORNS,
        )

        granted: list[RewardExt] = []
        rocksWon = 0

        for prize in prizes:
            success, reward = grant_prize(self.air, avId, prize)

            if not success:
                self.notify.warning(f"requestDailyChance: failed to grant item {prize.id} to {avId}")
                continue

            granted.append(reward)

            if prize.id in SPIN_ROCK_ITEM_IDS:
                rocksWon += 1

        self.sendUpdateToAvatarId(avId, "setDailyChanceReward", [granted])

        if not granted:
            return

        self.recordDailyChanceSpin()

        # Counted per rock, so pulling three at once earns credit for three.
        self.air.badgeManager.d_accumulate(avId, badge_events.EVENT_PLAYED_DAILY_SPIN)

        if rocksWon:
            self.air.badgeManager.d_accumulate(avId, badge_events.EVENT_WON_ROCK, rocksWon)

    def _liteInvFromId(self, invId: int, itemsById: dict) -> LiteInvItemExt2:
        item = itemsById.get(invId)
        if not invId or item is None:
            return LiteInvItemExt2()

        return LiteInvItemExt2.unpackFromTuple((
            invId,
            item["item_id"],
            item.get("color1", 0),
            item.get("color2", 0),
            item.get("howAcquired", 0)
        ))

    def _equippedInvIdsBySlot(self, fairy: dict) -> dict:
        return {
            OUTFIT_SLOT_ORDER[item["slot"] - 1]: item["inv_id"]
            for item in fairy["avatar"]["items"]
            if item.get("location") == "Equipped"
            and 1 <= (item.get("slot") or 0) <= len(OUTFIT_SLOT_ORDER)
        }

    def _buildOutfitItems(self, invIds: tuple, fairy: dict) -> dict:
        """
        Snapshot the eight slots a saved outfit stores.

        The shop's save button (ShopPanel.saveOutfitToLookBook) sends 0 for
        every slot the player did not just buy, so a trinket run would save an
        outfit of bare accessories and undress the fairy when worn. Fall back to
        what she has on, the way the shop's own "wear it now" path does.

        A zero from the wardrobe is deliberate ("no necklace, thanks"), so only
        fall back when a mandatory slot arrives empty while she is wearing
        something there -- which only happens on the shop's partial path.
        """
        itemsById = {item["inv_id"]: item for item in fairy["avatar"]["items"]}
        wanted = dict(zip(OUTFIT_SLOT_ORDER, invIds))

        equipped = self._equippedInvIdsBySlot(fairy)
        if any(not wanted[slot] and equipped.get(slot) for slot in MANDATORY_OUTFIT_SLOTS):
            wanted = {
                slot: invId or equipped.get(slot, 0)
                for slot, invId in wanted.items()
            }

        return {
            slot: self._liteInvFromId(invId, itemsById).asTuple()
            for slot, invId in wanted.items()
        }

    def _savedOutfitToStruct(self, outfit: dict) -> SavedOutfit:
        items = outfit.get("items", {})
        return SavedOutfit.unpackFromTuple((
            outfit["outfitId"],
            *(
                LiteInvItemExt2.unpackFromTuple(items.get(slot, EMPTY_LITE_INV_ITEM))
                for slot in OUTFIT_SLOT_ORDER
            ),
        ))

    def _d_setSavedOutfits(self, outfits: list) -> None:
        payload = [self._savedOutfitToStruct(outfit).asTuple() for outfit in outfits]
        self.sendUpdateToAvatarId(self.doId, "setSavedOutfits", [payload])

    def _invalidateOutfitsForItem(self, invId: int) -> None:
        """
        Drop every saved outfit that references a donated-away item.

        An outfit stores a snapshot keyed by invId, so one naming an item the
        fairy no longer owns is unwearable. The donateConfirm dialog promises
        this ("You will lose this item and saved outfits with it!").
        """
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"savedOutfits": 1}
        )
        if not fairy:
            return

        outfits = fairy.get("savedOutfits", [])
        kept = [
            outfit for outfit in outfits
            if not any(item[0] == invId for item in outfit.get("items", {}).values())
        ]
        if len(kept) == len(outfits):
            return

        self.air.mongoInterface.updateField("fairies", "savedOutfits", self.doId, kept)
        self._d_setSavedOutfits(kept)

    def _pushSavedOutfitState(self) -> None:
        """
        Push the outfit state the client would otherwise only ever pull once.

        SavedOutfits reads maxOutfitSlots/savedOutfits when its panel is first
        constructed and caches them. After an AI crash the client rebuilds the
        player object empty and never re-asks, because the panel is not rebuilt:
        the book shows no outfits and every tab looks unpurchased. Generate runs
        on reconnect, so pushing here stands in for the missing pull.
        """
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"savedOutfits": 1, "maxOutfitSlots": 1}
        )
        maxSlots = (fairy or {}).get("maxOutfitSlots", DEFAULT_MAX_OUTFIT_SLOTS)
        self.sendUpdateToAvatarId(self.doId, "setMaxOutfitSlots", [maxSlots])
        self._d_setSavedOutfits((fairy or {}).get("savedOutfits", []))

    def requestGetMaxOutfitSlots(self) -> None:
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"maxOutfitSlots": 1}
        )
        maxSlots = (fairy or {}).get("maxOutfitSlots", DEFAULT_MAX_OUTFIT_SLOTS)
        self.sendUpdateToAvatarId(self.doId, "setMaxOutfitSlots", [maxSlots])

    def requestGetSavedOutfits(self) -> None:
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"savedOutfits": 1}
        )
        self._d_setSavedOutfits((fairy or {}).get("savedOutfits", []))

    def requestAddSavedOutfit(self, headId: int, necklaceId: int, shirtId: int, beltId: int, skirtId: int, wristId: int, ankleId: int, shoesId: int) -> None:
        # _buildOutfitItems needs avatar.items to snapshot the eight slots.
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId},
            {"savedOutfits": 1, "maxOutfitSlots": 1, "avatar.items": 1}
        )
        if not fairy:
            return

        outfits = fairy.get("savedOutfits", [])
        maxSlots = fairy.get("maxOutfitSlots", DEFAULT_MAX_OUTFIT_SLOTS)

        # No free slot -- resync so the client drops its waiting-for-save state.
        if len(outfits) >= maxSlots:
            self._d_setSavedOutfits(outfits)
            return

        invIds = (headId, necklaceId, shirtId, beltId, skirtId, wristId, ankleId, shoesId)
        items = self._buildOutfitItems(invIds, fairy)

        outfits.append({"outfitId": self.air.mongoInterface.getNextDoId(), "items": items})
        self.air.mongoInterface.updateField("fairies", "savedOutfits", self.doId, outfits)
        self._d_setSavedOutfits(outfits)

    def requestUpdateSavedOutfit(self, outfitId: int, headId: int, necklaceId: int, shirtId: int, beltId: int, skirtId: int, wristId: int, ankleId: int, shoesId: int) -> None:
        # _buildOutfitItems needs avatar.items to snapshot the eight slots.
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"savedOutfits": 1, "avatar.items": 1}
        )
        if not fairy:
            return

        outfits = fairy.get("savedOutfits", [])
        outfit = next((o for o in outfits if o["outfitId"] == outfitId), None)
        if outfit is None:
            self._d_setSavedOutfits(outfits)
            return

        invIds = (headId, necklaceId, shirtId, beltId, skirtId, wristId, ankleId, shoesId)
        outfit["items"] = self._buildOutfitItems(invIds, fairy)

        self.air.mongoInterface.updateField("fairies", "savedOutfits", self.doId, outfits)
        self._d_setSavedOutfits(outfits)

    def requestRemoveSavedOutfits(self, outfitIds: list) -> None:
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"savedOutfits": 1}
        )
        if not fairy:
            return

        # outfitIds is a LongType[]; each struct arrives as (longVal,).
        toRemove = {longType[0] for longType in outfitIds}
        outfits = [o for o in fairy.get("savedOutfits", []) if o["outfitId"] not in toRemove]

        self.air.mongoInterface.updateField("fairies", "savedOutfits", self.doId, outfits)
        self._d_setSavedOutfits(outfits)

    def requestSendSavedOutfitSlotPurchaseRequest(self) -> None:
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"maxOutfitSlots": 1}
        )
        if not fairy:
            return

        maxSlots = fairy.get("maxOutfitSlots", DEFAULT_MAX_OUTFIT_SLOTS)
        if maxSlots >= MAX_OUTFIT_SLOTS:
            return

        # takeGold charges nothing if the fairy can't afford the upgrade.
        if not self.takeGold(OUTFIT_SLOT_COST):
            return

        maxSlots = min(maxSlots + OUTFIT_SLOTS_PER_PURCHASE, MAX_OUTFIT_SLOTS)
        self.air.mongoInterface.updateField("fairies", "maxOutfitSlots", self.doId, maxSlots)
        self.sendUpdateToAvatarId(self.doId, "setMaxOutfitSlots", [maxSlots])

    def d_refreshEquippedItem(self, invId: int) -> bool:
        """
        Redraw one item the fairy is wearing, after its colors changed.

        Does nothing (and says so) for an item that isn't equipped: a wardrobe
        or storage entry has nothing on the avatar to redraw, and shows its new
        colors the next time the inventory panel reads it.
        """
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {
                "_id": self.doId,
                "avatar.items": {
                    "$elemMatch": {"inv_id": invId, "location": "Equipped"}
                },
            },
            {"avatar.items.$": 1},
        )

        if not fairy:
            return False

        items = fairy.get("avatar", {}).get("items")

        if not items:
            return False

        item = items[0]
        field = EQUIP_SLOT_FIELDS.get(item.get("slot"))

        if not field:
            return False

        self.sendUpdate(field, [[invId, item["item_id"], item["color1"], item["color2"]]])
        self.redrawFairy()

        return True

    def setOutfitDB(self, headId: int, necklaceId: int, shirtId: int, beltId: int, skirtId: int, wristId: int, ankleId: int, shoesId: int) -> None:
        SLOT_METHODS = EQUIP_SLOT_FIELDS

        EMPTY_LITE_INV = [0, 0, 0, 0]

        desiredOutfit = {
            1: headId, 2: necklaceId, 3: shirtId, 4: beltId,
            5: skirtId, 6: wristId, 7: ankleId, 8: shoesId
        }
        equippedIds = {invId: slot for slot, invId in desiredOutfit.items() if invId != 0}
        filledSlots = set(equippedIds.values())
        keepSlots = {
            slot for slot, invId in desiredOutfit.items()
            if not invId and slot in MANDATORY_SLOT_NUMBERS
        }

        table = self.air.mongoInterface.mongodb.fairies

        # Ask Mongo for the few items involved, not a thousand-entry wardrobe.
        rows = list(table.aggregate([
            {"$match": {"_id": self.doId}},
            {"$project": {
                "items": {
                    "$filter": {
                        "input": {"$ifNull": ["$avatar.items", []]},
                        "as": "item",
                        "cond": {
                            "$or": [
                                {"$eq": ["$$item.location", "Equipped"]},
                                {"$in": ["$$item.inv_id", list(equippedIds)]},
                            ]
                        },
                    }
                }
            }},
        ]))

        if not rows:
            return

        # Positional updates: $set-ing the array rewrites the whole document.
        setOps = {}
        arrayFilters = []

        def stage(invId: int, location: str, slot: int) -> None:
            alias = f"i{len(arrayFilters)}"
            setOps[f"avatar.items.$[{alias}].location"] = location
            setOps[f"avatar.items.$[{alias}].slot"] = slot
            arrayFilters.append({f"{alias}.inv_id": invId})

        for item in rows[0].get("items", []):
            invId = item["inv_id"]

            if invId in equippedIds:
                slot = equippedIds[invId]

                if item["location"] == "Equipped" and item["slot"] == slot:
                    continue

                stage(invId, "Equipped", slot)
                payload = [invId, item["item_id"], item["color1"], item["color2"]]
                self.sendUpdate(SLOT_METHODS[slot], [payload])

            elif item["location"] == "Equipped":
                oldSlot = item["slot"]

                if oldSlot in keepSlots:
                    continue

                stage(invId, "Wardrobe", 0)

                if oldSlot in SLOT_METHODS and oldSlot not in filledSlots:
                    self.sendUpdate(SLOT_METHODS[oldSlot], [EMPTY_LITE_INV])

        if setOps:
            table.update_one(
                {"_id": self.doId},
                {"$set": setOps},
                array_filters=arrayFilters
            )

            self.redrawFairy()

    def setChatMessage(self, message: str) -> None:
        # Ignore anything not sent by this fairy's own connection
        if self.air.getAvatarIdFromSender() != self.doId:
            return
        
        TrickOrTreat.handleChat(self.air, self, message)

    def setHotspotTriggered(self, tagId, hotspotFrame) -> None:
        """
        Play a shared meadow hotspot for everyone in the zone.

        The client keys hotspots by tagId rather than the config's `id`, and a
        shared one plays for nobody -- not even the fairy who clicked it --
        until the server sends a frame back. A full-play hotspot gets -1, the
        client's "run it from the start" path; a keyframe one gets the clicker's
        own frame, so everyone plays on from where they were. The config's
        serverParm is ignored on purpose -- meadow_xml's docstring has the why.
        """
        if not (meadow := self.air.zoneToMeadow.get(self.zoneId)):
            return

        hotspot = meadow_xml.getHotspot(self.zoneId, tagId)

        if hotspot is None:
            self.notify.warning(
                f"setHotspotTriggered from {self.doId} for unknown hotspot "
                f"{tagId} in zone {self.zoneId}"
            )
            return

        if not hotspot.shared:
            # Unshared hotspots are client-side; no honest client sends this.
            self.notify.warning(
                f"setHotspotTriggered from {self.doId} for unshared hotspot "
                f"{tagId} (id {hotspot.hotspotId}) in zone {self.zoneId}"
            )
            return

        if hotspot.isTalentSpot and not self.spendPixieDust(TALENT_SPOT_DUST_COST):
            return

        frame = meadow_xml.PLAY_FROM_START if hotspot.playsFull else hotspotFrame

        self.notify.debug(
            f"setHotspotTriggered: {self.doId} hit hotspot {tagId} "
            f"(id {hotspot.hotspotId}) in zone {self.zoneId} at frame "
            f"{hotspotFrame}, sending {frame}"
        )

        meadow.d_setHotspotFrame(tagId, frame)

        # The client doesn't read <resets>, so we put the cleared ones back.
        for resetTagId, keyframe in hotspot.resets:
            if meadow_xml.getHotspot(self.zoneId, resetTagId) is None:
                self.notify.warning(
                    f"hotspot {tagId} in zone {self.zoneId} resets hotspot "
                    f"{resetTagId}, which isn't live"
                )
                continue

            # Snap and hold: a reset is a state change, not an animation.
            meadow.d_setHotspotFrame(resetTagId, meadow_xml.PLAY_AT_OFFSET + keyframe)

    def setGold(self, gold: int) -> None:
        self.gold = gold

    def getGold(self) -> int:
        return self.gold

    def d_setGold(self, gold: int) -> None:
        self.sendUpdate("setGold", [gold])

    def d_setPouch(self, pouch: list) -> None:
        self.sendUpdateToAvatarId(self.doId, "setPouch", [pouch])

    def d_syncPouchAfterChanges(self) -> None:
        pouch = self.air.inventoryManager.getPouch(self.doId)
        self.d_setPouch(pouch)
        self.d_setPouch(pouch)

    def b_setGold(self, gold: int) -> None:
        self.setGold(gold)
        self.d_setGold(gold)
        self._shareGoldWithSiblings(gold)

    def _shareGoldWithSiblings(self, gold: int) -> None:
        # Gold is one wallet per account, not one per fairy -- that was the
        # original design, and it only moved onto the fairy because an account
        # could hold just one at the time. Now that an account can hold three,
        # every fairy needs to agree. setGold is `db` (fairy.dc), so the
        # broadcast above already persisted it to this fairy's own row; only
        # one fairy is ever a live DistributedObject at a time, so the others
        # get it written to their document directly rather than broadcast.
        doc = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"accountId": 1, "ownerAccount": 1})
        if not doc:
            return

        account = AccountControl.accountForFairyDoc(self.air, doc)
        if not account:
            return

        for sibling in AccountControl.fairiesForAccount(self.air, account):
            if sibling["_id"] != self.doId:
                self.air.mongoInterface.updateField("fairies", "gold", sibling["_id"], gold)

    def _reconcileSharedGold(self) -> None:
        # Gold used to be tracked per fairy, so an account's three fairies can
        # each be sitting on a different historical balance the first time
        # this runs for them. Settle on the highest of the three -- nobody
        # loses gold merging into one wallet -- and let b_setGold's fan-out
        # (above) bring the others up to match.
        doc = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"accountId": 1, "ownerAccount": 1})
        if not doc:
            return

        account = AccountControl.accountForFairyDoc(self.air, doc)
        if not account:
            return

        siblings = AccountControl.fairiesForAccount(self.air, account)
        shared = max((s.get("gold", 0) or 0 for s in siblings), default=self.gold)

        if shared != self.gold:
            self.b_setGold(shared)

    def addGold(self, deltaGold: int) -> None:
        self.b_setGold(deltaGold + self.getGold())

    def takeGold(self, deltaGold: int) -> bool:
        totalGold = self.gold

        if deltaGold < 0 or deltaGold > totalGold:
            return False

        self.b_setGold(self.gold - deltaGold)

        return True
    
    def requestDailyGoldTradeCapData(self) -> None:
        self._sync_gold_trading_cap()

    def _refresh_gold_trading(self) -> None:
        doc = self.air.mongoInterface.mongodb.fairies.find_one({"_id": self.doId})
        last_trade = doc.get("lastGoldTradeAt")
        self.goldTradedToday = doc.get("goldTradedToday")

        if last_trade is None:
            return

        # DB storage is tz unaware - make it aware
        last_trade_utc = last_trade.replace(tzinfo=timezone.utc)

        if get_period_start(last_trade_utc, "daily") != get_period_start(datetime.now(timezone.utc), "daily"):
            self.goldTradedToday = 0
            self._save_gold_trading()

    def _save_gold_trading(self) -> None:
        self.air.mongoInterface.updateFields(
            "fairies",
            {
                "goldTradedToday": self.goldTradedToday,
                "lastGoldTradeAt": self.lastGoldTradeAt,
            },
            self.doId,
        )
    
    def _sync_gold_trading_cap(self) -> None:
        self._refresh_gold_trading()
        self.sendUpdateToAvatarId(self.doId, "setDailyGoldTradeCap", [200])
        self.sendUpdateToAvatarId(self.doId, "setAmountGoldTradedForToday", [self.goldTradedToday])

    def tradeGoldForItem(self, amountToGive: int, invItemToGet: int, amountToGet: int) -> None:
        if self.takeGold(amountToGive):
            if not self.air.inventoryManager.addIngredientsToPouch(self.doId, invItemToGet, amountToGet, -1):
                self.notify.warning("Failed to add ingredient %d to pouch!" % (invItemToGet))
                return

            # Sent twice: onCheckForGiveGetUpdates only fires above one call.
            pouch = self.air.inventoryManager.getPouch(self.doId)
            self.d_setPouch(pouch)
            self.d_setPouch(pouch)

    def tradeItemForGold(self, invItemToGive: int, amountToGive: int, amountToGet: int) -> None:
        self._refresh_gold_trading()

        gold_remaining = 200 - self.goldTradedToday
        if gold_remaining <= 0 or amountToGet <= 0 or amountToGet > gold_remaining:
            self._sync_gold_trading_cap()
            return

        if not self.air.inventoryManager.removeIngredientsFromPouch(self.doId, invItemToGive, amountToGive):
            print("tradeItem - Couldn't Remove Ingredients??")
            return

        self.addGold(amountToGet)
        self.goldTradedToday += amountToGet
        self.lastGoldTradeAt = datetime.now(timezone.utc)
        self._save_gold_trading()
        self._sync_gold_trading_cap()
        # Sent twice: onCheckForGiveGetUpdates only fires above one call.
        pouch = self.air.inventoryManager.getPouch(self.doId)
        self.d_setPouch(pouch)
        self.d_setPouch(pouch)

    def tradeItem(self, invItemToGive: int, amountToGive: int, invItemToGet: int, amountToGet: int) -> None:
        if not self.air.inventoryManager.removeIngredientsFromPouch(self.doId, invItemToGive, amountToGive):
            print("tradeItemForGold - Couldn't Remove Ingredients??")
            return

        if not self.air.inventoryManager.addIngredientsToPouch(self.doId, invItemToGet, amountToGet, -1):
            self.notify.warning("Failed to add ingredient %d to pouch!" % (invItemToGet))
            return

        # Sent twice: onCheckForGiveGetUpdates only fires above one call.
        pouch = self.air.inventoryManager.getPouch(self.doId)
        self.d_setPouch(pouch)
        self.d_setPouch(pouch)

    def auraRemover(self, task):
        self.sendUpdate("setAura", [0])

    def invisRemover(self, task):
        self.sendUpdate("setRenderEffects", [0])
        self.sendUpdate("setRedraw", [1])

    def _getSweetType(self, itemId):
        """Determine which kind of silly sweet this item is."""
        if itemId == 22525:
            return "invisible"
        if itemId in AURA_MAPPING:
            return "aura"
        if itemId in SKIN_COLOR_MAPPING:
            return "skin"
        if itemId in WING_COLOR_MAPPING:
            return "wing"
        return None

    def _handleAuraSweet(self, itemId):
        aura = AURA_MAPPING[itemId]
        # A list means the sweet grants one of several auras at random.
        aura_id = random.choice(aura) if isinstance(aura, list) else aura
        self.sendUpdate("setAura", [aura_id])

        taskMgr.remove(f"AuraRemover-{self.doId}")
        taskMgr.doMethodLater(60, self.auraRemover, f"AuraRemover-{self.doId}")

    def _handleSkinSweet(self, itemId):
        color = SKIN_COLOR_MAPPING[itemId]
        self._applyDNAColor(color, slotIndex=12)

    def _handleWingSweet(self, itemId):
        color = WING_COLOR_MAPPING[itemId]
        self._applyDNAColor(color, slotIndex=13)

    def _handleInvisibleSweet(self, _):
        self.sendUpdate("setRenderEffects", [1])
        self.redrawFairy()

        taskMgr.remove(f"InvisRemover-{self.doId}")
        taskMgr.doMethodLater(60, self.invisRemover, f"InvisRemover-{self.doId}")

    def _cancelColorSweet(self, slotIndex):
        taskMgr.remove(f"DNARestore-{self.doId}-{slotIndex}")
        taskMgr.remove(f"ColorCycle-{self.doId}-{slotIndex}")

    def _restoreDNA(self, slotIndex):
        taskMgr.remove(f"ColorCycle-{self.doId}-{slotIndex}")
        if slotIndex not in self._originalDNA:
            return  # already restored, nothing to do
        dna = list(self.getFairyDNA())
        dna[slotIndex] = self._originalDNA[slotIndex]
        self.b_setFairyDNA(tuple(dna))
        self.redrawFairy()
        del self._originalDNA[slotIndex]

    def _endSweets(self) -> None:
        for slotIndex in list(self._originalDNA):
            taskMgr.remove(f"DNARestore-{self.doId}-{slotIndex}")
            self._restoreDNA(slotIndex)

        taskMgr.remove(f"AuraRemover-{self.doId}")
        taskMgr.remove(f"InvisRemover-{self.doId}")

    def _restoreDNATask(self, task):
        if not self.isDeleted() and task.slotIndex in self._originalDNA:
            self._restoreDNA(task.slotIndex)
        return task.done

    def _runColorCycleTask(self, task):
        if not self.isDeleted():
            self._applyColorStep(task.colors[task.cycleIndex], task.slotIndex)
            task.cycleIndex = (task.cycleIndex + 1) % len(task.colors)
        return task.again

    def _applyDNAColor(self, color, slotIndex):
        if isinstance(color, list):
            self._scheduleCyclingColors(color, slotIndex)
            return

        restore_task_name = f"DNARestore-{self.doId}-{slotIndex}"

        if not taskMgr.hasTaskNamed(restore_task_name):
            self._originalDNA[slotIndex] = self.getFairyDNA()[slotIndex]

        self._cancelColorSweet(slotIndex)

        dna = list(self.getFairyDNA())
        dna[slotIndex] = color
        self.b_setFairyDNA(tuple(dna))
        self.redrawFairy()

        restore_task = taskMgr.doMethodLater(60, self._restoreDNATask, restore_task_name)
        restore_task.slotIndex = slotIndex

    def _applyColorStep(self, color, slotIndex):
        """Single color application step, used by cycling tasks."""
        dna = list(self.getFairyDNA())
        dna[slotIndex] = color
        self.b_setFairyDNA(tuple(dna))
        self.redrawFairy()

    def _runColorCycle(self, colors, slotIndex, cycleIndex=0):
        self._applyColorStep(colors[cycleIndex], slotIndex)

        cycle_task = taskMgr.doMethodLater(5, self._runColorCycleTask, f"ColorCycle-{self.doId}-{slotIndex}")
        cycle_task.colors = colors
        cycle_task.slotIndex = slotIndex
        cycle_task.cycleIndex = (cycleIndex + 1) % len(colors)

    def _scheduleCyclingColors(self, colors, slotIndex):
        restore_task_name = f"DNARestore-{self.doId}-{slotIndex}"

        if not taskMgr.hasTaskNamed(restore_task_name):
            self._originalDNA[slotIndex] = self.getFairyDNA()[slotIndex]

        self._cancelColorSweet(slotIndex)

        self._runColorCycle(colors, slotIndex, cycleIndex=0)

        restore_task = taskMgr.doMethodLater(60, self._restoreDNATask, restore_task_name)
        restore_task.slotIndex = slotIndex

    def consumePouchItem(self, itemId, amount) -> None:
        baked = BAKED_ITEMS.get(itemId)
        if not baked:
            return

        if baked["bakedType"] == "sillysweet":
            sweet_type = self._getSweetType(itemId)

            if sweet_type is None:
                print(f"ITEM MISSING FROM ALL SWEET MAPPINGS: {itemId}")
                return

            # A new sweet type only needs a matching _handle<Type>Sweet method.
            handler = getattr(self, f"_handle{sweet_type.capitalize()}Sweet")
            handler(itemId)

        elif baked["bakedType"] in ("cookie", "cupcake"):
            self._grantPixiePower(baked["pixiePower"])

        self.sendUpdate("setItemEvent", [itemId, amount, 0, 0])
        self.air.inventoryManager.removeIngredientsFromPouch(self.doId, itemId, amount)

        pouch = self.air.inventoryManager.getPouch(self.doId)
        self.d_setPouch(pouch)
        self.d_setPouch(pouch)

    def redrawFairy(self) -> None:
        self.sendUpdate("setRedraw", [1])

    def setLevel(self, level: int) -> None:
        self.level = level

    def d_setLevel(self, level: int) -> None:
        self.sendUpdate("setLevel", [level])

    def b_setLevel(self, level: int) -> None:
        self.setLevel(level)
        self.d_setLevel(level)

    def getLevel(self) -> int:
        return self.level

    def setExperiencePoints(self, experiencePoints: int) -> None:
        self.experiencePoints = experiencePoints

    def d_setExperiencePoints(self, experiencePoints: int) -> None:
        self.sendUpdate("setExperiencePoints", [experiencePoints])

    def b_setExperiencePoints(self, experiencePoints: int) -> None:
        self.setExperiencePoints(experiencePoints)
        self.d_setExperiencePoints(experiencePoints)

    def getExperiencePoints(self) -> int:
        return self.experiencePoints

    def levelUpRequest(self) -> None:
        # the client's level-up panel asking for the level its bar has earned
        sender = self.air.getAvatarIdFromSender()
        if sender != self.doId:
            print(f"[XP] levelUpRequest for {self.doId} from {sender}, ignoring")
            return
        self.air.experienceManager.handleLevelUpRequest(self)

    def d_setMute(self, mute: int) -> None:
        # A courtesy, not a gag: it grays their input; setTalk still flows.
        self.sendUpdateToAvatarId(self.doId, "setMute", [mute])

    def setPixiePower(self, pixiePower: int) -> None:
        self.pixiePower = pixiePower

    def d_setPixiePower(self, pixiePower: int) -> None:
        self.sendUpdate("setPixiePower", [pixiePower])

    def b_setPixiePower(self, pixiePower: int) -> None:
        self.setPixiePower(pixiePower)
        self.d_setPixiePower(pixiePower)

    def getPixiePower(self) -> int:
        return self.pixiePower

    def getPixieDustCap(self) -> int:
        """The most pixie dust this fairy can hold.

        setPixiePower is how much they have, never how much they can hold: the
        client sizes its own meter from xpConfig.xml with
        ExperienceManager.getMemberDustForLevel(talentLevel) (PixieDustMeter),
        and setLevel is exactly the talentLevel it means. Reading the same table
        from XPRewardsService keeps the bar we fill and the bar they see the
        same one. (basicDust and memberDust happen to match at all 28 levels,
        but the membership is passed through anyway rather than assumed.)
        """
        return self.air.experienceManager.rewards.getDustCap(self.getLevel(), self.isPaid())

    def _grantPixiePower(self, amount: int) -> None:
        """Restore pixie power from eating a cookie or cupcake."""
        if not PIXIE_POWER_ENABLED:
            return

        self.addPixieDust(amount)

    def addPixieDust(self, amount: int) -> None:
        """Top a fairy up, never past what they can hold."""
        if amount <= 0:
            return

        self.b_setPixiePower(min(self.getPixiePower() + amount, self.getPixieDustCap()))

    def spendPixieDust(self, amount: int) -> bool:
        """Charge a fairy for something, or say they cannot afford it.

        The client pre-checks every cost against pixieDustAmount and shows its
        own "you need more Pixie Dust" panel, so a refusal here is a stale panel
        or a request that never went through one.
        """
        if amount <= 0:
            return True

        if not PIXIE_POWER_ENABLED:
            return True

        if self.getPixiePower() < amount:
            self.notify.warning(
                f"fairy {self.doId} cannot afford {amount} pixie dust "
                f"(has {self.getPixiePower()})")
            return False

        self.b_setPixiePower(self.getPixiePower() - amount)
        return True

    def loadPixieDust(self) -> None:
        """Settle a fairy's dust at login.

        setPixiePower is a db field, so what they had is already on the object
        by the time this runs -- but it is stored against a cap that moves with
        their level, and fairy.dc hands a brand new fairy a default that has
        nothing to do with either. Clamping here is what stops a meter drawn
        past its own end.
        """
        if not PIXIE_POWER_ENABLED:
            return

        cap = self.getPixieDustCap()
        dust = max(0, min(self.getPixiePower(), cap))

        self.b_setPixiePower(dust)

    def setLastMeadow(self, zoneId: int) -> None:
        self.lastMeadow = zoneId

    def getLastMeadow(self) -> int:
        return self.lastMeadow

    def d_setLastMeadow(self, zoneId: int) -> None:
        self.sendUpdateToAvatarId(self.doId, "setLastMeadow", [zoneId])

    def b_setLastMeadow(self, zoneId: int) -> None:
        self.setLastMeadow(zoneId)
        self.d_setLastMeadow(zoneId)

    def setHomeType(self, homeType: int, homeSubType: int = 0) -> None:
        self.homeType = homeType
        self.homeSubType = homeSubType

    def getHomeType(self) -> int:
        return self.homeType

    def d_setHomeType(self, homeType: int, homeSubType: int = 0) -> None:
        self.sendUpdateToAvatarId(self.doId, "setHomeType", [homeType, homeSubType])

    def b_setHomeType(self, homeType: int, homeSubType: int = 0) -> None:
        self.setHomeType(homeType, homeSubType)
        self.d_setHomeType(homeType, homeSubType)

    def _defaultHomeType(self) -> int:
        # Falls back to the fairy's talent until the player picks a home type.
        doc = self.air.mongoInterface.mongodb.fairies.find_one({"_id": self.doId})
        if doc:
            stored = doc.get("homeType")
            if stored is not None:
                return stored
            talent = doc.get("talent")
            if talent is not None:
                return talent
        return self.fairyDNA.talent

    # ════════════════════════════════════════════════════════════════════════ #
    #                                 Garden                                   #
    # ════════════════════════════════════════════════════════════════════════ #

    def setGardenType(self, gardenType: int) -> None:
        self.gardenType = gardenType

    def getGardenType(self) -> int:
        return self.gardenType

    def d_setGardenType(self, gardenType: int) -> None:
        self.sendUpdateToAvatarId(self.doId, "setGardenType", [gardenType])

    def b_setGardenType(self, gardenType: int) -> None:
        self.setGardenType(gardenType)
        self.d_setGardenType(gardenType)

    def _defaultGardenType(self) -> int:
        # Which garden they've bought, and so which scene -- and how many plots
        # -- they get. The client reads a 0 as the first garden either way.
        doc = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"gardenType": 1})

        return (doc or {}).get("gardenType") or GardenData.DEFAULT_GARDEN_TYPE

    def d_setGardenState(self) -> None:
        """Tell the owner how every plot of their garden is doing.

        This is what puts the "something in your garden needs you" prompt up
        (PlantManager.setPlotStates), so it is read out of the database rather
        than off the live plots: the fairy is usually nowhere near their garden
        when they want to know, and the plots only exist while somebody is.

        gardenState carries none of the routing keywords in fairy.dc, so it goes
        straight to the owner's channel -- see sendQuestHistory for the same
        trap.
        """
        doc = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId}, {"gardenPlots": 1})

        state = []

        for record in (doc or {}).get("gardenPlots", []):
            seed = GardenData.getSeed(record.get("seedId", 0))
            plant = seed.plant(record.get("plantId", 0)) if seed else None

            # struct GardenState: plotNum, plantId, seedId, stage, stages,
            # tendingNeeded, skillNeeded, endDateTime, wiltDelay, stageDuration.
            state.append((
                record.get("plotNum", 0),
                record.get("plantId", 0),
                record.get("seedId", 0),
                record.get("stage", 0),
                plant.stages if plant else 0,
                record.get("tendingNeeded", GardenData.NOTHING_NEEDED),
                record.get("skillNeeded", GardenData.NOTHING_NEEDED),
                record.get("stageStart", 0),
                GardenData.wiltDelay(),
                seed.stageDuration(plant) if seed and plant else 0,
            ))

        self.sendUpdateToAvatarId(self.doId, "gardenState", [state])

    # ════════════════════════════════════════════════════════════════════════ #
    #                              Animal Friend                               #
    # ════════════════════════════════════════════════════════════════════════ #

    def refreshPet(self, pet: dict | None = None, toOwner: bool = False) -> None:
        # pushes the pet to its owner and the zone, send it after every change so the results screens can compare
        # toOwner on (re)generate also sends setPetDNA straight to the owner, a zone broadcast can miss a reconnect
        if pet is None:
            pet = pet_state.loadPetAndApplyDecay(self.air, self.doId)

        followingDNA = pet_state.petDNATuple(pet) if pet_state.isPetFollowingOwner(pet) \
            else list(pet_state.EMPTY_PET_DNA)

        justReleased = bool(pet) and pet.get("status") == pet_state.ANIMAL_FRIEND_RELEASED and not toOwner

        self.sendUpdate("setPetDNA", [followingDNA])
        if toOwner or justReleased:
            self.sendUpdateToAvatarId(self.doId, "setPetDNA", [followingDNA])

        # only with a pet, an all-zero detail reads as a starving pet to doEmoteChecks
        if pet_state.hasPet(pet):
            self.sendUpdateToAvatarId(self.doId, "setPetDetail", [pet_state.petDetailTuple(pet)])
        elif pet and pet.get("status") == pet_state.ANIMAL_FRIEND_RELEASED and not toOwner:
            # elixa's release screen waits for a detail too, never on login or doEmoteChecks trips
            self.sendUpdateToAvatarId(self.doId, "setPetDetail", [pet_state.releasedDetailTuple(pet)])

    def setPetFeed(self, ownerId: int, foodId: int, amount: int) -> None:
        # FeedPetPanel sends the owner of the pet being fed, a friend's pet is fed from the feeder's own pouch
        # a home food bowl feeds for free, and says so by adding a large constant to the amount
        free = amount >= pet_state.FREE_FEED_MODIFIER
        if free:
            amount -= pet_state.FREE_FEED_MODIFIER

        pet = pet_state.loadPetAndApplyDecay(self.air, ownerId)
        if not pet_state.hasPet(pet):
            return

        species = pet_xml.getSpecies(pet["itemId"])
        if species is None or foodId != species.favFood:
            self.notify.warning(
                f"{self.doId} tried to feed item {foodId} to a {pet['itemId']}")
            return

        # the client caps its slider at foodToFill, so anything above that is not a real request
        amount = min(amount, pet_state.foodToFill(pet))
        if amount < 1:
            return

        if not free:
            if not self.air.inventoryManager.removeIngredientsFromPouch(self.doId, foodId, amount):
                return
            self.d_syncPouchAfterChanges()

        pet_state.feedPet(pet, amount)
        pet_state.savePet(self.air, ownerId, pet)

        if ownerId == self.doId:
            # FeedPetPanel pops the results screen off this detail update
            self.refreshPet(pet)
            return

        # the owner may be on another district, the save is what counts and they are told after
        owner = self.air.doId2do.get(ownerId)
        if owner is not None and hasattr(owner, "refreshPet"):
            owner.refreshPet(pet)
        else:
            self.air.d_petStateChanged(ownerId)

    def healPetAndRefresh(self) -> bool:
        pet = pet_state.loadPetAndApplyDecay(self.air, self.doId)
        if not pet_state.hasPet(pet):
            return False

        pet_state.healPet(pet)
        pet_state.savePet(self.air, self.doId, pet)
        self.refreshPet(pet)
        return True

    def setPetGameScore(self, gameId: int, score: int, levelId: int) -> None:
        # The microgame's end screen waits on a fresh setPetDetail before it shows
        # the results, so one always goes out, even when the pet is too hungry or
        # ill to gain happiness (the results panel explains that case itself).
        pet = pet_state.loadPetAndApplyDecay(self.air, self.doId)
        if not pet_state.hasPet(pet):
            return

        if score > 0:
            pet_state.addHappiness(pet, pet_state.HAPPINESS_PER_PLAY)
            pet_state.savePet(self.air, self.doId, pet)

        self.refreshPet(pet)

    def getPlayerStruct(self) -> list:
        """This fairy as a PlayerStruct, for matchmaker player lists."""
        return [
            self.doId,                       # fairyId
            self.DISLid,                     # DISLid
            self.air.districtId,             # district
            self.zoneId,                     # zone
            self.name,                       # name
            self.DISLname,                   # DISLname
            int(self.fairyDNA.talent or 0),  # talentId
            int(self.access or 0),           # access
            int(self.level or 0),            # level
            0,                               # place
        ]

    def requestMatchMaker(self, adventureId: int, questId) -> None:
        avId = self.air.getAvatarIdFromSender()
        if avId != self.doId:
            self.notify.warning(
                f"requestMatchMaker sender {avId} != avatar {self.doId}")
            return

        # A minigame match id (below IDS_PER_TYPE) is a party game the host picked in
        # their party panel; the house they're in runs its lobby.
        if 0 <= adventureId < PartyConstants.IDS_PER_TYPE:
            realm = self.air.homeRealmForOwner(self.currentHomeOwner)
            if realm is None:
                self.notify.warning(
                    f"requestMatchMaker for party game {adventureId} from {avId}, who isn't in a home")
                return

            realm.startPartyGame(avId, adventureId)
            return

        # Otherwise they picked an adventure in the AdventureChooser. Forward to the
        # WildernessGuardian, which finds/creates a lobby for it.
        questTuple = list(questId) if questId is not None else [-1, -1]
        self.air.sendWildernessMatchRequest(
            avId, adventureId, questTuple, self.getPlayerStruct())

    def requestFairyInfo(self, fairyId: int, unk: int) -> None:
        from game.fairies.ai.DatabaseObject import DatabaseObject

        from game.fairies.fairy.DistributedFairyPlayerAI import DistributedFairyPlayerAI

        def gotFairyLocation(doId: int, parentId: int, zoneId: int) -> None:
            if fairyId != doId:
                self.notify.warning(f"Got unexpected location for doId {doId}, was expecting {fairyId}!")
                return

            DISLid = fairy.getDISLid()
            fairyName = fairy.getName()
            DISLname = fairy.getDISLname()
            fairyDNA = fairy.fairyDNA.asTuple()
            fairyAccess = fairy.getAccess()
            fairyLevel = fairy.getLevel()

            # TODO: Implement this
            place: int = 0

            self.sendUpdateToAvatarId(self.doId, "responseFairyInfo", [[
                fairyId,
                DISLid,
                parentId,
                zoneId,
                fairyName,
                DISLname,
                fairyDNA[0], # talent
                fairyAccess,
                fairyLevel,
                place
            ]])

        fairy = self.air.getDo(fairyId)

        if fairy:
            # Present on this shard -- no need to ask the OTP server.
            gotFairyLocation(fairyId, fairy.parentId, fairy.zoneId)
            return

        def fieldsCallback(db: DatabaseObject, retCode: int) -> None:
            nonlocal fairy

            if retCode != 0:
                return

            fairy = DistributedFairyPlayerAI(self.air)

            db.fillin(fairy, db.dclass)

            self.air.getObjectLocation(fairyId, gotFairyLocation)

        # Not on this shard -- read their fields out of the database.
        gotFairyEvent = self.air.uniqueName(f"gotFairy-{fairyId}")
        self.acceptOnce(gotFairyEvent, fieldsCallback)

        db = DatabaseObject(self.air, fairyId)
        db.doneEvent = gotFairyEvent
        db.dclass = self.air.dclassesByName[self.__class__.__name__]
        db.getFields(["setDISLid", "setName", "setDISLname", "setFairyDNA", "setAccess", "setLevel"])

    def ignoresRealmCapacity(self) -> bool:
        # Overridden by the GM AI; the client exempts GMs from the same checks.
        return False

    def isRealmCapacityBlocked(self, parentId: int) -> bool:
        """
        Should this fairy be kept out of realm `parentId` because it is full?

        Only ever true for a *different* realm that the cluster has reported a
        FULL headcount for. Home realms are not districts and never answer yes
        here -- their cap lives in the RealmGuardian.
        """
        if parentId == self.parentId:
            # Already in that realm; capacity cannot be the reason to refuse.
            return False

        if self.ignoresRealmCapacity():
            return False

        return self.air.isRealmFull(parentId)

    def _reportRealmOverflow(self) -> None:
        """
        Log an arrival into an already-full realm.

        Nothing here can turn a client away: the client drives its own
        setLocation and the DC has no "go somewhere else" message to send.
        Realms are held under their cap by the request-time checks (fly-to-
        fairy, home teleport) and the client's shard chooser, so an overflow
        means one of those was bypassed and should not pass silently.
        """
        if self.ignoresRealmCapacity():
            return

        # We are already counted, so compare the headcount from just before.
        if self.air.getPopulation() - 1 < self.air.getRealmCapacity():
            return

        self.air.writeServerEvent(
            'realm-overflow', self.doId,
            '%s|%s' % (self.air.districtId, self.air.getPopulation()))

    def teleportRequestTo(self, fairyId: int) -> None:
        from game.fairies.ai.DatabaseObject import DatabaseObject

        from game.fairies.fairy.DistributedFairyPlayerAI import DistributedFairyPlayerAI

        def sendResponse(parentId: int, zoneId: int, roomId: int, inTransit: bool = False) -> None:
            """
            Answer a fly-to request, saying where the target is and if they can
            be reached.

            An activity zone (minigame, party game, quiet meadow, home preview)
            can never load a peer, so the arriving client would hang on the
            loading screen -- report those as unavailable instead.

            roomId is the target's room type. A home and its garden share one
            zone, so it is the only thing that drops the arriving fairy in the
            garden rather than the house, and it must never be anything else:
            the client feeds it into its own dispatchRoomID, so a bogus value
            gets stamped on everything that fairy places until they next fly.
            """
            available: bool = not ZoneConstants.isUnflyableActivityZone(zoneId) and not inTransit

            # a quest gated zone needs one of its key badges, the same "can't get there" answer as a full realm
            keys = ZoneConstants.ZONE_KEY_BADGES.get(zoneId)
            if available and keys and not badge_state.get_earned_badge_ids(self.air, self.doId, keys):
                available = False

            if available and self.isRealmCapacityBlocked(parentId):
                # The shard chooser grays full realms out; this catches leaks.
                self.notify.debug(
                    "Refusing to fly %d to %d: realm %d is full (%d)"
                    % (self.doId, fairyId, parentId,
                       self.air.getRealmPopulation(parentId)))
                available = False

            if not isValidRoomType(roomId):
                self.notify.warning(
                    "teleportRequestTo: %s reported room %r, reporting the house"
                    % (fairyId, roomId))
                roomId = ROOM_TYPE_HOME

            self.sendUpdateToAvatarId(self.doId, "teleportResponse", [
                fairyId,
                available,
                parentId,
                zoneId,
                roomId
            ])

            # the target's client turns this into the "is flying to you" alert
            if available and fairyId != self.doId:
                # addressed to the target's own object, like receivePartyInvite: an update
                # addressed to ours has nothing to land on in their client
                self.air.sendUpdateToDoId(
                    "DistributedFairyPlayer", "teleportRequest", fairyId, [self.doId],
                    channelId=self.GetPuppetConnectionChannel(fairyId))

        if AccountControl.hasIgnored(self.air, fairyId, self.getDISLid()):
            self.sendUpdateToAvatarId(self.doId, "teleportResponse", [fairyId, False, 0, 0, ROOM_TYPE_HOME])
            return

        fairy = self.air.getDo(fairyId)

        if fairy:
            # Present on this shard -- read both off the live object.
            # still loading into a meadow, the zone they asked for is not the one they have reported being in
            reported = getattr(fairy, "actualZoneId", None)
            sendResponse(fairy.parentId, fairy.zoneId, fairy.roomID,
                         inTransit=reported is not None and reported != fairy.zoneId)
            return

        # The room type lives on the object, not in the OTP location record.
        def gotRoomID(db: DatabaseObject, retCode: int) -> None:
            roomId: int = ROOM_TYPE_HOME
            if retCode == 0:
                remoteFairy = DistributedFairyPlayerAI(self.air)
                db.fillin(remoteFairy, db.dclass)
                roomId = remoteFairy.roomID

            def gotFairyLocation(doId: int, parentId: int, zoneId: int) -> None:
                if fairyId != doId:
                    self.notify.warning(f"Got unexpected location for doId {doId}, was expecting {fairyId}!")
                    return

                sendResponse(parentId, zoneId, roomId)

            self.air.getObjectLocation(fairyId, gotFairyLocation)

        gotRoomEvent = self.air.uniqueName(f"gotRoomID-{fairyId}")
        self.acceptOnce(gotRoomEvent, gotRoomID)

        db = DatabaseObject(self.air, fairyId)
        db.doneEvent = gotRoomEvent
        db.dclass = self.air.dclassesByName[self.__class__.__name__]
        db.getFields(["setRoomID"])

    def teleportResponseTo(self, fairyId: int, status: int) -> None:
        # the target answers the alert above, the requester already has their response
        pass

    def setSCEmote(self, unused: int, emoteId: int) -> None:
        if self.air.emoteBadges is not None and not getattr(self, "famousFairyId", 0):
            self.air.emoteBadges.emoted(self.doId, getattr(self, "actualZoneId", 0), emoteId)

    def setWhisperSCEmoteTo(self, toId: int, emoteId: int) -> None:
        if AccountControl.hasIgnored(self.air, toId, self.getDISLid()):
            return

        # addressed to the recipient's own object, an update addressed to ours has nothing to land on in their client
        self.air.sendUpdateToDoId(
            "DistributedFairyPlayer", "setWhisperSCEmoteFrom", toId, [self.doId, emoteId],
            channelId=self.GetPuppetConnectionChannel(toId))

    def removeFromInventory(self, invId, itemId):
        """
        Drop a donated item and echo the removal on the right client list.

        Storage and wardrobe items share avatar.items, so the item's location
        picks the echo: storageRemove for Storage, wardrobeRemove for Wardrobe
        and Equipped. The wrong one leaves a stale entry in the client's model
        and skips its donate confirmation (clearDonate), so read the location
        before pulling the item.
        """
        item = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.doId, "avatar.items.inv_id": invId},
            {"avatar.items.$": 1}
        )

        self.air.mongoInterface.mongodb.fairies.update_one(
            {"_id": self.doId},
                {
                    "$pull": {
                        "avatar.items": {
                            "inv_id": invId
                        }
                    }
                }
        )

        location = None
        if item and item.get("avatar", {}).get("items"):
            location = item["avatar"]["items"][0].get("location")

        if location == "Storage":
            field = "storageRemove"
            donationEvent = badge_events.EVENT_DONATE_STORAGE_ITEM
        else:
            field = "wardrobeRemove"
            donationEvent = badge_events.EVENT_DONATE_WARDROBE_ITEM

        self.air.inventoryManager.sendUpdateToAvatarId(self.doId, field, [0, invId])

        # The donate confirmation promises saved outfits go with the item.
        self._invalidateOutfitsForItem(invId)

        # Donating is the only caller: one call, one item to the community.
        self.air.badgeManager.d_accumulate(self.doId, donationEvent)

    def requestGlobalPurchase(self, item):
        avId = self.air.getAvatarIdFromSender()
        if avId != self.doId:
            self.notify.warning(
                f"requestGlobalPurchase from {avId} but sender DO is {self.doId}"
            )
            return

        # The client sends {itemId, amount} and never a price; we look it up.
        try:
            itemId, amount = item[0]
        except (IndexError, TypeError, ValueError):
            self.air.writeServerEvent(
                'suspicious', self.doId,
                'malformed requestGlobalPurchase item: %r' % (item,)
            )
            self.sendUpdateToAvatarId(self.doId, "setGlobalPurchase", [0])
            return

        purchase = GLOBAL_PURCHASE_ITEMS.get(itemId)
        if purchase is None or amount < 1:
            self.sendUpdateToAvatarId(self.doId, "setGlobalPurchase", [0])
            return

        # Nothing to heal means nothing to sell.
        if itemId == INSTA_HEAL_ID and not pet_state.hasPet(pet_state.loadPet(self.air, self.doId)):
            self.sendUpdateToAvatarId(self.doId, "setGlobalPurchase", [0])
            return

        # The client always displays goldPrice, so charge that to stay in sync.
        cost = purchase.goldPrice * amount
        if not self.takeGold(cost):
            self.sendUpdateToAvatarId(self.doId, "setGlobalPurchase", [0])
            return

        if itemId == INSTA_HEAL_ID and not self.healPetAndRefresh():
            # The pet went away between the check above and here. Don't keep the
            # money for something we didn't do.
            self.addGold(cost)
            self.sendUpdateToAvatarId(self.doId, "setGlobalPurchase", [0])
            return

        self.sendUpdateToAvatarId(self.doId, "setGlobalPurchase", [1])

    def requestSendUpdateFairyName(self, name):
        """
        Rename the fairy, live for the whole zone and persisted to Mongo.

        setName is `broadcast db ownrecv`, so one call does both. It does not
        reach the pre-game loading screen, which stays stale until the next
        login: that art belongs to the login/container shell, which caches the
        fairy list from web-api and never subscribes to this DO. Refreshing it
        live would take a client edit.
        """
        avId = self.air.getAvatarIdFromSender()
        if avId != self.doId:
            self.notify.warning(
                f"requestSendUpdateFairyName from {avId} but sender DO is {self.doId}"
            )
            return

        # The client builds the name as `first + " " + prefix + suffix` and
        # drops whichever half the player toggled off, so a last-name-only pick
        # arrives with the separator still on the front: " Bellbreeze".
        name = name_xml.normalize(name)
        if not name:
            return

        # The picker can only ever produce a name built from nameGenerator.xml's
        # word lists, so anything else came from an edited client. Same check
        # web-api's validateFairyName makes on the create-a-fairy path.
        if not name_xml.is_valid(name):
            self.notify.warning(
                f"{self.doId} tried to set an unpickable name: {name!r}"
            )
            return

        self.b_setName(name)
        self.sendUpdateToAvatarId(self.doId, "setRedraw", [1])

    def setStatus(self, location_status, pose_status, holding_status, afk_status):
        if pose_status == 8:
            if self.lastPoseStatus not in (8,10):
                pose_status = random.choice([8, 10])
            else:
                pose_status = self.lastPoseStatus
        
        self.lastPoseStatus = pose_status
        self.sendUpdate("setStatus", [location_status, pose_status, holding_status, afk_status])
