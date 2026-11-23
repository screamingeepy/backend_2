# the bits of the client's animalFriendAssets.xml the server has to agree with

import xml.etree.ElementTree as ET
from dataclasses import dataclass

from paths import XML

ANIMAL_FRIEND_XML = XML / "animalFriendAssets.xml"


@dataclass(frozen=True)
class GrowthLevel:
    # growth points needed to climb into this level from the one below
    pointsToLevel: int
    # hunger points one item of the favorite food is worth
    hungerPtsPerFood: int
    # health ladder rung a pet drops to when it first gets ill
    initSickLevel: int
    # days of good health before sickness can roll again
    sickFreeDays: int
    # percent chance per day of getting ill once past sickFreeDays
    sickChance: int
    # growth points for healing the pet
    healGrowth: int
    # days at zero happiness before the pet leaves for beck's nursery
    sadFreeDays: int
    # happiness lost per day
    happyDegrade: int
    label: str


@dataclass(frozen=True)
class Species:
    itemId: int
    favFood: int
    snackFood: int
    typeLabel: str
    # butterflies: the client hides their heal and play buttons so their meters must not decay
    healthHappinessExempt: bool


@dataclass(frozen=True)
class MeterConfig:
    hungerPerDay: int
    growthPerFoodItem: int
    hungerInitMeter: int
    healthInitMeter: int
    happinessInitMeter: int
    minHealthForHappyGrow: int
    minHungerForHappyGrow: int
    growthPerHappinessPoint: int


growthLevelCache: list[GrowthLevel] | None = None
healthLadderCache: list[int] | None = None
speciesCache: dict[int, Species] | None = None
meterConfigCache: MeterConfig | None = None


def parseIntAttribute(element, name: str, default: int = 0) -> int:
    raw = element.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(float(raw))
    except ValueError:
        return default


def parsePetXml(path):
    root = ET.parse(path).getroot()

    growthNode = root.find("growth")
    if growthNode is None:
        raise ValueError(f"{path} has no <growth> section")

    growth = [
        GrowthLevel(
            pointsToLevel=parseIntAttribute(level, "pointsToLevel"),
            hungerPtsPerFood=parseIntAttribute(level, "hungerPtsPerFood", 10),
            initSickLevel=parseIntAttribute(level, "initSickLevel", 8),
            sickFreeDays=parseIntAttribute(level, "sickFreeDays", 2),
            sickChance=parseIntAttribute(level, "sickChance"),
            healGrowth=parseIntAttribute(level, "healGrowth"),
            sadFreeDays=parseIntAttribute(level, "sadFreeDays", 2),
            happyDegrade=parseIntAttribute(level, "happyDegrade"),
            label=level.get("label", ""),
        )
        for level in growthNode.findall("level")
    ]

    if not growth:
        raise ValueError(f"{path} has no <growth><level> rows")

    healthNode = root.find("health")
    if healthNode is None:
        raise ValueError(f"{path} has no <health> section")

    healthLadder = [parseIntAttribute(level, "meter") for level in healthNode.findall("level")]

    hungerNode = root.find("hunger")
    happinessNode = root.find("happiness")
    if hungerNode is None or happinessNode is None:
        raise ValueError(f"{path} is missing <hunger> or <happiness>")

    meters = MeterConfig(
        hungerPerDay=parseIntAttribute(hungerNode, "hungerPerDay", 14),
        growthPerFoodItem=parseIntAttribute(hungerNode, "growthPerFoodItem", 5),
        hungerInitMeter=parseIntAttribute(hungerNode, "initMeter", 75),
        healthInitMeter=parseIntAttribute(healthNode, "initMeter", 75),
        happinessInitMeter=parseIntAttribute(happinessNode, "initMeter", 75),
        minHealthForHappyGrow=parseIntAttribute(happinessNode, "minHealthForHappyGrow", 50),
        minHungerForHappyGrow=parseIntAttribute(happinessNode, "minHungerForHappyGrow", 50),
        growthPerHappinessPoint=parseIntAttribute(happinessNode, "growthPerHappinessPoint", 2),
    )

    speciesNode = root.find("animalFriends")
    if speciesNode is None:
        raise ValueError(f"{path} has no <animalFriends> section")

    species = {}
    for element in speciesNode.findall("species"):
        itemId = parseIntAttribute(element, "id")
        if not itemId:
            continue

        species[itemId] = Species(
            itemId=itemId,
            favFood=parseIntAttribute(element, "favFood"),
            snackFood=parseIntAttribute(element, "snackFood"),
            typeLabel=element.get("typelabel", ""),
            healthHappinessExempt=element.get("healthHappinessExempt", "false") == "true",
        )

    return growth, healthLadder, species, meters


def loadPetXml() -> None:
    global growthLevelCache, healthLadderCache, speciesCache, meterConfigCache

    if growthLevelCache is None:
        growthLevelCache, healthLadderCache, speciesCache, meterConfigCache = parsePetXml(ANIMAL_FRIEND_XML)


def growthLevels() -> list[GrowthLevel]:
    loadPetXml()
    return growthLevelCache


def healthLadder() -> list[int]:
    loadPetXml()
    return healthLadderCache


