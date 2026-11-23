import random

from direct.directnotify import DirectNotifyGlobal
from direct.task.TaskManagerGlobal import taskMgr

from game.fairies.fairy.npc.QuestMgr import QuestMgr
from game.fairies.meadow.DistributedGiveawayAI import DistributedGiveawayAI
from game.fairies.meadow.HuntData import HUNTS, STACK_ITEM_ID
from game.fairies.meadow.IngredientSpawnData import ZONE_EXCLUSIONS, ZONE_MAP_BOUNDS

SYNC_SECONDS = 3
# items in one zone stay at least this far apart
MIN_DISTANCE = 140
POSITION_ATTEMPTS = 60
# the accumulator is an int16 and the client counts its set bits
MAX_ITEMS = 15


class HuntSpawnMgrAI:
    notify = DirectNotifyGlobal.directNotify.newCategory("HuntSpawnMgrAI")

    def __init__(self, air) -> None:
        self.air = air
        # (questId, step, bit) -> the giveaway standing for it, None if it had no room
        self.placed: dict[tuple[int, int, int], DistributedGiveawayAI | None] = {}

    def start(self) -> None:
        taskMgr.doMethodLater(SYNC_SECONDS, self.syncTask, "hunt-sync")

    def syncTask(self, task):
        self.sync()
        return task.again

    def quantity(self, quest_id: int, step: int) -> int:
        goal = QuestMgr.getInstance().getGoalForQuestStep(quest_id, step)
        return max(1, min(goal.quantity if goal else 1, MAX_ITEMS))

    def neededItems(self) -> set[tuple[int, int, int]]:
        needed = set()

        for obj in list(self.air.doId2do.values()):
            for quest_id, q_obj in list(getattr(obj, "activeQuests", {}).items()):
                if (quest_id, q_obj.step) not in HUNTS:
                    continue

                for bit in range(self.quantity(quest_id, q_obj.step)):
                    if not (q_obj.accumulator >> bit) & 1:
                        needed.add((quest_id, q_obj.step, bit))

        return needed

    def sync(self) -> None:
        needed = self.neededItems()

        for key in sorted(needed - self.placed.keys()):
            self.placed[key] = self.spawn(*key)

        for key in list(self.placed.keys() - needed):
            giveaway = self.placed.pop(key)

            if giveaway is not None:
                giveaway.requestDelete()

    def spawn(self, quest_id: int, step: int, bit: int) -> DistributedGiveawayAI | None:
        hunt = HUNTS[(quest_id, step)]
        zone_id = hunt.zones[bit % len(hunt.zones)]
        position = self.pickPosition(zone_id)

        if position is None:
            self.notify.warning("no spot for hunt %d step %d item %d in zone %d" % (quest_id, step, bit, zone_id))
            return None

        giveaway = DistributedGiveawayAI(self.air)
        giveaway.setGiveawayID(hunt.art[bit % len(hunt.art)])
        giveaway.setHunt(quest_id, step, bit)
        giveaway.setItemID(STACK_ITEM_ID)
        giveaway.setName(hunt.name)
        giveaway.setPosition(*position)
        giveaway.setColorIDs([])
        giveaway.setItemCount(1)
        giveaway.setServingSize(1)
        giveaway.generateWithRequired(zone_id)
        return giveaway

    def pickPosition(self, zone_id: int) -> tuple[int, int] | None:
        bounds = ZONE_MAP_BOUNDS.get(zone_id)

        if bounds is None:
            return None

        exclusions = ZONE_EXCLUSIONS.get(zone_id, ())
        near = [g.getPosition() for g in self.placed.values() if g is not None and g.zoneId == zone_id]

        for _ in range(POSITION_ATTEMPTS):
            x = random.randint(bounds.x_min, bounds.x_max)
            y = random.randint(bounds.y_min, bounds.y_max)

            if any(e.x_min <= x <= e.x_max and e.y_min <= y <= e.y_max for e in exclusions):
                continue

            if any((x - px) ** 2 + (y - py) ** 2 < MIN_DISTANCE ** 2 for px, py in near):
                continue

            return x, y

        return None
