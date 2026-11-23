from game.fairies.badges import badge_events
from game.fairies.experience import XPConfig
from game.fairies.instance.DistributedInstanceBaseAI import DistributedInstanceBaseAI
from game.fairies.leaderboard import leaderboard_xml

# crazy cakes and two for tea tables dropped in a home run the tearoom's games and share its badges, xp and board
HOME_TABLE_TO_TEAROOM_GAME = {13017: 13070, 13018: 13072}

MEADOW_GAME_JOIN_RESPONSE_ACCEPTED = 0
MEADOW_GAME_JOIN_RESPONSE_GAMEON_FULL = 1
MEADOW_GAME_JOIN_RESPONSE_DUPLICATE = 2
MEADOW_GAME_JOIN_RESPONSE_MEMBER_ONLY = 3

MEADOW_GAME_STATE_GROUPING = 0
MEADOW_GAME_STATE_INIT = 1
MEADOW_GAME_STATE_PLAY = 2
MEADOW_GAME_STATE_RESET = 3
# matches MMOConstants.MEADOW_GAME_STATE_REWARD (7), the game ends once the animation finishes
MEADOW_GAME_STATE_REWARD = 7

class DistributedMeadowGameAI(DistributedInstanceBaseAI):
    # a table with min == max players starts when the last seat is taken
    # tables that can start short-handed hold a countdown and set this False
    autoStartWhenFull: bool = True

    def __init__(self, air) -> None:
        super().__init__(air)

        self.gameId: int = 0
        self.minPlayers: int = 0
        self.maxPlayers: int = 0
        self.velvetRope: int = 0
        self.hotspotId: int = 0
        self.x: int = 0
        self.y: int = 0
        self.state: int = 0
        self.timeOutSecs: int = 0
        self.itemId: int = 0
        self.players: list[int] = []
        self.isSpawnedGame: int = 1
        # Whose home this table is in, or 0 for a meadow table. A game in a home
        # is a party game (HomeGames.createTableGame).
        self.homeOwnerId: int = 0

    @property
    def baseGameId(self) -> int:
        return HOME_TABLE_TO_TEAROOM_GAME.get(self.gameId, self.gameId)

    def setGameInfo(self, gameId, minPlayers, maxPlayers, velvetRope, hotspotId):
        self.gameId = gameId
        self.minPlayers = minPlayers
        self.maxPlayers = maxPlayers
        self.velvetRope = velvetRope
        self.hotspotId = hotspotId

    def getGameInfo(self):
        return [self.gameId, self.minPlayers, self.maxPlayers, self.velvetRope, self.hotspotId]

    def setPosition(self, x, y):
        self.x = x
        self.y = y

    def getPosition(self):
        return [self.x, self.y]

    def setGameState(self, state, timeOutSecs):
        self.state = state
        self.timeOutSecs = timeOutSecs

    def getGameState(self):
        return [self.state, self.timeOutSecs]

    def d_setGameState(self):
        self.sendUpdate("setGameState", self.getGameState())

    def setItemId(self, itemId):
        self.itemId = itemId

    def getItemId(self):
        return self.itemId

    def setPlayers(self, players):
        self.players = players

    def getPlayers(self):
        return self.players

    def d_setPlayers(self):
        self.sendUpdate("setPlayers", [self.getPlayers()])

    def setIsSpawnedGame(self, spawned):
        self.isSpawnedGame = spawned

    def getIsSpawnedGame(self):
        return self.isSpawnedGame

    def creditGamePlayed(self, avatarId, rank: int, ranks) -> None:
        eventId = badge_events.MEADOW_GAME_TO_EVENT.get(self.baseGameId)
        if eventId is not None:
            self.air.badgeManager.d_accumulate(avatarId, eventId)

        if self.homeOwnerId and avatarId != self.homeOwnerId:
            self.air.badgeManager.d_accumulate(avatarId, badge_events.EVENT_PLAYED_PARTY_GAME)

        beaten = sum(1 for other in ranks if other > rank)
        self.air.experienceManager.grantScaledExp(
            avatarId, XPConfig.getMultiplayerXp(self.baseGameId, beaten),
            "partyGame" if self.homeOwnerId else "meadowGame")

        if self.baseGameId in leaderboard_xml.WINS_GAME_IDS:
            # The games tab reads a meadow game's `total` as its win count, so the
            # stat is fed the result (1 or 0) rather than the score.
            won = 1 if rank == 0 else 0
            self.air.mongoInterface.recordStat(avatarId, "game", self.baseGameId, won)
            if won:
                self.air.leaderBoardManager.d_addToLeaderBoard(avatarId, self.baseGameId, 1)

    def creditHostedGame(self) -> None:
        if self.homeOwnerId:
            self.air.badgeManager.d_accumulate(self.homeOwnerId, badge_events.EVENT_HOSTED_PARTY_GAME)

    def joinRequest(self, avatarId):
        avatar = self.air.doId2do.get(avatarId)

        if avatar is None:
            self.notify.warning(f"No avatar present on AI for joinRequest: {avatarId}")
            return None

        # a laggy client can send joinRequest twice, seating it twice would start a match against itself
        # acknowledge it as DUPLICATE and add nothing
        if avatarId in self.players:
            self.notify.warning(f"duplicate joinRequest from {avatarId}")
            self.sendUpdateToAvatarId(avatarId, "joinResponse", [MEADOW_GAME_JOIN_RESPONSE_DUPLICATE])
            return MEADOW_GAME_JOIN_RESPONSE_DUPLICATE

        addedPlayer = False

        if len(self.players) >= self.maxPlayers:
            responseCode = MEADOW_GAME_JOIN_RESPONSE_GAMEON_FULL
        elif self.velvetRope and not avatar.isPaid():
            responseCode = MEADOW_GAME_JOIN_RESPONSE_MEMBER_ONLY
        else:
            responseCode = MEADOW_GAME_JOIN_RESPONSE_ACCEPTED

            self.players.append(avatarId)
            addedPlayer = True
            self.d_setPlayers()

        self.sendUpdateToAvatarId(avatarId, "joinResponse", [responseCode])

        if (addedPlayer and self.autoStartWhenFull
                and len(self.players) >= self.maxPlayers
                and self.state != MEADOW_GAME_STATE_PLAY):
            self.setGameState(MEADOW_GAME_STATE_INIT, 0)
            self.d_setGameState()
            self.setGameState(MEADOW_GAME_STATE_PLAY, 0)
            self.d_setGameState()

        # return the outcome so subclasses only react to accepted joins
        return responseCode

    def notifyWin(self, avId: int) -> None:
        """Subclasses call this once they've determined avId won a round, so
        any active WIN_MEADOW_GAME quest for this game can progress. Import is
        local to avoid a hard dependency for meadow games that never call it.
        XP is creditGamePlayed's, for every player by place."""
        from game.fairies.fairy.npc.QuestMgr import QuestMgr, QUEST_TYPE_WIN_MEADOW_GAME
        QuestMgr.getInstance().addQuestGoalProgress(
            self.air, avId, QUEST_TYPE_WIN_MEADOW_GAME, amount=1, game_id=self.baseGameId)
