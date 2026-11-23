from game.fairies.magicwords.registry import command
from game.fairies.minigame.DistributedMatchGameAI import (
    DistributedMatchGameAI,
    MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BADNEWS,
    MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS,
    MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS_X2,
    MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_GOLDEN,
    MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_SHUFFLE,
)
from game.fairies.minigame.DistributedCrazyEightsAI import DistributedCrazyEightsAI
from game.fairies.minigame.CrazyEightsConstants import (
    SUIT_CHANGE,
    SUIT_POWER,
    VALUE_DRAW_TWO,
    VALUE_POWER_0,
    VALUE_POWER_1,
    VALUE_POWER_2,
    VALUE_POWER_3,
    VALUE_REVERSE,
    VALUE_SKIP,
    getCardSuit,
    getCardValue,
)

# The four pixie-power wheel slots, named after the copy the client prints for
# each (powerSpinnerChoice1..4 in meadowgameCrazyEight.xml) rather than after the
# misleading constant names -- "reverse" really is slot 2's ALL_PASS_ONE.
POWER_SLOTS_BY_NAME = {
    "extraturn": VALUE_POWER_0,
    "reverse": VALUE_POWER_1,
    "changecolor": VALUE_POWER_2,
    "drawone": VALUE_POWER_3,
}

SUIT_NAMES = {101: "orange", 102: "blue", 103: "purple", 104: "yellow",
              SUIT_CHANGE: "change", SUIT_POWER: "power"}

VALUE_NAMES = {VALUE_DRAW_TWO: "draw2", VALUE_REVERSE: "rev", VALUE_SKIP: "skip"}

# The four results the power spinner wheel can actually land on. REVEAL and
# LOSETURN exist in the client's enum but are not wheel slots -- sending either
# leaves stuck cards or a desynced turn -- so they are not offered here either.
SPIN_RESULTS = {
    "bonus": MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS,
    "bonus2": MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS_X2,
    "badnews": MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BADNEWS,
    "shuffle": MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_SHUFFLE,
    "golden": MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_GOLDEN,
}


# @command("reveal-match-cards", "reveal-match-cards [fairy]", targetArgCount=0)
# def revealMatchCards(ctx) -> str:
#     target = ctx.actingOn(0)
#     game = _matchGameFor(ctx, target)

#     game.d_revealBoard()

#     return f"revealed the board for fairy {target.doId} (until the next move redraws it)"


# @command("match-spin-result", "match-spin-result <bonus|bonus2|badnews|shuffle|golden> [fairy]",
#         targetArgCount=1)
# def matchSpinResult(ctx) -> str:
#     token = ctx.arg(0).lower()
#     target = ctx.actingOn(1)
#     game = _matchGameFor(ctx, target)

#     if token in SPIN_RESULTS:
#         result = SPIN_RESULTS[token]
#     elif token.isdigit() and int(token) in SPIN_RESULTS.values():
#         result = int(token)
#     else:
#         ctx.fail(f"unknown spin result {token!r} -- usage: {ctx.usage}")

#     game.forcedSpinResult = result

#     return f"next power spinner match at fairy {target.doId}'s table will land on {token}"


# @command("c8-spin-result", "c8-spin-result <extraturn|reverse|changecolor|drawone> [fairy]",
#         targetArgCount=1)
# def crazyEightsSpinResult(ctx) -> str:
#     token = ctx.arg(0).lower()
#     target = ctx.actingOn(1)
#     game = _crazyEightsFor(ctx, target)

#     if token in POWER_SLOTS_BY_NAME:
#         slot = POWER_SLOTS_BY_NAME[token]
#     elif token.isdigit() and int(token) in POWER_SLOTS_BY_NAME.values():
#         slot = int(token)
#     else:
#         ctx.fail(f"unknown spin result {token!r} -- usage: {ctx.usage}")

#     game.forcedPowerSlot = slot

#     return f"next pixie power card at fairy {target.doId}'s table will land on {token} (slot {slot})"


# @command("c8-hand", "c8-hand [fairy]", targetArgCount=0)
# def crazyEightsHand(ctx) -> str:
#     target = ctx.actingOn(0)
#     game = _crazyEightsFor(ctx, target)

#     hand = game.hands.get(target.doId, [])

#     if not hand:
#         return f"fairy {target.doId}'s hand is empty"

#     return (f"top discard {_cardName(game.topDiscard)} | "
#             f"{len(hand)} cards: " + ", ".join(_cardName(c) for c in hand))


# @command("c8-deal", "c8-deal <count> [fairy]", targetArgCount=1)
# def crazyEightsDeal(ctx) -> str:
#     """Resize a fairy's own hand, to reach an end state without playing a whole round."""
#     target = ctx.actingOn(1)
#     game = _crazyEightsFor(ctx, target)

#     # One card is the floor: emptying the hand outright would skip the win path
#     # entirely, which is usually the thing being tested.
#     count = max(1, min(ctx.intArg(0), 20))
#     avId = target.doId
#     hand = game.hands.setdefault(avId, [])

#     while len(hand) > count:
#         game.deck.append(hand.pop())

#     if len(hand) < count:
#         game.drawCardsFromDeck(avId, count - len(hand))

#     game.d_setGameData()
#     game.d_setPlayerData(avId)

#     return f"fairy {avId}'s hand is now {len(hand)} card(s)"


def _cardName(card) -> str:
    value, suit = getCardValue(card), getCardSuit(card)
    return f"{SUIT_NAMES.get(suit, suit)}-{VALUE_NAMES.get(value, value)}"


def _matchGameFor(ctx, target):
    return _tableFor(ctx, target, DistributedMatchGameAI, "Two For Tea")


def _crazyEightsFor(ctx, target):
    return _tableFor(ctx, target, DistributedCrazyEightsAI, "Crazy Cakes")


def _tableFor(ctx, target, gameClass, label):
    game = next(
        (do for do in ctx.air.doId2do.values()
         if isinstance(do, gameClass) and target.doId in do.players),
        None,
    )

    if game is None:
        ctx.fail(f"fairy {target.doId} is not sitting at a {label} table")

    return game
