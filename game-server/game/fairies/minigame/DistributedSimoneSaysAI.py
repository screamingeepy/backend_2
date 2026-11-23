import random

from game.fairies.minigame.DistributedMeadowGameAI import MEADOW_GAME_STATE_PLAY
from game.fairies.minigame.DistributedPartyTableGameAI import DistributedPartyTableGameAI

# setNpcDialogue entry states (SimoneSays.showNPCDialogue)
GAMESTATE_INTRO = 0
GAMESTATE_LEVEL_PLAY = 99       # a between-rounds line: copy "npc<value>_<variant>"
GAMESTATE_ROUND_PLAY = 100      # a prompt: value is Simone's emote, variant 1 if she says "Simone Says"
GAMESTATE_ROUND_NOTPLAY = 101   # between prompts: takes her emote down (the client's default case)
GAMESTATE_CONCLUSION = 102      # hides her emote and balloon
GAMESTATE_OUTRO = 103

DIALOGUE_STRIDE = 5
GAME_DATA_STRIDE = 6

# roundStart's argument is how many rows of emotes the players pick from
EMOTES_FOR_ROWS = {1: 3, 2: 5, 3: 7}


# the chat emoticon an emote position draws
def faceOf(emote: int) -> int:
    return emote // 2

# meadowgameSimoneSays.xml ss_percentage is the share of prompts where simone doesn't say simone says
TRICK_CHANCE = 0.25

# scoring copies the client's display
POINTS_PER_HIT = 1
CHAIN_LENGTH = 5
MAX_MULTIPLIER = 3

LOAD_DELAY = 3.0
LINE_TIME = 4.0                 # every <level npcDelay="4">
PROMPT_GAP = 1.0                # the balloon clearing before the next prompt

# the copy in meadowgameSimoneSays.xml in the order the level script plays it
INTRO_LINES = 5                 # intro0_* .. intro4_*
INTRO_VARIANTS = 2
OUTRO_LINES = 2                 # outro0_0, outro1_0

# (kind, ...) steps run in order, prompts is (rows, count, shortest, longest, always says)
SCRIPT = (
    ("intro",),
    ("prompts", 1, 1, 4.0, 4.0, True),        # the practice emote
    ("comment", 11),                            # "Remember, only follow me when I say..."
    ("comment", 12),                            # "Okay. Now it's time to play for real!"
    ("prompts", 1, 5, 4.0, 5.0, False),        # first round
    ("comment", 21),
    ("prompts", 2, 8, 3.0, 4.0, False),        # second round
    ("comment", 31),
    ("comment", 32),
    ("prompts", 3, 6, 2.0, 4.0, False),        # third round
    ("comment", 41),                            # Simone's Super Special Challenge
    ("prompts", 3, 3, 1.5, 2.5, False),
    ("outro",),
)


