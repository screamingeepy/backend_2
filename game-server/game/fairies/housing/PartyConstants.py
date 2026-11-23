# home parties and party games

import xml.etree.ElementTree as ET

from panda3d.core import ConfigVariableInt

from game.fairies.ai.FairiesConstants import TYPE_MINIGAME_ID, TYPE_PARTY_DECORATION_ID
from paths import XML

# FairiesConstants.IDS_PER_TYPE in the client, an item id is type * 500 + n
IDS_PER_TYPE = 500

# createParty sends the decoration item id minus this, so the theme is 1..7 for items 17001..17007
DECORATION_ITEM_BASE = TYPE_PARTY_DECORATION_ID * IDS_PER_TYPE

# party games
PARTY_GAME_ITEM_BASE = TYPE_MINIGAME_ID * IDS_PER_TYPE

# the party games that run as a hosted DistributedMultiplayerMinigame
PARTY_GAME_IDS = frozenset({12, 13, 16})

# setExpectedPlayers truncates anything longer
MAX_PARTY_GAME_PLAYERS = 12

# partyAssets.xml minPlayersNNNNN, for a game it doesn't list
DEFAULT_PARTY_GAME_MIN_PLAYERS = 2

# PartyGameLauncher.GAME_LAUNCH_DELAY is 16s, this covers a host client that never triggers or cancels
LOBBY_TIMEOUT_SECS = 16 + 30

# lobby stays up after the trigger so every client acts on setGameTriggered
LOBBY_LINGER_SECS = 10

# how long the room waits for players before opening without the stragglers
GAME_READY_TIMEOUT_SECS = 30

# clients fly home after the results, the room cleans out after this in case one doesn't
GAME_RESULTS_LINGER_SECS = 60

# between setCleanOut and deleting the room so the bounce reaches everyone
GAME_CLEANOUT_GRACE_SECS = 5

# hard ceiling on one game room
GAME_MAX_LIFETIME_SECS = 30 * 60

# chat room messages are small json, bigger isn't a game move
MAX_GAME_MESSAGE_LENGTH = 8192

# end of game prize is the season's ingredient
REWARD_PER_PLAYER = 15
REWARD_FIRST_PLACE_MAX = 60
REWARD_LAST_PLACE = 15


def partyGameReward(rank: int, playerCount: int) -> int:
    first = min(REWARD_PER_PLAYER * max(playerCount, 1), REWARD_FIRST_PLACE_MAX)

    if playerCount <= 1:
        return first

    spread = first - REWARD_LAST_PLACE
    return round(first - spread * rank / (playerCount - 1))

PARTY_ASSETS_XML = XML / "partyAssets.xml"

MIN_THEME = 1
MAX_THEME = 7  # every home layout carries images for party="1" .. party="7"

# a party ends on its own this long after it starts
DEFAULT_PARTY_DURATION_SECS = 2 * 60 * 60

# party.xml partyCoolDownDelay, the panel grays out send this long after inviting
INVITE_COOLDOWN_SECS = 60
INVITE_COOLDOWN_SLACK_SECS = 5

# nobody can have more friends than this (FMPlayerFriendsManager.lua MAX_FRIENDS)
MAX_INVITEES = 300

# home privacy sits at this offset in moreOptions, '1' means friends only
HOME_PRIVACY_OFFSET = 15

PARTY_NAMES_XML = XML / "partyNames.xml"

# the three word lists, in the order createParty's name indices refer to them
NAME_PARTS = ("adjective", "noun", "party")

nameCountsCache: tuple[int, ...] | None = None
minPlayersCache: dict[int, int] | None = None


def decorationItemId(themeId: int) -> int:
    return DECORATION_ITEM_BASE + themeId


def isValidTheme(themeId: int) -> bool:
    return MIN_THEME <= themeId <= MAX_THEME


def isHomePrivate(moreOptions) -> bool:
    return (isinstance(moreOptions, str) and len(moreOptions) > HOME_PRIVACY_OFFSET
            and moreOptions[HOME_PRIVACY_OFFSET] == "1")


def partyGameItemId(gameId: int) -> int:
    return PARTY_GAME_ITEM_BASE + gameId


# the fewest players a party game can start with (partyAssets.xml)
def partyGameMinPlayers(gameId: int) -> int:
    global minPlayersCache

    if minPlayersCache is None:
        config = ET.parse(PARTY_ASSETS_XML).getroot().find("config")
        minPlayersCache = {}

        for node in (config if config is not None else []):
            if node.tag.startswith("minPlayers") and (node.text or "").strip().isdigit():
                minPlayersCache[int(node.tag[len("minPlayers"):])] = int(node.text)

    return minPlayersCache.get(partyGameItemId(gameId), DEFAULT_PARTY_GAME_MIN_PLAYERS)


def partyDurationSecs() -> int:
    return ConfigVariableInt("party-duration", DEFAULT_PARTY_DURATION_SECS).getValue()


def parseNameCounts(path) -> tuple[int, ...]:
    copy = ET.parse(path).getroot().find("copy")
    if copy is None:
        raise ValueError(f"{path} has no <copy> section")

    counts = []
    for part in NAME_PARTS:
        # PartyName.loadNameAssets stops at the first missing one, so a gap ends the list here too
        count = 0
        while copy.find(f"{part}{count + 1}") is not None:
            count += 1
        counts.append(count)

    return tuple(counts)


def nameCounts() -> tuple[int, ...]:
    global nameCountsCache

    if nameCountsCache is None:
        nameCountsCache = parseNameCounts(PARTY_NAMES_XML)

    return nameCountsCache


# three 0-based indices, one into each word list (PartyName's constructor)
def isValidName(nameIds) -> bool:
    counts = nameCounts()

    return (len(nameIds) == len(counts)
            and all(0 <= index < count for index, count in zip(nameIds, counts)))
