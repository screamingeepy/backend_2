from .DistributedFairyGMAI import DistributedFairyGMAI

MAX_ORB_SIZE = 255


class DistributedFamousFairyGMAI(DistributedFairyGMAI):
    def __init__(self, air) -> None:
        DistributedFairyGMAI.__init__(self, air)

        self.famousFairyId: int = 0
        self.orbSize: int = 0

    def setFamousFairyId(self, famousFairyId: int) -> None:
        self.famousFairyId = famousFairyId

    def getFamousFairyId(self) -> int:
        return self.famousFairyId

    def setOrbSize(self, orbSize: int) -> None:
        self.orbSize = orbSize

    def getOrbSize(self) -> int:
        return self.orbSize

    def b_setOrbSize(self, orbSize: int) -> None:
        self.setOrbSize(orbSize)
        self.sendUpdate("setOrbSize", [orbSize])

    def puppetSay(self, message: str) -> None:
        self.sendUpdate("setTalk", [self.doId, self.getDISLid(), self.getName(), message, [], 0])

    def puppetEmote(self, emoteId: int) -> None:
        self.sendUpdate("setSCEmote", [self.doId, emoteId])

    def puppetMove(self, x: int, y: int) -> None:
        self.sendUpdate("setPosition", [x, y])
