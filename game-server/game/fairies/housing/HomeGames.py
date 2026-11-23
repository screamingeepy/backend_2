import xml.etree.ElementTree as ET

from game.fairies.ai.FairiesConstants import TYPE_MINIGAME_ID
from game.fairies.housing.HouseConstants import ROOM_TYPE_HOME
from paths import XML

MEADOW_GAME_ASSETS_XML = XML / "meadowGameAssets.xml"

IDS_PER_TYPE = 500

# A table's tag is its hotspot id on the client, and the DistributedMeadowGame a
# table hosts carries it in setGameInfo as a uint8, so tags have to fit in one.
MIN_TAG = 1
MAX_TAG = 255

# HomeItemNegotiator.HOTSPOTMAX_LARGEHOME. The client holds a small home to 4
# (HOTSPOTMAX_SMALLHOME); the server only stops a client that ignores both.
MAX_TABLES_PER_ROOM = 6

# DistributedHomeHotspot.MAX_DEPTH: room coordinates run 0..1000 on each axis.
MAX_POSITION = 1000

# DistributedHomeHotspot.LOCKEDSTATE_TRUE, what the client gives a table that
# isn't a placeholder.
LOCKED_STATE_TRUE = 0

PASS_THE_POPCORN_ITEM = 13012
SIMONE_SAYS_ITEM = 13013
ROCK_PAPER_SCISSORS_ITEM = 13016
CRAZY_CAKES_ITEM = 13017
TWO_FOR_TEA_ITEM = 13018

_tableHotspots: dict[int, int] | None = None


def tableHotspots() -> dict[int, int]:
    """Game item id -> the hotspot its table is drawn as (<gameconfigNNNNN dhsId>).

    PouchPanel.onPlaceClick reads the same attribute to pick the hotspot it sends.
    """
    global _tableHotspots

    if _tableHotspots is None:
        config = ET.parse(MEADOW_GAME_ASSETS_XML).getroot().find("config")
        _tableHotspots = {}

        for node in (config if config is not None else []):
            itemId = node.tag[len("gameconfig"):]
            hotspotId = node.get("dhsId", "")
            if node.tag.startswith("gameconfig") and itemId.isdigit() and hotspotId.isdigit():
                _tableHotspots[int(itemId)] = int(hotspotId)

    return _tableHotspots


def createTableGame(air, itemId: int, ownerId: int = 0):
    """the meadow game a table for this game item hosts, or None. ownerId makes it a party game (party rewards and badges)"""
    from game.fairies.housing import PartyConstants
    from game.fairies.minigame.DistributedCrazyEightsAI import DistributedCrazyEightsAI
    from game.fairies.minigame.DistributedMatchGameAI import DistributedMatchGameAI
    from game.fairies.minigame.DistributedPassPopCornAI import DistributedPassPopCornAI
    from game.fairies.minigame.DistributedRockPaperScissorsAI import DistributedRockPaperScissorsAI
    from game.fairies.minigame.DistributedSimoneSaysAI import DistributedSimoneSaysAI

    partyTables = {
        ROCK_PAPER_SCISSORS_ITEM: DistributedRockPaperScissorsAI,
        SIMONE_SAYS_ITEM: DistributedSimoneSaysAI,
        PASS_THE_POPCORN_ITEM: DistributedPassPopCornAI,
    }

    if itemId == CRAZY_CAKES_ITEM:
        game = DistributedCrazyEightsAI(air)
    elif itemId == TWO_FOR_TEA_ITEM:
        game = DistributedMatchGameAI(air)
        game.minPlayers = game.maxPlayers = 2
    elif itemId in partyTables:
        game = partyTables[itemId](air)
        game.minPlayers = PartyConstants.partyGameMinPlayers(itemId - IDS_PER_TYPE * TYPE_MINIGAME_ID)
    else:
        return None

    game.homeOwnerId = ownerId
    return game


def isGameItem(itemId: int) -> bool:
    return itemId // IDS_PER_TYPE == TYPE_MINIGAME_ID


def clampPosition(value: int) -> int:
    return max(0, min(MAX_POSITION, value))


def removeHouseTables(air, avId: int) -> None:
    """Take down every table in the house (not the garden), as a home reset does
    to the furniture, and put their games back in the pouch."""
    before = air.mongoInterface.mongodb.fairies.find_one_and_update(
        {"_id": avId}, {"$pull": {"homeGames": {"roomId": ROOM_TYPE_HOME}}}, projection={"homeGames": 1})

    returned = 0
    for record in (before or {}).get("homeGames", []):
        # a table put out before games left the pouch never took its game out
        if record.get("roomId") == ROOM_TYPE_HOME and record.get("spent"):
            air.inventoryManager.addIngredientsToPouch(avId, record["item_id"], 1, -1)
            returned += 1

    owner = air.doId2do.get(avId)
    if returned and owner is not None:
        owner.d_syncPouchAfterChanges()
