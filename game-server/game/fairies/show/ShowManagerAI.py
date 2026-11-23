import datetime
import json
import re
from pathlib import Path
from zoneinfo import ZoneInfo

from direct.directnotify import DirectNotifyGlobal
from direct.task import Task
from pymongo.errors import DuplicateKeyError

from game.fairies.ai import AccountControl, ZoneConstants
from game.fairies.badges import badge_events
from game.fairies.fairy import PuppetControl

notify = DirectNotifyGlobal.directNotify.newCategory("ShowManagerAI")

GAME_SERVER = Path(__file__).resolve().parents[3]
SHOWS_FOLDER = GAME_SERVER / "config" / "shows"
SCHEDULE_FILE = GAME_SERVER / "config" / "showSchedule.json"

DEFAULT_ZONE = ZoneConstants.FAIRY_TALE_THEATER
POLL_SECONDS = 3
SCHEDULE_WINDOW_SECONDS = 60
MANUAL_SHOW_MINUTES = 60
TAIL_SECONDS = 10
DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
STEP_KINDS = ("summon", "say", "emote", "move", "orb", "dismiss", "end")


def loadScript(name: str) -> dict:
    path = SHOWS_FOLDER / f"{name}.json"
    script = json.loads(path.read_text(encoding="utf8"))

    if script.get("kind") not in badge_events.SHOW_KIND_EVENTS:
        raise ValueError(f"{name}: kind must be one of {', '.join(badge_events.SHOW_KIND_EVENTS)}")

    for step in script.get("steps", []):
        if step.get("do") not in STEP_KINDS:
            raise ValueError(f"{name}: unknown step {step.get('do')!r}")

    return script


def scriptNames() -> list[str]:
    return sorted(path.stem for path in SHOWS_FOLDER.glob("*.json"))


def dueOccurrences(entries: list, now: datetime.datetime) -> list:
    """The schedule entries that should be starting right now, as (key, entry)
    pairs. The key names one occurrence, so a restart or a second district can
    tell it has already been started."""
    due = []

    for entry in entries:
        zone = ZoneInfo(entry.get("timezone", "America/Los_Angeles"))
        local = now.astimezone(zone)

        if "at" in entry:
            start = datetime.datetime.fromisoformat(entry["at"]).replace(tzinfo=zone)
            key = f"{entry['script']}:{entry['at']}"
        else:
            days = [day.lower()[:3] for day in entry.get("days", DAY_NAMES)]

            if DAY_NAMES[local.weekday()] not in days:
                continue

            hour, minute = (int(part) for part in entry["time"].split(":"))
            start = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
            key = f"{entry['script']}:{start.date().isoformat()}:{entry['time']}"

        age = (now - start).total_seconds()

        if 0 <= age < SCHEDULE_WINDOW_SECONDS:
            due.append((key, entry))

    return due


class Show:
    def __init__(self, zoneId: int, kind: str, title: str, script: dict | None) -> None:
        self.zoneId = zoneId
        self.kind = kind
        self.title = title
        self.script = script
        self.startedAt = datetime.datetime.now(datetime.timezone.utc)
        self.attendees: set[int] = set()
        self.puppets: dict[str, int] = {}
        self.taskNames: list[str] = []


