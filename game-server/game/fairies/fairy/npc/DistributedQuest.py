import time
from direct.distributed.DistributedObjectAI import DistributedObjectAI
from .QuestMgr import QUESTS_PER_QUEST_GROUP


QUEST_OBJECT_ZONE = 1

QUEST_STATE_REWARD_PENDING = 2
QUEST_STATE_ABORTED        = 10
QUEST_STATE_REMOVE_NONREPEATABLE = 11
QUEST_STATE_REMOVE_REPEATABLE   = 12

class DistributedQuest(DistributedObjectAI):
    def __init__(self, air, avId: int = 0, questId: int = 0, step: int = 0,
                startTime: int = 0, accumulator: int = 0) -> None:
        DistributedObjectAI.__init__(self, air)
        self.avId: int = avId
        self.questId: int = questId
        self.step: int = step
        self.startTime: int = startTime if startTime > 0 else int(time.time())
        self.accumulator: int = accumulator
        self.stepStatus: int = 0

    def announceGenerate(self) -> None:
        DistributedObjectAI.announceGenerate(self)

    def getQuestId(self) -> tuple[int, int]:
        group = self.questId // QUESTS_PER_QUEST_GROUP
        bit_idx = self.questId % QUESTS_PER_QUEST_GROUP
        return (group, bit_idx)

    def getStep(self) -> tuple[int, int]:
        return (self.step, self.startTime)

    def getAccumulator(self) -> int:
        return self.accumulator

    def setStep(self, step: int, startTime: int = 0) -> None:
        self.step = step
        if startTime > 0:
            self.startTime = startTime
        if self.avId:
            self.sendUpdateToAvatarId(self.avId, "setStep", [self.step, self.startTime])

    def setAccumulator(self, accum: int) -> None:
        self.accumulator = accum
        if self.avId:
            self.sendUpdateToAvatarId(self.avId, "setAccumulator", [accum])

    def setStepStatus(self, status: int) -> None:
        self.stepStatus = status
        if self.avId:
            self.sendUpdateToAvatarId(self.avId, "setStepStatus", [status])

    def getStepStatus(self) -> int:
        return self.stepStatus

    def removeQuest(self, reason: int) -> None:
        sender_id = self.air.getAvatarIdFromSender()
        print(f"[DistributedQuest] removeQuest called by avId={sender_id} for questId={self.questId}, reason={reason}")
        if sender_id != self.avId:
            print(f"[DistributedQuest] removeQuest: avId={sender_id} does not own questId={self.questId}, ignoring")
            return
        # client can send this twice for one decline
        if getattr(self, "alreadyRemoved", False):
            return
        self.alreadyRemoved = True

        if self.avId:
            self.air.mongoInterface.mongodb.fairies.update_one(
                {"_id": self.avId},
                {"$pull": {"questState": {"questId": self.questId}}}
            )
            player = self.air.doId2do.get(self.avId)
            if player and hasattr(player, "activeQuests") and self.questId in player.activeQuests:
                del player.activeQuests[self.questId]

        # aborted status has to go out before the delete or the npc dialog hangs
        self.setStepStatus(QUEST_STATE_ABORTED)
        self.requestDelete()
        
    def isQuestDaily(self) -> bool:
        step = self.getCurrentStep()
        return step is not None and step.delay > 0
    
    
# isComplete -> called in mgr