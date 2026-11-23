import random
import time

from direct.directnotify.DirectNotifyGlobal import directNotify
from direct.distributed.DistributedObjectAI import DistributedObjectAI
from direct.task.TaskManagerGlobal import taskMgr

from game.fairies.ai.FairiesConstants import (
    POUCH_TYPE_IDS,
    STORAGE_TYPE_IDS,
    WARDROBE_TYPE_IDS,
    get_type_id,
)
from game.fairies.fairy.ItemGrant import STORAGE, WARDROBE, grant_item
from game.fairies.badges import badge_events
from game.fairies.housing import GardenData

# how often a stage asks for a talent skill instead of dusting
SKILL_CHANCE = 0.25

# verbs a plant can ask for, the client only has buttons for the first five
SKILL_VERBS = (0, 1, 2, 3, 4)

# tendingNeeded when a plant wants dusting, the client only tests it against -1
TENDING_WANTED = 1


class DistributedGardenPlotAI(DistributedObjectAI):
    notify = directNotify.newCategory("DistributedGardenPlotAI")

    def __init__(self, air, ownerId, plotNum, record=None):
        DistributedObjectAI.__init__(self, air)

        self.ownerId = ownerId
        self.plotNum = plotNum

        self.seedId = 0
        self.plantId = 0
        self.stage = 0
        self.stages = 0
        # unix seconds the current stage started, the client's endDateTime
        self.stageStart = 0
        self.tendingNeeded = GardenData.NOTHING_NEEDED
        self.skillNeeded = GardenData.NOTHING_NEEDED
        self.wilted = False
        # fairies who have sung to this plant
        self.helpers: set[int] = set()
        self.canInteract = False

        self.taskNames: set[str] = set()

        if record:
            self.loadRecord(record)

    # ------------------------------------------------------------------ tasks

    def runAfterSeconds(self, delay, callback, name):
        taskName = f"{type(self).__name__}-{self.doId}-{name}"
        taskMgr.remove(taskName)
        self.taskNames.add(taskName)

        def run(task):
            self.taskNames.discard(taskName)
            callback()
            return task.done

        taskMgr.doMethodLater(delay, run, taskName)

    def cancelNamedTask(self, name):
        taskName = f"{type(self).__name__}-{self.doId}-{name}"
        taskMgr.remove(taskName)
        self.taskNames.discard(taskName)

    def cancelAllNamedTasks(self):
        for taskName in list(self.taskNames):
            taskMgr.remove(taskName)
        self.taskNames.clear()

    # ------------------------------------------------------------------ state

    def isPlanted(self):
        return self.seedId > 0 and self.plantId > 0

    def isRipe(self):
        return self.isPlanted() and self.stage >= self.stages

    def getSeed(self):
        return GardenData.getSeed(self.seedId)

    def getPlant(self):
        seed = self.getSeed()
        return seed.plant(self.plantId) if seed else None

    def stageDuration(self):
        seed, plant = self.getSeed(), self.getPlant()
        return seed.stageDuration(plant) if seed and plant else 0

    def readyAt(self):
        return self.stageStart + self.stageDuration()

    def interactTimeLeft(self):
        return max(0, self.readyAt() - int(time.time()))

    # ---------------------------------------------------------------- getters

    def getFairyId(self):
        # MeadowPlant.isMyPlant compares this to the logged in fairy
        return self.ownerId

    def getPlotNum(self):
        return self.plotNum

    def getSeedId(self):
        return self.seedId

    def getPlantId(self):
        return self.plantId

    def getStage(self):
        return self.stage

    def getStages(self):
        return self.stages

    def getEndDateTime(self):
        return self.stageStart

    def getTendingNeeded(self):
        return self.tendingNeeded

    def getSkillNeeded(self):
        return self.skillNeeded

    def getDustCost(self):
        return GardenData.TEND_COST if self.isPlanted() else 0

    def getHelperCount(self):
        return len(self.helpers)

    def getMaxHelperCount(self):
        return GardenData.MAX_HELPERS

    def getInstaGrowCost(self):
        seed = self.getSeed()
        return seed.instaGrowCost if seed else 0

    def getCanInteract(self):
        return int(self.canInteract)

    def getCanHelp(self):
        return int(self.canBeHelped())

    def getIsWilted(self):
        return int(self.wilted)

    def getWiltDelay(self):
        return GardenData.wiltDelay()

    def getTotalInteractionTime(self):
        return self.stageDuration()

    def canBeHelped(self):
        return (self.isPlanted() and not self.isRipe() and not self.wilted
                and len(self.helpers) < GardenData.MAX_HELPERS)

    # a seed that was never dusted is not on the clock
    def canWilt(self):
        return (self.isPlanted() and not self.isRipe() and not self.wilted
                and self.stage > GardenData.FIRST_STAGE)

    # ----------------------------------------------------------- persistence

    def getFairiesCollection(self):
        return self.air.mongoInterface.mongodb.fairies

    def asRecord(self):
        return {
            "plotNum": self.plotNum,
            "seedId": self.seedId,
            "plantId": self.plantId,
            "stage": self.stage,
            "stageStart": self.stageStart,
            "tendingNeeded": self.tendingNeeded,
            "skillNeeded": self.skillNeeded,
            "wilted": self.wilted,
            "helpers": sorted(self.helpers),
        }

    def loadRecord(self, record):
        self.seedId = record.get("seedId", 0)
        self.plantId = record.get("plantId", 0)
        self.stage = record.get("stage", 0)
        self.stageStart = record.get("stageStart", 0)
        self.tendingNeeded = record.get("tendingNeeded", GardenData.NOTHING_NEEDED)
        self.skillNeeded = record.get("skillNeeded", GardenData.NOTHING_NEEDED)
        self.wilted = bool(record.get("wilted", False))
        self.helpers = set(record.get("helpers", []))

        plant = self.getPlant()

        if plant is None:
            # seed or plant is gone from the data, clear it so the client doesn't draw a hole
            if self.isPlanted():
                self.notify.warning(
                    f"plot {self.plotNum} of fairy {self.ownerId} grows unknown "
                    f"plant {self.plantId} from seed {self.seedId}; clearing it")
            self.resetPlot()
            return

        self.stages = plant.stages
        self.catchUpOfflineGrowth()

    # works out where a plant got to while nobody was watching
    def catchUpOfflineGrowth(self):
        if not self.isPlanted() or self.isRipe() or self.wilted:
            self.canInteract = False
            return

        now = int(time.time())
        self.canInteract = now >= self.readyAt()

        if (self.canInteract and self.canWilt()
                and now >= self.readyAt() + GardenData.wiltDelay()):
            self.wilted = True
            self.canInteract = False

    def saveToDatabase(self):
        record = self.asRecord()
        result = self.getFairiesCollection().update_one(
            {"_id": self.ownerId, "gardenPlots.plotNum": self.plotNum},
            {"$set": {"gardenPlots.$": record}},
        )

        if result.matched_count == 0:
            self.getFairiesCollection().update_one(
                {"_id": self.ownerId},
                {"$push": {"gardenPlots": record}},
            )

        owner = self.air.doId2do.get(self.ownerId)

        if owner is not None:
            owner.d_setGardenState()

    # --------------------------------------------------------------- lifetime

    def announceGenerate(self):
        DistributedObjectAI.announceGenerate(self)
        self.scheduleStage()

    def delete(self):
        self.cancelAllNamedTasks()
        DistributedObjectAI.delete(self)

    # arms whichever clock the plant is waiting on, ripen or wilt
    def scheduleStage(self):
        self.cancelNamedTask("ready")
        self.cancelNamedTask("wilt")

        if not self.isPlanted() or self.isRipe() or self.wilted:
            return

        now = int(time.time())

        if now < self.readyAt():
            self.runAfterSeconds(self.readyAt() - now, self.onStageReady, "ready")
            return

        self.scheduleWilt()

    def scheduleWilt(self):
        self.cancelNamedTask("wilt")

        if not self.canWilt():
            return

        left = self.readyAt() + GardenData.wiltDelay() - int(time.time())
        self.runAfterSeconds(max(1, left), self.onWilt, "wilt")

    def onStageReady(self):
        # go straight to the wilt clock, this fires the second readyAt lands
        self.canInteract = True
        self.sendUpdate("setCanInteract", [self.getCanInteract()])
        self.scheduleWilt()

    def onWilt(self):
        self.wilted = True
        self.canInteract = False
        self.sendUpdate("setIsWilted", [self.getIsWilted()])
        self.sendUpdate("setCanInteract", [self.getCanInteract()])
        self.sendUpdate("setCanHelp", [self.getCanHelp()])
        self.sendUpdate("plantWilted", [])
        self.saveToDatabase()

    # ------------------------------------------------------------------- sync

    # pushes everything the plot looks like to the client
    def sendPlotStateToClients(self):
        self.sendUpdate("setSeedId", [self.seedId])
        self.sendUpdate("setPlantId", [self.plantId])
        self.sendUpdate("setStage", [self.stage])
        self.sendUpdate("setStages", [self.stages])
        self.sendUpdate("setEndDateTime", [self.stageStart])
        self.sendUpdate("setTendingNeeded", [self.tendingNeeded])
        self.sendUpdate("setSkillNeeded", [self.skillNeeded])
        self.sendUpdate("setDustCost", [self.getDustCost()])
        self.sendUpdate("setInstaGrowCost", [self.getInstaGrowCost()])
        self.sendUpdate("setTotalInteractionTime", [self.getTotalInteractionTime()])
        self.sendUpdate("setHelperCount", [self.getHelperCount()])
        self.sendUpdate("setCanInteract", [self.getCanInteract()])
        self.sendUpdate("setCanHelp", [self.getCanHelp()])
        self.sendUpdate("setIsWilted", [self.getIsWilted()])
        # the client only asks once on generate, so a dust would leave its countdown at 0
        self.sendUpdate("plantInteractTimeLeftUpdate", [self.interactTimeLeft()])

    def resetPlot(self):
        self.seedId = 0
        self.plantId = 0
        self.stage = 0
        self.stages = 0
        self.stageStart = 0
        self.tendingNeeded = GardenData.NOTHING_NEEDED
        self.skillNeeded = GardenData.NOTHING_NEEDED
        self.wilted = False
        self.helpers.clear()
        self.canInteract = False

    def clearPlot(self):
        self.cancelAllNamedTasks()
        self.resetPlot()
        self.sendPlotStateToClients()
        # assetsLoaded rebuilds the art from plantId, that's how the plant leaves the screen
        self.sendUpdate("plantRemoved", [])
        self.saveToDatabase()

    def rollWhatPlantNeeds(self):
        if self.isRipe():
            self.tendingNeeded = GardenData.NOTHING_NEEDED
            self.skillNeeded = GardenData.NOTHING_NEEDED
            return

        if random.random() < SKILL_CHANCE:
            self.tendingNeeded = GardenData.NOTHING_NEEDED
            self.skillNeeded = random.choice(SKILL_VERBS)
            return

        self.tendingNeeded = TENDING_WANTED
        self.skillNeeded = GardenData.NOTHING_NEEDED

    # the sender, if they own this garden
    def getAvatarIfOwner(self, avatarId):
        if avatarId != self.ownerId:
            self.notify.warning(
                f"fairy {avatarId} tried to work plot {self.plotNum} "
                f"of fairy {self.ownerId}")
            return None

        return self.air.doId2do.get(avatarId)

    # --------------------------------------------------------------- planting

    def requestPlantSeed(self, seedId):
        avatarId = self.air.getAvatarIdFromSender()
        avatar = self.getAvatarIfOwner(avatarId)

        if avatar is None:
            return

        if self.isPlanted():
            self.notify.warning(f"plot {self.plotNum} already has something growing")
            return

        seed = GardenData.getSeed(seedId)

        if seed is None:
            self.notify.warning(f"fairy {avatarId} tried to plant unknown seed {seedId}")
            return

        if not self.air.inventoryManager.removeIngredientsFromPouch(avatarId, seedId, 1):
            self.notify.warning(f"fairy {avatarId} has no {seedId} to plant")
            return

        avatar.d_setPouch(self.air.inventoryManager.getPouch(avatarId))

        # which plant it grows into is picked now, not at harvest
        plant = random.choice(seed.plants)

        self.seedId = seed.seedId
        self.plantId = plant.plantId
        self.stages = plant.stages
        self.stage = GardenData.FIRST_STAGE
        self.wilted = False
        self.helpers.clear()
        self.rollWhatPlantNeeds()
        # a new seed wants dusting straight away, back-date it so the button shows at once
        self.stageStart = int(time.time()) - self.stageDuration()
        self.canInteract = True

        self.sendPlotStateToClients()
        self.sendUpdate("plantPlanted", [self.seedId, self.plantId])
        self.scheduleStage()
        self.saveToDatabase()

    def requestRemove(self):
        avatarId = self.air.getAvatarIdFromSender()

        if self.getAvatarIfOwner(avatarId) is None or not self.isPlanted():
            return

        self.clearPlot()

    # ---------------------------------------------------------------- tending

    def requestDust(self):
        self.tendPlant(self.air.getAvatarIdFromSender(), skill=False)

    def requestSkill(self):
        self.tendPlant(self.air.getAvatarIdFromSender(), skill=True)

    def tendPlant(self, avatarId, skill):
        avatar = self.getAvatarIfOwner(avatarId)

        if avatar is None or not self.isPlanted() or self.wilted or self.isRipe():
            return

        wanted = self.skillNeeded if skill else self.tendingNeeded

        if wanted == GardenData.NOTHING_NEEDED:
            return

        if not self.canInteract:
            # client only shows the button once ripe, so this is a stale panel or someone poking us
            return

        if not avatar.spendPixieDust(GardenData.TEND_COST):
            return

        # first dusting plays the sprouting animation
        firstTending = self.stage == GardenData.FIRST_STAGE

        self.stage += 1
        self.stageStart = int(time.time())
        self.canInteract = False
        self.rollWhatPlantNeeds()

        self.sendPlotStateToClients()

        if skill:
            self.sendUpdate("plantSkilled", [])
        elif firstTending:
            self.sendUpdate("plantFirstDusted", [])
        else:
            self.sendUpdate("plantDusted", [])

        self.scheduleStage()
        self.saveToDatabase()

    def requestRevive(self):
        avatarId = self.air.getAvatarIdFromSender()
        avatar = self.getAvatarIfOwner(avatarId)

        if avatar is None or not self.wilted:
            return

        if not avatar.spendPixieDust(GardenData.REVIVE_COST):
            return

        self.wilted = False
        # revived plants get their attention straight away
        self.stageStart = int(time.time()) - self.stageDuration()
        self.canInteract = True

        self.sendPlotStateToClients()
        self.sendUpdate("plantRevived", [])
        self.scheduleStage()
        self.saveToDatabase()

    def requestHelp(self):
        avatarId = self.air.getAvatarIdFromSender()
        avatar = self.air.doId2do.get(avatarId)

        if avatar is None or avatarId == self.ownerId or not self.canBeHelped():
            return

        if avatarId in self.helpers:
            return

        if not avatar.spendPixieDust(GardenData.HELP_COST):
            return

        self.helpers.add(avatarId)

        # garden melodies, helping a friend's plant counts as singing
        self.air.badgeManager.d_accumulate(avatarId, badge_events.EVENT_SANG_TO_FRIENDS_PLANT)

        self.sendUpdate("setHelperCount", [self.getHelperCount()])
        self.sendUpdate("setCanHelp", [self.getCanHelp()])
        self.saveToDatabase()

    def requestInstaGrow(self):
        avatarId = self.air.getAvatarIdFromSender()
        avatar = self.getAvatarIfOwner(avatarId)

        if avatar is None or not self.isPlanted() or self.isRipe():
            return

        seed = self.getSeed()

        if seed is None or not avatar.takeGold(seed.instaGrowCost):
            return

        self.cancelAllNamedTasks()

        self.stage = self.stages
        self.stageStart = int(time.time())
        self.wilted = False
        self.canInteract = False
        self.rollWhatPlantNeeds()

        self.sendPlotStateToClients()
        self.sendUpdate("plantInstaGrown", [])
        self.saveToDatabase()

    def requestInteractTimeLeft(self):
        # asked on generate and whenever the client wants the time left
        self.sendUpdateToAvatarId(
            self.air.getAvatarIdFromSender(),
            "plantInteractTimeLeftUpdate", [self.interactTimeLeft()])

    # ---------------------------------------------------------------- harvest

    def requestHarvest(self):
        avatarId = self.air.getAvatarIdFromSender()
        avatar = self.getAvatarIfOwner(avatarId)

        if avatar is None or not self.isRipe() or self.wilted:
            return

        plant = self.getPlant()

        if plant is None:
            return

        gender = getattr(getattr(avatar, "fairyDNA", None), "gender", GardenData.ANY_GENDER)
        # full help meter is the bonus
        bonus = len(self.helpers) >= GardenData.MAX_HELPERS
        granted = []

        for reward in GardenData.rewardsFor(plant, gender):
            amount = reward.amount * (2 if bonus else 1)

            if self.giveHarvestReward(avatar, reward, amount):
                granted.append((reward.itemId, amount, reward.color1, reward.color2))

        # get growing, counted by how many days the seed takes
        seed = self.getSeed()
        growEvent = badge_events.SEED_DAYS_TO_EVENT.get(seed.days) if seed else None
        if growEvent is not None:
            self.air.badgeManager.d_accumulate(avatarId, growEvent)

        self.cancelAllNamedTasks()
        self.resetPlot()
        self.sendPlotStateToClients()

        self.sendUpdate("plantHarvested", [granted])

        self.air.experienceManager.grantScaledExp(avatarId, len(granted) or 1, "garden")
        self.saveToDatabase()

    # puts one harvested reward where that kind of item lives
    def giveHarvestReward(self, avatar, reward, amount):
        try:
            typeId = get_type_id(reward.itemId)
        except ValueError:
            self.notify.warning(f"plant {self.plantId} pays out unusable item {reward.itemId}")
            return False

        if typeId in POUCH_TYPE_IDS:
            if not self.air.inventoryManager.addIngredientsToPouch(
                    avatar.doId, reward.itemId, amount, -1):
                return False

            avatar.d_setPouch(self.air.inventoryManager.getPouch(avatar.doId))
            return True

        if typeId in WARDROBE_TYPE_IDS or typeId in STORAGE_TYPE_IDS:
            where = WARDROBE if typeId in WARDROBE_TYPE_IDS else STORAGE

            # clothes and furniture are one row each, doubled is two items
            for _ in range(max(1, amount)):
                if not grant_item(self.air, avatar.doId, reward.itemId,
                                  reward.color1, reward.color2, where):
                    return False

            return True

        self.notify.warning(
            f"plant {self.plantId} pays out item {reward.itemId} of type {typeId}, "
            f"which is not a pouch, wardrobe or storage item")
        return False