class ShowManagerAI:
    def __init__(self, air) -> None:
        self.air = air
        self.shows: dict[int, Show] = {}
        self.presence: dict[int, int] = {}
        self.scheduleStamp = None
        self.schedule: list = []

        mongodb = air.mongoInterface.mongodb
        mongodb.shows.delete_many({"districtName": air.districtName})
        mongodb.showClaims.create_index("claimedAt", expireAfterSeconds=7 * 24 * 3600)
        mongodb.showResults.create_index("at", expireAfterSeconds=24 * 3600)

        taskMgr.doMethodLater(POLL_SECONDS, self.poll, "showPoll")

    def mongodb(self):
        return self.air.mongoInterface.mongodb

    def fairyMoved(self, avatarId: int, zoneId: int) -> None:
        previous = self.presence.get(avatarId, 0)

        if previous == zoneId:
            return

        if previous:
            self.raiseFor(avatarId, self.shows.get(previous))

        if zoneId:
            self.presence[avatarId] = zoneId
            show = self.shows.get(zoneId)

            if show is not None:
                show.attendees.add(avatarId)
                self.raiseFor(avatarId, show)
        else:
            self.presence.pop(avatarId, None)

    def raiseFor(self, avatarId: int, show: Show | None) -> None:
        if show is None:
            return

        for eventId in badge_events.SHOW_KIND_EVENTS[show.kind]:
            self.air.badgeManager.d_accumulate(avatarId, eventId, 1)

    def start(self, kind: str, zoneId: int, title: str = "", scriptName: str | None = None) -> str:
        if zoneId not in self.air.zoneToMeadow:
            return f"zone {zoneId} isn't a meadow here"

        if zoneId in self.shows:
            return f"a show is already running in zone {zoneId}"

        script = loadScript(scriptName) if scriptName else None
        show = Show(zoneId, kind, title or (script or {}).get("title", kind), script)
        self.shows[zoneId] = show

        for avatarId, here in list(self.presence.items()):
            if here == zoneId:
                show.attendees.add(avatarId)
                self.raiseFor(avatarId, show)

        if script is not None:
            self.scheduleSteps(show)
        else:
            self.addTask(show, MANUAL_SHOW_MINUTES * 60, lambda: self.end(zoneId), "limit")

        self.publish(show)
        return f"{show.title} ({kind}) started in zone {zoneId}"

    def end(self, zoneId: int) -> str:
        show = self.shows.pop(zoneId, None)

        if show is None:
            return f"no show in zone {zoneId}"

        for name in show.taskNames:
            taskMgr.remove(name)

        for avatarId, here in list(self.presence.items()):
            if here == zoneId:
                self.raiseFor(avatarId, show)

        for fairyId in show.puppets.values():
            puppet = self.air.doId2do.get(fairyId)

            if puppet is not None and PuppetControl.isPuppet(self.air, fairyId):
                PuppetControl.dismissPuppet(self.air, puppet)

        self.mongodb().shows.delete_one({"_id": f"{self.air.districtName}:{zoneId}"})
        return f"{show.title} ended in zone {zoneId} with {len(show.attendees)} attending"

    def scheduleSteps(self, show: Show) -> None:
        steps = sorted(show.script.get("steps", []), key=lambda step: step.get("at", 0))
        last = max([step.get("at", 0) for step in steps] or [0])

        for index, step in enumerate(steps):
            self.addTask(show, step.get("at", 0), lambda step=step: self.runStep(show, step), f"step{index}")

        if not any(step["do"] == "end" for step in steps):
            self.addTask(show, last + TAIL_SECONDS, lambda: self.end(show.zoneId), "tail")

    def addTask(self, show: Show, delay: float, action, label: str) -> None:
        name = f"show-{self.air.districtName}-{show.zoneId}-{label}"
        show.taskNames.append(name)

        def run(task):
            try:
                action()
            except Exception:
                notify.warning(f"show step {label} failed", exc_info=True)
            return Task.done

        taskMgr.doMethodLater(max(0.1, delay), run, name)

    def runStep(self, show: Show, step: dict) -> None:
        kind = step["do"]

        if kind == "end":
            self.end(show.zoneId)
        elif kind == "summon":
            self.summon(show, step["who"])
        else:
            fairyId = show.puppets.get(step.get("who", ""))
            puppet = self.air.doId2do.get(fairyId) if fairyId else None

            if puppet is None:
                notify.warning(f"{show.title}: {step.get('who')} isn't out for step {kind}")
            elif kind == "dismiss":
                PuppetControl.dismissPuppet(self.air, puppet)
                show.puppets.pop(step["who"], None)
            elif kind == "say":
                puppet.puppetSay(step["text"])
            elif kind == "emote":
                puppet.puppetEmote(int(step["emote"]))
            elif kind == "move":
                puppet.puppetMove(int(step["x"]), int(step["y"]))
            elif kind == "orb":
                puppet.b_setOrbSize(int(step["size"]))

    def summon(self, show: Show, name: str) -> None:
        fairy = self.mongodb().fairies.find_one({
            "famousFairy": True,
            "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"},
        })

        if fairy is None:
            notify.warning(f"{show.title}: no famous fairy named {name}")
            return

        if fairy["_id"] in self.air.doId2do or PuppetControl.isPuppet(self.air, fairy["_id"]):
            notify.warning(f"{show.title}: {name} is already out")
            return

        account = AccountControl.accountForFairyDoc(self.air, fairy)

        if account is None:
            notify.warning(f"{show.title}: {name} has no account")
            return

        meadow = self.air.zoneToMeadow[show.zoneId]
        PuppetControl.activatePuppet(self.air, fairy, account, meadow.parentId, show.zoneId)
        show.puppets[name] = fairy["_id"]

    def publish(self, show: Show) -> None:
        self.mongodb().shows.replace_one(
            {"_id": f"{self.air.districtName}:{show.zoneId}"},
            {
                "_id": f"{self.air.districtName}:{show.zoneId}",
                "districtName": self.air.districtName,
                "zoneId": show.zoneId,
                "kind": show.kind,
                "title": show.title,
                "startedAt": show.startedAt,
            },
            upsert=True,
        )

    def report(self, text: str) -> None:
        notify.info(text)
        self.mongodb().showResults.insert_one({
            "at": datetime.datetime.now(datetime.timezone.utc),
            "districtName": self.air.districtName,
            "text": text,
        })

    def poll(self, task):
        try:
            self.takeRequests()
            self.takeSchedule()
        except Exception:
            notify.warning("show poll failed", exc_info=True)

        return Task.again

    def mine(self) -> dict:
        return {"$or": [{"district": None}, {"district": self.air.districtName}]}

    def takeRequests(self) -> None:
        requests = self.mongodb().showRequests

        if self.shows:
            request = requests.find_one_and_delete({
                "action": "end", "zoneId": {"$in": [0, *self.shows]}, **self.mine()})

            if request is not None:
                zones = list(self.shows) if request["zoneId"] == 0 else [request["zoneId"]]
                self.report("; ".join(self.end(zone) for zone in zones))

        request = requests.find_one_and_delete({"action": "start", **self.mine()})

        if request is not None:
            self.report(self.startRequest(request))

    def startRequest(self, request: dict) -> str:
        try:
            if request.get("script"):
                script = loadScript(request["script"])
                zoneId = request.get("zoneId") or script.get("zone", DEFAULT_ZONE)
                return self.start(script["kind"], zoneId, script.get("title", ""), request["script"])

            return self.start(request["kind"], request.get("zoneId") or DEFAULT_ZONE)
        except (OSError, ValueError, KeyError) as error:
            return f"couldn't start the show: {error}"

    def takeSchedule(self) -> None:
        if not SCHEDULE_FILE.exists():
            return

        stamp = SCHEDULE_FILE.stat().st_mtime

        if stamp != self.scheduleStamp:
            self.scheduleStamp = stamp

            try:
                self.schedule = json.loads(SCHEDULE_FILE.read_text(encoding="utf8"))
            except (OSError, ValueError):
                notify.warning("showSchedule.json couldn't be read", exc_info=True)
                self.schedule = []

        entries = [entry for entry in self.schedule
                   if entry.get("district") in (None, self.air.districtName)]

        for key, entry in dueOccurrences(entries, datetime.datetime.now(datetime.timezone.utc)):
            try:
                self.mongodb().showClaims.insert_one({
                    "_id": key, "districtName": self.air.districtName,
                    "claimedAt": datetime.datetime.now(datetime.timezone.utc)})
            except DuplicateKeyError:
                continue

            self.report(self.startRequest({"script": entry["script"], "zoneId": entry.get("zoneId", 0)}))
