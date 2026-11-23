"""
Magic words that change a fairy's DNA, stats, house or daily spin.

Every one of these acts on whoever typed it unless a fairy's doId trails the
command's own arguments (Context.actingOn) -- "set-level 10" changes your own
level from the console; "set-level 10 5000123456" changes that fairy's level
instead, which is what makes these usable from the GM-portal queue, where
there is no "yourself" to fall back to at all.
"""

from game.fairies.housing.HomeItems import clearPlacedHomeItems
from game.fairies.magicwords.registry import command

# Slot indices into FairyDNA, in the order set-hair takes them. The client's
# character creator picks a back and a front hairpiece plus one color for both
# (CAFSceneBody's hairback/hairfront selectors and its single hairPicker), and
# these are the DNA fields those three land in.
DNA_HAIR_BACK = 4
DNA_HAIR_FRONT = 5
DNA_HAIR_COLOR = 9


# @command("set-level", "set-level <level> [fairy]", targetArgCount=1)
# def setLevel(ctx) -> str:
#     level = ctx.intArg(0)
#     target = ctx.actingOn(1)

#     # setLevel is `db`, so the broadcast persists through the DBSS bridge.
#     target.b_setLevel(level)

#     return f"level set to {level} for fairy {target.doId}"


# @command("set-pixie-dust", "set-pixie-dust <amount> [fairy]", targetArgCount=1)
# def setPixieDust(ctx) -> str:
#     amount = ctx.intArg(0)
#     target = ctx.actingOn(1)
#     cap = target.getPixieDustCap()
#     dust = max(0, min(amount, cap))

#     # setPixiePower is `db`, so the broadcast persists through the DBSS bridge.
#     target.b_setPixiePower(dust)

#     if dust != amount:
#         return f"pixie dust set to {dust} for fairy {target.doId} (capped at {cap} for level {target.getLevel()})"

#     return f"pixie dust set to {dust} for fairy {target.doId}"


# @command("set-experience-points", "set-experience-points <points> [fairy]", targetArgCount=1)
# def setExperiencePoints(ctx) -> str:
#     points = ctx.intArg(0)
#     target = ctx.actingOn(1)

#     target.b_setExperiencePoints(points)

#     # This is a live poke at the pixie dust meter and the level-up
#     # panel, nothing more right now -- it is gone at the next login.
#     return f"experience set to {points} for fairy {target.doId} (not persisted -- session only)"


# @command("set-hair", "set-hair <hairBack> <hairFront> <hairColor> [fairy]", targetArgCount=3)
# def setHair(ctx) -> str:
#     hairBack = ctx.intArg(0)
#     hairFront = ctx.intArg(1)
#     hairColor = ctx.intArg(2)
#     target = ctx.actingOn(3)

#     dna = list(target.getFairyDNA())
#     dna[DNA_HAIR_BACK] = hairBack
#     dna[DNA_HAIR_FRONT] = hairFront
#     dna[DNA_HAIR_COLOR] = hairColor

#     target.b_setFairyDNA(tuple(dna))
#     target.redrawFairy()

#     return f"hair set to back={hairBack} front={hairFront} color={hairColor} for fairy {target.doId}"


@command("dye-item", "dye-item <invId> <color1> <color2> [fairy]", targetArgCount=3)
def dyeItem(ctx) -> str:
    invId = ctx.intArg(0)
    color1 = ctx.intArg(1)
    color2 = ctx.intArg(2)
    target = ctx.actingOn(3)

    # -1 in either slot means "leave this one alone", matching the shop's
    # setRequestDyeItem. The client's dye-item always sends both, but a GM
    # recolouring one half of an item shouldn't have to restate the other.
    fields = {}

    if color1 != -1:
        fields["avatar.items.$.color1"] = color1

    if color2 != -1:
        fields["avatar.items.$.color2"] = color2

    if not fields:
        ctx.fail("nothing to dye -- both colors were -1")

    result = ctx.air.mongoInterface.mongodb.fairies.update_one(
        {"_id": target.doId, "avatar.items.inv_id": invId},
        {"$set": fields},
    )

    if result.matched_count == 0:
        ctx.fail(f"no item with invId {invId}")

    # Only an equipped item has anything to redraw; a wardrobe entry just shows
    # its new colors the next time the panel reads it.
    target.d_refreshEquippedItem(invId)

    return f"dyed item {invId} to {color1}/{color2} for fairy {target.doId}"


