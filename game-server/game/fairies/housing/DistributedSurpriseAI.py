from direct.directnotify.DirectNotifyGlobal import directNotify
from direct.distributed.DistributedObjectAI import DistributedObjectAI

SURPRISE_CLOSED = 0
SURPRISE_OPEN = 1

TYPE_POST_OFFICE_POSTCARDS = 4
TYPE_POST_OFFICE_GIFT_SETS = 5

SURPRISE_ITEM_ID_BY_TYPE = {
    TYPE_POST_OFFICE_POSTCARDS: 28503,
    TYPE_POST_OFFICE_GIFT_SETS: 28504,
}


class DistributedSurpriseAI(DistributedObjectAI):
    """ai half of the client's DistributedSurprise, the home post office mailbox"""
    notify = directNotify.newCategory("DistributedSurpriseAI")

    def __init__(self, air, typeId, x, y, itemId=None, restricted=0):
        DistributedObjectAI.__init__(self, air)

        self.typeId = typeId
        self.x = x
        self.y = y
        # Each surprise type has a fixed art item; callers may override.
        self.itemId = itemId if itemId is not None else SURPRISE_ITEM_ID_BY_TYPE.get(typeId, 0)
        self.restricted = restricted
        self.state = SURPRISE_CLOSED

    def getItemId(self):
        return self.itemId

    def getTypeId(self):
        return self.typeId

    def getTypeData(self):
        # The panels fetch their real contents over HTTP, so no per-item payload
        # rides along here.
        return []

    def getPosition(self):
        return (self.x, self.y)

    def getRestricted(self):
        return self.restricted

    def getState(self):
        return self.state

    def b_setState(self, state):
        self.state = state
        self.sendUpdate("setState", [state])

    def openRequest(self, surpriseSet):
        # the owner opened the mailbox, play the animation and open the archive panel
        if self.state == SURPRISE_CLOSED:
            self.b_setState(SURPRISE_OPEN)

    def openComplete(self, surpriseSet):
        # the owner cleared their mail, take the mailbox away until more arrives
        self.requestDelete()
