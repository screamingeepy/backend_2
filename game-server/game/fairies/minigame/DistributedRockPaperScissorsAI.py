import random

from game.fairies.minigame.DistributedMeadowGameAI import MEADOW_GAME_STATE_PLAY
from game.fairies.minigame.DistributedPartyTableGameAI import DistributedPartyTableGameAI

# picks as the client's buttons send them (RockPaperScissors.as)
EMPTY = 1
ROCK = 2
PAPER = 3
SCISSOR = 4
PICKS = (ROCK, PAPER, SCISSOR)
BEATS = {ROCK: SCISSOR, PAPER: ROCK, SCISSOR: PAPER}

# setNpcDialogue entry states (RockPaperScissors.parseNPCDialogue)
GAMESTATE_INTRO = 0
GAMESTATE_ROUND_PLAY = 100
GAMESTATE_CONCLUSION = 102
GAMESTATE_OUTRO = 103
# a round's result line from rochelle's side
NPC_WON = 1
NPC_LOST = 2
NPC_TIED = 3

# roundScore's win/lose/draw from the player's side (Model.showWLD)
PLAYER_WIN = 1
PLAYER_LOSE = 2
PLAYER_DRAW = 3

# setNpcDialogue and the round data are [count, stride, entry, entry, ...]
ENTRY_STRIDE = 5

# meadowgameRockPaperScissors.xml <game iterations="3"/> and the client's ROUND_TIME_DEFAULT
ROUNDS = 3
ROUND_TIME = 10

# copy variants in meadowgameRockPaperScissors.xml
INTRO_LINES = (4, 3, 3)       # intro0_0..3, intro1_0..2, intro2_0..2
OUTRO_LINES = (4, 3)          # outro0_0..3, outro1_0..2 (the two the config shows)
RESULT_VARIANTS = 3           # npcWinPaper_1..3 etc., playerChoseNada_1..3, conclusion*_1..3

# pacing from the same file
LOAD_DELAY = 3.0              # the game panel loading its assets on every client
LINE_TIME = 3.0               # <intro time="3"/>, <outro time="3"/>
REVEAL_DELAY = 3.0            # <refreshNpcThinkDelay>
COMMENT_DELAY = 5.0           # <refreshNpcCommentDelay1>

# nothing in the client says what a round is worth, these are ours
WIN_POINTS = 10
DRAW_POINTS = 5
SOLO_WIN_BONUS = 5


