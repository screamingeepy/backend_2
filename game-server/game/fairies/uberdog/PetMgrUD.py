from direct.distributed.DistributedObjectGlobalUD import DistributedObjectGlobalUD
from direct.distributed.PyDatagram import PyDatagram

from game.fairies.ai.FairiesAIMsgTypes import BROADCAST_MESSAGE_TO_ALL_AI, PET_STATE_CHANGED
from game.fairies.pet import pet_state


# the animal friend manager
class PetMgrUD(DistributedObjectGlobalUD):

    def __init__(self, air) -> None:
        super().__init__(air)

    def petProfileRequest(self, avatarId: int) -> None:
        # avatarId is the viewed fairy, not the viewer, so the answer goes to the sender
        requesterId = self.air.getAvatarIdFromSender()

        pet = pet_state.loadPetAndApplyDecay(self.air, avatarId)

        self.sendUpdateToAvatarId(
            requesterId, "petProfileResponse",
            [avatarId, pet_state.petDNATuple(pet), pet_state.petDetailTuple(pet)]
        )

    def setPetState(self, state: int) -> None:
        # from the rest button, from the client when a microgame starts and from elixa's release option
        avatarId = self.air.getAvatarIdFromSender()

        allowed = (pet_state.ANIMAL_FRIEND_RESTING, pet_state.ANIMAL_FRIEND_ACTIVE, pet_state.ANIMAL_FRIEND_RELEASED)
        if state not in allowed:
            self.notify.warning(f"Ignoring setPetState {state} from {avatarId}")
            return

        pet = pet_state.loadPetAndApplyDecay(self.air, avatarId)
        if not pet_state.hasPet(pet):
            print(f"[Pet] setPetState {state} from {avatarId}: no pet")
            return

        print(f"[Pet] setPetState from {avatarId}: {pet.get('status')} -> {state}")
        if pet.get("status") != state:
            pet["status"] = state
            pet_state.savePet(self.air, avatarId, pet)

        self.d_petStateChanged(avatarId)

    # asks whichever district holds this avatar to re-push its pet
    def d_petStateChanged(self, avatarId: int) -> None:
        dg = PyDatagram()
        dg.addServerHeader(BROADCAST_MESSAGE_TO_ALL_AI, self.air.ourChannel, PET_STATE_CHANGED)
        dg.addUint32(avatarId)
        self.air.send(dg)

    # gifts, outfits and golden need the avatar so PetMgrAI on the district handles them

    def giftRequest(self, mask: int) -> None:
        pass

    def resetPetGiftTimer(self) -> None:
        pass

    def requestOutfitChange(self, outfitId: int) -> None:
        pass

    def petConversion(self) -> None:
        pass
