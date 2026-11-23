from game.fairies.fairy.ItemGrant import STORAGE, WARDROBE, grant_item
from game.fairies.ai.FairiesConstants import DYE_ITEM_ID_OFFSET
from game.fairies.magicwords.registry import MagicWordError, SCOPE_ANY, SCOPE_GLOBAL, command


@command("get-home-item", "get-home-item <itemId> [color1] [color2]", scope=SCOPE_GLOBAL, hidden=True)
def getHomeItem(ctx) -> str:
    itemId, color1, color2 = _readItemArgs(ctx, len(ctx.args))

    return _grant(ctx, ctx.avatar.doId, itemId, color1, color2, STORAGE, "storage")


@command("give-home-item", "give-home-item <itemId> [color1] [color2] <fairy>", scope=SCOPE_GLOBAL)
def giveHomeItem(ctx) -> str:
    return _grantToTarget(ctx, STORAGE, "storage")


@command("get-wardrobe-item", "get-wardrobe-item <itemId> [color1] [color2]", scope=SCOPE_GLOBAL, hidden=True)
def getWardrobeItem(ctx) -> str:
    itemId, color1, color2 = _readItemArgs(ctx, len(ctx.args))

    return _grant(ctx, ctx.avatar.doId, itemId, color1, color2, WARDROBE, "wardrobe")


@command("give-wardrobe-item", "give-wardrobe-item <itemId> [color1] [color2] <fairy>", scope=SCOPE_GLOBAL)
def giveWardrobeItem(ctx) -> str:
    return _grantToTarget(ctx, WARDROBE, "wardrobe")


def _readItemArgs(ctx, upTo: int) -> tuple[int, int, int]:
    """itemId plus the two optional colors, reading no further than `upTo`."""
    itemId = ctx.intArg(0)
    color1 = ctx.optIntArg(1, 0) if upTo > 1 else 0
    color2 = ctx.optIntArg(2, 0) if upTo > 2 else 0

    return itemId, color1, color2


def _grant(ctx, avatarId: int, itemId: int, color1: int, color2: int, where, label: str) -> str:
    try:
        invId = grant_item(ctx.air, avatarId, itemId, color1, color2, where)
    except ValueError as e:
        # get_item_type refuses an id it can't bucket into an item type.
        raise MagicWordError(str(e)) from e

    if not invId:
        ctx.fail(f"could not add item {itemId} to fairy {avatarId}")

    return f"gave {label} item {itemId} to {avatarId} as invId {invId}"


def _grantToTarget(ctx, where, label: str) -> str:
    nameStart = _targetStart(ctx)
    itemId, color1, color2 = _readItemArgs(ctx, min(nameStart, 3))
    targetId = ctx.targetId(nameStart)

    return _grant(ctx, targetId, itemId, color1, color2, where, label)


def nameStartIn(args: list[str]) -> int | None:
    start = len(args)
    while start > 1 and not _isInt(args[start - 1]):
        start -= 1
    if start == len(args):
        start = len(args) - 1
    return start if start >= 1 else None


def _targetStart(ctx) -> int:
    args = ctx.args
    start = len(args)

    while start > 1 and not _isInt(args[start - 1]):
        start -= 1

    if start == len(args):
        start = len(args) - 1

    if start < 1:
        ctx.fail(f"no fairy named -- usage: {ctx.usage}")

    return start


def _isInt(token: str) -> bool:
    try:
        int(token)
    except ValueError:
        return False

    return True


@command("get-pouch-item", "get-pouch-item <itemId> [amount]", scope=SCOPE_GLOBAL, hidden=True)
def getPouchItem(ctx) -> str:
    itemId = ctx.intArg(0)
    amount = ctx.optIntArg(1, 1)

    # The feedback flavour also fires the client's pickup sparkle and resyncs
    # the pouch, which is what the fairy would see picking one up in a meadow.
    if not ctx.air.inventoryManager.addIngredientsToPouchWithPickupFeedback(
        ctx.avatar.doId, itemId, amount
    ):
        ctx.fail(f"could not add {amount}x{itemId} to the pouch")

    return f"gave {amount}x pouch item {itemId}"


def pouchTargetOf(args: list[str]) -> str | None:
    start = nameStartIn(args)
    return " ".join(args[start:]) if start is not None else None


@command("give-pouch-item", "give-pouch-item <itemId> [amount] <fairy>", scope=SCOPE_ANY,
         targetOf=pouchTargetOf, description="Add ingredients or other pouch items to a fairy's pouch.")
def givePouchItem(ctx) -> str:
    itemId = ctx.intArg(0)
    nameStart = _targetStart(ctx)
    amount = ctx.optIntArg(1, 1) if nameStart > 1 else 1
    return changePouch(ctx, itemId, amount, nameStart)


@command("remove-pouch-item", "remove-pouch-item <itemId> <amount> <fairy>", scope=SCOPE_ANY,
         requiredTargetIndex=2, description="Take ingredients or other pouch items out of a fairy's pouch.")
def removePouchItem(ctx) -> str:
    return changePouch(ctx, ctx.intArg(0), -ctx.intArg(1), 2)


