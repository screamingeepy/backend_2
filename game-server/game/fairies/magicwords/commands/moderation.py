from game.fairies.ai import AccountControl, StaffTiers
from game.fairies.ai.StaffTiers import MODERATOR, PLAYER
from game.fairies.magicwords.registry import (
    CATEGORY_MODERATION, SCOPE_GLOBAL, command, splitOn,
)

MUTED = 1
UNMUTED = 0


def readReason(ctx, args: list[str]) -> tuple[list[str], str]:
    split = splitOn(args, "for")
    if split is None:
        return args, ""
    target, reason = split
    return target, " ".join(reason)


def accountFrom(ctx, tokens: list[str]) -> dict:
    token = " ".join(tokens).strip()
    if not token:
        ctx.fail(f"name a fairy or Account ID -- usage: {ctx.usage}")
    try:
        account = AccountControl.findAccount(ctx.air, token)
    except AccountControl.AmbiguousName as exc:
        ctx.fail(str(exc))
    if account is None:
        ctx.fail(f"no fairy or account called {token!r}")
    return account


# an account below your own tier, never a peer and never yourself
def targetFrom(ctx, tokens: list[str]) -> dict:
    account = accountFrom(ctx, tokens)
    mine = ctx.avatar.getDISLid()
    theirs = account.get("accountType", StaffTiers.PLAYER)
    who = AccountControl.describeAccount(ctx.air, account)

    if account["_id"] == mine:
        ctx.fail(f"you can't {ctx.name} your own account")
    if StaffTiers.rank(ctx.tier) <= StaffTiers.rank(theirs):
        ctx.fail(f"{who} is {theirs}, and a {ctx.tier} can only {ctx.name} accounts below their own tier")

    return account


def untilText(until) -> str:
    return "until unmuted" if until is None else f"until {until:%b %d %H:%M} UTC"


@command("kick", "kick <fairy or Account ID>", tier=MODERATOR, scope=SCOPE_GLOBAL,
         category=CATEGORY_MODERATION, description="Disconnect a player right now. They can log back in.")
def kick(ctx) -> str:
    account = targetFrom(ctx, ctx.args)
    AccountControl.ejectAccount(ctx.air, account["_id"], AccountControl.DISCONNECT_KICKED, AccountControl.KICK_MESSAGE)
    return f"kicked {AccountControl.describeAccount(ctx.air, account)}"


@command("ban", "ban <days, 0 = forever> <fairy or Account ID> [for <reason>]", tier=MODERATOR,
         scope=SCOPE_GLOBAL, category=CATEGORY_MODERATION,
         description="Stop an account from logging in, and disconnect it if it's online.")
def ban(ctx) -> str:
    days = ctx.intArg(0)
    if days < 0:
        ctx.fail("days can't be negative")
    targetTokens, reason = readReason(ctx, ctx.args[1:])
    account = targetFrom(ctx, targetTokens)
    until = AccountControl.untilFromMinutes(days * 24 * 60)

    AccountControl.accounts(ctx.air).update_one({"_id": account["_id"]}, {"$set": {
        "banned": 1, "banUntil": until, "banReason": reason,
    }})
    AccountControl.ejectAccount(ctx.air, account["_id"], AccountControl.DISCONNECT_BANNED, AccountControl.BAN_MESSAGE)

    length = "forever" if until is None else f"for {days} day(s)"
    return f"banned {AccountControl.describeAccount(ctx.air, account)} {length}" + (f" for {reason}" if reason else "")


@command("unban", "unban <fairy or Account ID>", tier=MODERATOR, scope=SCOPE_GLOBAL,
         category=CATEGORY_MODERATION, description="Let a banned account log in again.")
def unban(ctx) -> str:
    account = targetFrom(ctx, ctx.args)
    AccountControl.accounts(ctx.air).update_one({"_id": account["_id"]}, {"$set": {
        "banned": 0, "banUntil": None, "banReason": "",
    }})
    return f"unbanned {AccountControl.describeAccount(ctx.air, account)}"


def setMute(ctx, account: dict, muted: bool, minutes: int, reason: str) -> str:
    until = AccountControl.untilFromMinutes(minutes) if muted else None
    AccountControl.accounts(ctx.air).update_one({"_id": account["_id"]}, {"$set": {
        "muted": MUTED if muted else UNMUTED, "mutedUntil": until, "muteReason": reason if muted else "",
    }})
    AccountControl.pushMute(ctx.air, account["_id"], muted, until, reason)

    who = AccountControl.describeAccount(ctx.air, account)
    if muted:
        return f"muted {who} {untilText(until)}" + (f" for {reason}" if reason else "")
    return f"unmuted {who}"


