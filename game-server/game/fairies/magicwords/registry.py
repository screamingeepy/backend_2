from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

from game.fairies.ai import AccountControl, StaffTiers


class MagicWordError(Exception):
    pass
# Where a command has to run, for the GM-portal queue (game/fairies/magicwords/
# queue.py). SCOPE_GLOBAL is claimed by the uberdog, a singleton so there is no
# race; SCOPE_DISTRICT is claimed by whichever district actually holds the
# command's target fairy in its doId2do. Almost every command acts on a
# specific fairy, so district is the default -- global is only for things with
# no live-object target at all (an account-level lookup, a ban).
SCOPE_GLOBAL = "global"
SCOPE_DISTRICT = "district"
SCOPE_ANY = "any"
SCOPE_ANY_DISTRICT = "anydistrict"

CATEGORY_MODERATION = "moderation"
CATEGORY_ACCOUNTS = "accounts"
CATEGORY_DEBUG = "debug"
CATEGORY_PUPPETS = "puppets"
CATEGORIES = (CATEGORY_MODERATION, CATEGORY_ACCOUNTS, CATEGORY_DEBUG, CATEGORY_PUPPETS)


@dataclass(frozen=True)
class Command:
    name: str
    usage: str
    handler: Callable[["Context"], str | None]
    tier: str
    scope: str
    targetArgCount: int | None = None
    requiredTargetIndex: int | None = None
    category: str = CATEGORY_DEBUG
    description: str = ""
    hidden: bool = False
    targetOf: Callable[[list[str]], str | None] | None = None


_COMMANDS: dict[str, Command] = {}


def command(name: str, usage: str = "", tier: str = StaffTiers.ADMINISTRATOR,
           scope: str = SCOPE_DISTRICT, targetArgCount: int | None = None,
           requiredTargetIndex: int | None = None, category: str = CATEGORY_DEBUG,
           description: str = "", hidden: bool = False,
           targetOf: Callable[[list[str]], str | None] | None = None):
    def register(handler: Callable[["Context"], str | None]) -> Callable:
        if name in _COMMANDS:
            raise ValueError(f"magic word {name!r} is already registered")

        allowedTiers = (StaffTiers.MODERATOR, StaffTiers.ADMINISTRATOR)
        if hidden:
            allowedTiers += (StaffTiers.PLAYER,)

        if tier not in allowedTiers:
            raise ValueError(f"magic word {name!r} has an unusable tier {tier!r}")

        if scope not in (SCOPE_GLOBAL, SCOPE_DISTRICT, SCOPE_ANY, SCOPE_ANY_DISTRICT):
            raise ValueError(f"magic word {name!r} has an unusable scope {scope!r}")

        if category not in CATEGORIES:
            raise ValueError(f"magic word {name!r} has an unusable category {category!r}")

        if targetArgCount is not None and requiredTargetIndex is not None:
            raise ValueError(f"magic word {name!r} can't set both targetArgCount and requiredTargetIndex")

        _COMMANDS[name] = Command(
            name, usage or name, handler, tier, scope, targetArgCount, requiredTargetIndex,
            category, description, hidden, targetOf)
        return handler

    return register


def get(name: str) -> Command | None:
    return _COMMANDS.get(name)


def names() -> list[str]:
    return sorted(_COMMANDS)


def snapshot() -> list[dict]:
    return [
        {"name": cmd.name, "usage": cmd.usage, "tier": cmd.tier, "scope": cmd.scope,
         "category": cmd.category, "description": cmd.description}
        for cmd in (get(name) for name in names())
        if not cmd.hidden
    ]


def targetToken(cmd: Command, args: list[str]) -> str | None:
    if cmd.targetOf is not None:
        return cmd.targetOf(args)

    if cmd.requiredTargetIndex is not None:
        if len(args) > cmd.requiredTargetIndex:
            return " ".join(args[cmd.requiredTargetIndex:])
        return None

    if cmd.targetArgCount is not None:
        if len(args) > cmd.targetArgCount:
            return args[cmd.targetArgCount]
        return None

    return None


def splitOn(args: list[str], word: str) -> tuple[list[str], list[str]] | None:
    lowered = [arg.lower() for arg in args]
    if word not in lowered:
        return None
    index = lowered.index(word)
    return args[:index], args[index + 1:]