class DistributedSimoneSaysAI(DistributedPartyTableGameAI):

    def __init__(self, air) -> None:
        super().__init__(air)
        self.onReset()

    def onReset(self) -> None:
        self.seats: list[int] = []
        self.scores: dict[int, int] = {}
        self.chains: dict[int, int] = {}
        self.multipliers: dict[int, int] = {}
        self.picks: dict[int, int] = {}
        self.correct: dict[int, bool] = {}
        self.rows = 1
        self.npcEmote = -1
        self.simoneSays = False
        self.promptOpen = False
        self.promptArgs = (0, 0.0, 0.0, False)
        self.step = 0

    # ------------------------------------------------------------------ wire data

    def d_sayToAll(self, state: int, value: int = 0, variant: int = 0) -> None:
        data = [len(self.players), DIALOGUE_STRIDE]
        for avId in self.players:
            data += [self.seats.index(avId), state, value, 0, variant]
        self.sendUpdate("setNpcDialogue", [data])

    def buildGameData(self) -> list[int]:
        # simoneSays.updateGameData matches the local player by position in this list so it's
        data = [len(self.players), GAME_DATA_STRIDE]
        for avId in self.players:
            correct = int(self.correct.get(avId, False))
            data += [self.seats.index(avId), correct, self.scores.get(avId, 0),
                     correct, self.picks.get(avId, -1), 0]
        return data

    # ------------------------------------------------------------------ script

    def onGameStart(self) -> None:
        self.onReset()
        self.seats = list(self.players)
        self.scores = {avId: 0 for avId in self.seats}
        self.chains = {avId: 0 for avId in self.seats}
        self.multipliers = {avId: 1 for avId in self.seats}

        self.runAfterSeconds(LOAD_DELAY, self.runNextScriptStep, "flow")

    def runNextScriptStep(self) -> None:
        if self.step >= len(SCRIPT):
            self.finishGame(self.scores)
            return

        kind, *args = SCRIPT[self.step]
        self.step += 1

        if kind == "intro":
            self.playLines(GAMESTATE_INTRO, INTRO_LINES, INTRO_VARIANTS)
        elif kind == "outro":
            self.d_sayToAll(GAMESTATE_CONCLUSION)
            self.playLines(GAMESTATE_OUTRO, OUTRO_LINES, 1)
        elif kind == "comment":
            self.d_sayToAll(GAMESTATE_LEVEL_PLAY, args[0], 0)
            self.runAfterSeconds(LINE_TIME, self.runNextScriptStep, "flow")
        elif kind == "prompts":
            rows, count, shortest, longest, alwaysSays = args
            self.rows = rows
            self.startPrompt(count, shortest, longest, alwaysSays)

    def playLines(self, state: int, count: int, variants: int, line: int = 0) -> None:
        if line >= count:
            self.runNextScriptStep()
            return

        self.d_sayToAll(state, line, random.randrange(variants))
        self.runAfterSeconds(LINE_TIME, lambda: self.playLines(state, count, variants, line + 1), "flow")

    def startPrompt(self, remaining: int, shortest: float, longest: float, alwaysSays: bool) -> None:
        if remaining <= 0:
            self.runNextScriptStep()
            return

        emotes = EMOTES_FOR_ROWS[self.rows]
        # never the same face twice running (Emotes.newEmote)
        self.npcEmote = random.choice(
            [e for e in range(emotes) if faceOf(e) != faceOf(self.npcEmote)] or list(range(emotes)))
        self.simoneSays = alwaysSays or random.random() >= TRICK_CHANCE
        self.picks = {}
        self.correct = {}
        self.promptOpen = True
        self.promptArgs = (remaining, shortest, longest, alwaysSays)

        # every prompt, it's the only thing that makes the emote buttons clickable again
        self.sendUpdate("roundStart", [self.rows])
        self.d_sayToAll(GAMESTATE_ROUND_PLAY, self.npcEmote, int(self.simoneSays))
        self.runAfterSeconds(random.uniform(shortest, longest),
                   lambda: self.closePrompt(remaining, shortest, longest, alwaysSays), "flow")

    def emoteSelected(self, emote) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        # a wrong face can be changed until the prompt closes
        if (self.state != MEADOW_GAME_STATE_PLAY or not self.promptOpen
                or avatarId not in self.players or self.correct.get(avatarId)
                or not 0 <= emote < EMOTES_FOR_ROWS[self.rows]):
            return

        self.picks[avatarId] = emote
        self.correct[avatarId] = self.simoneSays and emote == self.npcEmote
        self.sendUpdate("roundUpdate", [self.buildGameData()])

        # on simone says everyone has answered once all picked
        if self.simoneSays and all(avId in self.picks for avId in self.players):
            self.cancelNamedTask("flow")
            self.closePrompt(*self.promptArgs)

    def closePrompt(self, remaining: int, shortest: float, longest: float, alwaysSays: bool) -> None:
        self.promptOpen = False

        for avId in self.players:
            picked = avId in self.picks

            if self.simoneSays:
                right = picked and self.picks[avId] == self.npcEmote
            else:
                # doing nothing is the right answer to a trick
                right = not picked
            self.correct[avId] = right

            # the client only moves the chain meter when she said simone says or the player picked
            if not (self.simoneSays or picked):
                continue

            if right:
                self.chains[avId] += 1
                if self.chains[avId] == CHAIN_LENGTH:
                    self.multipliers[avId] = min(self.multipliers[avId] + 1, MAX_MULTIPLIER)
                    self.chains[avId] = 0
                self.scores[avId] += POINTS_PER_HIT * self.multipliers[avId]
            else:
                self.chains[avId] = 0
                self.multipliers[avId] = 1

        self.sendUpdate("roundEnd", [self.buildGameData()])

        # Npc.refreshEmote piles new faces on the last, only this takes the old one down
        self.d_sayToAll(GAMESTATE_ROUND_NOTPLAY)

        self.runAfterSeconds(PROMPT_GAP,
                   lambda: self.startPrompt(remaining - 1, shortest, longest, alwaysSays), "flow")

    def onPlayerLeft(self, avatarId: int) -> None:
        self.picks.pop(avatarId, None)
