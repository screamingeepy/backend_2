import time

from game.fairies.housing import GardenData
from game.fairies.magicwords.registry import command


# live plots of ownerId's garden by plot number, the realm has to be on this district
def gardenPlotsFor(ctx, ownerId: int):
    realm = next(
        (realm for realm in getattr(ctx.air, "homeRealms", {}).values()
         if realm.ownerId == ownerId),
        None,
    )

    if realm is None:
        ctx.fail(f"fairy {ownerId}'s garden is not on this district")

    if not realm.gardenPlots:
        ctx.fail(f"fairy {ownerId}'s garden has no plots")

    return realm.gardenPlots


# @command("set-garden-type-id", "set-garden-type-id <gardenTypeId> [fairy]", targetArgCount=1)
# def setGardenTypeId(ctx) -> str:
#     gardenType = ctx.intArg(0)
#     target = ctx.actingOn(1)

#     if not GardenData.plotNumbers(gardenType):
#         ctx.fail(f"there is no garden {gardenType} for the client to load")

#     # saved by hand like set-home-type-id, b_setGardenType only reaches the client
#     ctx.air.mongoInterface.updateField(
#         "fairies", "gardenType", target.doId, gardenType
#     )
#     target.b_setGardenType(gardenType)

#     plots = len(GardenData.plotNumbers(gardenType))

#     return f"garden type set to {gardenType} ({plots} plots) for fairy {target.doId} -- fly out and back to see it"


# winds the garden clock up or down without a restart
# @command("garden-growth-rate", "garden-growth-rate [rate]", hidden=True)
# def gardenGrowthRate(ctx) -> str:
#     if not ctx.args:
#         return (f"garden growth rate is {GardenData.GROWTH_RATE} "
#                 f"(1.0 = the days on the seed packet)")

#     raw = ctx.arg(0)

#     try:
#         rate = float(raw)
#     except ValueError:
#         ctx.fail(f"{raw!r} is not a number -- usage: {ctx.usage}")

#     if rate <= 0:
#         ctx.fail("the growth rate has to be greater than zero")

#     GardenData.GROWTH_RATE = rate

#     # everything planted was timed on the old rate, so re-time it
#     retimed = 0

#     for realm in getattr(ctx.air, "homeRealms", {}).values():
#         for plot in realm.gardenPlots.values():
#             if not plot.isPlanted():
#                 continue

#             plot.catchUpOfflineGrowth()
#             plot.sendPlotStateToClients()
#             plot.scheduleStage()
#             plot.saveToDatabase()
#             retimed += 1

#     return f"garden growth rate set to {rate} ({retimed} growing plants re-timed)"


# ripens a plot now so it can be tended without waiting out the stage
# @command("plot-next-stage", "plot-next-stage [plotNum] [fairy]", targetArgCount=1)
# def plotNextStage(ctx) -> str:
#     plotNum = ctx.optIntArg(0, 0)
#     target = ctx.actingOn(1)
#     plots = gardenPlotsFor(ctx, target.doId)

#     if plotNum:
#         plot = plots.get(plotNum)

#         if plot is None:
#             ctx.fail(f"fairy {target.doId} has no plot {plotNum}")

#         chosen = [plot]
#     else:
#         chosen = [plot for plot in plots.values() if plot.isPlanted()]

#         if not chosen:
#             ctx.fail(f"nothing is growing in fairy {target.doId}'s garden")

#     ripened = []

#     for plot in chosen:
#         if not plot.isPlanted():
#             continue

#         # back-date the stage so it reads as ripe
#         plot.stageStart = int(time.time()) - plot.stageDuration()
#         plot.wilted = False
#         plot.canInteract = True
#         plot.sendPlotStateToClients()
#         plot.scheduleStage()
#         plot.saveToDatabase()

#         ripened.append(plot.plotNum)

#     if not ripened:
#         ctx.fail(f"nothing is growing in fairy {target.doId}'s garden")

#     return f"ripened plot(s) {', '.join(str(num) for num in ripened)} for fairy {target.doId} -- they want tending now"