def resolveFairyToken(air, token: str) -> int:

    if token.isdigit():
        doId = int(token)

        if not air.mongoInterface.mongodb.fairies.find_one({"_id": doId}, {"_id": 1}):
            raise MagicWordError(f"no fairy with doId {doId}")

        return doId

    # Names are stored as typed; match without case so a GM doesn't have to
    # guess it. Anchored so "Rose" can't pick up "Rosetta". Fairies may share a
    # name, so more than one match is an error and not a coin flip, and a
    # soft-deleted fairy isn't reachable by name (its doId still is).
    matches = list(air.mongoInterface.mongodb.fairies.find(
        {"name": {"$regex": f"^{re.escape(token)}$", "$options": "i"}, "deleted": {"$ne": True}},
        {"_id": 1, "ownerAccount": 1, "accountId": 1, "level": 1},
    ).limit(6))

    if not matches:
        raise MagicWordError(f"no fairy named {token!r}")

    if len(matches) > 1:
        raise MagicWordError(AccountControl.ambiguousNameMessage(token, matches))

    return matches[0]["_id"]


class Context:

    def __init__(self, air, avatar, name: str, args: list[str], zoneId: int) -> None:
        self.air = air
        self.avatar = avatar
        self.name = name
        self.args = args
        self.zoneId = zoneId

    @property
    def tier(self) -> str:
        queuedTier = getattr(self.avatar, "queuedTier", None)
        if queuedTier is not None:
            return queuedTier
        return self.air.getAccountType(self.avatar.getDISLid())

    @property
    def usage(self) -> str:
        cmd = get(self.name)
        return cmd.usage if cmd else self.name

    def fail(self, message: str) -> None:
        raise MagicWordError(message)

    # ── arguments ─────────────────────────────────────────────────────────── #

    def arg(self, index: int) -> str:
        if index >= len(self.args):
            self.fail(f"not enough arguments -- usage: {self.usage}")

        return self.args[index]

    def intArg(self, index: int) -> int:
        value = self.arg(index)

        try:
            return int(value)
        except ValueError:
            self.fail(f"{value!r} is not a number -- usage: {self.usage}")

    def optIntArg(self, index: int, default: int) -> int:
        if index >= len(self.args):
            return default

        return self.intArg(index)

    def tail(self, index: int) -> str:
        if index >= len(self.args):
            self.fail(f"not enough arguments -- usage: {self.usage}")

        return " ".join(self.args[index:])

    # ── other fairies ─────────────────────────────────────────────────────── #

    def targetId(self, index: int) -> int:
        return resolveFairyToken(self.air, self.tail(index))

    def onlineTarget(self, index: int) -> object:
        doId = self.targetId(index)
        avatar = self.air.doId2do.get(doId)

        if avatar is None:
            self.fail(f"fairy {doId} is not on this district")

        return avatar

    def fairyTarget(self, index: int) -> tuple[int, object | None]:
        doId = self.targetId(index)
        return doId, self.air.doId2do.get(doId)

    def fairyNamed(self, token: str) -> tuple[int, object | None]:
        doId = resolveFairyToken(self.air, token)
        return doId, self.air.doId2do.get(doId)

    def actingOn(self, requiredArgCount: int) -> object:
        if len(self.args) > requiredArgCount:
            token = self.arg(requiredArgCount)
            if not token.isdigit():
                self.fail(
                    f"this command needs a fairy's doId, not a name (got {token!r}) -- "
                    f"run 'whois {token}' to get their doId -- usage: {self.usage}"
                )
            return self.onlineTarget(requiredArgCount)

        return self.avatar

    def actingOnId(self, requiredArgCount: int) -> int:
        if len(self.args) > requiredArgCount:
            token = self.arg(requiredArgCount)
            if not token.isdigit():
                self.fail(
                    f"this command needs a fairy's doId, not a name (got {token!r}) -- "
                    f"run 'whois {token}' to get their doId -- usage: {self.usage}"
                )
            return self.targetId(requiredArgCount)

        return self.avatar.doId


def dispatch(air, avatar, magicWord: str, zoneId: int) -> str:
    parts = magicWord.split()

    if not parts:
        raise MagicWordError("empty magic word")

    name = parts[0].lower()
    cmd = get(name)

    if cmd is None:
        raise MagicWordError(f"unknown magic word {name!r}")

    ctx = Context(air, avatar, name, parts[1:], zoneId)
    tier = ctx.tier
    
    if StaffTiers.rank(tier) < StaffTiers.rank(cmd.tier):
        raise MagicWordError(
            f"{name} needs {cmd.tier}; this account is {tier}"
            + (" -- log in again if you were just granted it" if tier == StaffTiers.PLAYER else "")
        )

    response = cmd.handler(ctx)

    return response if response is not None else f"{name}: ok"
