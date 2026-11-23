from game.fairies.meadow import GiveawayReward
from game.fairies.meadow.GiveawaySpawnData import get_giveaway
from game.fairies.magicwords.registry import SCOPE_GLOBAL, command


@command("get-giveaway", "get-giveaway <giveawayId> [fairy]", scope=SCOPE_GLOBAL, targetArgCount=1)
def getGiveaway(ctx) -> str:
    giveawayId = ctx.intArg(0)
    targetId = ctx.actingOnId(1)

    return _award(ctx, targetId, giveawayId)


@command("give-giveaway", "give-giveaway <giveawayId> <fairy>", scope=SCOPE_GLOBAL, requiredTargetIndex=1)
def giveGiveaway(ctx) -> str:
    giveawayId = ctx.intArg(0)
    targetId = ctx.targetId(1)

    return _award(ctx, targetId, giveawayId)


def _award(ctx, avatarId: int, giveawayId: int) -> str:
    definition = get_giveaway(giveawayId)

    if definition is None:
        ctx.fail(f"no giveaway {giveawayId} in GiveawaySpawnData")

    # record it either way, only say already had it when this call failed to claim
    claimed = GiveawayReward.claim(ctx.air, avatarId, giveawayId)

    if not GiveawayReward.award(
        ctx.air, avatarId, giveawayId, definition.reward_item_id
    ):
        if claimed:
            GiveawayReward.release(ctx.air, avatarId, giveawayId)

        ctx.fail(
            f"could not award giveaway {giveawayId} "
            f"(reward {definition.reward_item_id}) to {avatarId}"
        )

    again = "" if claimed else " (had already collected it)"

    return (
        f"gave giveaway {giveawayId} '{definition.display_name}' "
        f"-- reward {definition.reward_item_id} -- to {avatarId}{again}"
    )
