# what a seed grows into, how long it takes and how many plots a garden has

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass

from direct.directnotify import DirectNotifyGlobal

from paths import MEADOWS, XML

notify = DirectNotifyGlobal.directNotify.newCategory("GardenData")

GARDEN_ASSETS_XML = XML / "gardenAssets.xml"
CACHEABLE_MEDIA_XML = XML / "cacheableMedia.xml"

SECONDS_PER_DAY = 86400

# scales every grow time, 1.0 is the days on the seed packet
GROWTH_RATE = 1.0

# plant art a media row links to, e.g. stageCount6
STAGE_COUNT_SYMBOL = "stageCount"

# scene locations a plot can sit on, e.g. gardenPlot1
PLOT_LOCATION = "gardenPlot"

# fairiesConstants.as genders
GENDER_FEMALE = 1
GENDER_MALE = 2
ANY_GENDER = 0

# MMOConstants garden costs in pixie dust
REVIVE_COST = 20
HELP_COST = 10

# pixie dust one tending costs, MeadowPlant checks it for both requestDust and requestSkill
TEND_COST = 10

# MeadowPlant reads -1 as nothing wanted
NOTHING_NEEDED = -1

# fairies who can sing to one plant, filling it is the harvest bonus
MAX_HELPERS = 4

# how long a plant that wants attention waits before it wilts
WILT_DELAY = 2 * SECONDS_PER_DAY

# seed in the ground before it's dusted into sprouting, planting is not a tending
FIRST_STAGE = 0

# the client reads a stored 0 as 1
DEFAULT_GARDEN_TYPE = 1


@dataclass(frozen=True)
class PlantReward:
    itemId: int
    amount: int
    color1: int
    color2: int
    # GENDER_FEMALE, GENDER_MALE or ANY_GENDER
    gender: int


@dataclass(frozen=True)
class Plant:
    plantId: int
    # stages its art draws, ripe at stage == stages
    stages: int
    rewards: tuple[PlantReward, ...]


@dataclass(frozen=True)
class Seed:
    seedId: int
    days: int
    instaGrowCost: int
    plants: tuple[Plant, ...]

    # seconds a plant waits between one tending and the next
    def stageDuration(self, plant: Plant) -> int:
        waits = max(1, plant.stages - 1)
        return max(1, int(self.days * SECONDS_PER_DAY * GROWTH_RATE) // waits)

    def plant(self, plantId: int) -> Plant | None:
        return next((plant for plant in self.plants if plant.plantId == plantId), None)


seedCache: dict[int, Seed] | None = None
plotsByGardenTypeCache: dict[int, tuple[int, ...]] = {}


def parseIntOrDefault(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def loadPlantStageCounts() -> dict[int, int]:
    # plantId -> stages, from the stageCount symbol each plant's art links to.
    counts: dict[int, int] = {}

    root = ET.parse(CACHEABLE_MEDIA_XML).getroot()

    for asset in root.iter("asset"):
        assetId = asset.get("id") or ""
        symbol = (asset.text or "").strip()

        if not assetId.endswith("_item") or not symbol.startswith(STAGE_COUNT_SYMBOL):
            continue

        itemId = assetId[:-len("_item")]
        stages = symbol[len(STAGE_COUNT_SYMBOL):]

        if itemId.isdigit() and stages.isdigit():
            counts[int(itemId)] = int(stages)

    return counts


def parseRewards(plantNode) -> tuple[PlantReward, ...]:
    rewards = []

    for node in plantNode.iterfind("reward"):
        itemId = parseIntOrDefault(node.get("itemId"))

        if itemId <= 0:
            continue

        gender = parseIntOrDefault(node.get("g"))

        rewards.append(PlantReward(
            itemId=itemId,
            amount=max(1, parseIntOrDefault(node.get("amount"), 1)),
            color1=parseIntOrDefault(node.get("color1")),
            color2=parseIntOrDefault(node.get("color2")),
            gender=gender if gender in (GENDER_FEMALE, GENDER_MALE) else ANY_GENDER,
        ))

    return tuple(rewards)


def loadSeedsFromXml() -> dict[int, Seed]:
    root = ET.parse(GARDEN_ASSETS_XML).getroot()
    stageCounts = loadPlantStageCounts()

    # grow times are in <copy> keyed by tag, e.g. <item89000 days="1" gardenType="seed">
    days: dict[int, int] = {}

    for node in root.find("copy") or ():
        if node.tag.startswith("item") and node.get("gardenType") == "seed":
            seedId = node.tag[len("item"):]

            if seedId.isdigit():
                days[int(seedId)] = max(1, parseIntOrDefault(node.get("days"), 1))

    seeds: dict[int, Seed] = {}

    for node in (root.find("config") or ()).iter("item"):
        seedId = parseIntOrDefault(node.get("id"))

        if seedId <= 0:
            continue

        plants = []

        for plantNode in node.iterfind("plant"):
            plantId = parseIntOrDefault(plantNode.get("id"))
            stages = stageCounts.get(plantId, 0)

            if plantId <= 0 or stages <= FIRST_STAGE:
                notify.warning(f"seed {seedId}: no usable stage count for plant {plantId}")
                continue

            plants.append(Plant(
                plantId=plantId,
                stages=stages,
                rewards=parseRewards(plantNode),
            ))

        if not plants:
            notify.warning(f"seed {seedId} has nothing to sprout into; ignoring it")
            continue

        seeds[seedId] = Seed(
            seedId=seedId,
            days=days.get(seedId, 1),
            # no instaGrowCost still has to cost something
            instaGrowCost=max(1, parseIntOrDefault(node.get("instaGrowCost"), 1)),
            plants=tuple(plants),
        )

    return seeds


# seconds a sprouted plant can wait before it wilts
def wiltDelay() -> int:
    return max(1, int(WILT_DELAY * GROWTH_RATE))


def seeds() -> dict[int, Seed]:
    global seedCache

    if seedCache is None:
        try:
            seedCache = loadSeedsFromXml()
        except (OSError, ET.ParseError) as e:
            notify.warning(f"could not read the garden data: {e}")
            seedCache = {}

        notify.info(f"garden data: {len(seedCache)} seeds")

    return seedCache


def getSeed(seedId: int) -> Seed | None:
    return seeds().get(seedId)


def isSeed(itemId: int) -> bool:
    return itemId in seeds()


# the rewards a fairy of this gender gets from harvesting plant
def rewardsFor(plant: Plant, gender: int) -> tuple[PlantReward, ...]:
    return tuple(
        reward for reward in plant.rewards
        if reward.gender in (ANY_GENDER, gender)
    )


# plots the given garden scene has room for, lowest first
def plotNumbers(gardenType: int) -> tuple[int, ...]:
    if gardenType in plotsByGardenTypeCache:
        return plotsByGardenTypeCache[gardenType]

    path = MEADOWS / f"garden{gardenType}" / "config.xml"
    numbers: list[int] = []

    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError) as e:
        notify.warning(f"no garden scene config at {path}: {e}")
        root = None

    for location in (root.iter("location") if root is not None else ()):
        name = (location.text or "").strip()

        if name.startswith(PLOT_LOCATION):
            plotNum = name[len(PLOT_LOCATION):]

            if plotNum.isdigit():
                numbers.append(int(plotNum))

    plotsByGardenTypeCache[gardenType] = tuple(sorted(set(numbers)))

    return plotsByGardenTypeCache[gardenType]
