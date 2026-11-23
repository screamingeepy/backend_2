# This is directly from xpConfig.xml
# The zxml states that both the xml and this file should stay in sync at all times
# Some of the methods derive from the original AS logic of the Experience Manager

# BalanceRates
BALANCE_RATES = {
    ("talentGame", ""): 10,
    ("partyGame", ""): 5,
    ("partyGame", "PartyDays"): 5,
    ("meadowGame", ""): 2,
    ("wilderness", ""): 2,
    ("tailoring", ""): 2,
    ("tinkering", ""): 2,
    ("baking", ""): 2,
    ("hotspot", ""): 1,
    ("quest", ""): 5,
}

 # Returns the appropriate multiplier
def getBalanceRate(source_type: str, tag: str = "") -> int:
    if (source_type, tag) in BALANCE_RATES:
        return BALANCE_RATES[(source_type, tag)]
    return BALANCE_RATES.get((source_type, ""), 1)


# Quest Exp is bonus exp given if the quest giver is the same talent as your fairy
QUEST_TALENT_BONUS = 0

QUEST_XP = {
    "0": 1, "1": 2, "1pouch": 2, "1cookies": 5, "1storage": 5,
    "1wardrobe": 5, "2": 2, "3": 2, "4": 5, "5": 1,
    "6": 5, "7": 1, "8": 1, "9": 1,
}

# Crafting Exp
CRAFT_XP = {
    1: {"practice": 0.04, "makeMyOwn": 0.04},
    2: {"practice": 0.08, "makeMyOwn": 0.08},
    3: {"practice": 0.12, "makeMyOwn": 0.12},
    4: {"practice": 0.16, "makeMyOwn": 0.16},
    5: {"practice": 0.20, "makeMyOwn": 0.20},
    6: {"practice": 0.24, "makeMyOwn": 0.24},
    7: {"practice": 0.28, "makeMyOwn": 0.28},
    8: {"practice": 0.32, "makeMyOwn": 0.32},
    9: {"practice": 0.36, "makeMyOwn": 0.36},
}

def getCraftXpFraction(difficulty: int, practice: bool) -> float:
    # recipes run difficulty 1-8, the table goes to 9
    row = CRAFT_XP[max(1, min(int(difficulty or 1), max(CRAFT_XP)))]
    return row["practice" if practice else "makeMyOwn"]


# Multiplayer Exp
MULTIPLAYER_XP = {
    0: {"playerMult": 2, "placeFloor": 12},
    13070: {"playerMult": 5, "placeFloor": 4},
    13072: {"playerMult": 5, "placeFloor": 4},
    13073: {"playerMult": 5, "placeFloor": 4},
}


def getMultiplayer(game_id: int) -> dict:
    return MULTIPLAYER_XP.get(game_id, MULTIPLAYER_XP[0])

# Exp from minigames
def getMultiplayerXp(game_id: int, players_beaten: int) -> int:
    config = getMultiplayer(game_id)
    return max(config["placeFloor"], config["playerMult"] * max(players_beaten, 0))


# Wilderness Exp
WILDERNESS_XP_PER_MICROGAME = 1

# a trip costs resources, so a finished one never pays less than this
WILDERNESS_MIN_XP = 50

# Talent level conversion table from the XML, i believe this was to match the old level system with the new one(?)
LEVEL_CONVERSIONS = {0: 1, 1: 3, 2: 5, 3: 7, 4: 10, 5: 13}

# Dust caps/level caps
LEVEL0_DUST_CAP_MEMBER = 10
LEVEL0_DUST_CAP_BASIC = 10

LEVELUPS_BASIC_CAP = 28
LEVELUPS_MEMBER_CAP = 28

