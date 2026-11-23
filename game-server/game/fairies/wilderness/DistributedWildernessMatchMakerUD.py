# a wilderness lobby (dclass 103)

from game.fairies.wilderness.DistributedMatchMakerUD import DistributedMatchMakerUD
from game.fairies.wilderness import WildernessConstants as WC


class DistributedWildernessMatchMakerUD(DistributedMatchMakerUD):
    def __init__(self, air, guardian=None) -> None:
        super().__init__(air, guardian)

        self.countdownState: int = WC.COUNTDOWN_IDLE
        # avId -> PlayerStruct awaiting the leader's yes/no
        self.pendingVerify: dict[int, list] = {}

    def setCountdownState(self, state: int) -> None:
        self.countdownState = state

    def getCountdownState(self) -> int:
        return self.countdownState

    def b_setCountdownState(self, state: int) -> None:
        self.setCountdownState(state)
        self.sendUpdate("setCountdownState", [state])

    # AI -> client (broadcast)
    def d_verifyJoinWithLeader(self, player_struct: list) -> None:
        self.sendUpdateToAvatarId(self.leader, "verifyJoinWithLeader", [player_struct])

    def d_abortVerify(self, player_struct: list) -> None:
        self.sendUpdateToAvatarId(self.leader, "abortVerify", [player_struct])

    # client -> AI (clsend airecv)
    def leaderResponse(self, fairyId: int, accepted: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        if avId != self.leader:
            self.notify.warning(f"leaderResponse from non-leader {avId}")
            return
        if self.guardian is not None:
            self.guardian.handleLeaderResponse(self, fairyId, bool(accepted))

    def requestCountdownState(self, state: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        if avId != self.leader:
            self.notify.warning(f"requestCountdownState from non-leader {avId}")
            return
        if self.guardian is not None:
            self.guardian.handleCountdownRequest(self, state)
