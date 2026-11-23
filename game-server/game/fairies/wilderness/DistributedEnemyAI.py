# a creature in a wilderness instance

import sys
from dataclasses import dataclass, field
from typing import List, Set

from direct.task import Task
from direct.distributed.DistributedObjectAI import DistributedObjectAI

from game.fairies.wilderness import WildernessConstants as WC
from game.fairies.wilderness import WildernessMicrogames as MG

PREP_SECONDS = 1.5
# the client runs its own countdown off gamePrep and shows try again when it ends
TIMEOUT_GRACE = 1.0
# INACTIVE gives the controls back but leaves the hit area off
REARM_SECONDS = 0.5
# a won round rolls straight into the next skill
CHAIN_SECONDS = 3.5
# seconds, the client's own countdown ticks four a second off this
MICROGAME_SECONDS = 45


# mirrors struct Microgame in fairy.dc
@dataclass
class MicrogameDef:
    spell_id: int = 0
    spell_copy_id: int = 0
    mech_id: int = 0
    mech_level: int = 0
    mech_asset_ids: List[int] = field(default_factory=list)
    sfx_ids: List[int] = field(default_factory=list)

    def asStruct(self) -> list:
        return [self.spell_id, self.spell_copy_id, self.mech_id, self.mech_level,
                list(self.mech_asset_ids), list(self.sfx_ids)]


# requestStateChange(target), the current state has to be in the set for the target
ALLOWED_REQUESTS = {
    WC.ENEMY_ANIMATED: {WC.ENEMY_HIDDEN, WC.ENEMY_INACTIVE, WC.ENEMY_ACTIVE},
    WC.ENEMY_ACTIVE: {WC.ENEMY_HIDDEN, WC.ENEMY_ANIMATED, WC.ENEMY_INACTIVE},
    WC.ENEMY_INACTIVE: {WC.ENEMY_ANIMATED, WC.ENEMY_ACTIVE},
}


