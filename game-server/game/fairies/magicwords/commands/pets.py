# magic words for a fairy's animal friend

from game.fairies.magicwords.registry import command
from game.fairies.pet import pet_state, pet_xml
from game.fairies.pet.pet_state import METER_MAX


def loadPetOrFail(ctx, target) -> dict:
    pet = pet_state.loadPetAndApplyDecay(ctx.air, target.doId)
    if not pet_state.hasPet(pet):
        ctx.fail(f"fairy {target.doId} doesn't have an Animal Friend")
    return pet


def setPetMeter(ctx, field: str) -> str:
    value = ctx.intArg(0)
    if field != "growth":
        value = max(0, min(METER_MAX, value))

    target = ctx.actingOn(1)
    pet = loadPetOrFail(ctx, target)
    pet[field] = max(0, value)
    pet_state.savePet(ctx.air, target.doId, pet)
    target.refreshPet(pet)
    return f"fairy {target.doId}'s pet {field} set to {pet[field]}"


# @command("set-pet-hunger", "set-pet-hunger <value> [fairy]", targetArgCount=1)
# def setPetHunger(ctx) -> str:
#     return setPetMeter(ctx, "hunger")


# @command("set-pet-health", "set-pet-health <value> [fairy]", targetArgCount=1)
# def setPetHealth(ctx) -> str:
#     return setPetMeter(ctx, "health")


# @command("set-pet-happiness", "set-pet-happiness <value> [fairy]", targetArgCount=1)
# def setPetHappiness(ctx) -> str:
#     return setPetMeter(ctx, "happiness")


# @command("set-pet-growth", "set-pet-growth <value> [fairy]", targetArgCount=1)
# def setPetGrowth(ctx) -> str:
#     return setPetMeter(ctx, "growth")


# no target declared, mask is already optional so a fairy id would be ambiguous
# @command("request-gift", "request-gift [mask]", hidden=True)
# def requestGift(ctx) -> str:
#     loadPetOrFail(ctx, ctx.avatar)
#     mask = ctx.intArg(0) if ctx.args else 0

#     gift = ctx.air.petManager.giveGift(ctx.avatar.doId, ctx.avatar, mask, force=True)
#     if gift is None:
#         ctx.fail("no gift could be given (nothing left in this pet's gift list)")

#     return f"gift given: {gift.count} x {gift.itemId}"


# @command("give-pet-outfit", "give-pet-outfit <outfitId> [fairy]", targetArgCount=1)
# def givePetOutfit(ctx) -> str:
#     outfitId = ctx.intArg(0)
#     target = ctx.actingOn(1)

#     if not pet_xml.outfitSpecies(outfitId):
#         ctx.fail(f"{outfitId} is not a pet outfit")

#     pet_state.addOwnedOutfit(ctx.air, target.doId, outfitId)
#     target.sendOwnedPetOutfits()
#     return f"pet outfit {outfitId} added for fairy {target.doId} (fits species {pet_xml.outfitSpecies(outfitId)})"
