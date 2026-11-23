# constants for the wilderness / adventure feature

# ── Interest handles / zoning ────────────────────────────────────────────────
WILDERNESS_MATCH_MAKER_HANDLE = 7
WILDERNESS_MATCH_MAKER_ZONE_OFFSET = 1000
ALL_SERVERS_PARENT = 4619


# zone under ALL_SERVERS_PARENT that holds a wilderness's matchmakers
def getMatchMakerZone(wilderness_id: int) -> int:
    return WILDERNESS_MATCH_MAKER_ZONE_OFFSET + wilderness_id


# ── Velvet rope ─────────────────────────────────────────────────────────────
VELVET_WILDERNESS = 5

# ── DistributedEnemy state machine (setEnemyState / requestStateChange) ──────
ENEMY_HIDDEN = 1
ENEMY_ANIMATED = 2
ENEMY_INACTIVE = 3
ENEMY_ACTIVE = 4
ENEMY_DEFEATED = 5

# DistributedEnemy.gameEnded(...) result codes
MG_NOT_WON = 0
MG_WON = 1
MG_ABORTED = 2

# ── DistributedWildernessMatchMaker.setCountdownState ───────────────────────
COUNTDOWN_IDLE = 0
COUNTDOWN_STARTED = 1
COUNTDOWN_CANCELED = 2

# ── DistributedFairyPlayer.matchMakerRejected reason codes ──────────────────
MATCH_MAKER_REJECTED_TIMEOUT = 2

# ── Entry gate (client checks these; the server should mirror them) ─────────
WILDERNESS_MIN_TALENT_LEVEL = 3
SPELL_DUST_REQ_NORMAL = 10
SPELL_DUST_REQ_SPECIAL = 5

# a spell in your own talent costs the lower price
TALENT_SPECIALTY_VERB = {1: 1, 2: 4, 3: 2, 4: 3, 5: 0}


def spellDustCost(talentId: int, spellId: int) -> int:
    if TALENT_SPECIALTY_VERB.get(talentId) == spellId:
        return SPELL_DUST_REQ_SPECIAL
    return SPELL_DUST_REQ_NORMAL

# ── adventure id -> meadows/adventure<N>/ folder ──────────────────────────
ADVENTURE_ITEM_ID_OFFSET = 18000


def getAdventureFolderId(adventure_id: int) -> int:
    return adventure_id + ADVENTURE_ITEM_ID_OFFSET

# tuneable enemy offset, some enemies were spawning in the floor, this was my solution, it works for now
# it is not a good solution, but it works for now
ORIGIN_ITEM_ID_OFFSET = 1000
ORIGIN_TOP_YOFFSET = 315
ORIGIN_BOTTOM_YOFFSET = 290
# only the spider's web hangs from above, every other origin sits on the floor
TOP_ORIGIN_ITEM_IDS = (20002,)

# how far the enemy's origin sits from the enemy the way the client works it out
def originOffsetFor(itemId: int) -> int:
    if itemId + ORIGIN_ITEM_ID_OFFSET in TOP_ORIGIN_ITEM_IDS:
        return -ORIGIN_TOP_YOFFSET
    return ORIGIN_BOTTOM_YOFFSET

# zoning for games
HOSTED_GAME_ZONE_START = 3_000_000_000

MAX_WILDERNESS_PLAYERS = 4
# offset of each seat from the group spawn point, by join order
WILDERNESS_PLAYER_OFFSETS = [(-200, -100), (200, 100), (200, -100), (-200, 100)]
WILDERNESS_PLAYER_ROTATIONS = [0, 1, 1, 0]