class DistributedRockPaperScissorsAI(DistributedPartyTableGameAI):

    def __init__(self, air) -> None:
        super().__init__(air)
        self.onReset()

    def onReset(self) -> None:
        self.seats: list[int] = []
        self.picks: dict[int, int] = {}
        self.scores: dict[int, int] = {}
        self.bonuses: dict[int, int] = {}
        self.results: dict[int, int] = {}
        self.round = 0
        self.roundOpen = False

    # ------------------------------------------------------------------ wire data

    def buildNpcDialogueData(self, entries: dict[int, tuple[int, int, int, int]]) -> list[int]:
        data = [len(entries), ENTRY_STRIDE]
        for avId, (state, value, pick, variant) in entries.items():
            data += [self.seats.index(avId), state, value, pick, variant]
        return data

    def d_sayToAll(self, state: int, value: int = 0, variant: int = 0) -> None:
        self.sendUpdate("setNpcDialogue", [self.buildNpcDialogueData(
            {avId: (state, value, EMPTY, variant) for avId in self.players})])

    def buildRoundData(self) -> list[int]:
        data = [len(self.players), ENTRY_STRIDE]
        for avId in self.players:
            data += [
                self.seats.index(avId),
                self.picks.get(avId, EMPTY),
                self.scores.get(avId, 0),
                self.bonuses.get(avId, 0),
                self.results.get(avId, 0),
            ]
        return data

    # ------------------------------------------------------------------ game flow

    def onGameStart(self) -> None:
        self.onReset()
        self.seats = list(self.players)
        self.scores = {avId: 0 for avId in self.seats}

        self.runAfterSeconds(LOAD_DELAY, lambda: self.playIntroLine(0), "flow")

    def playIntroLine(self, line: int) -> None:
        if line >= len(INTRO_LINES):
            self.startRound()
            return

        self.d_sayToAll(GAMESTATE_INTRO, line, random.randrange(INTRO_LINES[line]))
        self.runAfterSeconds(LINE_TIME, lambda: self.playIntroLine(line + 1), "flow")

    def startRound(self) -> None:
        self.round += 1
        self.picks = {}
        self.bonuses = {}
        self.results = {}
        self.roundOpen = True

        self.d_sayToAll(GAMESTATE_ROUND_PLAY)
        self.sendUpdate("roundStart", [ROUND_TIME])

        # half a second of grace for picks clicked on the last tick
        self.runAfterSeconds(ROUND_TIME + 0.5, self.endRound, "flow")

    def turnRequest(self, pick) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        if (self.state != MEADOW_GAME_STATE_PLAY or not self.roundOpen
                or avatarId not in self.players or pick not in PICKS):
            return

        self.picks[avatarId] = pick
        self.sendUpdate("roundUpdate", [self.buildRoundData()])

        # everyone has picked so reveal now instead of waiting out the clock
        if all(avId in self.picks for avId in self.players):
            self.cancelNamedTask("flow")
            self.endRound()

    def endRound(self) -> None:
        self.roundOpen = False
        self.sendUpdate("roundEnd", [[]])

        npcPick = random.choice(PICKS)
        pickCounts = {pick: list(self.picks.values()).count(pick) for pick in PICKS}
        lines = {}

        for avId in self.players:
            pick = self.picks.get(avId, EMPTY)
            variant = random.randint(1, RESULT_VARIANTS)

            if pick == EMPTY:
                # the client reads she won with an empty pick as pick something next time
                self.results[avId] = PLAYER_LOSE
                lines[avId] = (NPC_WON, npcPick, EMPTY, variant)
            elif pick == npcPick:
                self.results[avId] = PLAYER_DRAW
                self.scores[avId] += DRAW_POINTS
                lines[avId] = (NPC_TIED, npcPick, pick, variant)
            elif BEATS[pick] == npcPick:
                self.results[avId] = PLAYER_WIN
                self.scores[avId] += WIN_POINTS
                if len(self.players) > 1 and pickCounts[pick] == 1:
                    self.bonuses[avId] = SOLO_WIN_BONUS
                    self.scores[avId] += SOLO_WIN_BONUS
                lines[avId] = (NPC_LOST, npcPick, pick, variant)
            else:
                self.results[avId] = PLAYER_LOSE
                lines[avId] = (NPC_WON, npcPick, pick, variant)

        self.sendUpdate("setNpcDialogue", [self.buildNpcDialogueData(lines)])
        self.runAfterSeconds(REVEAL_DELAY, self.scoreRound, "flow")

    def scoreRound(self) -> None:
        self.sendUpdate("roundScore", [self.buildRoundData()])

        if self.round < ROUNDS:
            self.runAfterSeconds(COMMENT_DELAY, self.startRound, "flow")
        else:
            self.runAfterSeconds(COMMENT_DELAY, self.playConclusion, "flow")

    def playConclusion(self) -> None:
        # #NUM# players beat me that time, that time being the last round
        winners = sum(1 for avId in self.players if self.results.get(avId) == PLAYER_WIN)
        self.d_sayToAll(GAMESTATE_CONCLUSION, winners, random.randint(1, RESULT_VARIANTS))
        self.runAfterSeconds(COMMENT_DELAY, lambda: self.playOutroLine(0), "flow")

    def playOutroLine(self, line: int) -> None:
        if line >= len(OUTRO_LINES):
            self.finishGame(self.scores)
            return

        self.d_sayToAll(GAMESTATE_OUTRO, line, random.randrange(OUTRO_LINES[line]))
        self.runAfterSeconds(LINE_TIME, lambda: self.playOutroLine(line + 1), "flow")

    def onPlayerLeft(self, avatarId: int) -> None:
        self.picks.pop(avatarId, None)
