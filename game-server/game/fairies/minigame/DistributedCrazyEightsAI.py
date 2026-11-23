from game.fairies.minigame.DistributedMeadowGameAI import (
    DistributedMeadowGameAI,
    MEADOW_GAME_JOIN_RESPONSE_ACCEPTED,
    MEADOW_GAME_JOIN_RESPONSE_GAMEON_FULL,
    MEADOW_GAME_STATE_GROUPING,
    MEADOW_GAME_STATE_INIT,
    MEADOW_GAME_STATE_PLAY,
    MEADOW_GAME_STATE_RESET,
    MEADOW_GAME_STATE_REWARD,
)
from game.fairies.minigame.CrazyEightsConstants import (
    DIRECTION_LEFT,
    DIRECTION_RIGHT,
    LOBBY_COUNTDOWN,
    MAX_PLAYERS,
    MIN_PLAYERS,
    PLAYTYPE_DISCARD,
    PLAYTYPE_DRAW,
    PLAYTYPE_NONE,
    PLAYTYPE_PLAYER_REMOVED,
    PLAYTYPE_SHOW_SPECIAL,
    POWER_SLOTS,
    POWER_SLOT_TO_ACTION,
    STARTING_HAND_SIZE,
    SUIT_CHANGE,
    SUIT_ORANGE,
    SUIT_POWER,
    SUITS,
    TURN_RESPONSE_INVALID_CARD,
    TURN_RESPONSE_INVALID_MOVE,
    TURN_RESPONSE_INVALID_PLAYER,
    TURN_RESPONSE_VALID,
    VALUE_ALL_CHANGE_SUIT,
    VALUE_ALL_DRAW_ONE,
    VALUE_ALL_PASS_ONE,
    VALUE_DRAW_TWO,
    VALUE_REVERSE,
    VALUE_SELF_GO_AGAIN,
    VALUE_SKIP,
    VALUE_UNDECLARED,
    buildDeck,
    getCardSuit,
    getCardValue,
    isColor,
    isCardPlayable,
    makeCard,
)
import game.fairies.ai.FairiesConstants as fc
from game.fairies.housing import PartyConstants
from game.fairies.daily.TimeUtils import get_season
from direct.task.TaskManagerGlobal import taskMgr
from datetime import datetime, timezone
import random

# two extra game over states the client knows that two for tea never uses
MEADOW_GAME_STATE_REWARD_NO_PLAYER = 8
MEADOW_GAME_STATE_REWARD_NO_CARD = 9

# end of game reward like DistributedMatchGameAI
SEASONAL_REWARD_ITEM = {
    "spring": fc.SPIDER_SILK,      # 8008
    "summer": fc.SUNFLOWER_SEEDS,  # 8010
    "autumn": fc.DANDELION_FLUFF,  # 8013
    "winter": fc.SNOWFLAKES,       # 8016
}

# payout per finishing place (best first) keyed by how many players saw the round out
REWARD_BY_PLACE: dict[int, tuple[int, ...]] = {
    2: (30, 15),
    3: (30, 22, 15),
    4: (30, 25, 20, 15),
}

# seconds to leave the finished table standing before wiping it
RESET_DELAY = 8.0

# a wild parks the table until its owner picks a color or the spinner resolves
SPECIAL_RESOLVE_TIMEOUT = 25.0

# drawing a card ends your turn
DRAW_ENDS_TURN = True


