import math
import random
from datetime import datetime, timezone

from game.fairies.badges import badge_events
from game.fairies.daily.TimeUtils import get_period_start
from game.fairies.pet import pet_xml

# PetMgr.ANIMAL_FRIEND_* in the client
ANIMAL_FRIEND_REMOVED = 0
ANIMAL_FRIEND_RELEASED = 1
ANIMAL_FRIEND_RESTING = 2
ANIMAL_FRIEND_ACTIVE = 3

# sent when a fairy has no animal friend, the client hides the tab on itemId 0
EMPTY_PET_DNA = [0, 0, 0, 0]
EMPTY_PET_DETAIL = [0, 0, 0, 0, 0, 0, 0, 0, 0]

METER_MAX = 100

# health decays and pets fall ill
SICKNESS_ENABLED = True

# happiness decays, playing a microgame is the only way to raise it
HAPPINESS_DECAY_ENABLED = True

# happiness per microgame round that scored, the xml has no score table so it's flat
HAPPINESS_PER_PLAY = 15

# a pet left miserable for sadFreeDays leaves for beck's nursery
ABANDONMENT_ENABLED = False

# the client adds this to the feed amount when the food is free (home food bowl)
FREE_FEED_MODIFIER = 1000000


def getFairiesCollection(air):
    return air.mongoInterface.mongodb.fairies


def clampMeter(value: int) -> int:
    return max(0, min(METER_MAX, int(value)))


# butterflies have no heal quests or minigame, only feeding applies
def isExemptFromHealthAndHappiness(pet: dict | None) -> bool:
    if not pet or not pet.get("itemId"):
        return False

    species = pet_xml.getSpecies(pet["itemId"])
    return species is not None and species.healthHappinessExempt


# butterflies are always full health and happiness
def keepButterflyMetersFull(pet: dict) -> bool:
    if not isExemptFromHealthAndHappiness(pet):
        return False

    changed = pet.get("health") != METER_MAX or pet.get("happiness") != METER_MAX         or pet.get("sadDays", 0) or pet.get("healthyDays", 0)

    pet["health"] = METER_MAX
    pet["happiness"] = METER_MAX
    pet["sadDays"] = 0
    pet["healthyDays"] = 0
    return bool(changed)


# the raw pet sub document, or None if there is no animal friend
def loadPet(air, avId: int) -> dict | None:
    doc = getFairiesCollection(air).find_one({"_id": avId}, {"pet": 1})
    if not doc:
        return None

    pet = doc.get("pet")
    if not pet or not pet.get("itemId"):
        return None

    keepButterflyMetersFull(pet)
    return pet


def hasPet(pet: dict | None) -> bool:
    return bool(pet) and bool(pet.get("itemId")) and \
        pet.get("status", ANIMAL_FRIEND_ACTIVE) not in (ANIMAL_FRIEND_REMOVED, ANIMAL_FRIEND_RELEASED)


def isFullGrown(pet: dict | None) -> bool:
    if not pet or not pet.get("itemId"):
        return False

    return pet_xml.growthLevelIndexForGrowth(int(pet.get("growth", 0))) == len(pet_xml.growthLevels()) - 1


def savePet(air, avId: int, pet: dict) -> None:
    collection = getFairiesCollection(air)

    badgeManager = getattr(air, "badgeManager", None)
    crossed = False

    if badgeManager is not None and isFullGrown(pet):
        old = (collection.find_one({"_id": avId}, {"pet": 1}) or {}).get("pet")
        crossed = not isFullGrown(old)

    collection.update_one({"_id": avId}, {"$set": {"pet": pet}})

    if crossed:
        badgeManager.d_accumulate(avId, badge_events.EVENT_PET_FULL_GROWN)


