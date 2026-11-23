from game.fairies.ai import AccountControl, ZoneConstants
from game.fairies.ai.StaffTiers import MODERATOR
from game.fairies.fairy import PuppetControl
from game.fairies.fairy.DistributedFamousFairyGMAI import MAX_ORB_SIZE, DistributedFamousFairyGMAI
from game.fairies.magicwords.registry import (
    CATEGORY_PUPPETS, SCOPE_ANY_DISTRICT, SCOPE_DISTRICT, SCOPE_GLOBAL, command, splitOn,
)


def meadowNames() -> dict[int, str]:
    names = {}
    for key, value in vars(ZoneConstants).items():
        if key.isupper() and isinstance(value, int) and value in ZoneConstants.MEADOW_ZONES_LIST:
            names.setdefault(value, key.replace("_", " ").title())
    return names


def findMeadow(ctx, token: str) -> int:
    names = meadowNames()
    if token.isdigit():
        zoneId = int(token)
    else:
        wanted = token.lower().replace(" ", "")
        zoneId = next((zone for zone, name in names.items() if name.lower().replace(" ", "") == wanted), 0)
    if zoneId not in ctx.air.zoneToMeadow or zoneId not in ZoneConstants.MEADOW_ZONES_LIST:
        ctx.fail(f"{token!r} isn't a meadow -- try list-meadows")
    return zoneId


def famousTarget(ctx, token: str):
    doId, live = ctx.fairyNamed(token)
    if not isinstance(live, DistributedFamousFairyGMAI):
        ctx.fail(f"{token} isn't a famous fairy in play here")
    return live


def splitTarget(word: str):
    def targetOf(args: list[str]) -> str | None:
        split = splitOn(args, word)
        return " ".join(split[0]) if split and split[0] else None
    return targetOf


@command("famous-fairies", "famous-fairies", tier=MODERATOR, scope=SCOPE_GLOBAL, category=CATEGORY_PUPPETS,
         description="List the famous fairies, and which are out as puppets right now.")
def famousFairiesList(ctx) -> str:
    fairies = PuppetControl.famousFairies(ctx.air)
    if not fairies:
        return "no famous fairies yet -- run db-maintenance/create-famous-fairies.js"
    out = {doc["_id"]: doc for doc in PuppetControl.puppets(ctx.air).find({})}
    names = meadowNames()
    lines = []
    for fairy in fairies:
        puppet = out.get(fairy["_id"])
        where = f"puppet in {names.get(puppet['zoneId'], puppet['zoneId'])}" if puppet else "resting"
        lines.append(f"{fairy.get('name')} ({fairy.get('ownerAccount')}): {where}")
    return "\n".join(lines)


@command("list-meadows", "list-meadows", tier=MODERATOR, scope=SCOPE_ANY_DISTRICT, category=CATEGORY_PUPPETS,
         description="List the meadows a puppet can be summoned to.")
def listMeadows(ctx) -> str:
    names = meadowNames()
    return "\n".join(f"{zone}: {names.get(zone, '?')}" for zone in ZoneConstants.MEADOW_ZONES_LIST if zone in ctx.air.zoneToMeadow)


@command("puppet-summon", "puppet-summon <famous fairy> in <meadow name or zoneId>", tier=MODERATOR,
         scope=SCOPE_ANY_DISTRICT, category=CATEGORY_PUPPETS,
         description="Bring a famous fairy into a meadow as a puppet the portal controls. Nobody needs to log in.")
