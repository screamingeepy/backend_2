from game.fairies.ai.StaffTiers import MODERATOR
from game.fairies.badges import badge_events
from game.fairies.magicwords.registry import SCOPE_GLOBAL, command


@command("get-badge", "get-badge <badgeId> [fairy]", scope=SCOPE_GLOBAL, targetArgCount=1)
def getBadge(ctx) -> str:
    badgeId = ctx.intArg(0)
    targetId = ctx.actingOnId(1)

    _awardBadge(ctx, targetId, badgeId)

    return f"awarded badge {badgeId} to fairy {targetId}"


@command("give-badge", "give-badge <badgeId> <fairy>", tier=MODERATOR, scope=SCOPE_GLOBAL, requiredTargetIndex=1)
def giveBadge(ctx) -> str:
    badgeId = ctx.intArg(0)
    targetId = ctx.targetId(1)

    _awardBadge(ctx, targetId, badgeId)

    return f"awarded badge {badgeId} to {targetId}"


def _onUberdog(ctx) -> bool:
    # global commands run on the uberdog where badgeManager is the manager itself, so call its method directly
    return not hasattr(ctx.air.badgeManager, "d_unlockBadge")


def _unlockBadge(ctx, avatarId: int, badgeId: int) -> None:
    if _onUberdog(ctx):
        ctx.air.badgeManager.unlockBadge(avatarId, badgeId)
    else:
        ctx.air.badgeManager.d_unlockBadge(avatarId, badgeId)


def _giveBadge(ctx, avatarId: int, badgeId: int) -> None:
    if _onUberdog(ctx):
        ctx.air.badgeManager.giveBadge(avatarId, badgeId)
    else:
        ctx.air.badgeManager.d_giveBadge(avatarId, badgeId)


def _unlockPage(ctx, avatarId: int, pageId: int) -> None:
    if _onUberdog(ctx):
        ctx.air.badgeManager.unlockPage(avatarId, pageId)
    else:
        ctx.air.badgeManager.d_unlockPage(avatarId, pageId)


def _awardBadge(ctx, avatarId: int, badgeId: int) -> None:
    # unlockBadge first, giveBadge only touches rows that already exist
    _unlockBadge(ctx, avatarId, badgeId)
    _giveBadge(ctx, avatarId, badgeId)


@command("get-badge-page", "get-badge-page <pageId> [fairy]", scope=SCOPE_GLOBAL, targetArgCount=1)
def getBadgePage(ctx) -> str:
    pageId = ctx.intArg(0)
    targetId = ctx.actingOnId(1)

    _unlockPage(ctx, targetId, pageId)

    return f"unlocked badge page {pageId} for fairy {targetId}"


@command("give-badge-page", "give-badge-page <pageId> <fairy>", scope=SCOPE_GLOBAL, requiredTargetIndex=1)
def giveBadgePage(ctx) -> str:
    pageId = ctx.intArg(0)
    targetId = ctx.targetId(1)

    _unlockPage(ctx, targetId, pageId)

    return f"unlocked badge page {pageId} for {targetId}"


# self only, an appended fairy id would be ambiguous with the optional amount
@command("accumulate-badge", "accumulate-badge <eventId> [amount]", scope=SCOPE_GLOBAL, hidden=True)
def accumulateBadge(ctx) -> str:
    eventId = ctx.intArg(0)
    amount = ctx.optIntArg(1, 1)

    if not badge_events.get_badges_for_event(eventId) and not badge_events.get_conditional_badges(eventId):
        ctx.fail(f"no badge listens for event {eventId} (see badge_events)")

    ctx.air.badgeManager.d_accumulate(ctx.avatar.doId, eventId, amount)

    return f"accumulated {amount} toward event {eventId}"


@command("clear-visited-meadows", "clear-visited-meadows [fairy]", scope=SCOPE_GLOBAL, targetArgCount=0)
def clearVisitedMeadows(ctx) -> str:
    targetId = ctx.actingOnId(0)

    # clearing wipes the visited meadows set, which is what unlockBadge does when it resets a row
    for badgeId in badge_events.MEADOW_EXPLORER_ZONES:
        _unlockBadge(ctx, targetId, badgeId)

    count = len(badge_events.MEADOW_EXPLORER_ZONES)

    return f"reset {count} meadow explorer badge(s) for fairy {targetId} -- re-walk the meadows to re-earn"
