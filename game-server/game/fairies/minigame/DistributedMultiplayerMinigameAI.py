import time
from datetime import datetime, timezone

from direct.task.TaskManagerGlobal import taskMgr

from game.fairies.daily.TimeUtils import get_season
from game.fairies.housing import PartyConstants
from game.fairies.instance.DistributedInstanceBaseAI import DistributedInstanceBaseAI
from game.fairies.minigame.DistributedCrazyEightsAI import SEASONAL_REWARD_ITEM


class DistributedMultiplayerMinigameAI(DistributedInstanceBaseAI):

    def __init__(self, air, realm, gameId: int, leaderId: int, players: list) -> None:
        super().__init__(air)

        self.realm = realm
        self.gameID = gameId
        self.leader = leaderId
        self.expectedPlayers = [list(player) for player in players]

        self.arrived: set[int] = set()
        self.left: set[int] = set()
        self.scores: dict[int, int] = {}

        self.readySent = False
        self.begun = False
        self.ended = False
        self.closing = False

    # ------------------------------------------------------------------ required fields

    def getGameID(self) -> int:
        return self.gameID

    def getLeader(self) -> int:
        return self.leader

    def getExpectedPlayers(self) -> list:
        return self.expectedPlayers

    # ------------------------------------------------------------------ lifetime

    @property
    def playerIds(self) -> list[int]:
        return [player[0] for player in self.expectedPlayers]

    # expected players who are in the room right now, in the expected order
    @property
    def present(self) -> list[int]:
        return [avId for avId in self.playerIds if avId in self.arrived and avId not in self.left]

    def announceGenerate(self) -> None:
        super().announceGenerate()

        for avId in self.playerIds:
            self.acceptOnce(self.air.getAvatarExitEvent(avId), self.playerLeft, [avId])

        taskMgr.doMethodLater(
            PartyConstants.GAME_READY_TIMEOUT_SECS, self.readyTimeoutTask, self.uniqueName("ready"))
        taskMgr.doMethodLater(
            PartyConstants.GAME_MAX_LIFETIME_SECS, self.lifetimeTask, self.uniqueName("lifetime"))

    def delete(self) -> None:
        for kind in ("ready", "lifetime", "results", "cleanout"):
            taskMgr.remove(self.uniqueName(kind))

        self.ignoreAll()
        super().delete()

    # sends everyone still here back, then goes, called by the realm
    def close(self) -> None:
        if self.closing:
            return

        self.closing = True

        for kind in ("ready", "lifetime", "results"):
            taskMgr.remove(self.uniqueName(kind))

        self.sendUpdate("setCleanOut", [])
        taskMgr.doMethodLater(
            PartyConstants.GAME_CLEANOUT_GRACE_SECS, self.cleanoutTask, self.uniqueName("cleanout"))

    def cleanoutTask(self, task):
        self.requestDelete()
        return task.done

    def closeFromHere(self, reason: str) -> None:
        if self.realm is not None:
            self.realm.closePartyGame(self, reason)
        else:
            self.close()

    def lifetimeTask(self, task):
        self.closeFromHere("it ran too long")
        return task.done

    # ------------------------------------------------------------------ arrivals

    # the avatar reported this room's zone (DistributedFairyPlayerAI.setActualZoneId)
    def playerArrived(self, avId: int) -> None:
        if avId not in self.playerIds or self.closing or avId in self.arrived:
            return

        if self.begun:
            # the client only counts players who were here when the game began so there's no seat to join into
            self.sendUpdateToAvatarId(avId, "setCleanOut", [])
            return

        self.left.discard(avId)
        self.arrived.add(avId)

        if self.readySent:
            # the lobby already opened without them, open theirs too
            self.sendReadyToPlayer(avId, len(self.present), 0)
        elif all(a in self.arrived or a in self.left for a in self.playerIds):
            self.sendAllPlayersReady()

    # flew off, went home after the results, or disconnected
    def playerLeft(self, avId: int) -> None:
        if avId not in self.playerIds or avId in self.left:
            return

        self.left.add(avId)
        self.arrived.discard(avId)
        self.ignore(self.air.getAvatarExitEvent(avId))

        if self.realm is not None:
            self.realm.partyGamePlayerLeft(self, avId)

        if not self.present and all(a in self.left for a in self.playerIds):
            self.closeFromHere("everyone left")
            return

        if not self.readySent and self.arrived and all(
                a in self.arrived or a in self.left for a in self.playerIds):
            self.sendAllPlayersReady()

    def readyTimeoutTask(self, task):
        if not self.readySent:
            if self.arrived:
                self.sendAllPlayersReady()
            else:
                self.closeFromHere("nobody arrived")

        return task.done

    def sendAllPlayersReady(self) -> None:
        if self.readySent:
            return

        self.readySent = True
        taskMgr.remove(self.uniqueName("ready"))

        missing = 1 if any(a not in self.arrived for a in self.playerIds) else 0

        for avId in self.present:
            self.sendReadyToPlayer(avId, len(self.present), missing)

    def sendReadyToPlayer(self, avId: int, count: int, missing: int) -> None:
        # allPlayersReady is on the player's avatar so address it straight to their connection
        self.air.sendUpdateToDoId(
            "DistributedFairyPlayer", "allPlayersReady", avId,
            [self.zoneId, count, missing, 0],
            channelId=self.GetPuppetConnectionChannel(avId))

    # ------------------------------------------------------------------ the game

    def getSenderIfPresent(self, fieldName: str) -> int | None:
        avId = self.air.getAvatarIdFromSender()

        if avId in self.present:
            return avId

        self.notify.warning(f"{fieldName} in party game room {self.doId} from {avId}, who isn't playing")
        return None

    def isSenderLeader(self, fieldName: str) -> bool:
        avId = self.air.getAvatarIdFromSender()

        if avId == self.leader and avId in self.present:
            return True

        self.notify.warning(f"{fieldName} in party game room {self.doId} from {avId}, not the leader")
        return False

    def startGame(self, _flag: int) -> None:
        # the leader pressed start in the lobby (MiniGameContainer.onClickConfirm -> initSession)
        if not self.isSenderLeader("startGame") or self.begun or self.ended:
            return

        if len(self.present) < 2:
            self.notify.warning(f"startGame in party game room {self.doId} with {len(self.present)} player(s)")
            return

        self.begun = True
        self.scores = {}

        # the client only logs the value, setGameBegin is its go
        self.sendUpdate("setGameBegin", [int(time.time()) & 0x7FFFFFFF])

    def sendMessage(self, message: str) -> None:
        avId = self.getSenderIfPresent("sendMessage")

        if avId is None or self.closing:
            return

        if len(message) > PartyConstants.MAX_GAME_MESSAGE_LENGTH:
            self.notify.warning(f"sendMessage of {len(message)} characters from {avId} - dropping")
            return

        # to the whole room, sender included
        self.sendUpdate("setMessage", [avId, message])

    def reportScore(self, score: int) -> None:
        # MiniGameContainer.reportScore, each client reports its own points as it earns them
        avId = self.getSenderIfPresent("reportScore")

        if avId is None or not self.begun or self.ended:
            return

        self.scores[avId] = self.scores.get(avId, 0) + score

    def endGame(self, _flag: int) -> None:
        # MultiplayerMinigameBase.endGame -> endSession, only the leader's client sends it
        if not self.isSenderLeader("endGame") or not self.begun or self.ended:
            return

        self.ended = True

        ranks = self.rankings()

        for fairyId, _score, (itemId, amount), _rank in ranks:
            self.grantReward(fairyId, itemId, amount)

        self.sendUpdate("setRewardMultiplayer", [ranks])

        taskMgr.doMethodLater(
            PartyConstants.GAME_RESULTS_LINGER_SECS, self.resultsTask, self.uniqueName("results"))

    def resultsTask(self, task):
        self.closeFromHere("the results are over")
        return task.done

    # rank structs for everyone still playing
    def rankings(self) -> list:
        standings = sorted(self.present, key=lambda avId: -self.scores.get(avId, 0))
        itemId = SEASONAL_REWARD_ITEM[get_season(datetime.now(timezone.utc))]

        ranks = []
        for place, avId in enumerate(standings):
            score = self.scores.get(avId, 0)
            rank = place if place == 0 or score != self.scores.get(standings[place - 1], 0) else ranks[-1][3]
            amount = PartyConstants.partyGameReward(rank, len(standings))

            # rank struct: (fairyId, score, Reward(itemId, amount), rank)
            ranks.append((avId, score, (itemId, amount), rank))

        return ranks

    def grantReward(self, avId: int, itemId: int, amount: int) -> None:
        avatar = self.air.doId2do.get(avId)

        if avatar is None:
            return

        if self.air.inventoryManager.addIngredientsToPouch(avId, itemId, amount, -1):
            avatar.d_setPouch(self.air.inventoryManager.getPouch(avId))

    def terminateWithMessage(self, code: int) -> None:
        # the leader's client aborted back to the lobby, it already showed itself so tell the rest
        if not self.isSenderLeader("terminateWithMessage"):
            return

        self.begun = False
        self.ended = False
        self.scores = {}

        for avId in self.present:
            if avId != self.leader:
                self.sendUpdateToAvatarId(avId, "terminateWithMessage", [code])

    def chooseReward(self, _rewardId: int) -> None:
        # talent game prize picking, party games have no prize screen
        pass
