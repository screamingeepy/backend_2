from datetime import datetime, timezone

from direct.task.TaskManagerGlobal import taskMgr

from game.fairies.daily.TimeUtils import get_season
from game.fairies.housing import PartyConstants
from game.fairies.minigame.DistributedCrazyEightsAI import (
    MEADOW_GAME_STATE_REWARD_NO_PLAYER,
    SEASONAL_REWARD_ITEM,
)
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

# the launcher counts this down once enough players joined
LOBBY_COUNTDOWN = 10

# every party table seats up to 12 (the for 2-12 players in the descriptions and 12 snap targets)
MAX_PLAYERS = 12

# long enough for the results panel to come up before the empty roster from resetGame
RESET_DELAY = 10.0


class DistributedPartyTableGameAI(DistributedMeadowGameAI):

    autoStartWhenFull = False

    def __init__(self, air) -> None:
        super().__init__(air)

        self.maxPlayers = MAX_PLAYERS
        self.countdownEnds: float | None = None
        self.taskNames: set[str] = set()

    # ------------------------------------------------------------------ tasks

    # runs callback after delay seconds, canceled by cancelAllNamedTasks, reset and delete
    def runAfterSeconds(self, delay: float, callback, name: str) -> None:
        taskName = f"{type(self).__name__}-{self.doId}-{name}"
        taskMgr.remove(taskName)
        self.taskNames.add(taskName)

        def run(task):
            self.taskNames.discard(taskName)
            callback()
            return task.done

        taskMgr.doMethodLater(delay, run, taskName)

    def cancelNamedTask(self, name: str) -> None:
        taskName = f"{type(self).__name__}-{self.doId}-{name}"
        taskMgr.remove(taskName)
        self.taskNames.discard(taskName)

    def cancelAllNamedTasks(self) -> None:
        for taskName in list(self.taskNames):
            taskMgr.remove(taskName)
        self.taskNames.clear()

    # ------------------------------------------------------------------ lobby

    def countdownRemaining(self) -> int:
        if self.countdownEnds is None:
            return 0

        return max(0, int(round(self.countdownEnds - globalClock.getRealTime())))

    def startCountdown(self) -> None:
        self.countdownEnds = globalClock.getRealTime() + LOBBY_COUNTDOWN
        self.runAfterSeconds(LOBBY_COUNTDOWN, self.countdownFinished, "countdown")

        # INIT carries the timer, it's what makes the launcher start counting
        self.setGameState(MEADOW_GAME_STATE_INIT, LOBBY_COUNTDOWN)
        self.d_setGameState()

    def cancelCountdown(self) -> None:
        self.cancelNamedTask("countdown")
        self.countdownEnds = None

        # the client only cancels its countdown on an INIT -> GROUPING edge
        if self.state != MEADOW_GAME_STATE_INIT:
            return

        self.setGameState(MEADOW_GAME_STATE_GROUPING, 0)
        self.d_setGameState()

    def countdownFinished(self) -> None:
        self.countdownEnds = None

        if len(self.players) >= self.minPlayers:
            self.startGame()
        else:
            self.cancelCountdown()

    def joinRequest(self) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        # a game in progress or showing results has no seat
        if (self.state in (MEADOW_GAME_STATE_PLAY, MEADOW_GAME_STATE_REWARD,
                           MEADOW_GAME_STATE_REWARD_NO_PLAYER)
                and avatarId not in self.players):
            self.sendUpdateToAvatarId(
                avatarId, "joinResponse", [MEADOW_GAME_JOIN_RESPONSE_GAMEON_FULL])
            return

        # a latecomer gets what is left of the countdown
        if self.state == MEADOW_GAME_STATE_INIT and avatarId not in self.players:
            self.sendUpdateToAvatarId(
                avatarId, "setGameState", [MEADOW_GAME_STATE_INIT, self.countdownRemaining()])

        if super().joinRequest(avatarId) != MEADOW_GAME_JOIN_RESPONSE_ACCEPTED:
            return

        if len(self.players) >= self.maxPlayers:
            self.startGame()
        elif len(self.players) >= self.minPlayers and self.state == MEADOW_GAME_STATE_GROUPING:
            self.startCountdown()

    def leaveRequest(self) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        if avatarId not in self.players:
            return

        self.players.remove(avatarId)
        # still in PLAY so the other clients mark the seat Left Game instead of a fresh lobby
        self.d_setPlayers()

        if self.state == MEADOW_GAME_STATE_PLAY:
            if len(self.players) < self.minPlayers:
                self.cancelAllNamedTasks()
                self.setGameState(MEADOW_GAME_STATE_REWARD_NO_PLAYER, 0)
                self.d_setGameState()
                self.runAfterSeconds(RESET_DELAY, self.resetGame, "reset")
            else:
                self.onPlayerLeft(avatarId)
            return

        if self.state == MEADOW_GAME_STATE_INIT and len(self.players) < self.minPlayers:
            self.cancelCountdown()

    # ------------------------------------------------------------------ game

    def startGame(self) -> None:
        self.cancelNamedTask("countdown")
        self.countdownEnds = None

        self.setGameState(MEADOW_GAME_STATE_PLAY, 0)
        self.d_setGameState()

        self.onGameStart()

    def onGameStart(self) -> None:
        raise NotImplementedError

    def onPlayerLeft(self, avatarId: int) -> None:
        pass

    def onReset(self) -> None:
        pass

    # pays out by score (highest first) and shows everyone their results
    def finishGame(self, scores: dict[int, int]) -> None:
        self.cancelAllNamedTasks()
        self.d_setRewards(scores)

        self.setGameState(MEADOW_GAME_STATE_REWARD, 0)
        self.d_setGameState()

        self.runAfterSeconds(RESET_DELAY, self.resetGame, "reset")

    def d_setRewards(self, scores: dict[int, int]) -> None:
        players = [avId for avId in self.players if avId in scores]
        if len(players) < self.minPlayers:
            return

        itemId = SEASONAL_REWARD_ITEM[get_season(datetime.now(timezone.utc))]

        # standard competition ranking, equal scores share a place and the next skips
        rankForScore: dict[int, int] = {}
        for place, score in enumerate(sorted((scores[avId] for avId in players), reverse=True)):
            rankForScore.setdefault(score, place)

        allRanks = [rankForScore[scores[avId]] for avId in players]

        ranks = []
        for avId in players:
            rank = rankForScore[scores[avId]]
            amount = PartyConstants.partyGameReward(rank, len(players))

            avatar = self.air.doId2do.get(avId)
            if avatar is not None and self.air.inventoryManager.addIngredientsToPouch(avId, itemId, amount, -1):
                avatar.d_setPouch(self.air.inventoryManager.getPouch(avId))

            self.creditGamePlayed(avId, rank, allRanks)
            if rank == 0:
                self.notifyWin(avId)

            # rank struct: (fairyId, score, Reward(itemId, amount), rank)
            ranks.append((avId, scores[avId], (itemId, amount), rank))

        self.creditHostedGame()

        for avId in players:
            self.sendUpdateToAvatarId(avId, "setRewards", [ranks])

    # ------------------------------------------------------------------ reset

    def resetGame(self) -> None:
        self.cancelAllNamedTasks()
        self.countdownEnds = None
        self.players = []
        self.onReset()

        # RESET clears the launcher
        self.setGameState(MEADOW_GAME_STATE_RESET, 0)
        self.d_setGameState()
        self.setGameState(MEADOW_GAME_STATE_GROUPING, 0)
        self.d_setGameState()
        self.d_setPlayers()

    def delete(self) -> None:
        self.cancelAllNamedTasks()
        super().delete()