def puppetSummon(ctx) -> str:
    split = splitOn(ctx.args, "in")
    if split is None or not split[0] or not split[1]:
        ctx.fail(f"usage: {ctx.usage}")
    zoneId = findMeadow(ctx, " ".join(split[1]))
    fairyDoId, live = ctx.fairyNamed(" ".join(split[0]))

    fairy = ctx.air.mongoInterface.mongodb.fairies.find_one({"_id": fairyDoId})
    if not fairy or not fairy.get("famousFairy"):
        ctx.fail(f"{fairy.get('name') if fairy else fairyDoId} isn't a famous fairy")
    if live is not None or PuppetControl.isPuppet(ctx.air, fairyDoId):
        ctx.fail(f"{fairy.get('name')} is already out -- dismiss them first")
    account = AccountControl.accountForFairyDoc(ctx.air, fairy)
    if account is None:
        ctx.fail(f"{fairy.get('name')} has no account")

    meadow = ctx.air.zoneToMeadow[zoneId]
    PuppetControl.activatePuppet(ctx.air, fairy, account, meadow.parentId, zoneId)
    return f"summoned {fairy.get('name')} to {meadowNames().get(zoneId, zoneId)}"


@command("puppet-say", "puppet-say <famous fairy> says <message>", tier=MODERATOR, scope=SCOPE_DISTRICT,
         targetOf=splitTarget("says"), category=CATEGORY_PUPPETS,
         description="Make a famous fairy say something in their meadow.")
def puppetSay(ctx) -> str:
    split = splitOn(ctx.args, "says")
    if split is None or not split[0] or not split[1]:
        ctx.fail(f"usage: {ctx.usage}")
    puppet = famousTarget(ctx, " ".join(split[0]))
    message = " ".join(split[1])
    puppet.puppetSay(message)
    return f"{puppet.getName()}: {message}"


@command("puppet-emote", "puppet-emote <emoteId> <famous fairy>", tier=MODERATOR, scope=SCOPE_DISTRICT,
         requiredTargetIndex=1, category=CATEGORY_PUPPETS,
         description="Play a SpeedChat emote on a famous fairy.")
def puppetEmote(ctx) -> str:
    emoteId = ctx.intArg(0)
    puppet = famousTarget(ctx, ctx.tail(1))
    puppet.puppetEmote(emoteId)
    return f"{puppet.getName()} played emote {emoteId}"


@command("puppet-move", "puppet-move <x> <y> <famous fairy>", tier=MODERATOR, scope=SCOPE_DISTRICT,
         requiredTargetIndex=2, category=CATEGORY_PUPPETS,
         description="Fly a summoned puppet to a spot in its meadow.")
def puppetMove(ctx) -> str:
    x, y = ctx.intArg(0), ctx.intArg(1)
    if x < 0 or y < 0:
        ctx.fail("x and y can't be negative")
    puppet = famousTarget(ctx, ctx.tail(2))
    if not PuppetControl.isPuppet(ctx.air, puppet.doId):
        ctx.fail(f"{puppet.getName()} is being played by someone logged in -- they move themselves")
    puppet.puppetMove(x, y)
    return f"{puppet.getName()} is flying to {x}, {y}"


@command("puppet-orb", "puppet-orb <size 0-255> <famous fairy>", tier=MODERATOR, scope=SCOPE_DISTRICT,
         requiredTargetIndex=1, category=CATEGORY_PUPPETS,
         description="Set the glowing orb that keeps other fairies back. 0 turns it off.")
def puppetOrb(ctx) -> str:
    size = ctx.intArg(0)
    if not 0 <= size <= MAX_ORB_SIZE:
        ctx.fail(f"orb size must be between 0 and {MAX_ORB_SIZE}")
    puppet = famousTarget(ctx, ctx.tail(1))
    puppet.b_setOrbSize(size)
    return f"{puppet.getName()}'s orb is now {size}" if size else f"{puppet.getName()}'s orb is off"


@command("puppet-dismiss", "puppet-dismiss <famous fairy>", tier=MODERATOR, scope=SCOPE_DISTRICT,
         requiredTargetIndex=0, category=CATEGORY_PUPPETS,
         description="Send a summoned puppet away.")
def puppetDismiss(ctx) -> str:
    puppet = famousTarget(ctx, ctx.tail(0))
    if not PuppetControl.isPuppet(ctx.air, puppet.doId):
        ctx.fail(f"{puppet.getName()} is being played by someone logged in -- kick them instead")
    name = puppet.getName()
    PuppetControl.dismissPuppet(ctx.air, puppet)
    return f"dismissed {name}"
