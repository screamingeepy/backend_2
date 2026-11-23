import json
import os
from pathlib import Path
from typing import NamedTuple, Optional

from direct.directnotify import DirectNotifyGlobal

from game.fairies.wilderness.WildernessConstants import ADVENTURE_ITEM_ID_OFFSET

notify = DirectNotifyGlobal.directNotify.newCategory("WildernessCoordOverrides")

# game-server/game/fairies/wilderness/ -> game-server/
GAME_SERVER_FOLDER = Path(__file__).resolve().parents[3]
OVERRIDES_FILE = Path(os.environ.get("WILDERNESS_OVERRIDES_FILE", GAME_SERVER_FOLDER / "config" / "wildernessOverrides.json"))

COPY_DEPTH = 5


class CoordOverride(NamedTuple):
    nearExit: Optional[tuple] = None
    farExit: Optional[tuple] = None
    enemies: tuple = ()


# the parsed file and the modified time it was parsed at
class OverrideTable:

    def __init__(self) -> None:
        self.mtime: Optional[float] = None
        self.adventures: dict = {}
        self.wildernesses: dict = {}


overrideTable = OverrideTable()


# the current table, re-read if the file changed
def loadOverrideTable() -> OverrideTable:
    try:
        mtime = OVERRIDES_FILE.stat().st_mtime
    except OSError:
        # no file at all is fine, everything is computed
        overrideTable.mtime = None
        overrideTable.adventures = {}
        overrideTable.wildernesses = {}
        return overrideTable

    if mtime == overrideTable.mtime:
        return overrideTable

    try:
        raw = json.loads(OVERRIDES_FILE.read_text(encoding="utf-8"))
        adventures = {int(key): value for key, value in (raw.get("adventures") or {}).items()}
        wildernesses = {int(key): value for key, value in (raw.get("wilderness") or {}).items()}
    except (OSError, ValueError, AttributeError) as exc:
        notify.warning("could not read %s (%s); keeping the last good positions" % (OVERRIDES_FILE.name, exc))
        overrideTable.mtime = mtime
        return overrideTable

    overrideTable.mtime = mtime
    overrideTable.adventures = adventures
    overrideTable.wildernesses = wildernesses
    notify.info("loaded coordinate overrides for %d adventure(s), %d wilderness(es)" % (len(adventures), len(wildernesses)))
    return overrideTable


def parsePoint(value) -> Optional[tuple]:
    if isinstance(value, (list, tuple)) and len(value) == 2:
        try:
            return (int(value[0]), int(value[1]))
        except (TypeError, ValueError):
            return None
    return None


# an adventure's entry with its copyFrom chain folded in, own keys last so they win
def resolveAdventureEntry(table: OverrideTable, adventureId: int, depth: int = 0) -> dict:
    entry = table.adventures.get(adventureId)
    if not isinstance(entry, dict):
        return {}

    merged: dict = {}
    source = entry.get("copyFrom")
    if source is not None and depth < COPY_DEPTH:
        try:
            merged.update(resolveAdventureEntry(table, int(source), depth + 1))
        except (TypeError, ValueError):
            notify.warning("adventure %d: copyFrom %r is not an adventure id" % (adventureId, source))

    for key, value in entry.items():
        if key == "copyFrom":
            continue
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value

    return merged


def getWildernessOfAdventure(adventureId: int) -> Optional[int]:
    from game.fairies.wilderness.WildernessData import WildernessData

    adventure = WildernessData.getInstance().getAdventureDef(adventureId)
    return adventure.wilderness_id if adventure else None


# the override in force for a raw adventure id, or None
def overrideFor(adventureId: int) -> Optional[CoordOverride]:
    table = loadOverrideTable()

    merged: dict = {}
    wilderness = getWildernessOfAdventure(adventureId)
    if wilderness is not None and isinstance(table.wildernesses.get(wilderness), dict):
        merged.update({k: v for k, v in table.wildernesses[wilderness].items() if v is not None})
    merged.update(resolveAdventureEntry(table, adventureId))

    near = parsePoint(merged.get("nearExit"))
    far = parsePoint(merged.get("farExit"))
    enemies = tuple(point for point in (parsePoint(e) for e in (merged.get("enemies") or [])) if point is not None)

    if near is None and far is None and not enemies:
        return None
    return CoordOverride(nearExit=near, farExit=far, enemies=enemies)


# layout is an AdventureLayout or None
def overrideForLayout(layout) -> Optional[CoordOverride]:
    zoneId = getattr(layout, "zone_id", None)
    if zoneId is None:
        return None
    return overrideFor(zoneId - ADVENTURE_ITEM_ID_OFFSET)
