import re

from game.fairies.housing.HomeItems import clearPlacedHomeItems
from game.fairies.ai.StaffTiers import MODERATOR
from game.fairies.magicwords.registry import (
    CATEGORY_ACCOUNTS, SCOPE_ANY, command, splitOn,
)

DNA_HAIR_COLOR = 9
DNA_SKIN_COLOR = 12
DNA_WING_COLOR = 13

NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z' -]{1,29}$")


def setDnaSlot(ctx, slot: int, field: str, label: str) -> str:
    value = ctx.intArg(0)
    doId, live = ctx.fairyTarget(1)

    if live is not None:
        dna = list(live.getFairyDNA())
        dna[slot] = value
        live.b_setFairyDNA(tuple(dna))
        live.redrawFairy()
        return f"{label} set to {value} for fairy {doId} (updated live)"

    result = ctx.air.mongoInterface.mongodb.fairies.update_one(
        {"_id": doId}, {"$set": {f"avatar.{field}": value}})
    if result.matched_count == 0:
        ctx.fail(f"no fairy {doId}")
    return f"{label} set to {value} for fairy {doId} (offline -- they'll see it next login)"


@command("set-wing-color", "set-wing-color <colorId> <fairy>", tier=MODERATOR, scope=SCOPE_ANY, requiredTargetIndex=1,
         description="Change a fairy's wing color.")
def setWingColor(ctx) -> str:
    return setDnaSlot(ctx, DNA_WING_COLOR, "wing_color", "wing color")


@command("set-skin-color", "set-skin-color <colorId> <fairy>", tier=MODERATOR, scope=SCOPE_ANY, requiredTargetIndex=1,
         description="Change a fairy's skin color.")
def setSkinColor(ctx) -> str:
    return setDnaSlot(ctx, DNA_SKIN_COLOR, "skin_color", "skin color")


@command("set-hair-color", "set-hair-color <colorId> <fairy>", scope=SCOPE_ANY, requiredTargetIndex=1,
         description="Change a fairy's hair color.")
def setHairColor(ctx) -> str:
    return setDnaSlot(ctx, DNA_HAIR_COLOR, "hair_color", "hair color")


def nameTargetOf(args: list[str]) -> str | None:
    split = splitOn(args, "to")
    if split is None or not split[0]:
        return None
    return " ".join(split[0])


@command("set-fairy-name", "set-fairy-name <fairy> to <new name>", tier=MODERATOR, scope=SCOPE_ANY, targetOf=nameTargetOf,
         description="Rename a fairy. Other players see the new name in chat after the fairy logs in again.")
def setFairyName(ctx) -> str:
    split = splitOn(ctx.args, "to")
    if split is None or not split[0] or not split[1]:
        ctx.fail(f"usage: {ctx.usage}")
    newName = " ".join(split[1]).strip()
    if not NAME_PATTERN.match(newName):
        ctx.fail("names are 2 to 30 letters, spaces, apostrophes or hyphens, starting with a letter")

    doId, live = ctx.fairyNamed(" ".join(split[0]))
    fairies = ctx.air.mongoInterface.mongodb.fairies
    taken = fairies.find_one(
        {"name": {"$regex": f"^{re.escape(newName)}$", "$options": "i"}, "_id": {"$ne": doId}}, {"_id": 1})
    if taken:
        ctx.fail(f"another fairy is already named {newName!r}")

    fairies.update_one({"_id": doId}, {"$set": {"name": newName}})
    if live is not None:
        live.b_setName(newName)
        return f"renamed fairy {doId} to {newName} (updated live)"
    return f"renamed fairy {doId} to {newName}"


@command("set-home", "set-home <homeTypeId 1-26> <fairy>", scope=SCOPE_ANY, requiredTargetIndex=1,
         description="Give a fairy a different house. Placed furniture goes back to storage.")
def setHome(ctx) -> str:
    homeType = ctx.intArg(0)
    doId, live = ctx.fairyTarget(1)

    clearPlacedHomeItems(ctx.air, doId)
    ctx.air.mongoInterface.updateField("fairies", "homeType", doId, homeType)
    if live is not None:
        live.b_setHomeType(homeType)
        return f"home type set to {homeType} for fairy {doId} (updated live)"
    return f"home type set to {homeType} for fairy {doId}"


def changeGold(ctx, delta: int) -> str:
    doId, live = ctx.fairyTarget(1)

    if live is not None:
        newGold = max(0, live.getGold() + delta)
        live.b_setGold(newGold)
        return f"gold for fairy {doId} is now {newGold} (updated live)"

    fairies = ctx.air.mongoInterface.mongodb.fairies
    fairy = fairies.find_one({"_id": doId}, {"gold": 1})
    if fairy is None:
        ctx.fail(f"no fairy {doId}")
    newGold = max(0, int(fairy.get("gold", 0)) + delta)
    fairies.update_one({"_id": doId}, {"$set": {"gold": newGold}})
    return f"gold for fairy {doId} is now {newGold}"


@command("give-gold", "give-gold <amount> <fairy>", tier=MODERATOR, scope=SCOPE_ANY, requiredTargetIndex=1,
         category=CATEGORY_ACCOUNTS, description="Add gold (diamonds) to a fairy.")
def giveGold(ctx) -> str:
    amount = ctx.intArg(0)
    if amount <= 0:
        ctx.fail("amount has to be more than 0")
    return changeGold(ctx, amount)


@command("take-gold", "take-gold <amount> <fairy>", scope=SCOPE_ANY, requiredTargetIndex=1,
         category=CATEGORY_ACCOUNTS, description="Remove gold (diamonds) from a fairy. Never goes below 0.")
def takeGold(ctx) -> str:
    amount = ctx.intArg(0)
    if amount <= 0:
        ctx.fail("amount has to be more than 0")
    return changeGold(ctx, -amount)
