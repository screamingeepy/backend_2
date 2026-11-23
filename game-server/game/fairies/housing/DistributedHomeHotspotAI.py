from direct.directnotify.DirectNotifyGlobal import directNotify
from direct.distributed.DistributedObjectAI import DistributedObjectAI

from game.fairies.housing import HomeGames


class DistributedHomeHotspotAI(DistributedObjectAI):
    """ai half of the client's DistributedHomeHotspot, a game table dropped into a home or garden"""
    notify = directNotify.newCategory("DistributedHomeHotspotAI")

    def __init__(self, air, ownerId, tagId, gameItemId, hotspotId, invId, x, y, roomId):
        DistributedObjectAI.__init__(self, air)

        self.ownerId = ownerId
        self.tagId = tagId
        self.gameItemId = gameItemId
        # the hotspot id from hotspotAssets.xml, sent as the item id
        self.hotspotId = hotspotId
        # Echoed back exactly as the client sent it -- HomeItemNegotiator swaps
        # its placeholder for this object by comparing the two.
        self.invId = invId
        self.x = x
        self.y = y
        self.roomId = roomId
        # The DistributedMeadowGame played at this table, keyed to it by tag.
        self.game = None

    def getItemID(self):
        return self.hotspotId

    def getHotspotLockState(self):
        return HomeGames.LOCKED_STATE_TRUE

    def getPosition(self):
        return (self.x, self.y, 0)

    def getInventoryID(self):
        return self.invId

    def getRoomID(self):
        return self.roomId

    def getTagId(self):
        return self.tagId
