import random

from game.fairies.minigame.DistributedMeadowGameAI import MEADOW_GAME_STATE_PLAY
from game.fairies.minigame.DistributedPartyTableGameAI import DistributedPartyTableGameAI

# setNpcDialogue entry states (PassPopCorn.showNPCDialogue)
GAMESTATE_PRE_ROUND = 10        # "start<round>_<variant>"
GAMESTATE_COUNTDOWN = 20        # "countdown<round>_<0..2>"
GAMESTATE_POST_ROUND = 40       # "end<round>_0", "_" becomes the name it popped on
GAMESTATE_OUTRO = 50            # "outro0_<variant>"
GAMESTATE_CONCLUSION = 60       # the round is over: the popcorn pops where it is

DIALOGUE_STRIDE = 5
GAME_DATA_STRIDE = 4

# meadowgamePassPopCorn.xml
ROUND_TIMES = (60, 40, 20)
POINT_PASS = 5
POINT_POP = 10
COMMENT_TIME = 5.0
COUNTDOWN_TIME = 1.5
HOLD_TIME = 5.0
START_VARIANTS = 3
OUTRO_VARIANTS = 3
COUNTDOWN_LINES = 3

# passing chain as the client's ChainMeter draws it
CHAIN_LENGTH = 5
MAX_MULTIPLIER = 3

# the client loads the game's panel after the state flips to play, a slow load misses anything sent before it
LOAD_DELAY = 6.0
# the holder's client asks to move on once its hold animation ends
HOLD_FALLBACK = HOLD_TIME + 3.0
# the first catch of a round also has the popcorn falling in
ENTER_EXTRA = 2.0
# between the pop and the it popped on line so the name is still there
POST_ROUND_DELAY = 0.3

# rule fields as CardRule.setFromBPrint reads a PopcornBluePrint
ANY = -1


# how many shapes and colors are dealt (Model.setVariance)
def varianceFor(playerCount: int) -> int:
    if playerCount < 3:
        return 2
    if playerCount < 4:
        return 3
    return 4


# cardRule.testCard, rule is (shape, color, negative), card is (shape, color)
def ruleMatches(rule: tuple[int, int, int], card: tuple[int, int]) -> bool:
    shape, color, negative = rule
    cardShape, cardColor = card

    if shape != ANY and color != ANY:
        if negative:
            return cardColor != color and cardShape != shape
        return cardColor == color and cardShape == shape
    if color != ANY:
        return (cardColor != color) if negative else (cardColor == color)
    if shape != ANY:
        return (cardShape != shape) if negative else (cardShape == shape)
    return True


def groupingMatches(rules, card) -> bool:
    return all(ruleMatches(rule, card) for rule in rules)


# the rule sets that describe this card at a difficulty (Card.createRules)
def groupingsFor(card: tuple[int, int], variance: int, level: int) -> list[list[tuple[int, int, int]]]:
    shape, color = card
    otherShapes = [s for s in range(variance) if s != shape]
    otherColors = [c for c in range(variance) if c != color]

    if level == 0:
        return [[(shape, ANY, 0)], [(ANY, color, 0)], [(shape, color, 0)]]

    if level == 1:
        return ([[(s, ANY, 1)] for s in otherShapes]
                + [[(ANY, c, 1)] for c in otherColors])

    return ([[(s, ANY, 1), (ANY, color, 0)] for s in otherShapes]
            + [[(ANY, c, 1), (shape, ANY, 0)] for c in otherColors]
            + [[(s, ANY, 1), (ANY, c, 1)] for s in otherShapes for c in otherColors])


