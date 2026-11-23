
from direct.task import Task
from direct.directnotify import DirectNotifyGlobal

from game.otp.distributed.OtpDoGlobals import OTP_DO_ID_FAIRIES

from game.fairies.wilderness import WildernessConstants as WC
from game.fairies.wilderness import WildernessChallenges
from game.fairies.wilderness.WildernessData import WildernessData
from game.fairies.wilderness.DistributedWildernessMatchMakerUD import (
    DistributedWildernessMatchMakerUD,
)

COUNTDOWN_SECONDS = 5
JOIN_VERIFY_TIMEOUT = 15
LOBBY_IDLE_TIMEOUT = 180


class WildernessGuardian:
    notify = DirectNotifyGlobal.directNotify.newCategory("WildernessGuardian")

    def __init__(self, air) -> None:
        self.air = air
        self.data = WildernessData.getInstance().loadAllWildernessData()

        # wildernessId -> { matchmaker doId -> DistributedWildernessMatchMakerUD
        self.lobbies: dict[int, dict[int, DistributedWildernessMatchMakerUD]] = {}
        # matchmaker doId -> wildernessId (reverse lookup)
        self.wildernessByMatchMaker: dict[int, int] = {}

    # entry point (forwarded from DistributedFairyPlayerAI)
    # returns True if the player was placed in a lobby
    def requestMatch(self, avId: int, adventure_id: int, quest_id: list,
                      player_struct: list) -> bool:
        adv = self.data.getAdventureDef(adventure_id)
        if adv is None:
            self.notify.warning(f"requestMatch: unknown adventure {adventure_id} (av {avId})")
            return False

        if not WildernessChallenges.challengeForAdventure(adventure_id):
            self.notify.warning(
                f"requestMatch: adventure {adventure_id} has no wilderness challenge (av {avId})")
            return False

        if self.data.getLayoutForAdventure(adventure_id) is None:
            self.notify.warning(
                f"requestMatch: adventure {adventure_id} has no wilderness layout (av {avId})")
            return False

        wid = adv.wilderness_id
        
        # try to find lobby

        existing = self.findLobbyWithPlayer(wid, avId)
        if existing is not None:
            if not existing.triggered:
                return True
            # a run already underway lingers here for the teleport grace, it isn't their group any more
            self.reapLobby(existing)

        for mm in self.lobbies.get(wid, {}).values():
            if mm.triggered or mm.countdownState == WC.COUNTDOWN_STARTED:
                continue
            if mm.gameId != adventure_id:
                continue
            if len(mm.players) >= WC.MAX_WILDERNESS_PLAYERS:
                continue
            self.beginJoinVerify(mm, avId, player_struct)
            return True
            # no lobby? create lobby
        self.createLobby(wid, adventure_id, quest_id, avId, player_struct)
        return True