def meterConfig() -> MeterConfig:
    loadPetXml()
    return meterConfigCache


def getSpecies(itemId: int) -> Species | None:
    loadPetXml()
    return speciesCache.get(itemId)


def isPetItem(itemId: int) -> bool:
    loadPetXml()
    return itemId in speciesCache


# growth points -> zero based growth level like PetMgr.getGrowthLevelData
def growthLevelIndexForGrowth(growth: int) -> int:
    levels = growthLevels()

    total = 0
    for index in range(len(levels) - 1):
        total += levels[index].pointsToLevel
        if growth < total + levels[index + 1].pointsToLevel:
            return index

    return len(levels) - 1


def growthLevelForGrowth(growth: int) -> GrowthLevel:
    return growthLevels()[growthLevelIndexForGrowth(growth)]


# gifts, outfits and conversion

PRICE_DATA_XML = XML / "priceData.xml"


@dataclass(frozen=True)
class Gift:
    itemId: int
    count: int
    chance: int
    # 0 when any species can give it
    species: int
    tags: tuple[str, ...]


@dataclass(frozen=True)
class GiftSet:
    minLevel: int
    maxLevel: int
    gifts: tuple[Gift, ...]


@dataclass(frozen=True)
class GiftConfig:
    minHealth: int
    minHunger: int
    minHappiness: int
    maxGiftsPerDay: int
    # (seconds with the pet, percent chance), in order
    giftTimes: tuple[tuple[int, int], ...]
    giftSets: tuple[GiftSet, ...]


giftConfigCache: GiftConfig | None = None
outfitSpeciesCache: dict[int, int] | None = None
conversionPriceCache: dict[int, int] | None = None


def loadGiftOutfitAndPriceData() -> None:
    global giftConfigCache, outfitSpeciesCache, conversionPriceCache

    if giftConfigCache is not None:
        return

    root = ET.parse(ANIMAL_FRIEND_XML).getroot()

    giftNode = root.find("giftConfig")
    giftSets = []
    giftTimes = []
    if giftNode is not None:
        for timeNode in giftNode.findall("giftTime"):
            giftTimes.append((parseIntAttribute(timeNode, "seconds"), parseIntAttribute(timeNode, "chance")))

        for setNode in giftNode.findall("giftSet"):
            gifts = []
            for giftElement in setNode.findall("gift"):
                itemId = parseIntAttribute(giftElement, "id")
                if not itemId:
                    continue
                tags = tuple(tag.strip() for tag in giftElement.get("tag", "").split(",") if tag.strip())
                gifts.append(Gift(
                    itemId=itemId,
                    count=parseIntAttribute(giftElement, "count", 1),
                    chance=parseIntAttribute(giftElement, "chance"),
                    species=parseIntAttribute(giftElement, "species"),
                    tags=tags,
                ))
            giftSets.append(GiftSet(
                minLevel=parseIntAttribute(setNode, "minLevel", 1),
                maxLevel=parseIntAttribute(setNode, "maxLevel", 10),
                gifts=tuple(gifts),
            ))

    giftConfigCache = GiftConfig(
        minHealth=parseIntAttribute(giftNode, "minHealthForGift", 90) if giftNode is not None else 90,
        minHunger=parseIntAttribute(giftNode, "minHungerForGift", 90) if giftNode is not None else 90,
        minHappiness=parseIntAttribute(giftNode, "minHappinessForGift", 90) if giftNode is not None else 90,
        maxGiftsPerDay=parseIntAttribute(giftNode, "maxGiftsPerDay", 2) if giftNode is not None else 2,
        giftTimes=tuple(giftTimes),
        giftSets=tuple(giftSets),
    )

    outfitSpecies = {}
    clothingNode = root.find("clothing")
    if clothingNode is not None:
        for outfit in clothingNode.findall("outfit"):
            outfitSpecies[parseIntAttribute(outfit, "id")] = parseIntAttribute(outfit, "forAnimalFriend")
    outfitSpeciesCache = outfitSpecies

    prices = {}
    priceRoot = ET.parse(PRICE_DATA_XML).getroot()
    for item in priceRoot.findall("./conversionPrices/items/item"):
        prices[parseIntAttribute(item, "id")] = parseIntAttribute(item, "price")
    conversionPriceCache = prices


def giftConfig() -> GiftConfig:
    loadGiftOutfitAndPriceData()
    return giftConfigCache


# the gift set for a pet's growth, picked like PetWardrobe.setGiftSetData does
def giftSetForGrowth(growth: int) -> GiftSet | None:
    sets = giftConfig().giftSets
    if not sets:
        return None

    level = growthLevelIndexForGrowth(growth) + 1
    for giftSet in sets:
        if giftSet.minLevel <= level <= giftSet.maxLevel:
            return giftSet

    return sets[0]


# the species an outfit fits, or 0 if it isn't a pet outfit
def outfitSpecies(outfitId: int) -> int:
    loadGiftOutfitAndPriceData()
    return outfitSpeciesCache.get(outfitId, 0)


# diamonds to make an animal friend golden, or -1 if it can't be converted
def conversionPrice(itemId: int) -> int:
    loadGiftOutfitAndPriceData()
    return conversionPriceCache.get(itemId, -1)