class DistributedEnemyAI(DistributedObjectAI):
    def __init__(self, air, wilderness=None) -> None:
        super().__init__(air)

        self.wilderness = wilderness          # owning DistributedWildernessAI
        self.itemId: int = 0
        self.position: str = "0,0"            # "x,y"
        self.origin: tuple = (0, 0, 0, 0)
        self.microgames: List[MicrogameDef] = []
        self.gamesDefeated: List[int] = []    # parallel to microgames; WC.MG_*
        self.state: int = WC.ENEMY_HIDDEN

        self.currentGameIndex: int = -1
        self.movers: Set[int] = set()
        self.currentRound = None
        # whoever cast on us, and so whoever pays for each spell that follows
        self.caster: int = 0
        # how the last round ended, for a laggy client still playing it out
        self.lastEnded: tuple = (-1, 0)

    def setItemId(self, itemId: int) -> None:
        self.itemId = itemId

    def getItemId(self) -> int:
        return self.itemId

    def setPosition(self, position: str) -> None:
        self.position = position

    def getPosition(self) -> str:
        return self.position

    def b_setPosition(self, x: int, y: int) -> None:
        self.setPosition(f"{int(x)},{int(y)}")

    def setOrigin(self, effectId: int, startX: int, startY: int, animDir: int) -> None:
        self.origin = (effectId, startX, startY, animDir)

    def getOrigin(self) -> tuple:
        return self.origin

    def setMicrogames(self, microgames: list) -> None:
        self.microgames = [mg if isinstance(mg, MicrogameDef) else MicrogameDef(*mg)
                           for mg in microgames]
        self.gamesDefeated = [WC.MG_NOT_WON for _ in self.microgames]

    def getMicrogames(self) -> list:
        return [mg.asStruct() for mg in self.microgames]

    def setGamesDefeated(self, gamesDefeated: list) -> None:
        self.gamesDefeated = list(gamesDefeated)

    def getGamesDefeated(self) -> list:
        return self.gamesDefeated

    def d_setGamesDefeated(self) -> None:
        self.sendUpdate("setGamesDefeated", [self.gamesDefeated])

    def setEnemyState(self, state: int) -> None:
        self.state = state

    def getEnemyState(self) -> int:
        return self.state

    def b_setEnemyState(self, state: int) -> None:
        # who changed it, so a round that is undone behind the client's back can be traced
        print(f"[Wilderness] enemy item {self.itemId} state {self.state} -> {state} "
              f"(game {self.currentGameIndex}) from {sys._getframe(1).f_code.co_name}")
        self.setEnemyState(state)
        self.sendUpdate("setEnemyState", [state])

    def d_setEnemyEmote(self, emoteId: int) -> None:
        self.sendUpdate("setEnemyEmote", [emoteId])

    def d_gamePrep(self, gameIndex: int, gameTime: int, prepState: list) -> None:
        self.sendUpdate("gamePrep", [gameIndex, gameTime, prepState])

    def d_gameStart(self, gameIndex: int, gameState: list) -> None:
        self.sendUpdate("gameStart", [gameIndex, gameState])

    def d_gameUpdate(self, gameIndex: int, gameState: list) -> None:
        self.sendUpdate("gameUpdate", [gameIndex, gameState])

    def d_gameEnded(self, gameIndex: int, result: int) -> None:
        self.sendUpdate("gameEnded", [gameIndex, result])

    def isParticipant(self, avId: int) -> bool:
        return self.wilderness is None or self.wilderness.isFairyAllowed(avId)

    def requestStateChange(self, target: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        print(f"[Wilderness] fairy {avId} asks enemy item {self.itemId} at {self.position}: state {self.state} -> {target}")
        if not self.isParticipant(avId):
            self.notify.warning(f"requestStateChange from non-participant {avId}")
            return
        if target == self.state:
            # nothing to do, a round only starts from a real cast (INACTIVE -> ACTIVE)
            return
        if target not in ALLOWED_REQUESTS or self.state not in ALLOWED_REQUESTS[target]:
            self.notify.warning(
                f"illegal enemy transition {self.state} -> {target} (enemy {self.doId})")
            return

        self.b_setEnemyState(target)
        if target == WC.ENEMY_ACTIVE:
            self.caster = avId
            self.startNextMicrogame()
        elif target != WC.ENEMY_ACTIVE and self.currentGameIndex >= 0:
            self.abortMicrogame()

    def gameMove(self, gameIndex: int, moveState: list) -> None:
        avId = self.air.getAvatarIdFromSender()

        self.notify.debug(
            f"gameMove from {avId} on enemy {self.itemId}: game {gameIndex} "
            f"(playing {self.currentGameIndex}), state {moveState}, "
            f"enemyState {self.state}")

        if not self.isParticipant(avId):
            self.notify.warning(f"gameMove from non-participant {avId}")
            return
        if self.state != WC.ENEMY_ACTIVE or gameIndex != self.currentGameIndex:
            self.notify.warning(
                f"gameMove ignored: enemyState {self.state} (want {WC.ENEMY_ACTIVE}), "
                f"game {gameIndex} (want {self.currentGameIndex})")
            # a client that lagged is still playing a round the rest of the party was told ended,
            # and without hearing how it ended it sits in the enemy window for good
            if gameIndex == self.lastEnded[0]:
                self.sendUpdateToAvatarId(avId, "gameEnded", list(self.lastEnded))
            return

        if self.currentRound is None:
            # no board for this mechanic, everyone touching it still carries it to a finish
            self.movers.add(avId)
            self.d_gameUpdate(gameIndex, moveState)
            if len(self.movers) >= self.getExpectedPlayers():
                self.finishMicrogame(gameIndex, WC.MG_WON)
            return

        offset = self.getPlayerOffset(avId)

        accepted = self.currentRound.applyMove(offset, moveState)
        if type(self.currentRound).__name__ == "DragRound":
            # drag moves are the ones that go missing for a non-leader, show every one with its verdict
            print(f"[Wilderness] drag move: {avId} (player {offset}) sent {moveState} -> "
                  f"{'accepted' if accepted else 'REJECTED'}")

        if not accepted:
            # usually a second click landing before the first one's update did
            msg = (f"gameMove ignored: {avId} is player {offset} of {self.getExpectedPlayers()} "
                   f"(roster {getattr(self.wilderness, 'activeFairies', None)}), "
                   f"clicked {moveState}, board still holds {self.currentRound.debugState()}")
            self.notify.debug(msg)
            print(f"[Wilderness] {msg}")
            return

        self.d_gameUpdate(gameIndex, self.currentRound.updateData())

        if self.currentRound.won:
            if self.currentRound.settleSeconds > 0:
                # let the mechanic's own animation play out before the board goes away
                if not taskMgr.hasTaskNamed(self.getTaskName("settle")):
                    taskMgr.doMethodLater(
                        self.currentRound.settleSeconds, self.finishMicrogame,
                        self.getTaskName("settle"), extraArgs=[gameIndex, WC.MG_WON])
            else:
                self.finishMicrogame(gameIndex, WC.MG_WON)

    def getExpectedPlayers(self) -> int:
        if self.wilderness is not None and self.wilderness.activeFairies:
            return len(self.wilderness.activeFairies)
        return 1

    # where this fairy sits in the party roster, same offset AdventureManager uses
    def getPlayerOffset(self, avId: int) -> int:
        if self.wilderness is None or avId not in self.wilderness.activeFairies:
            return 0
        return self.wilderness.activeFairies.index(avId)

    def getNextUnplayedMicrogameIndex(self) -> int:
        for i, done in enumerate(self.gamesDefeated):
            if done != WC.MG_WON:
                return i
        return -1

    # one spell, one charge of pixie dust
    def chargeCasterPixieDust(self, spellId: int) -> bool:
        if not self.spendDustFor(self.caster, spellId):
            return False
        # the whole party pays for the cast, like the original, short fairies just pay nothing
        if self.wilderness is not None:
            for avId in self.wilderness.activeFairies:
                if avId != self.caster:
                    self.spendDustFor(avId, spellId)
        return True

    def spendDustFor(self, avId: int, spellId: int) -> bool:
        avatar = self.air.doId2do.get(avId) if avId else None
        if avatar is None or not hasattr(avatar, "spendPixieDust"):
            return True
        talentId = int(getattr(getattr(avatar, "fairyDNA", None), "talent", 0) or 0)
        return avatar.spendPixieDust(WC.spellDustCost(talentId, spellId))

    def startNextMicrogame(self) -> None:
        taskMgr.remove(self.getTaskName("handback"))
        taskMgr.remove(self.getTaskName("rearm"))
        taskMgr.remove(self.getTaskName("chain"))
        taskMgr.remove(self.getTaskName("settle"))
        idx = self.getNextUnplayedMicrogameIndex()
        if idx < 0:
            self.markDefeated()
            return

        if not self.chargeCasterPixieDust(self.microgames[idx].spell_id):
            # out of pixie dust, hand the creature back, the client shows its own notice on the next cast
            self.currentGameIndex = -1
            self.handBackToParty()
            return

        self.currentGameIndex = idx
        self.movers = set()
        self.currentRound = MG.roundFor(self.microgames[idx].mech_id, self.getExpectedPlayers())
        prepData = self.currentRound.prepData() if self.currentRound else []
        print(f"[Wilderness] round start: enemy {self.itemId} game {idx} mech {self.microgames[idx].mech_id} "
              f"{type(self.currentRound).__name__} players={self.getExpectedPlayers()} "
              f"roster={getattr(self.wilderness, 'activeFairies', None)} prep={prepData}")
        self.d_gamePrep(idx, MICROGAME_SECONDS, prepData)
        taskMgr.remove(self.getTaskName("prep"))
        taskMgr.remove(self.getTaskName("timeout"))
        taskMgr.doMethodLater(PREP_SECONDS, self.beginMicrogame, self.getTaskName("prep"),
                              extraArgs=[idx])

    def beginMicrogame(self, idx: int):
        if self.currentGameIndex != idx or self.state != WC.ENEMY_ACTIVE:
            return Task.done
        startData = self.currentRound.gameData() if self.currentRound else []
        print(f"[Wilderness] round go: enemy {self.itemId} game {idx} data={startData}")
        self.d_gameStart(idx, startData)
        taskMgr.doMethodLater(max(1.0, MICROGAME_SECONDS - TIMEOUT_GRACE),
                              self.microgameTimeout,
                              self.getTaskName("timeout"), extraArgs=[idx])
        return Task.done

    def microgameTimeout(self, idx: int):
        # a board we built and the party didn't clear is a real loss
        if self.currentGameIndex != idx:
            return Task.done

        lost = self.currentRound is not None and not self.currentRound.won
        self.finishMicrogame(idx, WC.MG_NOT_WON if lost else WC.MG_WON)
        return Task.done

    def finishMicrogame(self, idx: int, result: int, task=None):
        # also reached as a settle task, idx and result travel as extraArgs
        if idx != self.currentGameIndex:
            return Task.done

        taskMgr.remove(self.getTaskName("prep"))
        taskMgr.remove(self.getTaskName("timeout"))
        taskMgr.remove(self.getTaskName("settle"))
        self.currentGameIndex = -1
        self.movers = set()
        self.currentRound = None

        self.lastEnded = (idx, result)
        self.d_gameEnded(idx, result)
        if 0 <= idx < len(self.gamesDefeated):
            self.gamesDefeated[idx] = result
            self.d_setGamesDefeated()

        if result == WC.MG_WON and all(g == WC.MG_WON for g in self.gamesDefeated):
            self.markDefeated()
            return Task.done

        if result == WC.MG_WON:
            # stay ACTIVE and run the next skill's round
            taskMgr.remove(self.getTaskName("chain"))
            taskMgr.doMethodLater(CHAIN_SECONDS, self.chainNextMicrogame, self.getTaskName("chain"))
            return Task.done

        # a lost round hands the creature back
        self.handBackToParty()
        return Task.done

    def chainNextMicrogame(self, task=None):
        if self.state == WC.ENEMY_ACTIVE and self.currentGameIndex < 0 and not self.defeated:
            self.startNextMicrogame()
        return Task.done

    def handBackToParty(self, task=None):
        if self.state == WC.ENEMY_ACTIVE and self.currentGameIndex < 0:
            self.b_setEnemyState(WC.ENEMY_INACTIVE)
            taskMgr.remove(self.getTaskName("rearm"))
            taskMgr.doMethodLater(REARM_SECONDS, self.rearmEnemy, self.getTaskName("rearm"))
        return Task.done

    def rearmEnemy(self, task=None):
        if self.state == WC.ENEMY_INACTIVE and self.currentGameIndex < 0 and not self.defeated:
            self.b_setEnemyState(WC.ENEMY_ANIMATED)
        return Task.done

    def abortMicrogame(self) -> None:
        idx = self.currentGameIndex
        taskMgr.remove(self.getTaskName("prep"))
        taskMgr.remove(self.getTaskName("timeout"))
        taskMgr.remove(self.getTaskName("handback"))
        taskMgr.remove(self.getTaskName("rearm"))
        taskMgr.remove(self.getTaskName("chain"))
        taskMgr.remove(self.getTaskName("settle"))
        self.currentGameIndex = -1
        self.movers = set()
        self.currentRound = None
        if idx >= 0:
            self.lastEnded = (idx, WC.MG_ABORTED)
            self.d_gameEnded(idx, WC.MG_ABORTED)

    def markDefeated(self) -> None:
        self.b_setEnemyState(WC.ENEMY_DEFEATED)
        if self.wilderness is not None:
            self.wilderness.onEnemyDefeated(self)

    def getTaskName(self, kind: str) -> str:
        return f"emg-{kind}-{self.doId}"

    def delete(self) -> None:
        for kind in ("prep", "timeout", "handback", "rearm", "chain", "settle"):
            taskMgr.remove(self.getTaskName(kind))
        super().delete()

    @property
    def defeated(self) -> bool:
        return self.state == WC.ENEMY_DEFEATED or (
            bool(self.gamesDefeated) and all(g == WC.MG_WON for g in self.gamesDefeated))