# a new animal friend with meters at the xml start values
def createNewPet(itemId: int, color1: int, color2: int, name1: int, name2: int) -> dict:
    meters = pet_xml.meterConfig()
    now = datetime.now(timezone.utc)

    pet = {
        "itemId": itemId,
        "color1": color1,
        "color2": color2,
        "outfitId": 0,
        "name1": name1,
        "name2": name2,
        "hunger": meters.hungerInitMeter,
        "happiness": meters.happinessInitMeter,
        "health": meters.healthInitMeter,
        "growth": 0,
        "status": ANIMAL_FRIEND_ACTIVE,
        "golden": 0,
        "healthyDays": 0,
        "sadDays": 0,
        "lastTick": now,
        "acquired": now,
    }

    keepButterflyMetersFull(pet)
    return pet


# derived values

# items of the favorite food needed to fill the hunger meter
def foodToFill(pet: dict) -> int:
    level = pet_xml.growthLevelForGrowth(pet.get("growth", 0))
    missing = METER_MAX - clampMeter(pet.get("hunger", 0))

    if missing <= 0 or level.hungerPtsPerFood <= 0:
        return 0

    return int(math.ceil(missing / level.hungerPtsPerFood))


def getDisplayedHappiness(pet: dict) -> int:
    happiness = clampMeter(pet.get("happiness", 0))
    sadDays = pet.get("sadDays", 0)

    if happiness > 0 or not sadDays:
        return happiness

    level = pet_xml.growthLevelForGrowth(pet.get("growth", 0))
    return -max(1, level.sadFreeDays - sadDays)


def petDNATuple(pet: dict | None) -> list:
    if not hasPet(pet):
        return list(EMPTY_PET_DNA)

    return [
        int(pet.get("itemId", 0)),
        int(pet.get("color1", 0)),
        int(pet.get("color2", 0)),
        int(pet.get("outfitId", 0)),
    ]


def petDetailTuple(pet: dict | None) -> list:
    if not hasPet(pet):
        return list(EMPTY_PET_DETAIL)

    return [
        int(pet.get("name1", 0)),
        int(pet.get("name2", 0)),
        clampMeter(pet.get("hunger", 0)),
        getDisplayedHappiness(pet),
        clampMeter(pet.get("health", 0)),
        int(pet.get("status", ANIMAL_FRIEND_ACTIVE)),
        foodToFill(pet),
        int(pet.get("growth", 0)),
        int(pet.get("golden", 0)),
    ]