@command("give-dye", "give-dye <colorId> <amount> <fairy>", scope=SCOPE_ANY, requiredTargetIndex=2,
         description="Add dye bottles of one color to a fairy's pouch.")
def giveDye(ctx) -> str:
    return changePouch(ctx, DYE_ITEM_ID_OFFSET + ctx.intArg(0), ctx.intArg(1), 2)


@command("remove-dye", "remove-dye <colorId> <amount> <fairy>", scope=SCOPE_ANY, requiredTargetIndex=2,
         description="Take dye bottles of one color out of a fairy's pouch.")
def removeDye(ctx) -> str:
    return changePouch(ctx, DYE_ITEM_ID_OFFSET + ctx.intArg(0), -ctx.intArg(1), 2)


def changePouch(ctx, itemId: int, amount: int, nameStart: int) -> str:
    targetId, live = ctx.fairyTarget(nameStart)
    if amount == 0:
        ctx.fail("amount can't be 0")

    if amount > 0:
        if not ctx.air.inventoryManager.addIngredientsToPouch(targetId, itemId, amount, -1):
            ctx.fail(f"could not add {amount}x{itemId} to fairy {targetId}'s pouch")
        result = f"gave {amount}x pouch item {itemId} to {targetId}"
    else:
        held = pouchAmount(ctx, targetId, itemId)
        taking = min(held, -amount)
        if taking <= 0:
            ctx.fail(f"fairy {targetId} has no pouch item {itemId}")
        if not ctx.air.inventoryManager.removeIngredientsFromPouch(targetId, itemId, taking):
            ctx.fail(f"could not remove pouch item {itemId} from fairy {targetId}")
        result = f"took {taking}x pouch item {itemId} from {targetId} ({held - taking} left)"

    if live is not None:
        live.d_syncPouchAfterChanges()
        return result + " (updated live)"
    return result + " (offline -- they'll see it next login)"


def pouchAmount(ctx, fairyId: int, itemId: int) -> int:
    fairy = ctx.air.mongoInterface.mongodb.fairies.find_one(
        {"_id": fairyId, "pouch.item_id": itemId}, {"pouch.$": 1})
    if not fairy or not fairy.get("pouch"):
        return 0
    return int(fairy["pouch"][0].get("amount", 0))


@command("remove-wardrobe-item", "remove-wardrobe-item <itemId> <fairy>", scope=SCOPE_GLOBAL,
         description="Take one piece of clothing (by item id) out of a fairy's wardrobe.")
def removeWardrobeItem(ctx) -> str:
    return removeItem(ctx, ("Wardrobe", "Equipped"), "wardrobeRemove", "wardrobe")


@command("remove-home-item", "remove-home-item <itemId> <fairy>", scope=SCOPE_GLOBAL,
         description="Take one piece of furniture (by item id) out of a fairy's storage.")
def removeHomeItem(ctx) -> str:
    return removeItem(ctx, ("Storage",), "storageRemove", "storage")


def removeItem(ctx, locations: tuple[str, ...], updateName: str, label: str) -> str:
    itemId = ctx.intArg(0)
    targetId = ctx.targetId(1)
    fairies = ctx.air.mongoInterface.mongodb.fairies
    fairy = fairies.find_one({"_id": targetId}, {"avatar.items": 1})
    items = ((fairy or {}).get("avatar") or {}).get("items", [])
    matches = [item for item in items if item.get("item_id") == itemId and item.get("location") in locations]
    if not matches:
        ctx.fail(f"fairy {targetId} has no {label} item {itemId}")
    matches.sort(key=lambda item: item.get("location") == "Equipped")
    invId = matches[0]["inv_id"]

    fairies.update_one({"_id": targetId}, {"$pull": {"avatar.items": {"inv_id": invId}}})
    ctx.air.inventoryManager.sendUpdateToAvatarId(targetId, updateName, [0, invId])

    note = " (it was being worn)" if matches[0].get("location") == "Equipped" else ""
    return f"removed {label} item {itemId} (invId {invId}) from {targetId}{note}"


@command("add-crafting-points", "add-crafting-points <recipeId> <points> [fairy]",
        scope=SCOPE_GLOBAL, targetArgCount=2)
def addCraftingPoints(ctx) -> str:
    return _addRecipePoints(ctx)


# The client's `add-tailoring-points` actually sends "add-crafting-points" (see
# LiveMod), so this only ever fires if something speaks to the manager directly.
# Registered anyway so the two names behave the same.
@command("add-tailoring-points", "add-tailoring-points <recipeId> <points> [fairy]",
        scope=SCOPE_GLOBAL, targetArgCount=2)
def addTailoringPoints(ctx) -> str:
    return _addRecipePoints(ctx)


def _addRecipePoints(ctx) -> str:
    recipeId = ctx.intArg(0)
    points = ctx.intArg(1)
    targetId = ctx.actingOnId(2)

    # Same shape a finished craft records (DistributedCraftingMinigameAI), so
    # the recipe card's craft count, best quality and running total all move.
    # The client updates its own copy of the card from LiveMod, so this is only
    # about what survives the session.
    ctx.air.mongoInterface.recordStat(targetId, "recipe", recipeId, points)

    return f"recorded {points} point(s) on recipe {recipeId} for fairy {targetId}"