# A table with the total amount of xp you need to level up for each level and the gifts upon reaching it
LEVEL_UPS = [
    {"level": 1, "basicDust": 10, "memberDust": 10, "xp": 50, "skill": 0, "gifts": [{'id': 8499, 'count': 1}, {'id': 14020, 'count': 5}, {'id': 8007, 'count': 4}, {'id': 8005, 'count': 2}, {'id': 8006, 'count': 2}, {'id': 8004, 'count': 3}, {'id': 8008, 'count': 6}]},
    {"level": 2, "basicDust": 10, "memberDust": 10, "xp": 100, "skill": 0, "gifts": [{'id': 8499, 'count': 1}, {'id': 14142, 'count': 5}, {'id': 8007, 'count': 1}, {'id': 8005, 'count': 7}, {'id': 8006, 'count': 5}, {'id': 8008, 'count': 8}]},
    {"level": 3, "basicDust": 30, "memberDust": 30, "xp": 200, "skill": 1, "gifts": [{'id': 22501, 'count': 1}, {'id': 22502, 'count': 1}, {'id': 22503, 'count': 1}]},
    {"level": 4, "basicDust": 30, "memberDust": 30, "xp": 300, "skill": 0, "gifts": [{'id': 8499, 'count': 1}, {'id': 14022, 'count': 5}, {'id': 8009, 'count': 5}, {'id': 8003, 'count': 2}, {'id': 8001, 'count': 2}, {'id': 8008, 'count': 8}, {'id': 89000, 'count': 2}]},
    {"level": 5, "basicDust": 60, "memberDust": 60, "xp": 400, "skill": 1, "gifts": [{'id': 22502, 'count': 1}, {'id': 22503, 'count': 2}]},
    {"level": 6, "basicDust": 60, "memberDust": 60, "xp": 500, "skill": 0, "gifts": [{'id': 8499, 'count': 1}, {'id': 14045, 'count': 5}, {'id': 14082, 'count': 5}, {'id': 8005, 'count': 4}, {'id': 8009, 'count': 5}, {'id': 8001, 'count': 2}, {'id': 8008, 'count': 10}]},
    {"level": 7, "basicDust": 90, "memberDust": 90, "xp": 600, "skill": 1, "gifts": [{'id': 22506, 'count': 3}]},
    {"level": 8, "basicDust": 90, "memberDust": 90, "xp": 700, "skill": 0, "gifts": [{'id': 8499, 'count': 1}, {'id': 14030, 'count': 5}, {'id': 14187, 'count': 5}, {'id': 8009, 'count': 6}, {'id': 8001, 'count': 2}, {'id': 8004, 'count': 2}, {'id': 8008, 'count': 10}, {'id': 8013, 'count': 12}, {'id': 89001, 'count': 2},]},
    {"level": 9, "basicDust": 90, "memberDust": 90, "xp": 800, "skill": 0,
     "gifts": [{'id': 8499, 'count': 1}, {'id': 14042, 'count': 5}, {'id': 14051, 'count': 5}, {'id': 8007, 'count': 4}, {'id': 8003, 'count': 2}, {'id': 8006, 'count': 2}, {'id': 8001, 'count': 2},  {'id': 8004, 'count': 2},  {'id': 8008, 'count': 8},  {'id': 8013, 'count': 8}]},
    {"level": 10, "basicDust": 120, "memberDust": 120, "xp": 900, "skill": 1,
     "gifts": [{'id': 22532, 'count': 2}]},
    {"level": 11, "basicDust": 120, "memberDust": 120, "xp": 900, "skill": 0,
     "gifts": [{'id': 8499, 'count': 2}, {'id': 14027, 'count': 5}, {'id': 14111, 'count': 5}, {'id': 8007, 'count': 5}, {'id': 8005, 'count': 5}, {'id': 8009, 'count': 5}, {'id': 8004, 'count': 2}, {'id': 8008, 'count': 12}]},
    {"level": 12, "basicDust": 120, "memberDust": 120, "xp": 950, "skill": 0,
     "gifts": [{'id': 8499, 'count': 2}, {'id': 14021, 'count': 5}, {'id': 14019, 'count': 5}, {'id': 8007, 'count': 5}, {'id': 8005, 'count': 5}, {'id': 8009, 'count': 5}, {'id': 8004, 'count': 2}, {'id': 8008, 'count': 12},  {'id': 89002, 'count': 2}]},
    {"level": 13, "basicDust": 150, "memberDust": 150, "xp": 950, "skill": 1,
     "gifts": [{'id': 22533, 'count': 2}]},
    {"level": 14, "basicDust": 150, "memberDust": 150, "xp": 1000, "skill": 0,
     "gifts": [{'id': 8499, 'count': 3}, {'id': 14031, 'count': 5}, {'id': 14012, 'count': 5}, {'id': 8005, 'count': 4}, {'id': 8006, 'count': 10}, {'id': 8008, 'count': 14}]},
    {"level": 15, "basicDust": 150, "memberDust": 150, "xp": 1100, "skill": 0,
     "gifts": [{'id': 8499, 'count': 3}, {'id': 14040, 'count': 5}, {'id': 14018, 'count': 5}, {'id': 8005, 'count': 4}, {'id': 8006, 'count': 10}, {'id': 8008, 'count': 14}]},
    {"level": 16, "basicDust": 180, "memberDust": 180, "xp": 1320, "skill": 1,
     "gifts": [{'id': 22534, 'count': 2}, {'id': 89000, 'count': 3}]},
    {"level": 17, "basicDust": 180, "memberDust": 180, "xp": 1330, "skill": 0,
     "gifts": [{'id': 8499, 'count': 4}, {'id': 14081, 'count': 5}, {'id': 14113, 'count': 5}, {'id': 8009, 'count': 6}, {'id': 8003, 'count': 2}, {'id': 8008, 'count': 12}, {'id': 8015, 'count': 8}]},
    {"level": 18, "basicDust": 180, "memberDust": 180, "xp": 1340, "skill": 0,
     "gifts": [{'id': 8499, 'count': 4}, {'id': 14047, 'count': 5}, {'id': 14089, 'count': 5}, {'id': 8007, 'count': 4}, {'id': 8009, 'count': 6}, {'id': 8008, 'count': 29}, {'id': 8013, 'count': 4}]},
    {"level": 19, "basicDust": 180, "memberDust": 180, "xp": 1350, "skill": 0,
     "gifts": [{'id': 8499, 'count': 4}, {'id': 14143, 'count': 5}, {'id': 14038, 'count': 5}, {'id': 8007, 'count': 3}, {'id': 8005, 'count': 2}, {'id': 8009, 'count': 2}, {'id': 8006, 'count': 2}, {'id': 8008, 'count': 29}, {'id': 8013, 'count': 5}, {'id': 8015, 'count': 3}]},
    {"level": 20, "basicDust": 210, "memberDust": 210, "xp": 1680, "skill": 1,
     "gifts": [{'id': 22535, 'count': 2}, {'id': 89001, 'count': 3}]},
    {"level": 21, "basicDust": 210, "memberDust": 210, "xp": 1690, "skill": 0,
     "gifts": [{'id': 8499, 'count': 5}, {'id': 14081, 'count': 5}, {'id': 14113, 'count': 5}, {'id': 8009, 'count': 7}, {'id': 8003, 'count': 3}, {'id': 8008, 'count': 13}, {'id': 8015, 'count': 9}]},
    {"level": 22, "basicDust": 210, "memberDust": 210, "xp": 1700, "skill": 0,
     "gifts": [{'id': 8499, 'count': 5}, {'id': 14047, 'count': 5}, {'id': 14089, 'count': 5}, {'id': 8007, 'count': 5}, {'id': 8009, 'count': 7}, {'id': 8008, 'count': 30}, {'id': 8013, 'count': 5}]},
    {"level": 23, "basicDust": 210, "memberDust": 210, "xp": 1710, "skill": 0,
     "gifts": [{'id': 8499, 'count': 5}, {'id': 14143, 'count': 5}, {'id': 14038, 'count': 5}, {'id': 8007, 'count': 4}, {'id': 8005, 'count': 3}, {'id': 8009, 'count': 3}, {'id': 8006, 'count': 3}, {'id': 8008, 'count': 30}, {'id': 8013, 'count': 6}, {'id': 8015, 'count': 4}]},
    {"level": 24, "basicDust": 240, "memberDust": 240, "xp": 2160, "skill": 1,
     "gifts": [{'id': 22535, 'count': 2}, {'id': 22525, 'count': 3}, {'id': 22537, 'count': 3}, {'id': 89002, 'count': 3}]},
    {"level": 25, "basicDust": 240, "memberDust": 240, "xp": 2170, "skill": 0,
     "gifts": [{'id': 8499, 'count': 6}, {'id': 14026, 'count': 5}, {'id': 14069, 'count': 5}, {'id': 8008, 'count': 30}, {'id': 8009, 'count': 5}, {'id': 8007, 'count': 4}, {'id': 8005, 'count': 4}, {'id': 8015, 'count': 4}]},
    {"level": 26, "basicDust": 240, "memberDust": 240, "xp": 2180, "skill": 0,
     "gifts": [{'id': 8499, 'count': 6}, {'id': 14137, 'count': 5}, {'id': 14136, 'count': 5}, {'id': 8008, 'count': 30}, {'id': 8009, 'count': 6}, {'id': 8007, 'count': 5}, {'id': 8006, 'count': 4}, {'id': 8015, 'count': 5}]},
    {"level": 27, "basicDust": 240, "memberDust": 240, "xp": 2190, "skill": 0,
     "gifts": [{'id': 8499, 'count': 7}, {'id': 14123, 'count': 5}, {'id': 14064, 'count': 5}, {'id': 8008, 'count': 31}, {'id': 8009, 'count': 7}, {'id': 8005, 'count': 5}, {'id': 8006, 'count': 5}, {'id': 8015, 'count': 6}]},
    {"level": 28, "basicDust": 240, "memberDust": 240, "xp": 2200, "skill": 0,
     "gifts": [{'id': 8499, 'count': 7}, {'id': 14048, 'count': 5}, {'id': 14041, 'count': 5}, {'id': 8008, 'count': 31}, {'id': 8009, 'count': 7}, {'id': 8007, 'count': 6}, {'id': 8006, 'count': 6}, {'id': 8005, 'count': 5}, {'id': 89004, 'count': 3}]},
]