# how sick the pet is for quests.xml petSickLevel, 0 healthy then 1 mildest to 5 worst
def getSickLevel(pet: dict | None) -> int:
    if not hasPet(pet):
        return 0

    health = clampMeter(pet.get("health", 0))
    if health >= METER_MAX:
        return 0

    return 5 - min(4, health // 20)


# what the owner is sent after releasing their pet at elixa's
def releasedDetailTuple(pet: dict) -> list:
    detail = list(EMPTY_PET_DETAIL)
    detail[5] = ANIMAL_FRIEND_RELEASED
    detail[0] = int(pet.get("name1", 0))
    detail[1] = int(pet.get("name2", 0))
    return detail


# whether the pet is drawn following its owner
def isPetFollowingOwner(pet: dict | None) -> bool:
    return hasPet(pet) and pet.get("status", ANIMAL_FRIEND_ACTIVE) == ANIMAL_FRIEND_ACTIVE


# changes

# feed units items of favorite food, changes the pet in place
def feedPet(pet: dict, units: int) -> None:
    if units <= 0:
        return

    meters = pet_xml.meterConfig()
    level = pet_xml.growthLevelForGrowth(pet.get("growth", 0))

    pet["hunger"] = clampMeter(pet.get("hunger", 0) + units * level.hungerPtsPerFood)
    pet["growth"] = int(pet.get("growth", 0)) + units * meters.growthPerFoodItem


# cures the pet and adds the growth the xml gives for healing
def healPet(pet: dict) -> None:
    level = pet_xml.growthLevelForGrowth(pet.get("growth", 0))

    pet["health"] = METER_MAX
    pet["healthyDays"] = 0
    pet["growth"] = int(pet.get("growth", 0)) + level.healGrowth


# raises happiness and the growth that rides on it, like playing with the pet
def addHappiness(pet: dict, points: int) -> bool:
    if points <= 0:
        return False

    meters = pet_xml.meterConfig()

    if pet.get("health", 0) < meters.minHealthForHappyGrow:
        return False
    if pet.get("hunger", 0) < meters.minHungerForHappyGrow:
        return False

    before = clampMeter(pet.get("happiness", 0))
    pet["happiness"] = clampMeter(before + points)
    # growth rides on the points earned, so a full meter keeps growing
    pet["growth"] = int(pet.get("growth", 0)) + points * meters.growthPerHappinessPoint
    pet["sadDays"] = 0
    return True


# decay

def daysSinceLastTick(lastTick) -> int:
    if lastTick is None:
        return 0

    # mongo gives datetimes back without a timezone, they were written as utc
    if lastTick.tzinfo is None:
        lastTick = lastTick.replace(tzinfo=timezone.utc)

    then = get_period_start(lastTick, "daily")
    now = get_period_start(datetime.now(timezone.utc), "daily")

    return max(0, (now - then).days)


def dropHealthOneRung(pet: dict) -> None:
    ladder = pet_xml.healthLadder()
    if not ladder:
        return

    health = clampMeter(pet.get("health", 0))

    if health >= METER_MAX:
        # first illness goes straight to the level's starting sick rung
        level = pet_xml.growthLevelForGrowth(pet.get("growth", 0))
        index = max(0, min(len(ladder) - 1, level.initSickLevel))
        pet["health"] = ladder[index]
        return

    # otherwise go down to the highest rung below the current one
    below = [rung for rung in ladder if rung < health]
    pet["health"] = max(below) if below else 0


# brings a pet's meters up to date for the days since the last tick and saves it
def applyDecay(air, avId: int, pet: dict) -> bool:
    if not hasPet(pet):
        return False

    species = pet_xml.getSpecies(pet.get("itemId", 0))

    days = daysSinceLastTick(pet.get("lastTick"))
    if days <= 0:
        return False

    meters = pet_xml.meterConfig()

    # butterflies have no heal or play buttons so only hunger moves
    if species is not None and species.healthHappinessExempt:
        pet["hunger"] = clampMeter(pet.get("hunger", 0) - meters.hungerPerDay * days)
        keepButterflyMetersFull(pet)
        pet["lastTick"] = datetime.now(timezone.utc)
        savePet(air, avId, pet)
        return True

    for _ in range(days):
        level = pet_xml.growthLevelForGrowth(pet.get("growth", 0))

        pet["hunger"] = clampMeter(pet.get("hunger", 0) - meters.hungerPerDay)

        if SICKNESS_ENABLED:
            healthyDays = pet.get("healthyDays", 0) + 1
            if healthyDays > level.sickFreeDays and random.randrange(100) < level.sickChance:
                dropHealthOneRung(pet)
                healthyDays = 0
            pet["healthyDays"] = healthyDays

        happiness = clampMeter(pet.get("happiness", 0))
        if HAPPINESS_DECAY_ENABLED:
            happiness = clampMeter(happiness - level.happyDegrade)
        pet["happiness"] = happiness

        if happiness <= 0 and ABANDONMENT_ENABLED:
            sadDays = pet.get("sadDays", 0) + 1
            pet["sadDays"] = sadDays
            if sadDays >= level.sadFreeDays:
                pet["status"] = ANIMAL_FRIEND_REMOVED
                break
        elif happiness > 0:
            pet["sadDays"] = 0

    pet["lastTick"] = datetime.now(timezone.utc)
    savePet(air, avId, pet)
    return True


# loadPet plus applyDecay, what every read wants
def loadPetAndApplyDecay(air, avId: int) -> dict | None:
    pet = loadPet(air, avId)
    if pet is None:
        return None

    applyDecay(air, avId, pet)
    return pet


# gifts and outfits

# bits of the mask AnimalFriendManager.dispatchGiftRequest sends
GIFT_MASK_WARDROBE_FULL = 1 << 2
GIFT_MASK_STORAGE_FULL = 1 << 3
GIFT_MASK_OUTFITS_FULL = 1 << 4

# the client asks every giftTime[0] seconds, faster than this isn't the client
GIFT_REQUEST_MIN_SECONDS = 240

# a tag ending in this is the everyday version of a holiday gift
REGULAR_TAG_SUFFIX = "_Reg"


def getOwnedOutfits(air, avId: int) -> list[int]:
    doc = getFairiesCollection(air).find_one({"_id": avId}, {"petOutfits": 1})
    return list(doc.get("petOutfits") or []) if doc else []


def addOwnedOutfit(air, avId: int, outfitId: int) -> None:
    getFairiesCollection(air).update_one({"_id": avId}, {"$addToSet": {"petOutfits": outfitId}})


# 0 takes the outfit off, anything else has to be owned and fit this species
def canWearOutfit(pet: dict, outfitId: int, owned: list[int]) -> bool:
    if outfitId == 0:
        return True

    return outfitId in owned and pet_xml.outfitSpecies(outfitId) == int(pet.get("itemId", 0))


def isGiftAllowed(gift, pet: dict, mask: int, owned: list[int], activeTags: set[str], typeOf) -> bool:
    if gift.chance <= 0:
        return False

    if gift.species and gift.species != int(pet.get("itemId", 0)):
        return False

    if gift.tags and not any(tag in activeTags or tag.endswith(REGULAR_TAG_SUFFIX) for tag in gift.tags):
        return False

    kind = typeOf(gift.itemId)
    if kind is None:
        return False
    if kind == "outfit" and (gift.itemId in owned or mask & GIFT_MASK_OUTFITS_FULL):
        return False
    if kind == "wardrobe" and mask & GIFT_MASK_WARDROBE_FULL:
        return False
    if kind == "storage" and mask & GIFT_MASK_STORAGE_FULL:
        return False

    return True


# one of the client's gift requests, changes the pet's gift counters in place
def rollGift(pet: dict, mask: int, owned: list[int], activeTags: set[str], typeOf, force: bool = False):
    config = pet_xml.giftConfig()

    if not hasPet(pet):
        return None
    if force:
        return pickGift(pet, mask, owned, activeTags, typeOf)
    if pet.get("status") != ANIMAL_FRIEND_ACTIVE:
        return None
    if pet.get("health", 0) < config.minHealth or pet.get("hunger", 0) < config.minHunger:
        return None
    if pet.get("happiness", 0) < config.minHappiness:
        return None

    today = get_period_start(datetime.now(timezone.utc), "daily").date().isoformat()
    if pet.get("giftDay") != today:
        pet["giftDay"] = today
        pet["giftsToday"] = 0
    if pet.get("giftsToday", 0) >= config.maxGiftsPerDay:
        return None

    steps = int(pet.get("giftSteps", 0)) + 1
    pet["giftSteps"] = steps
    times = config.giftTimes
    chance = times[min(steps, len(times)) - 1][1] if times else 100
    if random.randrange(100) >= chance:
        return None

    gift = pickGift(pet, mask, owned, activeTags, typeOf)
    if gift is None:
        return None

    pet["giftSteps"] = 0
    pet["giftsToday"] = pet.get("giftsToday", 0) + 1
    return gift


def pickGift(pet: dict, mask: int, owned: list[int], activeTags: set[str], typeOf):
    giftSet = pet_xml.giftSetForGrowth(pet.get("growth", 0))
    if giftSet is None:
        return None

    choices = [gift for gift in giftSet.gifts if isGiftAllowed(gift, pet, mask, owned, activeTags, typeOf)]
    if not choices:
        return None

    return random.choices(choices, weights=[gift.chance for gift in choices])[0]