# @command("set-home-type-id", "set-home-type-id <homeTypeId> [fairy]", targetArgCount=1)
# def setHomeTypeId(ctx) -> str:
#     homeType = ctx.intArg(0)
#     target = ctx.actingOn(1)

#     # Same two steps the shop's purchaseHomeType takes: empty the old house out
#     # (placed furniture is laid out against the old floorplan and has nowhere to
#     # go in the new one) and persist by hand, because b_setHomeType only reaches
#     # the client and _defaultHomeType reads the database on the next login.
#     if target.getHomeType() != homeType:
#         clearPlacedHomeItems(ctx.air, target.doId)

#     ctx.air.mongoInterface.updateField(
#         "fairies", "homeType", target.doId, homeType
#     )
#     target.b_setHomeType(homeType)

#     return f"home type set to {homeType} for fairy {target.doId} (placed items returned to storage)"


# @command("tryon", "tryon <itemIndex> <collectionId> [fairy]", targetArgCount=2)
# def tryOn(ctx) -> str:
#     from game.fairies.fairy.npc.DistributedFairyShopkeeperNPCAI import (
#         DistributedFairyShopkeeperNPCAI,
#     )

#     itemIndex = ctx.intArg(0)
#     collectionId = ctx.intArg(1)
#     target = ctx.actingOn(2)

#     # setTriedOnItems is a field on the shopkeeper, so there has to be one in
#     # the room -- the client's try-on mirror is part of the shop panel.
#     shopkeeper = next(
#         (do for do in ctx.air.doId2do.values()
#          if isinstance(do, DistributedFairyShopkeeperNPCAI) and do.zoneId == target.zoneId),
#         None,
#     )

#     if shopkeeper is None:
#         ctx.fail(f"fairy {target.doId} is not standing in a shop")

#     shopkeeper.sendUpdateToAvatarId(
#         target.doId, "setTriedOnItems",
#         [[(target.doId, [(itemIndex, collectionId)])]],
#     )

#     return f"trying on item {itemIndex} from collection {collectionId} for fairy {target.doId}"


# @command("daily-chance", "daily-chance [fairy]", targetArgCount=0)
# def dailyChance(ctx) -> str:
#     target = ctx.actingOn(0)

#     # Clear today's spin first so the command always spins, rather than doing
#     # nothing on the second use of the day -- testing the wheel is the whole
#     # point of asking for it from a console.
#     ctx.air.mongoInterface.updateField(
#         "fairies", "dailyChanceLastSpin", target.doId, None
#     )

#     # excludeMask 0: the client normally works out whether there is wardrobe or
#     # storage room and passes it in. Zero means "no restrictions", so a GM can
#     # win anything on the wheel.
#     target.doDailyChance(0)

#     return f"spun the daily chance wheel for fairy {target.doId}"


# @command("set-daily-chance", "set-daily-chance <0|1> [fairy]", targetArgCount=1)
# def setDailyChance(ctx) -> str:
#     played = ctx.intArg(0)
#     target = ctx.actingOn(1)

#     if played:
#         target.recordDailyChanceSpin()
#         return f"daily chance marked as played for today for fairy {target.doId}"

#     ctx.air.mongoInterface.updateField(
#         "fairies", "dailyChanceLastSpin", target.doId, None
#     )
#     target.b_setDailyChancePlayed(0)

#     return f"daily chance reset for fairy {target.doId} -- the wheel is available again"
