import datetime
import re

from direct.distributed.PyDatagram import PyDatagram

from game.fairies.ai.FairiesAIMsgTypes import ACCOUNT_SET_IGNORED, ACCOUNT_SET_MUTE
from game.otp.ai.AIMsgTypes import CLIENT_AGENT_EJECT

DISCONNECT_KICKED = 1
DISCONNECT_BANNED = 152

KICK_MESSAGE = "You have been removed from Pixie Hollow by a moderator."
BAN_MESSAGE = (
    "There has been a reported violation of our Terms of Use connected to this account. "
    "For safety purposes, we have placed a hold on the account."
)


def accountChannel(accountId: int) -> int:
    return accountId + (3 << 32)


def accounts(air):
    return air.mongoInterface.mongodb.accounts


def fairies(air):
    return air.mongoInterface.mongodb.fairies


class AmbiguousName(Exception):
    pass


# fairies are allowed to share a name, so a name alone can't be trusted to mean one of them
def ambiguousNameMessage(token: str, matches: list[dict]) -> str:
    rows = [
        f"  {m['_id']} - account {m.get('ownerAccount') or m.get('accountId') or '?'}"
        + (f", level {m['level']}" if m.get('level') is not None else "")
        for m in matches[:5]]
    if len(matches) > 5:
        rows.append("  ...and more")
    return (f"{len(matches)} fairies are named {token!r}:\n" + "\n".join(rows)
            + "\nRun it again with the fairy's doId instead.")


def findAccount(air, token: str) -> dict | None:
    token = token.strip()
    if not token:
        return None

    if token.isdigit():
        number = int(token)
        account = accounts(air).find_one({"_id": number})
        if account:
            return account
        fairy = fairies(air).find_one({"_id": number}, {"accountId": 1, "ownerAccount": 1})
        return accountForFairyDoc(air, fairy)

    pattern = {"$regex": f"^{re.escape(token)}$", "$options": "i"}
    named = list(fairies(air).find(
        {"name": pattern, "deleted": {"$ne": True}}, {"accountId": 1, "ownerAccount": 1, "level": 1}).limit(6))

    owners = {}
    for fairy in named:
        account = accountForFairyDoc(air, fairy)
        if account:
            owners[account["_id"]] = account

    # two of one account's fairies sharing a name still point at one account
    if len(owners) > 1:
        raise AmbiguousName(ambiguousNameMessage(token, named))
    if owners:
        return next(iter(owners.values()))

    return accounts(air).find_one({"username": pattern})


def accountForFairyDoc(air, fairy: dict | None) -> dict | None:
    if not fairy:
        return None
    if fairy.get("accountId"):
        account = accounts(air).find_one({"_id": fairy["accountId"]})
        if account:
            return account
    if fairy.get("ownerAccount"):
        return accounts(air).find_one({"username": fairy["ownerAccount"]})
    return None


def fairyForAccount(air, account: dict) -> dict | None:
    return fairies(air).find_one(
        {"$or": [{"accountId": account["_id"]}, {"ownerAccount": account.get("username")}]})


def fairiesForAccount(air, account: dict) -> list[dict]:
    return list(fairies(air).find(
        {"$or": [{"accountId": account["_id"]}, {"ownerAccount": account.get("username")}]}))


def describeAccount(air, account: dict) -> str:
    fairy = fairyForAccount(air, account)
    name = fairy.get("name") if fairy else None
    return f"{name} ({account.get('username')})" if name else account.get("username", str(account["_id"]))


def untilFromMinutes(minutes: int) -> datetime.datetime | None:
    if minutes <= 0:
        return None
    return datetime.datetime.utcnow() + datetime.timedelta(minutes=minutes)


def untilEpoch(until: datetime.datetime | None) -> int:
    if until is None:
        return 0
    return int(until.replace(tzinfo=datetime.timezone.utc).timestamp())


def ejectAccount(air, accountId: int, reason: int, message: str) -> None:
    dg = PyDatagram()
    dg.addServerHeader(accountChannel(accountId), air.ourChannel, CLIENT_AGENT_EJECT)
    dg.addUint16(reason)
    dg.addString(message)
    air.send(dg)


def pushMute(air, accountId: int, muted: bool, until: datetime.datetime | None, reason: str) -> None:
    dg = PyDatagram()
    dg.addServerHeader(accountChannel(accountId), air.ourChannel, ACCOUNT_SET_MUTE)
    dg.addUint8(1 if muted else 0)
    dg.addUint32(untilEpoch(until))
    dg.addString(reason or "")
    air.send(dg)


def pushIgnored(air, accountId: int, ignoredIds: list[int]) -> None:
    dg = PyDatagram()
    dg.addServerHeader(accountChannel(accountId), air.ourChannel, ACCOUNT_SET_IGNORED)
    dg.addUint16(len(ignoredIds))
    for ignoredId in ignoredIds:
        dg.addUint32(ignoredId)
    air.send(dg)


def ignoredBy(air, account: dict) -> list[int]:
    return [int(i) for i in account.get("ignored") or [] if str(i).isdigit()]


# the ignore list is the account's, so look up the account that fairy belongs to
def hasIgnored(air, targetFairyId: int, otherAccountId: int) -> bool:
    fairy = fairies(air).find_one({"_id": targetFairyId}, {"accountId": 1, "ownerAccount": 1})
    account = accountForFairyDoc(air, fairy)
    return account is not None and otherAccountId in ignoredBy(air, account)