MAX_LEVEL = LEVEL_UPS[-1]["level"] if LEVEL_UPS else 0

# Level up spell progressions for meadow interactions and wilderness
SPELL_PROGRESSIONS = {
    1: [1, 7, 4, 2, 3, 6, 5, 0],  # Animal Talent Spells
    2: [4, 7, 5, 0, 2, 3, 1, 6],  # Garden Talent Spells
    3: [2, 6, 4, 0, 7, 5, 1, 3],  # Light Talent Spells
    4: [3, 5, 1, 6, 4, 7, 0, 2],  # Water Talent Spells
    5: [0, 5, 6, 7, 2, 3, 1, 4],  # Tinker Talent Spells
}


LEVEL_UPS_BY_LEVEL = {level_up["level"]: level_up for level_up in LEVEL_UPS}

SKILL_LEVELS = [level_up["level"] for level_up in LEVEL_UPS if int(level_up.get("skill", 0)) == 1]


def cumulativeThresholds() -> dict[int, int]:

    # This maps every level with the total xp required
    # ex. level 1 threshold is level 1's xp value form the table

    thresholds = {0: 0}
    running = 0
    for level_up in LEVEL_UPS:
        running += int(level_up["xp"])
        thresholds[int(level_up["level"])] = running

    return thresholds

