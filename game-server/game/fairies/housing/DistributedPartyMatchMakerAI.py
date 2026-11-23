import time

from direct.distributed.DistributedObjectAI import DistributedObjectAI
from direct.task.TaskManagerGlobal import taskMgr

from game.fairies.housing import PartyConstants


class DistributedPartyMatchMakerAI(DistributedObjectAI):

    def __init__(self, air, realm, leaderId: int, gameId: int) -> None:
        super().__init__(air)

        self.realm = realm
        self.leader = leaderId
        self.gameId = gameId
        self.players: list[list] = []  # PlayerStruct-shaped lists
        self.timeCreated = int(time.time())  # epoch seconds, against the client's realmTime
        self.triggered = False

    # ------------------------------------------------------------------ required fields

    def getLeader(self) -> int:
        return self.leader

    def getGameId(self) -> int:
        return self.gameId

    def getDebugMode(self) -> int:
        return 0

    def getQuestId(self) -> list:
        return [-1, -1]

    def getPlayers(self) -> list:
        return self.players

    def getTimeCreated(self) -> int:
        return self.timeCreated

    # ------------------------------------------------------------------ lifetime

    @property
    def playerIds(self) -> list[int]:
        return [player[0] for player in self.players]

    def announceGenerate(self) -> None:
        super().announceGenerate()

        # a host whose client never triggers or cancels mustn't leave the lobby up for good
        taskMgr.doMethodLater(
            PartyConstants.LOBBY_TIMEOUT_SECS, self.timeoutTask, self.uniqueName("timeout"))

        # the host opens a lobby without joining it, so removePlayer would never hear them go
        # and the lobby, panel and all, would be waiting for them when they log back in
        self.acceptOnce(self.air.getAvatarExitEvent(self.leader), self.hostGone)

    def hostGone(self) -> None:
        if not self.triggered and self.realm is not None:
            self.realm.closePartyGameLobby("the host logged out")

    def delete(self) -> None:
        taskMgr.remove(self.uniqueName("timeout"))
        taskMgr.remove(self.uniqueName("linger"))
        self.ignoreAll()
        super().delete()

    def scheduleDelete(self, delay: float) -> None:
        taskMgr.remove(self.uniqueName("timeout"))
        taskMgr.doMethodLater(delay, self.deleteTask, self.uniqueName("linger"))

    def deleteTask(self, task):
        self.requestDelete()
        return task.done

    def timeoutTask(self, task):
        if not self.triggered and self.realm is not None:
            self.realm.closePartyGameLobby("the host never started it")

        return task.done

    # ------------------------------------------------------------------ client requests

    def d_setPlayers(self) -> None:
        self.sendUpdate("setPlayers", [self.players])

    def requestJoin(self, _flag: int) -> None:
        avId = self.air.getAvatarIdFromSender()

        if self.triggered or avId in self.playerIds:
            return

        avatar = self.air.doId2do.get(avId)

        if avatar is None or avatar.zoneId != self.realm.ownerZone:
            self.notify.warning(f"requestJoin on {self.realm.ownerId}'s party game from {avId}, who isn't in the house")
            return

        if len(self.players) >= PartyConstants.MAX_PARTY_GAME_PLAYERS:
            # only the fairy turned away, every launcher shows already full for joinRejected
            self.sendUpdateToAvatarId(avId, "joinRejected", [0])
            return

        self.players.append(avatar.getPlayerStruct())
        self.acceptOnce(self.air.getAvatarExitEvent(avId), self.removePlayer, [avId])
        self.d_setPlayers()

    def requestLeave(self, _flag: int) -> None:
        self.removePlayer(self.air.getAvatarIdFromSender())

    def removePlayer(self, avId: int) -> None:
        if avId not in self.playerIds or self.triggered:
            return

        self.ignore(self.air.getAvatarExitEvent(avId))
        self.players = [player for player in self.players if player[0] != avId]
        self.d_setPlayers()

        if avId == self.leader and self.realm is not None:
            self.realm.closePartyGameLobby("the host left the lobby")

    def setCancel(self, _flag: int) -> None:
        # PartyGameLauncher.onClickCancel, or PartyPanel replacing one game with another
        avId = self.air.getAvatarIdFromSender()

        if avId != self.leader:
            self.notify.warning(f"setCancel on {self.realm.ownerId}'s party game from {avId}, not the host")
            return

        if not self.triggered:
            self.realm.closePartyGameLobby("the host canceled it")

    def requestTriggerGame(self, _flag: int) -> None:
        avId = self.air.getAvatarIdFromSender()

        if avId != self.leader or self.triggered:
            self.notify.warning(f"requestTriggerGame on {self.realm.ownerId}'s party game from {avId}")
            return

        if len(self.players) < PartyConstants.partyGameMinPlayers(self.gameId):
            # the host's launcher checks this first, so this is a client that didn't
            self.sendUpdateToAvatarId(avId, "triggerRejected", [0])
            self.realm.closePartyGameLobby("not enough fairies joined")
            return

        self.triggered = True
        self.realm.triggerPartyGame(self)

    def d_setGameTriggered(self, zoneId: int) -> None:
        self.sendUpdate("setGameTriggered", [zoneId])