# lobby creation and destruction, countdown, joins
    def createLobby(self, wid: int, adventure_id: int, quest_id: list,
                      leader: int, leader_struct: list) -> DistributedWildernessMatchMakerUD:
        mm = DistributedWildernessMatchMakerUD(self.air, guardian=self)
        mm.setLeader(leader)
        mm.setGameId(adventure_id)
        mm.setDebugMode(0)
        mm.setQuestId(quest_id if quest_id else [-1, -1])
        mm.setPlayers([leader_struct])
        mm.setTimeCreated(mm.now())
        mm.setCountdownState(WC.COUNTDOWN_IDLE)

        zone = WC.getMatchMakerZone(wid)
        mm.generateOtpObject(OTP_DO_ID_FAIRIES, zone, doId=self.air.allocateChannel())
        # without this the matchmaker's ai channel is 0 and every clsend/airecv field the
        self.air.setAIReceiver(mm.doId, self.air.ourChannel)

        self.lobbies.setdefault(wid, {})[mm.doId] = mm
        self.wildernessByMatchMaker[mm.doId] = wid
        self.armIdleTimeout(mm)
        self.notify.info(
            f"opened wilderness {wid} lobby {mm.doId} (adv {adventure_id}, leader {leader})")
        return mm

 # join verification
    def beginJoinVerify(self, mm: DistributedWildernessMatchMakerUD, avId: int,
                      player_struct: list) -> None:
        mm.pendingVerify[avId] = list(player_struct)
        mm.d_verifyJoinWithLeader(player_struct)
        taskMgr.doMethodLater(
            JOIN_VERIFY_TIMEOUT, self.joinVerifyTimeout,
            f"wildVerify-{mm.doId}-{avId}", extraArgs=[mm, avId])

    def handleJoinRequest(self, mm, avId: int) -> None:
        if mm.triggered or mm.countdownState == WC.COUNTDOWN_STARTED:
            mm.d_joinRejected(avId)
            return
        if mm.hasPlayer(avId) or avId in mm.pendingVerify:
            return
        if len(mm.players) >= WC.MAX_WILDERNESS_PLAYERS:
            mm.d_joinRejected(avId)
            return
        self.beginJoinVerify(mm, avId, self.buildPlayerStruct(avId))

    def buildPlayerStruct(self, avId: int) -> list:
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": avId}, {"name": 1, "talent": 1, "level": 1, "accountId": 1}
        )
        if not fairy:
            return [avId, 0, 0, 0, "", "", 0, 2, 0, 0]

        account = self.air.mongoInterface.mongodb.accounts.find_one(
            {"_id": fairy.get("accountId")}, {"username": 1}
        )

        return [
            avId,
            fairy.get("accountId", 0),
            0,  # district
            0,  # zone
            fairy.get("name", ""),
            (account or {}).get("username", ""),
            fairy.get("talent", 0),
            2,  # access
            fairy.get("level", 0),
            0,  # place
        ]

    def handleLeaderResponse(self, mm, fairyId: int, accepted: bool) -> None:
        pending = mm.pendingVerify.pop(fairyId, None)
        taskMgr.remove(f"wildVerify-{mm.doId}-{fairyId}")
        if pending is None:
            return
        if accepted and len(mm.players) < WC.MAX_WILDERNESS_PLAYERS and not mm.triggered:
            mm.addPlayer(pending)
            self.armIdleTimeout(mm)
        else:
            mm.d_abortVerify(pending)

    def joinVerifyTimeout(self, mm, avId: int):
        pending = mm.pendingVerify.pop(avId, None)
        if pending is not None:
            mm.d_abortVerify(pending)
        return Task.done

    # countdown and trigger
    def handleCountdownRequest(self, mm, state: int) -> None:
        if state == WC.COUNTDOWN_STARTED:
            self.handleTriggerRequest(mm)
        else:
            self.cancelCountdown(mm)

    def handleTriggerRequest(self, mm) -> None:
        if mm.triggered or mm.countdownState == WC.COUNTDOWN_STARTED:
            return
        if not mm.players:
            mm.d_triggerRejected(0)
            return
        mm.b_setCountdownState(WC.COUNTDOWN_STARTED)
        taskMgr.remove(f"wildIdle-{mm.doId}")
        taskMgr.doMethodLater(
            COUNTDOWN_SECONDS, self.countdownDone, f"wildGo-{mm.doId}", extraArgs=[mm])

    def cancelCountdown(self, mm):
        taskMgr.remove(f"wildGo-{mm.doId}")
        if not mm.triggered:
            mm.b_setCountdownState(WC.COUNTDOWN_CANCELED)
            mm.setCountdownState(WC.COUNTDOWN_IDLE)
            self.armIdleTimeout(mm)

    def countdownDone(self, mm):
        if mm.triggered:
            return Task.done

        leader_district = self.getLeaderDistrict(mm)
        if leader_district is None:
            self.notify.warning(
                f"lobby {mm.doId}: no district for leader {mm.leader}; trigger rejected")
            mm.d_triggerRejected(0)
            self.cancelCountdown(mm)
            return Task.done

        wid = self.wildernessByMatchMaker.get(mm.doId, 0)

        def onInstanceReady(doId: int, parentId: int, zoneId: int):
            if not zoneId:
                mm.d_triggerRejected(0)
                self.cancelCountdown(mm)
                return
            mm.d_setGameTriggered(zoneId)
            self.notify.info(
                f"lobby {mm.doId} triggered -> wilderness instance {doId} in zone {zoneId}")
            taskMgr.doMethodLater(30, self.reapLobby, f"wildReap-{mm.doId}", extraArgs=[mm])

        self.spawnInstance(leader_district, wid, mm, onInstanceReady)
        return Task.done

    def spawnInstance(self, district_channel, wid, mm, callback) -> None:
        gen = getattr(self.air, "remoteGenerateWilderness", None)
        if gen is None:
            self.notify.warning(
                "remoteGenerateWilderness not wired yet; lobby %d cannot trigger" % mm.doId)
            callback(0, 0, 0)
            return
        gen(district_channel, mm.gameId, wid, mm.leader, mm.playerIds,
            list(mm.questId), callback)

    # cancel a lobby if the leader leaves or the lobby is idle too long
    def handleLeaveRequest(self, mm, avId: int) -> None:
        mm.pendingVerify.pop(avId, None)
        taskMgr.remove(f"wildVerify-{mm.doId}-{avId}")
        if avId == mm.leader and not mm.triggered:
            # Leader bailing collapses the lobby.
            mm.sendUpdate("setCancel", [1])
            self.reapLobby(mm)
            return
        mm.removePlayer(avId)
        if not mm.players:
            self.reapLobby(mm)

    # a client only cancels a group it thinks hasn't started, so a triggered one is stale
    def handleCancel(self, mm) -> None:
        self.reapLobby(mm)

    def armIdleTimeout(self, mm) -> None:
        taskMgr.remove(f"wildIdle-{mm.doId}")
        taskMgr.doMethodLater(
            LOBBY_IDLE_TIMEOUT, self.idleTimeout, f"wildIdle-{mm.doId}", extraArgs=[mm])

    def idleTimeout(self, mm):
        if not mm.triggered:
            for avId in list(mm.playerIds):
                self.notify.debug(f"idle timeout: dropping {avId} from lobby {mm.doId}")
            mm.sendUpdate("setCancel", [1])
            self.reapLobby(mm)
        return Task.done

    def reapLobby(self, mm):
        wid = self.wildernessByMatchMaker.pop(mm.doId, None)
        if wid is not None:
            self.lobbies.get(wid, {}).pop(mm.doId, None)
        for suffix in ("wildGo", "wildIdle", "wildReap"):
            taskMgr.remove(f"{suffix}-{mm.doId}")
        try:
            mm.requestDelete()
        except Exception as exc:  
            self.notify.warning(f"error deleting matchmaker {mm.doId}: {exc}")
        return Task.done

    def findLobbyWithPlayer(self, wid: int, avId: int):
        for mm in self.lobbies.get(wid, {}).values():
            if mm.hasPlayer(avId):
                return mm
        return None

    def getLeaderDistrict(self, mm):
        for p in mm.players:
            if p[0] == mm.leader:
                districtId = p[2]  
                return self.air.districtInfo.get(districtId)
        return None

    def onDistrictRegistered(self, districtId: int) -> None:
        stale = [mm for mms in self.lobbies.values() for mm in mms.values()
                 if any(p[0] == mm.leader and p[2] == districtId for p in mm.players)
                 and not mm.triggered]
        for mm in stale:
            self.notify.info(f"reaping lobby {mm.doId} after district {districtId} restart")
            self.reapLobby(mm)
