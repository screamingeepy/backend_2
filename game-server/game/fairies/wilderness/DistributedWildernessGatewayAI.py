# the signpost in a meadow (dclass 98)

from direct.distributed.DistributedObjectAI import DistributedObjectAI


class DistributedWildernessGatewayAI(DistributedObjectAI):
    def __init__(self, air) -> None:
        super().__init__(air)

        self.wildernessId: int = 0
        self.itemId: int = 0
        self.gatewayPosition: tuple[int, int] = (0, 0)
        self.positionByName: str = ""

    def setWildernessId(self, wildernessId: int) -> None:
        self.wildernessId = wildernessId

    def getWildernessId(self) -> int:
        return self.wildernessId

    def setItemId(self, itemId: int) -> None:
        self.itemId = itemId

    def getItemId(self) -> int:
        return self.itemId

    def setPosition(self, x: int, y: int) -> None:
        self.gatewayPosition = (x, y)

    def getPosition(self) -> tuple[int, int]:
        return self.gatewayPosition

    def setPositionByName(self, positionByName: str) -> None:
        self.positionByName = positionByName

    def getPositionByName(self) -> str:
        return self.positionByName