class DistributedPassPopCornAI(DistributedPartyTableGameAI):

    def __init__(self, air) -> None:
        super().__init__(air)
        self.onReset()

    def onReset(self) -> None:
        self.seats: list[int] = []
        self.cards: dict[int, tuple[int, int]] = {}
        self.scores: dict[int, int] = {}
        self.gained: dict[int, int] = {}
        self.variance = 2
        self.round = 0
        self.chain = 0
        self.holder = 0
        self.rules: list[tuple[int, int, int]] = []
        self.roundOpen = False

    # ------------------------------------------------------------------ wire data

    def d_sayToAll(self, state: int, value: int = 0, variant: int = 0) -> None:
        data = [len(self.players), DIALOGUE_STRIDE]
        for avId in self.players:
            data += [self.seats.index(avId), state, value, 0, variant]
        self.sendUpdate("setNpcDialogue", [data])

    def buildGameData(self) -> list[int]:
        # (seat, total score, points just gained, chain length), the chain is the table's
        data = [len(self.players), GAME_DATA_STRIDE]
        for avId in self.players:
            data += [self.seats.index(avId), self.scores.get(avId, 0),
                     self.gained.get(avId, 0), self.chain]
        return data

    def multiplier(self) -> int:
        return min(1 + self.chain // CHAIN_LENGTH, MAX_MULTIPLIER)

    # ------------------------------------------------------------------ game flow

    def onGameStart(self) -> None:
        self.onReset()
        self.seats = list(self.players)
        self.scores = {avId: 0 for avId in self.seats}
        self.variance = varianceFor(len(self.seats))

        # everyone gets a different flower so a rule can always single someone out
        combos = [(s, c) for s in range(self.variance) for c in range(self.variance)]
        for avId, card in zip(self.seats, random.sample(combos, len(self.seats))):
            self.cards[avId] = card

        self.d_setBluePrints()

        self.runAfterSeconds(LOAD_DELAY, lambda: self.startPreRound(0), "flow")

    # the flowers are only ever sent, never asked for, and a client still loading the game's panel when they go
    # out never draws the table, so they go out again with every round (the client just stores and redraws)
    def d_setBluePrints(self) -> None:
        self.sendUpdate("setBluePrints", [[(avId, self.cards[avId][0], self.cards[avId][1])
                                           for avId in self.seats]])

    def startPreRound(self, round: int) -> None:
        self.round = round
        self.d_setBluePrints()
        self.d_sayToAll(GAMESTATE_PRE_ROUND, round, random.randrange(START_VARIANTS))
        self.runAfterSeconds(COMMENT_TIME, lambda: self.playCountdownLine(0), "flow")

    def playCountdownLine(self, line: int) -> None:
        if line >= COUNTDOWN_LINES:
            self.startRound()
            return

        self.d_sayToAll(GAMESTATE_COUNTDOWN, self.round, line)
        self.runAfterSeconds(COUNTDOWN_TIME, lambda: self.playCountdownLine(line + 1), "flow")

    def startRound(self) -> None:
        self.chain = 0
        self.gained = {}
        self.roundOpen = True
        self.holder = random.choice(self.players)

        self.passPopcornTo(self.holder, startRound=True)
        self.runAfterSeconds(ROUND_TIMES[self.round], self.endRound, "flow")

    def pickRules(self) -> list[tuple[int, int, int]]:
        others = [avId for avId in self.players if avId != self.holder]
        target = random.choice(others)
        options = groupingsFor(self.cards[target], self.variance, self.round)
        return random.choice(options)

    def passPopcornTo(self, holder: int, startRound: bool = False) -> None:
        self.holder = holder
        self.rules = self.pickRules()
        self.sendUpdate("nextRule", [holder, self.rules, int(startRound)])

        self.runAfterSeconds(HOLD_FALLBACK + (ENTER_EXTRA if startRound else 0), self.holdTimedOut, "hold")

    def cardClicked(self, cardId, clientSaysCorrect) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        if (self.state != MEADOW_GAME_STATE_PLAY or not self.roundOpen
                or avatarId != self.holder or cardId == avatarId or cardId not in self.players):
            return

        self.cancelNamedTask("hold")
        self.gained = {}

        # checked here instead of trusting the client
        if groupingMatches(self.rules, self.cards[cardId]):
            self.chain += 1
            points = POINT_PASS * self.multiplier()
            self.scores[avatarId] += points
            self.gained[avatarId] = points
        else:
            self.chain = 0

        self.sendUpdate("roundUpdate", [self.buildGameData()])
        self.passPopcornTo(cardId)

    def chooseCard(self, timedOut) -> None:
        # the holder's hold animation ran out without a pass
        if self.air.getAvatarIdFromSender() != self.holder:
            return
        self.holdTimedOut()

    def holdTimedOut(self) -> None:
        if self.state != MEADOW_GAME_STATE_PLAY or not self.roundOpen:
            return

        self.cancelNamedTask("hold")
        self.chain = 0
        self.gained = {}
        self.sendUpdate("roundUpdate", [self.buildGameData()])

        others = [avId for avId in self.players if avId != self.holder]
        self.passPopcornTo(random.choice(others))

    def endRound(self) -> None:
        self.roundOpen = False
        self.cancelNamedTask("hold")

        self.d_sayToAll(GAMESTATE_CONCLUSION)
        self.runAfterSeconds(POST_ROUND_DELAY, self.scorePop, "flow")

    def scorePop(self) -> None:
        self.d_sayToAll(GAMESTATE_POST_ROUND, self.round, 0)

        self.chain = 0
        self.gained = {}
        for avId in self.players:
            if avId != self.holder:
                self.scores[avId] += POINT_POP
                self.gained[avId] = POINT_POP
        self.sendUpdate("roundEnd", [self.buildGameData()])

        if self.round + 1 < len(ROUND_TIMES):
            self.runAfterSeconds(COMMENT_TIME, lambda: self.startPreRound(self.round + 1), "flow")
        else:
            self.runAfterSeconds(COMMENT_TIME, self.playOutro, "flow")

    def playOutro(self) -> None:
        self.d_sayToAll(GAMESTATE_OUTRO, 0, random.randrange(OUTRO_VARIANTS))
        self.runAfterSeconds(COMMENT_TIME, lambda: self.finishGame(self.scores), "flow")

    def onPlayerLeft(self, avatarId: int) -> None:
        if not self.roundOpen:
            return

        if avatarId == self.holder:
            # the popcorn goes to someone else, no points either way
            self.cancelNamedTask("hold")
            self.chain = 0
            self.passPopcornTo(random.choice(self.players))
            return

        # nobody left fits the rule, give the holder one they can follow
        if not any(groupingMatches(self.rules, self.cards[avId])
                   for avId in self.players if avId != self.holder):
            self.cancelNamedTask("hold")
            self.passPopcornTo(self.holder)
