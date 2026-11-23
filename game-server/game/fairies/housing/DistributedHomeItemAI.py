from direct.directnotify.DirectNotifyGlobal import directNotify
from direct.distributed.DistributedObjectAI import DistributedObjectAI


class DistributedHomeItemAI(DistributedObjectAI):
    notify = directNotify.newCategory("DistributedHomeItemAI")

    def __init__(self, air, ownerId, invId, itemId, colorIds,
                 x, y, depth, flip, scale, roomId):
        DistributedObjectAI.__init__(self, air)

        self.ownerId = ownerId
        self.invId = invId
        self.itemId = itemId
        self.colorIds = colorIds
        self.x = x
        self.y = y
        self.depth = depth
        self.flip = flip
        self.scale = scale
        self.roomId = roomId

    def getItemID(self):
        return self.itemId

    def getInventoryID(self):
        return self.invId

    def getColorIDs(self):
        return self.colorIds

    def getPosition(self):
        return (self.x, self.y, self.depth)

    def getFlip(self):
        return self.flip

    def getScale(self):
        return self.scale

    def getRoomID(self):
        return self.roomId

    def setHomeManagerDOID(self, doId):
        pass

    def updatePlacement(self, x, y, depth, flip, scale, roomId):
        # re-sync without regenerating, the client re-sends placements it lost after teleporting home
        self._applyPlacement(x, y, depth, flip, scale, roomId)

    def requestItemChange(self, x, y, depth, flip, scale):
        # The client moved/flipped/resized the item.
        if self._applyPlacement(x, y, depth, flip, scale, self.roomId):
            self._persistPlacement()

    def _applyPlacement(self, x, y, depth, flip, scale, roomId):
        if (x, y, depth, flip, scale, roomId) == (
                self.x, self.y, self.depth, self.flip, self.scale, self.roomId):
            return False

        moved = (x, y, depth) != (self.x, self.y, self.depth)
        flipped = flip != self.flip
        resized = scale != self.scale
        changedRoom = roomId != self.roomId

        self.x = x
        self.y = y
        self.depth = depth
        self.flip = flip
        self.scale = scale
        self.roomId = roomId

        if moved:
            self.sendUpdate("setPosition", [x, y, depth])
        if flipped:
            self.sendUpdate("setFlip", [flip])
        if resized:
            self.sendUpdate("setScale", [scale])
        if changedRoom:
            self.sendUpdate("setRoomID", [roomId])

        return True

    def _persistPlacement(self):
        self.air.mongoInterface.mongodb.fairies.update_one(
            {"_id": self.ownerId, "avatar.items.inv_id": self.invId},
            {"$set": {
                "avatar.items.$.home.x": self.x,
                "avatar.items.$.home.y": self.y,
                "avatar.items.$.home.depth": self.depth,
                "avatar.items.$.home.flip": self.flip,
                "avatar.items.$.home.scale": self.scale,
                "avatar.items.$.home.roomId": self.roomId
            }}
        )
