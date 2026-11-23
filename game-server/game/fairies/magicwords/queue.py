import datetime

from direct.task import Task
from direct.task.TaskManagerGlobal import taskMgr

from game.fairies.ai import StaffTiers
from game.fairies.magicwords.registry import (
    MagicWordError, SCOPE_ANY, SCOPE_ANY_DISTRICT, SCOPE_DISTRICT, SCOPE_GLOBAL, dispatch, get, resolveFairyToken,
    snapshot, targetToken,
)

POLL_INTERVAL_SECONDS = 1.0
OFFLINE_GRACE_SECONDS = 2.0


class QueueOrigin:

    def __init__(self, accountId: int, tier: str) -> None:
        self._accountId = accountId
        self.queuedTier = tier

    def getDISLid(self) -> int:
        return self._accountId


def liveTier(air, accountId: int) -> str:
    try:
        account = air.mongoInterface.mongodb.accounts.find_one({"_id": accountId}, {"accountType": 1})
    except Exception:
        return StaffTiers.PLAYER

    tier = (account or {}).get("accountType", StaffTiers.PLAYER)
    return tier if isinstance(tier, str) else StaffTiers.PLAYER


def _claim(collection, docId, claimedBy) -> bool:
    result = collection.find_one_and_update(
        {"_id": docId, "status": "pending"},
        {"$set": {"status": "running", "claimedBy": claimedBy}},
    )
    return result is not None


def _finish(collection, docId, status: str, response: str) -> None:
    collection.update_one(
        {"_id": docId},
        {"$set": {"status": status, "response": response,
                  "finishedAt": datetime.datetime.utcnow()}},
    )


def _run(air, collection, docId, commandText: str, issuerId: int, zoneId: int) -> None:
    origin = QueueOrigin(issuerId, liveTier(air, issuerId))

    try:
        response = dispatch(air, origin, commandText, zoneId)
        _finish(collection, docId, "done", response)
    except MagicWordError as e:
        _finish(collection, docId, "failed", str(e))
    except Exception as e:
        # Unlike the console's own setMagicWord (which deliberately lets a
        # genuine bug surface as a traceback -- see FairiesMagicWordManagerAI),
        # a recurring poll cannot afford to die on one bad command: doing so
        # would silently stop servicing the entire queue until a restart. This
        # command fails loudly in its own response instead; anything else
        # queued keeps working.
        _finish(collection, docId, "failed", f"{type(e).__name__}: {e}")


def pollGlobal(air) -> None:
    collection = air.mongoInterface.mongodb.gmCommands

    for doc in collection.find({"status": "pending", "scope": SCOPE_GLOBAL}):
        if not _claim(collection, doc["_id"], "uberdog"):
            continue

        _run(air, collection, doc["_id"], doc.get("command", ""),
            doc.get("issuedBy", 0), 0)

    offlineBefore = datetime.datetime.utcnow() - datetime.timedelta(seconds=OFFLINE_GRACE_SECONDS)
    for doc in collection.find({"status": "pending", "scope": SCOPE_ANY, "issuedAt": {"$lt": offlineBefore}}):
        if not _claim(collection, doc["_id"], "uberdog"):
            continue

        _run(air, collection, doc["_id"], doc.get("command", ""),
            doc.get("issuedBy", 0), 0)


def pollDistrict(air) -> None:
    collection = air.mongoInterface.mongodb.gmCommands

    for doc in collection.find({"status": "pending", "scope": {"$in": [SCOPE_DISTRICT, SCOPE_ANY]}}):
        commandText = doc.get("command", "")
        parts = commandText.split()
        if not parts:
            continue

        cmd = get(parts[0].lower())
        if cmd is None:
            continue

        token = targetToken(cmd, parts[1:])
        if token is None:
            continue

        try:
            targetId = resolveFairyToken(air, token)
        except MagicWordError as e:
            # Not resolvable at all (typo, deleted fairy, a name shared by
            # several fairies) -- every district reaches the same answer, so
            # whichever claims it first reports the reason, and the GM gets
            # the list of doIds to pick from instead of a vague "unclaimed".
            if _claim(collection, doc["_id"], air.districtId):
                _finish(collection, doc["_id"], "failed", str(e))
            continue

        target = air.doId2do.get(targetId)
        if target is None:
            continue

        if not _claim(collection, doc["_id"], air.districtId):
            continue

        _run(air, collection, doc["_id"], commandText, doc.get("issuedBy", 0),
            getattr(target, "zoneId", 0))


def pollAnyDistrict(air) -> None:
    collection = air.mongoInterface.mongodb.gmCommands

    for doc in collection.find({"status": "pending", "scope": SCOPE_ANY_DISTRICT}):
        if not _claim(collection, doc["_id"], air.districtId):
            continue

        _run(air, collection, doc["_id"], doc.get("command", ""), doc.get("issuedBy", 0), 0)


def _pollGlobalTask(air):
    pollGlobal(air)
    taskMgr.doMethodLater(
        POLL_INTERVAL_SECONDS, _pollGlobalTask, "gmQueue-global", extraArgs=[air])
    return Task.done


def _pollDistrictTask(air):
    pollDistrict(air)
    pollAnyDistrict(air)
    taskMgr.doMethodLater(
        POLL_INTERVAL_SECONDS, _pollDistrictTask, "gmQueue-district", extraArgs=[air])
    return Task.done


def publishRegistry(air) -> None:
    collection = air.mongoInterface.mongodb.gmRegistry
    collection.delete_many({})
    commands = snapshot()
    if commands:
        collection.insert_many(commands)


def startGlobalPolling(air) -> None:
    publishRegistry(air)
    taskMgr.doMethodLater(
        POLL_INTERVAL_SECONDS, _pollGlobalTask, "gmQueue-global", extraArgs=[air])


def startDistrictPolling(air) -> None:
    taskMgr.doMethodLater(
        POLL_INTERVAL_SECONDS, _pollDistrictTask, "gmQueue-district", extraArgs=[air])