@command("mute-fairy", "mute-fairy [minutes, 0 = until unmuted] <fairy or Account ID> [for <reason>]",
         tier=MODERATOR, scope=SCOPE_GLOBAL, category=CATEGORY_MODERATION,
         description="Stop a player from chatting, whispering or group whispering. Lasts through logging out.")
def muteFairy(ctx) -> str:
    args = ctx.args
    minutes = 0
    if len(args) >= 2 and args[0].isdigit():
        minutes = int(args[0])
        args = args[1:]
    targetTokens, reason = readReason(ctx, args)
    return setMute(ctx, targetFrom(ctx, targetTokens), True, minutes, reason)


@command("unmute-fairy", "unmute-fairy <fairy or Account ID>", tier=MODERATOR, scope=SCOPE_GLOBAL,
         category=CATEGORY_MODERATION, description="Let a muted player chat again.")
def unmuteFairy(ctx) -> str:
    return setMute(ctx, targetFrom(ctx, ctx.args), False, 0, "")


@command("special-unmute-fairy", "special-unmute-fairy <fairy or Account ID>", tier=MODERATOR,
         scope=SCOPE_GLOBAL, category=CATEGORY_MODERATION, hidden=True)
def specialUnmuteFairy(ctx) -> str:
    return setMute(ctx, targetFrom(ctx, ctx.args), False, 0, "")


@command("mute-meadow", "mute-meadow", tier=MODERATOR, category=CATEGORY_MODERATION, hidden=True)
def muteMeadow(ctx) -> str:
    return setMeadowMute(ctx, MUTED)


@command("unmute-meadow", "unmute-meadow", tier=MODERATOR, category=CATEGORY_MODERATION, hidden=True)
def unmuteMeadow(ctx) -> str:
    return setMeadowMute(ctx, UNMUTED)


def setMeadowMute(ctx, mute: int) -> str:
    meadow = ctx.air.zoneToMeadow.get(ctx.avatar.zoneId)
    if meadow is None:
        ctx.fail(f"zone {ctx.avatar.zoneId} is not a meadow")
    meadow.sendUpdate("setMute", [mute])
    what = "muted" if mute else "unmuted"
    return f"{what} meadow {ctx.avatar.zoneId} for everyone in it"


@command("ignore-list", "ignore-list <fairy or Account ID>", tier=MODERATOR, scope=SCOPE_GLOBAL,
         category=CATEGORY_MODERATION, description="See who a player has ignored.")
def ignoreList(ctx) -> str:
    account = accountFrom(ctx, ctx.args)
    ignored = AccountControl.ignoredBy(ctx.air, account)
    who = AccountControl.describeAccount(ctx.air, account)
    if not ignored:
        return f"{who} hasn't ignored anyone"
    names = []
    for ignoredId in ignored:
        other = AccountControl.accounts(ctx.air).find_one({"_id": ignoredId})
        names.append(AccountControl.describeAccount(ctx.air, other) if other else str(ignoredId))
    return f"{who} has ignored: " + ", ".join(names)


@command("clear-ignores", "clear-ignores <fairy or Account ID>", tier=MODERATOR, scope=SCOPE_GLOBAL,
         category=CATEGORY_MODERATION, description="Empty a player's ignore list.")
def clearIgnores(ctx) -> str:
    account = targetFrom(ctx, ctx.args)
    fairy = AccountControl.fairyForAccount(ctx.air, account)
    if fairy is None:
        ctx.fail("that account has no fairy")
    AccountControl.fairies(ctx.air).update_one({"_id": fairy["_id"]}, {"$set": {"ignored": []}})
    AccountControl.pushIgnored(ctx.air, account["_id"], [])
    return f"cleared the ignore list of {AccountControl.describeAccount(ctx.air, account)}"


@command("sync-account", "sync-account <accountId>", tier=PLAYER, scope=SCOPE_GLOBAL,
         category=CATEGORY_MODERATION, hidden=True)
def syncAccount(ctx) -> str:
    account = AccountControl.accounts(ctx.air).find_one({"_id": ctx.intArg(0)})
    if account is None:
        ctx.fail("no such account")
    AccountControl.pushIgnored(ctx.air, account["_id"], AccountControl.ignoredBy(ctx.air, account))
    muted = bool(account.get("muted"))
    AccountControl.pushMute(ctx.air, account["_id"], muted, account.get("mutedUntil"), account.get("muteReason", ""))
    return f"synced account {account['_id']}"