class DistributedCrazyEightsAI(DistributedMeadowGameAI):

    # a lobby countdown runs between minPlayers and maxPlayers so the base must not deal
    autoStartWhenFull = False

    def __init__(self, air) -> None:
        super().__init__(air)

        self.minPlayers = MIN_PLAYERS
        self.maxPlayers = MAX_PLAYERS

        # globalClock time the lobby countdown ends, or None, a latecomer is told how much is left
        self.countdownEnds: float | None = None

        self.deck: list[tuple[int, int]] = []
        self.discard: list[tuple[int, int]] = []
        self.hands: dict[int, list[tuple[int, int]]] = {}

        self.lastPlayType: int = PLAYTYPE_NONE
        self.whoseTurn: int = 0
        self.lastPlayer: int = 0
        self.direction: int = DIRECTION_RIGHT

        # a wild is waiting for its owner to say what it became
        self.pendingSpecial: tuple[int, tuple[int, int]] | None = None

        # for a pixie power wild, the wheel slot we picked (50..53), the client's answer is checked against it
        self.pendingPowerSlot: int | None = None

        # set by the c8-spin-result magic word, used by the next power card
        self.forcedPowerSlot: int | None = None

    # ------------------------------------------------------------------ state

    @property
    def topDiscard(self) -> tuple[int, int]:
        # an empty pile is only seen by a client whose board outlived the game, give it something renderable
        if not self.discard:
            return makeCard(VALUE_UNDECLARED, SUIT_CHANGE)
        return self.discard[-1]

    # hand counts in roster order, index i describes self.players[i]
    def getHandSizes(self) -> list[int]:
        return [len(self.hands.get(avId, [])) for avId in self.players]

    def d_setGameData(self) -> None:
        # the third field is read and thrown away by this client build, always 0
        self.sendUpdate("setGameData", [
            self.lastPlayType,
            self.topDiscard,
            0,
            self.getHandSizes(),
            self.whoseTurn,
            self.lastPlayer,
            self.direction,
        ])

    def d_setPlayerData(self, avId) -> None:
        self.sendUpdateToAvatarId(avId, "setPlayerData", [self.hands.get(avId, [])])

    # pushes every hand to its owner, a power card can change all hands at once
    def d_setPlayerDataAll(self) -> None:
        for avId in self.players:
            self.d_setPlayerData(avId)

    def d_turnResponse(self, avId, code) -> None:
        # diagnostics only, the client just logs turnResponse
        self.sendUpdateToAvatarId(avId, "turnResponse", [code])

    # ------------------------------------------------------------------ dealing

    def dealNewRound(self) -> None:
        # a pending reset belongs to the previous round, firing it would wipe the table mid deal
        self.cancelReset()
        self.cancelSpecialTimeout()

        # the table may have filled early
        taskMgr.remove(self.countdownTaskName)
        self.countdownEnds = None

        self.deck = buildDeck()
        random.shuffle(self.deck)

        self.hands = {avId: [self.deck.pop() for _ in range(STARTING_HAND_SIZE)]
                      for avId in self.players}

        # the starting upcard has to be a colored card, a wild would leave the table with no color to match
        self.discard = [self.drawStartingCard()]

        self.lastPlayType = PLAYTYPE_NONE
        self.direction = DIRECTION_RIGHT
        self.whoseTurn = self.players[0]
        self.lastPlayer = 0
        self.pendingSpecial = None
        self.pendingPowerSlot = None
        self.forcedPowerSlot = None

        # INIT then PLAY, the table starts at min players so the base never sends it for us
        if self.state != MEADOW_GAME_STATE_PLAY:
            self.setGameState(MEADOW_GAME_STATE_INIT, 0)
            self.d_setGameState()
            self.setGameState(MEADOW_GAME_STATE_PLAY, 0)
            self.d_setGameState()

        self.d_setGameData()
        self.d_setPlayerDataAll()

        self.d_setPlayers()

    def drawStartingCard(self) -> tuple[int, int]:
        for i in range(len(self.deck) - 1, -1, -1):
            if getCardSuit(self.deck[i]) in SUITS:
                return self.deck.pop(i)

        # unreachable with the real deck, a deck of only wilds shouldn't crash a district
        self.notify.warning("no colored card to start the discard pile")
        return self.deck.pop()

    # moves count cards from the deck to avId's hand, returns how many moved
    def drawCardsFromDeck(self, avId, count) -> int:
        drawn = 0

        for _ in range(count):
            if not self.deck and not self.recycleDiscardPileIntoDeck():
                break
            self.hands.setdefault(avId, []).append(self.deck.pop())
            drawn += 1

        return drawn

    # shuffles the spent discard pile back into the deck
    def recycleDiscardPileIntoDeck(self) -> bool:
        if len(self.discard) <= 1:
            return False

        top = self.discard[-1]
        recycled = self.discard[:-1]
        self.discard = [top]

        # wilds go back undeclared or they'd match on the wrong color
        self.deck = [
            makeCard(VALUE_UNDECLARED, getCardSuit(c)) if getCardSuit(c) not in SUITS else c
            for c in recycled
        ]
        random.shuffle(self.deck)

        return True

    # ------------------------------------------------------------------ turn order

    # the seat step places from current, following the direction
    def getNextPlayer(self, current, step=1) -> int:
        if not self.players:
            return 0

        if current not in self.players:
            # the current player left mid turn, anyone is better than raising into the reader loop
            return self.players[0]

        offset = 1 if self.direction == DIRECTION_RIGHT else -1
        index = self.players.index(current)

        return self.players[(index + offset * step) % len(self.players)]

    def advanceTurn(self, step=1) -> None:
        self.whoseTurn = self.getNextPlayer(self.whoseTurn, step)

    # flips the turn order then hands off the turn
    def reverseDirection(self) -> None:
        self.direction = (DIRECTION_LEFT if self.direction == DIRECTION_RIGHT
                          else DIRECTION_RIGHT)

        self.advanceTurn(2 if len(self.players) == 2 else 1)

    # ------------------------------------------------------------------ lobby countdown

    @property
    def countdownTaskName(self) -> str:
        return f"CrazyEightsCountdown-{self.doId}"

    # whole seconds left on the lobby countdown, or 0 if it isn't running
    def countdownRemaining(self) -> int:
        if self.countdownEnds is None:
            return 0

        return max(0, int(round(self.countdownEnds - globalClock.getRealTime())))

    # opens the pre game wait, INIT with a timeOutSecs the launcher counts down
    def startCountdown(self) -> None:
        taskMgr.remove(self.countdownTaskName)
        self.countdownEnds = globalClock.getRealTime() + LOBBY_COUNTDOWN
        taskMgr.doMethodLater(LOBBY_COUNTDOWN, self.countdownTask, self.countdownTaskName)

        # INIT makes the client load the game swf and start the launcher clock, timeOutSecs goes out with it
        self.setGameState(MEADOW_GAME_STATE_INIT, LOBBY_COUNTDOWN)
        self.d_setGameState()

    # abandons the wait and goes back to grouping (the client's CANCEL_COUNTDOWN)
    def cancelCountdown(self) -> None:
        taskMgr.remove(self.countdownTaskName)
        self.countdownEnds = None

        # the client only fires CANCEL_COUNTDOWN on an INIT -> GROUPING edge
        if self.state != MEADOW_GAME_STATE_INIT:
            return

        self.setGameState(MEADOW_GAME_STATE_GROUPING, 0)
        self.d_setGameState()

    def countdownTask(self, task):
        self.countdownEnds = None

        # players can have left in the last few seconds, re-check before dealing to one player
        if len(self.players) >= self.minPlayers:
            self.dealNewRound()
        else:
            self.cancelCountdown()

        return task.done

    # ------------------------------------------------------------------ lifecycle

    def joinRequest(self) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        # a round in progress is closed to newcomers
        if self.state == MEADOW_GAME_STATE_PLAY and avatarId not in self.players:
            self.sendUpdateToAvatarId(
                avatarId, "joinResponse", [MEADOW_GAME_JOIN_RESPONSE_GAMEON_FULL])
            return

        # joining a running countdown, hand them the remainder instead of the full duration
        if self.state == MEADOW_GAME_STATE_INIT and avatarId not in self.players:
            self.sendUpdateToAvatarId(
                avatarId, "setGameState",
                [MEADOW_GAME_STATE_INIT, self.countdownRemaining()])

        responseCode = super().joinRequest(avatarId)

        if responseCode != MEADOW_GAME_JOIN_RESPONSE_ACCEPTED:
            return

        # push the current state so a table that's still filling renders something
        self.d_setGameData()
        self.d_setPlayerData(avatarId)

        # the last seat filling ends the wait early
        if len(self.players) >= self.maxPlayers:
            self.dealNewRound()
            return

        # second player down starts the lobby countdown and leaves the other seats open
        if len(self.players) >= self.minPlayers and self.state == MEADOW_GAME_STATE_GROUPING:
            self.startCountdown()

    def leaveRequest(self) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        if avatarId not in self.players:
            return

        wasPlaying = self.state == MEADOW_GAME_STATE_PLAY
        wasTheirTurn = self.whoseTurn == avatarId

        # work out the successor before removing them, getNextPlayer needs their seat
        successor = self.getNextPlayer(avatarId) if wasPlaying else 0

        self.players.remove(avatarId)

        # their cards go back in the deck so a long game doesn't starve it
        for card in self.hands.pop(avatarId, []):
            self.deck.append(
                makeCard(VALUE_UNDECLARED, getCardSuit(card))
                if getCardSuit(card) not in SUITS else card)
        random.shuffle(self.deck)

        # a wild they owed a decision on dies with them but its placeholder is still on the
        abandonedWild = (self.pendingSpecial is not None
                         and self.pendingSpecial[0] == avatarId)

        if abandonedWild:
            _, played = self.pendingSpecial
            self.cancelSpecialTimeout()
            self.pendingSpecial = None
            self.pendingPowerSlot = None
            self.discard[-1] = makeCard(random.choice(SUITS), getCardSuit(played))

        if not wasPlaying:
            self.d_setPlayers()

            # below the minimum again during the lobby countdown, call it off and go back to waiting
            if self.state == MEADOW_GAME_STATE_INIT and len(self.players) < self.minPlayers:
                self.cancelCountdown()
            elif not self.players:
                # an empty table that isn't in play gets wiped so no stale roster outlives its group
                self.scheduleReset()
            return

        # below minimum mid round, the table can't continue
        if len(self.players) < self.minPlayers:
            self.handleBelowMinimum()
            return

        # roster first, then the removal notice, the client re-indexes from the new roster
        self.d_setPlayers()

        # someone else is mid wild, say nothing more, setPlayers already did the removal
        if self.pendingSpecial is not None:
            return

        if wasTheirTurn:
            self.whoseTurn = successor

        self.lastPlayType = PLAYTYPE_PLAYER_REMOVED if abandonedWild else PLAYTYPE_NONE
        self.lastPlayer = avatarId
        self.d_setGameData()
        self.d_setPlayerDataAll()

    # ------------------------------------------------------------------ validation

    def validatePlayer(self, avId) -> bool:
        # a client whose board outlived the round will keep sending turns at a dead table
        if self.state != MEADOW_GAME_STATE_PLAY:
            self.notify.warning(
                f"turnRequest from {avId} with no game in play (state={self.state})")
            return False

        if len(self.players) < self.minPlayers:
            self.notify.warning(
                f"turnRequest from {avId} with {len(self.players)} player(s)")
            return False

        if avId not in self.players:
            self.notify.warning(f"turnRequest from non-player {avId}")
            return False

        if avId != self.whoseTurn:
            self.notify.warning(f"turnRequest from {avId} out of turn")
            return False

        return True

    # removes the played card from avId's hand and returns it
    def takeCardFromHand(self, avId, card) -> tuple[int, int] | None:
        hand = self.hands.get(avId)

        if not hand:
            return None

        suit = getCardSuit(card)

        if suit not in SUITS:
            for i, held in enumerate(hand):
                if getCardSuit(held) == suit:
                    return hand.pop(i)
            return None

        if card in hand:
            hand.remove(card)
            return card

        return None

    # ------------------------------------------------------------------ turn entry

    def turnRequest(self, playType, cards):
        avId = self.air.getAvatarIdFromSender()

        if not self.validatePlayer(avId):
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_PLAYER)
            return

        if playType == PLAYTYPE_DISCARD:
            self.handleDiscard(avId, cards)
        elif playType == PLAYTYPE_DRAW:
            self.handleDraw(avId)
        elif playType == PLAYTYPE_SHOW_SPECIAL:
            self.handleShowSpecial(avId, cards)
        elif playType == PLAYTYPE_NONE:
            self.handleTimeout(avId)
        else:
            self.notify.warning(f"turnRequest from {avId} with unknown playType {playType}")
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_MOVE)

    def handleDiscard(self, avId, cards) -> None:
        if not cards:
            self.notify.warning(f"discard from {avId} with no card")
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_CARD)
            return

        # the client sends its whole picked cards array, the card being played is the last one
        card = tuple(cards[-1])

        # a wild awaiting resolution is the answer to a question we asked, not a fresh play
        if self.pendingSpecial is not None:
            self.resolveSpecial(avId, card)
            return

        played = self.takeCardFromHand(avId, card)

        if played is None:
            self.notify.warning(f"discard from {avId} of a card they don't hold: {card}")
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_CARD)
            self.d_setPlayerData(avId)
            return

        if not isCardPlayable(card, self.topDiscard):
            self.notify.warning(
                f"discard from {avId} of unplayable {card} on {self.topDiscard}")
            # put it back, we already took it out of their hand
            self.hands[avId].append(played)
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_MOVE)
            self.d_setPlayerData(avId)
            return

        self.d_turnResponse(avId, TURN_RESPONSE_VALID)

        # a wild played as the last card skips the ceremony
        if getCardSuit(played) not in SUITS:
            # value is the pre declared color and it is client supplied
            declared = getCardValue(card)
            if not isColor(declared):
                self.notify.warning(
                    f"discard from {avId} pre-declared a non-color {declared}; using orange")
                declared = SUIT_ORANGE
            self.discard.append(makeCard(declared, getCardSuit(played)))
        else:
            self.discard.append(played)

        self.lastPlayer = avId
        self.lastPlayType = PLAYTYPE_DISCARD

        if not self.hands[avId]:
            self.handleWin(avId)
            return

        self.applyCardEffect(avId, self.topDiscard)

        self.d_setGameData()
        self.d_setPlayerDataAll()

    # advances the turn, applying what the played card does
    def applyCardEffect(self, avId, card) -> None:
        value = getCardValue(card)

        if value == VALUE_DRAW_TWO:
            victim = self.getNextPlayer(self.whoseTurn)
            self.drawCardsFromDeck(victim, 2)
            self.lastPlayer = victim
            self.advanceTurn(2)
            return

        if value == VALUE_SKIP:
            self.lastPlayer = self.getNextPlayer(self.whoseTurn)
            self.advanceTurn(2)
            return

        if value == VALUE_REVERSE:
            self.reverseDirection()
            return

        if value == VALUE_SELF_GO_AGAIN:
            # the spinner's extra turn, whoseTurn stays put
            return

        if value == VALUE_ALL_PASS_ONE:
            # named pass one but is really reverse, same path as a reverse card so the two spellings agree
            self.reverseDirection()
            return

        if value == VALUE_ALL_DRAW_ONE:
            for player in self.players:
                self.drawCardsFromDeck(player, 1)
            self.advanceTurn()
            return

        self.advanceTurn()

    def handleDraw(self, avId) -> None:
        if self.pendingSpecial is not None:
            self.notify.warning(f"draw from {avId} while a wild is unresolved")
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_MOVE)
            return

        if not self.drawCardsFromDeck(avId, 1):
            # deck and discard are both spent and nobody went out, call it
            self.handleNoCards()
            return

        self.d_turnResponse(avId, TURN_RESPONSE_VALID)

        self.lastPlayType = PLAYTYPE_DRAW
        self.lastPlayer = avId

        if DRAW_ENDS_TURN:
            self.advanceTurn()

        self.d_setGameData()
        self.d_setPlayerDataAll()

    # the active player's turn timer expired (Controller.onTimerComplete)
    def handleTimeout(self, avId) -> None:
        if self.pendingSpecial is not None:
            # their wild is still pending, the resolve timeout owns this table
            return

        self.drawCardsFromDeck(avId, 1)

        self.lastPlayType = PLAYTYPE_DRAW
        self.lastPlayer = avId
        self.advanceTurn()

        self.d_setGameData()
        self.d_setPlayerDataAll()

    # ------------------------------------------------------------------ wilds

    # a wild was played and needs a color (or a spin) before it resolves
    def handleShowSpecial(self, avId, cards) -> None:
        if not cards:
            self.notify.warning(f"showSpecial from {avId} with no card")
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_CARD)
            return

        if self.pendingSpecial is not None:
            self.notify.warning(f"showSpecial from {avId} with one already pending")
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_MOVE)
            return

        card = tuple(cards[-1])
        played = self.takeCardFromHand(avId, card)

        if played is None:
            self.notify.warning(f"showSpecial from {avId} of a card they don't hold: {card}")
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_CARD)
            self.d_setPlayerData(avId)
            return

        suit = getCardSuit(played)

        if suit in SUITS:
            # SHOW_SPECIAL is only sent for a wild, an ordinary card is a broken or hostile client
            self.notify.warning(f"showSpecial from {avId} with ordinary card {played}")
            self.hands[avId].append(played)
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_MOVE)
            self.d_setPlayerData(avId)
            return

        self.d_turnResponse(avId, TURN_RESPONSE_VALID)

        self.pendingSpecial = (avId, played)
        self.lastPlayer = avId
        self.lastPlayType = PLAYTYPE_SHOW_SPECIAL

        if suit == SUIT_POWER:
            # we pick the wheel result and send it in the same update
            slot = self.forcedPowerSlot if self.forcedPowerSlot in POWER_SLOTS \
                else random.choice(POWER_SLOTS)
            self.forcedPowerSlot = None
            self.pendingPowerSlot = slot
            self.discard.append(makeCard(slot, SUIT_POWER))
        else:
            self.pendingPowerSlot = None
            self.discard.append(makeCard(VALUE_UNDECLARED, SUIT_CHANGE))

        # whoseTurn stays on avId, the client shows the color picker to whoever holds the turn
        self.d_setGameData()
        self.d_setPlayerDataAll()

        self.scheduleSpecialTimeout()

    # the second half of a wild, the declared color or the spun action
    def resolveSpecial(self, avId, card) -> None:
        owner, played = self.pendingSpecial

        if avId != owner:
            self.notify.warning(f"resolveSpecial from {avId}, wild belongs to {owner}")
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_PLAYER)
            return

        value = getCardValue(card)
        suit = getCardSuit(played)

        if suit == SUIT_POWER:
            expected = POWER_SLOT_TO_ACTION.get(self.pendingPowerSlot)

            # slot 3 is change color, the client opens the picker after the wheel so a color comes back
            if expected == VALUE_ALL_CHANGE_SUIT:
                if not isColor(value):
                    self.notify.warning(
                        f"power resolve from {avId} expected a color, got {value}")
                    self.d_turnResponse(avId, TURN_RESPONSE_INVALID_MOVE)
                    return
            elif value != expected:
                # the client landed on a slot we didn't spin
                self.notify.warning(
                    f"power resolve from {avId} claimed {value}, "
                    f"slot {self.pendingPowerSlot} means {expected}")
                self.d_turnResponse(avId, TURN_RESPONSE_INVALID_MOVE)
                return
        elif not isColor(value):
            self.notify.warning(f"color resolve from {avId} with non-color {value}")
            self.d_turnResponse(avId, TURN_RESPONSE_INVALID_MOVE)
            return

        self.cancelSpecialTimeout()
        self.pendingSpecial = None
        self.pendingPowerSlot = None

        self.d_turnResponse(avId, TURN_RESPONSE_VALID)

        # the resolved wild replaces its placeholder on the pile, the declared color lives in value
        self.discard[-1] = makeCard(value, suit)

        self.lastPlayer = avId
        self.lastPlayType = PLAYTYPE_DISCARD

        # playing the wild is what emptied their hand, the win only lands now
        if not self.hands.get(avId):
            self.handleWin(avId)
            return

        # a color only resolution has no effect beyond the color so the turn passes
        if isColor(value):
            self.advanceTurn()
        else:
            self.applyCardEffect(avId, self.topDiscard)

        self.d_setGameData()
        self.d_setPlayerDataAll()

    @property
    def specialTaskName(self) -> str:
        return f"CrazyEightsSpecial-{self.doId}"

    def scheduleSpecialTimeout(self) -> None:
        taskMgr.remove(self.specialTaskName)
        taskMgr.doMethodLater(
            SPECIAL_RESOLVE_TIMEOUT, self.specialTimeoutTask, self.specialTaskName)

    def cancelSpecialTimeout(self) -> None:
        taskMgr.remove(self.specialTaskName)

    def specialTimeoutTask(self, task):
        self.forceResolveSpecial()
        return task.done

    # resolves a wild whose owner never answered so the table can carry on
    def forceResolveSpecial(self) -> None:
        if self.pendingSpecial is None:
            return

        owner, played = self.pendingSpecial
        suit = getCardSuit(played)

        if suit == SUIT_POWER and self.pendingPowerSlot is not None:
            action = POWER_SLOT_TO_ACTION.get(self.pendingPowerSlot)
            # change color needs a color picked for them, the rest are self contained
            value = random.choice(SUITS) if action == VALUE_ALL_CHANGE_SUIT else action
        else:
            value = random.choice(SUITS)

        self.notify.warning(
            f"forcing wild resolution for {owner} on table {self.doId}: {value}")

        self.pendingSpecial = None
        self.pendingPowerSlot = None

        self.discard[-1] = makeCard(value, suit)
        self.lastPlayer = owner
        self.lastPlayType = PLAYTYPE_DISCARD

        if not self.hands.get(owner):
            self.handleWin(owner)
            return

        if isColor(value):
            self.advanceTurn()
        else:
            self.applyCardEffect(owner, self.topDiscard)

        self.d_setGameData()
        self.d_setPlayerDataAll()

    # ------------------------------------------------------------------ endings

    def handleWin(self, avId) -> None:
        # these three sends are order critical
        self.d_setRewards()

        self.whoseTurn = 0
        self.lastPlayType = PLAYTYPE_NONE
        self.d_setGameData()
        self.d_setPlayerDataAll()

        self.setGameState(MEADOW_GAME_STATE_REWARD, 0)
        self.d_setGameState()

        self.scheduleReset()

    # deck and discard pile are both spent with nobody out, no winner and no reward
    def handleNoCards(self) -> None:
        self.cancelSpecialTimeout()

        self.setGameState(MEADOW_GAME_STATE_REWARD_NO_CARD, 0)
        self.d_setGameState()

        self.scheduleReset()

    # someone left and took the table below two players
    def handleBelowMinimum(self) -> None:
        self.cancelSpecialTimeout()

        # broadcast the shrunken roster while still in PLAY so the client processes the removal
        self.d_setPlayers()

        self.setGameState(MEADOW_GAME_STATE_REWARD_NO_PLAYER, 0)
        self.d_setGameState()

        self.scheduleReset()

    # ------------------------------------------------------------------ rewards

    def grantReward(self, avId, itemId, amount) -> None:
        avatar = self.air.doId2do.get(avId)

        if avatar is None:
            return

        if self.air.inventoryManager.addIngredientsToPouch(avId, itemId, amount, -1):
            avatar.d_setPouch(self.air.inventoryManager.getPouch(avId))

    def d_setRewards(self) -> None:
        if len(self.players) < self.minPlayers:
            return

        itemId = SEASONAL_REWARD_ITEM[get_season(datetime.now(timezone.utc))]

        # fewest cards left wins and everyone is placed by what they were caught holding
        remaining = {avId: len(self.hands.get(avId, [])) for avId in self.players}

        rankForScore: dict[int, int] = {}
        for place, score in enumerate(sorted(remaining.values())):
            rankForScore.setdefault(score, place)

        payouts = REWARD_BY_PLACE[len(self.players)]
        allRanks = [rankForScore[remaining[avId]] for avId in self.players]

        ranks = []

        for avId in self.players:
            score = remaining[avId]
            rank = rankForScore[score]

            # a table in someone's home is a party game and pays like one
            if self.homeOwnerId:
                amount = PartyConstants.partyGameReward(rank, len(self.players))
            else:
                amount = payouts[rank]
            self.grantReward(avId, itemId, amount)
            self.creditGamePlayed(avId, rank, allRanks)

            # rank struct order: (fairyId, score, Reward(itemId, amount), rank)
            ranks.append((avId, score, (itemId, amount), rank))

        self.creditHostedGame()

        for avId in self.players:
            self.sendUpdateToAvatarId(avId, "setRewards", [ranks])

    # ------------------------------------------------------------------ reset

    @property
    def resetTaskName(self) -> str:
        return f"CrazyEightsReset-{self.doId}"

    def scheduleReset(self, delay=RESET_DELAY) -> None:
        taskMgr.remove(self.resetTaskName)
        taskMgr.doMethodLater(delay, self.resetTask, self.resetTaskName)

    def cancelReset(self) -> None:
        taskMgr.remove(self.resetTaskName)

    def resetTask(self, task):
        self.resetGame()
        return task.done

    def delete(self) -> None:
        self.cancelReset()
        self.cancelSpecialTimeout()
        taskMgr.remove(self.countdownTaskName)
        super().delete()

    def resetGame(self) -> None:
        # empty the table and go back to grouping
        self.cancelSpecialTimeout()
        taskMgr.remove(self.countdownTaskName)
        self.countdownEnds = None

        self.players = []
        self.hands = {}
        self.deck = []
        self.discard = []
        self.lastPlayType = PLAYTYPE_NONE
        self.whoseTurn = 0
        self.lastPlayer = 0
        self.direction = DIRECTION_RIGHT
        self.pendingSpecial = None
        self.pendingPowerSlot = None
        self.forcedPowerSlot = None

        self.setGameState(MEADOW_GAME_STATE_RESET, 0)
        self.d_setGameState()

        # back to GROUPING so the table is joinable again, RESET isn't a stable state
        self.setGameState(MEADOW_GAME_STATE_GROUPING, 0)
        self.d_setGameState()
        self.d_setPlayers()
