from game.fairies.badges import badge_events
from game.fairies.instance.DistributedInstanceBaseAI import DistributedInstanceBaseAI
from game.fairies.leaderboard import leaderboard_xml
from game.fairies.minigame.MinigameConstants import MINIGAME_DAILY_CHANCE
from game.fairies.minigame.MinigameRewards import GAMES, calc_rewards
from game.fairies.fairy.npc.QuestMgr import QuestMgr, QUEST_TYPE_TALENTGAME_SCORE

# share of a level a badge threshold run is worth, a run pays in proportion to its score
# the client never sends the difficulty (startGame and endGame carry 0), it only shows up through the score
LEVEL_SHARE_AT_THRESHOLD = 0.25

# Scoring past the threshold keeps paying, up to twice it.
NORM_CAP = 2.0


class DistributedTalentMinigameAI(DistributedInstanceBaseAI):
    def __init__(self, air) -> None:
        super().__init__(air)

        self.gameID: int = 0
        self._scores: dict[int, int] = {}
        self._pendingRewards: dict[int, list] = {}  # avId -> rewards list

    def setGameID(self, gameID: int) -> None:
        self.gameID = gameID

    def getGameID(self) -> int:
        return self.gameID
    
    def startGame(self, unknown: int):
        if self.gameID == MINIGAME_DAILY_CHANCE:
            return
        
        # Clear scores before we start just incase we left in a stale state.
        avId = self.air.getAvatarIdFromSender()
        self._scores[avId] = 0
        self._pendingRewards.pop(avId, None)

    def reportScore(self, score: int) -> None:
        if self.gameID == MINIGAME_DAILY_CHANCE:
            return
        avId = self.air.getAvatarIdFromSender()
        self._scores[avId] = self._scores.get(avId, 0) + score

    def endGame(self, unknown: int) -> None:
        if self.gameID == MINIGAME_DAILY_CHANCE:
            # Daily Spin uses DistributedFairyPlayer.requestDailyChance, not minigame rewards.
            return

        print("endGame", unknown)

        avatarId = self.air.getAvatarIdFromSender()
        totalScore = self._scores.pop(avatarId, 0)

        self.air.mongoInterface.recordStat(avatarId, "game", self.gameID, totalScore)

        # The helper badges count games played, not points scored, so this fires
        # on finishing regardless of how well it went.
        eventId = badge_events.GAME_TO_EVENT.get(self.gameID)

        if eventId is not None:
            self.air.badgeManager.d_accumulate(avatarId, eventId)

        # the high score badge is earned the first time one run clears the game's threshold
        game = GAMES.get(self.gameID)
        highScoreBadge = badge_events.GAME_TO_HIGH_SCORE_BADGE.get(self.gameID)

        if game is not None and highScoreBadge is not None and totalScore >= game.badge_threshold:
            self.air.badgeManager.d_giveBadge(avatarId, highScoreBadge)

        # submit the run to the high score boards, the uberdog drops it if it falls short
        if leaderboard_xml.is_leaderboard_game(self.gameID):
            self.air.leaderBoardManager.d_putToLeaderBoard(avatarId, self.gameID, totalScore)

        QuestMgr.getInstance().addQuestGoalProgress(
            self.air, avatarId, QUEST_TYPE_TALENTGAME_SCORE,
            amount=totalScore, game_id=self.gameID)

        self.air.experienceManager.grantLevelShareExp(
            avatarId, self.levelShareForScore(totalScore), "talentGame")

        rewards = calc_rewards(self.gameID, totalScore)
        self._pendingRewards[avatarId] = rewards
        self.sendUpdateToAvatarId(avatarId, "setRewards", [rewards])

    def levelShareForScore(self, totalScore: int) -> float:
        # scores aren't comparable across games, so normalize against the badge threshold like the ingredient rewards do
        game = GAMES.get(self.gameID)
        if game is None or game.badge_threshold <= 0:
            return 0.0
        norm = min(NORM_CAP, max(0.0, totalScore / game.badge_threshold))
        return norm * LEVEL_SHARE_AT_THRESHOLD

    def chooseReward(self, rewardId: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        avatar = self.air.doId2do.get(avId)

        if not avatar:
            self.notify.warning(f"chooseReward: no avatar on AI for avId={avId}")
            return

        rewards = self._pendingRewards.get(avId)

        if not rewards:
            self.notify.warning(f"chooseReward: no pending rewards for avId={avId}")
            return

        if not isinstance(rewardId, int) or not (0 <= rewardId < len(rewards)):
            self.notify.warning(
                f"chooseReward: invalid rewardId={rewardId} "
                f"(rewards length={len(rewards)}, avId={avId})"
            )
            return

        chosenReward = rewards[rewardId]
        # Clear immediately so the client can't call chooseReward twice
        del self._pendingRewards[avId]

        itemID, itemCount = chosenReward.asTuple()
        itemSlot = -1

        if self.air.inventoryManager.addIngredientsToPouch(avId, itemID, itemCount, itemSlot):
            avatar.d_setPouch(self.air.inventoryManager.getPouch(avId))