CUMULATIVE_XP_THRESHOLDS = cumulativeThresholds()

def skillCountByLevel() -> dict[int, int]:

    # The count increases for every level that skill == 1

    result = {0: 0}
    count = 0

    for level_up in LEVEL_UPS:
        level = int(level_up["level"])
        if int(level_up.get("skill", 0)) == 1:
            count +=1
        result[level] = count

    return result

SKILL_COUNT_BY_LEVEL =skillCountByLevel()

def getSkillCountAtLevel(level: int) -> int:

    level = max(0, int(level or 0))

    if level in SKILL_COUNT_BY_LEVEL:
        return SKILL_COUNT_BY_LEVEL[level]

    if level > MAX_LEVEL:
        return SKILL_COUNT_BY_LEVEL.get(MAX_LEVEL, 0)

    return 0

def isSkillLevel(level: int) -> bool:

    # This checks if the level unlocks a fairy spell

    level_up = LEVEL_UPS_BY_LEVEL.get(int(level or 0))

    return bool(level_up and int(level_up.get("skill", 0)) == 1)

def getSpellProgressionForTalent(talent_id: int) -> list[int]:

    return SPELL_PROGRESSIONS.get(int(talent_id or 0), [])

def knownVerbs(talent_id: int, level: int) -> list[int]:

    progression = getSpellProgressionForTalent(talent_id)

    return progression[:getSkillCountAtLevel(level)]

def getSpellUnlockedAtLevel(level: int, talent_id: int) -> int | None:

    # This is a helper for server-side logs
    # Return the newest spell ID unlocked at a skill level, if known.

    if not isSkillLevel(level):
        return None

    progression = getSpellProgressionForTalent(talent_id)

    if not progression:
        return None

    skill_index = getSkillCountAtLevel(level) - 1

    if skill_index < 0 or skill_index >= len(progression):
        return None

    return progression[skill_index]
