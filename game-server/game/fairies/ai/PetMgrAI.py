import time

from direct.distributed.DistributedObjectGlobalAI import DistributedObjectGlobalAI

from game.fairies.ai import FairiesConstants as fc
from game.fairies.fairy.ItemGrant import STORAGE, WARDROBE, grant_item
from game.fairies.pet import pet_state, pet_xml
from game.fairies.uberdog.HolidayManagerUD import getActiveTags

# no pet quest goal type in the client

TYPE_PET_CLOTHING_OUTFIT = 147


# the district ai's side of the PetMgr uberdog
class PetMgrAI(DistributedObjectGlobalAI):

    def __init__(self, air) -> None:
        super().__init__(air)
        self.lastGiftRequest: dict[int, float] = {}

    def senderAvatar(self):
        avId = self.air.getAvatarIdFromSender()
        return avId, self.air.doId2do.get(avId)

    def petProfileRequest(self, avatarId: int) -> None:
        pass

    def setPetState(self, state: int) -> None:
        pass

    def giftRequest(self, mask: int) -> None:
        avId, avatar = self.senderAvatar()
        if avatar is None or not hasattr(avatar, "refreshPet"):
            return

        now = time.monotonic()
        if now - self.lastGiftRequest.get(avId, 0) < pet_state.GIFT_REQUEST_MIN_SECONDS:
            return
        self.lastGiftRequest[avId] = now

        self.giveGift(avId, avatar, mask)

    # rolls and hands over one gift, returns the gift given or None
    def giveGift(self, avId: int, avatar, mask: int, force: bool = False):
        pet = pet_state.loadPetAndApplyDecay(self.air, avId)
        if not pet_state.hasPet(pet):
            return None

        owned = pet_state.getOwnedOutfits(self.air, avId)
        gift = pet_state.rollGift(pet, mask, owned, set(getActiveTags()), self.giftKind, force)
        pet_state.savePet(self.air, avId, pet)

        if gift is None or not self.handOver(avId, avatar, gift):
            return None

        avatar.sendUpdateToAvatarId(avId, "giftGiven", [1, [gift.itemId, gift.count, 0, 0]])
        return gift

    def giftKind(self, itemId: int) -> str | None:
        try:
            typeId = fc.get_type_id(itemId)
        except ValueError:
            return None

        if typeId == TYPE_PET_CLOTHING_OUTFIT:
            return "outfit" if pet_xml.outfitSpecies(itemId) else None
        if typeId in fc.POUCH_TYPE_IDS:
            return "pouch"
        if typeId in fc.STORAGE_TYPE_IDS:
            return "storage"
        if typeId in fc.WARDROBE_TYPE_IDS:
            return "wardrobe"
        return None

    def handOver(self, avId: int, avatar, gift) -> bool:
        kind = self.giftKind(gift.itemId)

        if kind == "outfit":
            pet_state.addOwnedOutfit(self.air, avId, gift.itemId)
            avatar.sendOwnedPetOutfits()
            return True

        if kind == "pouch":
            if not self.air.inventoryManager.addIngredientsToPouch(avId, gift.itemId, gift.count, -1):
                return False
            avatar.d_syncPouchAfterChanges()
            return True

        if kind in ("wardrobe", "storage"):
            where = STORAGE if kind == "storage" else WARDROBE
            return bool(grant_item(self.air, avId, gift.itemId, where=where))

        return False

    def resetPetGiftTimer(self) -> None:
        avId, avatar = self.senderAvatar()
        if avatar is None:
            return

        pet = pet_state.loadPet(self.air, avId)
        if pet is not None and pet.get("giftSteps"):
            pet["giftSteps"] = 0
            pet_state.savePet(self.air, avId, pet)

    def requestOutfitChange(self, outfitId: int) -> None:
        avId, avatar = self.senderAvatar()
        if avatar is None or not hasattr(avatar, "refreshPet"):
            return

        pet = pet_state.loadPetAndApplyDecay(self.air, avId)
        if not pet_state.hasPet(pet):
            return

        if not pet_state.canWearOutfit(pet, outfitId, pet_state.getOwnedOutfits(self.air, avId)):
            self.notify.warning(f"requestOutfitChange: {avId} can't wear outfit {outfitId}")
            avatar.refreshPet(pet)
            return

        pet["outfitId"] = outfitId
        pet_state.savePet(self.air, avId, pet)
        avatar.refreshPet(pet)

    def petConversion(self) -> None:
        avId, avatar = self.senderAvatar()
        if avatar is None or not hasattr(avatar, "refreshPet"):
            return

        pet = pet_state.loadPetAndApplyDecay(self.air, avId)
        if not pet_state.hasPet(pet) or pet.get("golden"):
            return

        price = pet_xml.conversionPrice(int(pet.get("itemId", 0)))
        if price < 0 or not avatar.takeGold(price):
            avatar.refreshPet(pet)
            return

        pet["golden"] = 1
        pet_state.savePet(self.air, avId, pet)
        avatar.refreshPet(pet)
