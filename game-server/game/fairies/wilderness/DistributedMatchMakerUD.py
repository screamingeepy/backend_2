
import time

from direct.distributed.DistributedObjectUD import DistributedObjectUD


class DistributedMatchMakerUD(DistributedObjectUD):
    def __init__(self, air, guardian=None) -> None:
        super().__init__(air)

        self.guardian = guardian

        self.leader: int = 0
        self.gameId: int = 0          # adventure id for the wilderness
        self.debugMode: int = 0
        self.questId: list = [-1, -1]  # [questGroup, questBitmaskIndex]
        self.players: list = []       # list of PlayerStruct-shaped lists
        self.timeCreated: int = 0

        self.triggered: bool = False

    # ── required fields (set by the guardian before generate) ─────────────
    def setLeader(self, leader: int) -> None:
        self.leader = leader

    def getLeader(self) -> int:
        return self.leader

    def setGameId(self, gameId: int) -> None:
        self.gameId = gameId

    def getGameId(self) -> int:
        return self.gameId

    def setDebugMode(self, debugMode: int) -> None:
        self.debugMode = debugMode

    def getDebugMode(self) -> int:
        return self.debugMode

    def setQuestId(self, questId: list) -> None:
        self.questId = list(questId)

    def getQuestId(self) -> list:
        return self.questId

    def setPlayers(self, players: list) -> None:
        self.players = [list(p) for p in players]

    def getPlayers(self) -> list:
        return self.players

    def d_setPlayers(self) -> None:
        self.sendUpdate("setPlayers", [self.players])

    def setTimeCreated(self, timeCreated: int) -> None:
        self.timeCreated = timeCreated

    def getTimeCreated(self) -> int:
        return self.timeCreated

    # ── helpers ─────────────────────────────────────────────────────────
    @property
    def playerIds(self) -> list:
        return [p[0] for p in self.players]

    def hasPlayer(self, avId: int) -> bool:
        return avId in self.playerIds

    def addPlayer(self, player_struct: list) -> None:
        if not self.hasPlayer(player_struct[0]):
            self.players.append(list(player_struct))
            self.d_setPlayers()

    def removePlayer(self, avId: int) -> None:
        before = len(self.players)
        self.players = [p for p in self.players if p[0] != avId]
        if len(self.players) != before:
            self.d_setPlayers()

    # ── client -> AI (clsend airecv) ────────────────────────────────────
    def requestJoin(self, _flag: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        if self.guardian is not None:
            self.guardian.handleJoinRequest(self, avId)

    def requestLeave(self, _flag: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        if self.guardian is not None:
            self.guardian.handleLeaveRequest(self, avId)

    def requestTriggerGame(self, _flag: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        if avId != self.leader:
            self.notify.warning(f"requestTriggerGame from non-leader {avId}")
            return
        if self.guardian is not None:
            self.guardian.handleTriggerRequest(self)

    def setCancel(self, _flag: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        if avId != self.leader:
            self.notify.warning(f"setCancel from non-leader {avId}")
            return
        # Echo to subscribers so their panels close, then let the guardian reap.
        self.sendUpdate("setCancel", [1])
        if self.guardian is not None:
            self.guardian.handleCancel(self)

    # ── AI -> client (broadcast) ───────────────────────────────────────
    def d_joinRejected(self, reasonCode: int) -> None:
        self.sendUpdate("joinRejected", [reasonCode])

    def d_triggerRejected(self, reasonCode: int) -> None:
        self.sendUpdate("triggerRejected", [reasonCode])

    def d_setGameTriggered(self, zoneId: int) -> None:
        self.triggered = True
        self.sendUpdate("setGameTriggered", [zoneId])

    @staticmethod
    def now() -> int:
        return int(time.time())
