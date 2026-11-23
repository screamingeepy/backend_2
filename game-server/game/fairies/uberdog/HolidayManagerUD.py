import json
import time
from datetime import datetime, timezone
from direct.distributed.DistributedObjectUD import DistributedObjectUD
from direct.task.TaskManagerGlobal import taskMgr
from game.fairies.daily.TimeUtils import get_season
from paths import XML

# holidays.json lists every holiday and its tags, what is switched on lives in Mongo
# web-api's /gm/admin writes the same setting
HOLIDAYS_SETTING = "admin.holidays"
DEFAULT_ENABLED = []
REFRESH_SECONDS = 10

_mongodb = None
_catalog = None
_state = {"enabled": list(DEFAULT_ENABLED), "extra": [], "at": 0.0}


def bind(mongodb) -> None:
    global _mongodb
    _mongodb = mongodb


def getCatalog() -> list[dict]:
    global _catalog

    if _catalog is None:
        with open(XML / "holidays.json", encoding="utf-8") as handle:
            _catalog = json.load(handle)["holidays"]

    return _catalog


def _refresh(force: bool = False) -> None:
    now = time.monotonic()

    if not force and now - _state["at"] < REFRESH_SECONDS:
        return

    _state["at"] = now

    if _mongodb is None:
        return

    try:
        row = _mongodb.sitesettings.find_one({"_id": HOLIDAYS_SETTING})
    except Exception:
        return

    value = (row or {}).get("value")

    if isinstance(value, dict):
        _state["enabled"] = [str(one) for one in value.get("enabled", [])]
        _state["extra"] = [str(one) for one in value.get("extra", [])]
    else:
        _state["enabled"] = list(DEFAULT_ENABLED)
        _state["extra"] = []


def getHolidayState() -> dict:
    _refresh()

    return {"enabled": list(_state["enabled"]), "extra": list(_state["extra"])}


def _save() -> None:
    _mongodb.sitesettings.update_one(
        {"_id": HOLIDAYS_SETTING},
        {"$set": {"value": {"enabled": _state["enabled"], "extra": _state["extra"]}}}, upsert=True)


# a holiday id from holidays.json, or any other tag by its name
def setHoliday(name: str, on: bool) -> str:
    _refresh(force=True)

    ids = {holiday["id"].lower(): holiday["id"] for holiday in getCatalog()}
    key = ids.get(name.lower())
    listed = _state["enabled"] if key else _state["extra"]
    entry = key or name

    if on and entry not in listed:
        listed.append(entry)
    elif not on and entry in listed:
        listed.remove(entry)

    _save()

    return entry


def getActiveTags() -> list[str]:
    """
    The tag set the client's TagManager runs on, which decides which tagged
    <image>/<hotspot> variants in a meadow's config.xml are live right now.

    Module-level because the AI needs the same answer the uberdog hands the
    client -- meadow_xml resolves hotspots against it, and the two drifting
    apart would mean the server acting on a hotspot the player can't see.
    """
    _refresh()
    tags = []

    for holiday in getCatalog():
        if holiday["id"] in _state["enabled"]:
            tags.extend(tag for tag in holiday["tags"] if tag not in tags)

    tags.extend(tag for tag in _state["extra"] if tag not in tags)

    # Handle Seasonal changes for PP/Tearoom automatically
    current_season = get_season(datetime.now(timezone.utc))
    cap_season = current_season.capitalize()
    tags.append(f"Meadow_{cap_season}")
    tags.append(f"Tearoom_{cap_season}")
    tags.append(f"Meadow_{cap_season}_Ball_Open")

    return tags


# quest tags to enable/disable holiday quests, which the uberdog uses to decide what to give out
def getActiveQuestTags() -> set[str]:
    live = set(getActiveTags())

    for holiday in getCatalog():
        if holiday["id"] in _state["enabled"]:
            live.update(holiday.get("questTags", []))

    return live


def getGatedQuestTags() -> set[str]:
    gated = set()

    for holiday in getCatalog():
        gated.update(holiday["tags"])
        gated.update(holiday.get("questTags", []))

    return gated


DEFAULT_WELCOME ="Welcome to the test server. Missing features and bugs are to be expected. Enjoy!"
# web-api's AdminSettings keeps the saved one here, the SiteSetting model
WELCOME_SETTING = "admin.loginAnnouncement"


class HolidayManagerUD(DistributedObjectUD):
    def __init__(self, air) -> None:
        super().__init__(air)

        self.welcomeMessage = DEFAULT_WELCOME
        self.announcing = False
        self.loadWelcome()

        bind(air.mongoInterface.mongodb)
        self.lastTags = tuple(getActiveTags())
        taskMgr.doMethodLater(REFRESH_SECONDS, self.checkHolidays, "holidayTags")

    # a holiday switched on or off reaches players already in the game, they see it at their next meadow
    def checkHolidays(self, task):
        _refresh(force=True)
        tags = tuple(getActiveTags())

        if tags != self.lastTags:
            self.lastTags = tags
            self.sendUpdate("setTimeSpan", [list(tags)])

        return task.again

    def loadWelcome(self) -> None:
        try:
            row = self.air.mongoInterface.mongodb.sitesettings.find_one({"_id": WELCOME_SETTING})
        except Exception:
            return

        saved = str((row or {}).get("value") or "").strip()
        self.welcomeMessage = saved or DEFAULT_WELCOME

    # what new logins are welcomed with, an empty message goes back to the default
    def saveWelcome(self, message: str) -> None:
        self.air.mongoInterface.mongodb.sitesettings.update_one(
            {"_id": WELCOME_SETTING}, {"$set": {"value": message}}, upsert=True)
        self.loadWelcome()
        self.clearAnnouncement()

    # the client shows setTimeSpanMessage as an alert, so this reaches everyone connected right now
    # new logins get the welcome message, which a broadcast leaves alone unless it was saved
    def announce(self, message: str) -> None:
        self.sendUpdate("setTimeSpanMessage", [message])
        self.announcing = True
        self.loadWelcome()

    # setTimeSpanMessage is a ram field, so an announcement is what every new login sees until the field
    # is written again; putting the welcome message back is a broadcast too, so it alerts whoever is online
    def clearAnnouncement(self) -> bool:
        if not self.announcing:
            return False

        self.announcing = False
        self.sendUpdate("setTimeSpanMessage", [self.welcomeMessage])
        return True

    def getTimeSpan(self) -> list[str]:
        return getActiveTags()

    def getTimeSpanMessage(self) -> str:
        return self.welcomeMessage

    def getShopsOpen(self) -> int:
        return 1
