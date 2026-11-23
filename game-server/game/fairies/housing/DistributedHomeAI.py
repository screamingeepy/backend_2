from game.fairies.instance.DistributedInstanceBaseAI import DistributedInstanceBaseAI
from game.fairies.pet import pet_state


class DistributedHomeAI(DistributedInstanceBaseAI):
    """ai half of the client's DistributedHome, the object a home realm generates for the house itself"""

    def __init__(self, air, realm=None, address: str = "1234CatepillerCorral",
                 unlockedRooms: int = 0) -> None:
        super().__init__(air)

        # The FairiesHomeRealmAI this house belongs to. Parties live and die with
        # the realm, so createParty is handed straight to it.
        self.realm = realm
        self.address = address
        self.unlockedRooms = unlockedRooms
        # pet dna of the resting pet, or empty dna for none (broadcast ram, late joiners get it)
        self.restingPetDNA = list(pet_state.EMPTY_PET_DNA)
        self.minigameId = 0
        self.minigamePlayers: list = []

    def setAddress(self, address: str) -> None:
        self.address = address

    def setUnlockedRooms(self, unlockedRooms: int) -> None:
        self.unlockedRooms = unlockedRooms

    def getAddress(self) -> str:
        return self.address

    def getUnlockedRooms(self) -> int:
        return self.unlockedRooms

    def setRestingPetDNA(self, petDNA) -> None:
        """Seat (or clear, with the empty DNA) the Animal Friend resting here."""
        self.restingPetDNA = list(petDNA)
        self.sendUpdate("setRestingPet", [self.restingPetDNA])

    def createParty(self, themeId: int, nameIds) -> None:
        # PartyPanel.reallyRequestPlacement: the owner picked a party decoration
        # and a name and pressed Start.
        if self.realm is None:
            self.notify.warning("createParty on a home with no realm")
            return

        self.realm.startParty(self.air.getAvatarIdFromSender(), themeId, list(nameIds))

    def getNewHotspotTagId(self) -> None:
        # ActivityManager.setUpGameDrop: the owner pressed Place on a game in their
        # pouch, and the client wants a tag for the table before it can be dragged.
        if self.realm is None:
            self.notify.warning("getNewHotspotTagId on a home with no realm")
            return

        self.realm.requestHotspotTag(self.air.getAvatarIdFromSender())

    def b_setMinigame(self, gameId: int, players: list) -> None:
        """who is away playing a party game, the id goes first because the launcher reads it when players change"""
        self.minigameId = gameId
        self.minigamePlayers = [list(player) for player in players]
        self.sendUpdate("setMinigameId", [self.minigameId])
        self.sendUpdate("setMinigamePlayers", [self.minigamePlayers])
