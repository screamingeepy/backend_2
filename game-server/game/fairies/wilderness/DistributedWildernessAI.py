
import sys
from typing import Dict, List, Optional, Set

from direct.task import Task

from game.fairies.ai import FairiesConstants as fc
from game.fairies.badges import badge_events
from game.fairies.experience import XPConfig
from game.fairies.fairy.npc.QuestMgr import QuestMgr, QUEST_TYPE_ADVENTURE
from game.fairies.gateway.DistributedGatewayAI import DistributedGatewayAI
from game.fairies.meadow.DistributedMeadowAI import DistributedMeadowAI
from game.fairies.meadow.DistributedMultiplayerSpawnStackAI import DistributedMultiplayerSpawnStackAI
from game.fairies.meadow.DistributedSpawnStackAI import DistributedSpawnStackAI
from game.fairies.wilderness import WildernessChallenges
from game.fairies.wilderness import WildernessConstants as WC
from game.fairies.wilderness import WildernessCoordOverrides
from game.fairies.wilderness import WildernessGatherables
from game.fairies.wilderness import WildernessMicrogames as MG
from game.fairies.wilderness import WildernessPathing
from game.fairies.wilderness.DistributedEnemyAI import DistributedEnemyAI
from game.fairies.wilderness.WildernessGateways import exitSignFor

# grace period between forcing the party out and deleting the instance
CLEANOUT_GRACE_SECONDS = 20
# how long the congratulations notice stays up before the party is pushed out anyway
CONGRATULATIONS_SECONDS = 180
# fallback if a client never calls requestHotspotStates, arrival is normally detected for real
ALL_READY_FALLBACK_SECONDS = 10.0
# where the exit sign goes when a layout has no valid area to hang it off
EXIT_SIGN_FALLBACK_POSITION = (600, 600)
# how far into the run the far exit sign stands from the reachable end
FAR_EXIT_SETBACK = 140.0
# how far off spawn the near exit sign stands, enough to clear the spawn tile without reading past it
NEAR_EXIT_SETBACK = 50.0
# computed exit signs are lifted this many pixels so the base isn't buried in the grass
EXIT_SIGN_RAISE = 100
# how far back from its gate an enemy waits
ENEMY_GATE_STANDOFF = 220.0
# where an enemy goes when a layout has no walkable floor
ENEMY_FALLBACK_POSITION = (600, 600)
# wake on entry was used during development
WAKE_ON_ENTRY = False
WAKE_FIRST_SECONDS = 3.0
WAKE_STAGGER_SECONDS = 1.5
WAKE_RETRY_SECONDS = 2.0
ENEMY_DROP_PIXELS = 0
ENEMY_DROP_STEP = 5

# one ingredient reward per wilderness, by biome, twigs if unknown
REWARD_INGREDIENT = {1: fc.IVY, 2: fc.OAK_LEAVES, 3: fc.SPIDER_SILK}


class DistributedWildernessAI(DistributedMeadowAI):
    def __init__(self, air, adventure_id: int = 0, wilderness_id: int = 0,
                quest_id: tuple = (-1, -1)) -> None:
        super().__init__(air)

        self.adventureId: int = adventure_id
        self.wildernessId: int = wilderness_id
        # (questGroup, questBitmaskIndex) from the requestMatchMaker that started this run
        self.questId: tuple = tuple(quest_id)

        self.activeFairies: List[int] = []
        self.activeBarriers: List[int] = []
        self.defeated: int = 0
        # the fairy who started the party, 0 if unknown
        self.leaderId: int = 0

        # enemyDoId -> DistributedEnemyAI, generated into this instance's zone
        self.enemies: Dict[int, DistributedEnemyAI] = {}
        # enemyDoId -> the barrier index that enemy's defeat opens
        self.enemyGates: Dict[int, int] = {}
        # where each enemy ended up standing, so gatherables can avoid them
        self.enemyPosts: List[tuple] = []
        self.gatherables: List[DistributedSpawnStackAI] = []
        self.layout = None
        self.exitSign = None
        self.farExitSign = None

        # avIds that have actually loaded in (requestHotspotStates received)
        self.arrivedFairies: Set[int] = set()
        self.allReadySent: bool = False
        self.rewardsGranted: bool = False

    def setActiveFairies(self, fairyIds: list) -> None:
        self.activeFairies = list(fairyIds)

    def getActiveFairies(self) -> list:
        return self.activeFairies

    def b_setActiveFairies(self, fairyIds: list) -> None:
        self.setActiveFairies(fairyIds)
        self.sendUpdate("setActiveFairies", [self.activeFairies])

    def setActiveBarriers(self, barrierIndices: list) -> None:
        self.activeBarriers = list(barrierIndices)

    def getActiveBarriers(self) -> list:
        return self.activeBarriers

    def d_setActiveBarriers(self) -> None:
        self.sendUpdate("setActiveBarriers", [self.activeBarriers])

    def b_setActiveBarriers(self, barrierIndices: list) -> None:
        self.setActiveBarriers(barrierIndices)
        self.d_setActiveBarriers()

    def setDefeated(self, defeated: int) -> None:
        self.defeated = int(bool(defeated))

    def getDefeated(self) -> int:
        return self.defeated

    def b_setDefeated(self, defeated: int) -> None:
        self.setDefeated(defeated)
        self.sendUpdate("setDefeated", [self.defeated])

    def d_setCleanOut(self) -> None:
        self.sendUpdate("setCleanOut", [])

    # the last creature is down
    def completeRun(self) -> None:
        if not self.defeated:
            self.b_setDefeated(1)
        taskMgr.doMethodLater(
            CONGRATULATIONS_SECONDS, self.closeOutInstance, f"wildCleanOut-{self.doId}")

    def closeOutInstance(self, _task=None):
        self.d_setCleanOut()
        taskMgr.doMethodLater(
            CLEANOUT_GRACE_SECONDS, self.reapInstance, f"wildTeardown-{self.doId}")
        return Task.done

    # marks the run over and pushes everyone out now with no reward screen
    def defeatAndClose(self) -> None:
        if not self.defeated:
            self.b_setDefeated(1)
        taskMgr.remove(f"wildCleanOut-{self.doId}")
        self.closeOutInstance()

    def reapInstance(self, _task=None):
        if getattr(self, "air", None) is not None:
            self.air.teardownWilderness(self.doId)
        return Task.done

    def isFairyAllowed(self, avId: int) -> bool:
        return avId in self.activeFairies

    # a party member disconnected, logged out or otherwise vanished
    def onFairyLeft(self, avId: int) -> None:
        if avId not in self.activeFairies:
            return
        print(f"[Wilderness] zone {self.zoneId}: fairy {avId} dropped from roster {self.activeFairies} "
              f"(arrived {sorted(self.arrivedFairies)}) from {sys._getframe(1).f_code.co_name}")
        self.activeFairies = [a for a in self.activeFairies if a != avId]
        self.arrivedFairies.discard(avId)
        self.sendUpdate("setActiveFairies", [self.activeFairies])
        if not self.activeFairies and not self.defeated:
            # nobody left to clean out, skip straight to teardown
            taskMgr.remove(f"wildReady-{self.doId}")
            self.reapInstance()

    def registerEnemy(self, enemy: DistributedEnemyAI) -> None:
        self.enemies[enemy.doId] = enemy

    # challenge is a list of WildernessChallenges.EnemySpawn
    def spawnEnemies(self, challenge: list, layout) -> None:
        knownVerbs = self.getPartyKnownVerbs()
        original = challenge
        if knownVerbs is not None:
            challenge = WildernessChallenges.filterByVerbs(challenge, knownVerbs)
        print(f"[Wilderness] zone {self.zoneId}: party verbs {sorted(knownVerbs) if knownVerbs is not None else 'unknown'}")

        gates = self.getOrderedGates(layout)
        permanent = self.getPermanentBarrierPoints(layout)
        offsets = [WC.originOffsetFor(spawn.itemId) for spawn in challenge]
        positions = self.getEnemyPositions(layout, gates, offsets, permanent)
        self.enemyPosts = list(positions)

        cleared = []
        for index, (spawn, (ex, ey)) in enumerate(zip(challenge, positions)):
            enemy = DistributedEnemyAI(self.air, wilderness=self)
            enemy.setItemId(spawn.itemId)
            enemy.setPosition(f"{ex},{ey}")
            enemy.setOrigin(
                spawn.itemId + WC.ORIGIN_ITEM_ID_OFFSET, ex,
                ey + WC.originOffsetFor(spawn.itemId), 0)
            enemy.setMicrogames([MG.asPlayableStruct(mg) for mg in spawn.microgames])

            if spawn.microgames:
                enemy.setEnemyState(WC.ENEMY_HIDDEN)
            else:
                enemy.setEnemyState(WC.ENEMY_DEFEATED)
                cleared.append(enemy)

            wanted = [mg.spellId for mg in original[index].microgames]
            kept = [mg.spellId for mg in spawn.microgames]
            print(f"[Wilderness] enemy {index + 1}/{len(challenge)} item {spawn.itemId} at ({ex},{ey}): "
                  f"spells wanted {wanted}, party can cast {kept} -> "
                  f"{'waits hidden' if spawn.microgames else 'DEFEATED ON THE SPOT (party knows none of its spells)'}")

            enemy.generateOtpObject(
                self.parentId, self.zoneId, doId=self.air.allocateChannel())
            self.air.setAIReceiver(enemy.getDoId(), self.air.ourChannel)
            self.registerEnemy(enemy)

            if index < len(gates):
                self.enemyGates[enemy.doId] = gates[index].index

        # only now, with every enemy registered
        for enemy in cleared:
            self.onEnemyDefeated(enemy)

    # the talent skill verbs at least one present fairy has
    def getPartyKnownVerbs(self) -> Optional[set]:
        verbs: set = set()
        found = False

        for avId in self.activeFairies:
            avatar = self.air.doId2do.get(avId)
            if avatar is None:
                continue
            talentId = int(getattr(getattr(avatar, "fairyDNA", None), "talent", 0) or 0)
            level = int(avatar.getLevel() or 0)
            if not talentId or not level:
                continue
            found = True
            verbs.update(XPConfig.knownVerbs(talentId, level))

        return verbs if found else None

    # gatherables 
    # scatters the wilderness only ingredients through the cave
    def spawnGatherables(self, layout) -> None:
        corridor, run, reach = self.getCorridorReach(layout)
        if corridor is None:
            return

        chambers = len(self.getOrderedGates(layout)) + 1
        count = WildernessGatherables.stackCount(chambers)
        maxSteps = corridor.stepsAt(corridor.alongPath(run, reach)) if run else None
        spots = corridor.scatter(
            count, WildernessGatherables.MIN_SPACING, avoid=tuple(self.enemyPosts),
            maxSteps=maxSteps)
        if not spots:
            self.notify.warning(
                f"no room to scatter gatherables in zone {self.zoneId}")
            return

        for item, (x, y) in zip(WildernessGatherables.roll(len(spots)), spots):
            bunch = item.itemId in WildernessGatherables.BUNCH_ITEM_IDS and len(self.activeFairies) > 1
            stack = (DistributedMultiplayerSpawnStackAI if bunch else DistributedSpawnStackAI)(self.air)
            stack.setItemID(item.itemId)
            stack.setName(item.displayName)
            stack.setPosition(int(x), int(y))
            stack.setColorIDs([])
            stack.setItemCount(1)
            stack.setServingSize(1)
            stack.spawnMgr = self
            stack.generateOtpObject(
                self.parentId, self.zoneId, doId=self.air.allocateChannel())
            self.air.setAIReceiver(stack.getDoId(), self.air.ourChannel)
            self.gatherables.append(stack)

    # stacks call this when taken, so it vanishes for the whole party
    def onCollected(self, stack) -> None:
        if stack not in self.gatherables:
            return
        self.gatherables.remove(stack)
        stack.spawnMgr = None
        taskMgr.doMethodLater(1.5, lambda task: stack.requestDelete(),
                              f"wilderness-gatherable-{stack.getDoId()}")

    def removeGatherables(self) -> None:
        for stack in self.gatherables:
            stack.requestDelete()
        self.gatherables = []

    # the removable barriers, in the order the party meets them
    @staticmethod
    def getOrderedGates(layout) -> list:
        return list(getattr(layout, "gates", [])) if layout else []

    # the corridor, its deepest path
    @classmethod
    def getCorridorReach(cls, layout):
        corridor = WildernessPathing.corridorFor(layout)
        if corridor is None:
            return None, [], 0.0

        run = corridor.deepestPath()
        gates = cls.getOrderedGates(layout)
        lastGateMark = corridor.markAlongRun(run, (gates[-1].x, gates[-1].y)) if gates else 0.0
        reach = corridor.reachLimit(run, lastGateMark, cls.getPermanentBarrierPoints(layout))
        return corridor, run, reach

    # barriers that never open, wherever they sit in the layout
    @staticmethod
    def getPermanentBarrierPoints(layout) -> list:
        barriers = getattr(layout, "barriers", None) if layout else None
        if not barriers:
            return []
        return [(b.x, b.y) for b in barriers if not b.dynamic]

    # each enemy waits on the approach to the gate it guards, worked out once per layout and set of creatures
    @classmethod
    def getEnemyPositions(cls, layout, gates: list, originOffsets: list,
                        permanent: list = ()) -> list:
        count = len(originOffsets)
        if count <= 0:
            return []

        key = (getattr(layout, "zone_id", None), tuple(originOffsets))
        if key[0] is not None and key in cls.enemyPostCache:
            return list(cls.enemyPostCache[key])
        posts = cls.computeEnemyPositions(layout, gates, originOffsets, permanent)
        if key[0] is not None:
            cls.enemyPostCache[key] = list(posts)
        return posts

    enemyPostCache: Dict[tuple, list] = {}

    @classmethod
    def computeEnemyPositions(cls, layout, gates: list, originOffsets: list,
                              permanent: list = ()) -> list:
        count = len(originOffsets)

        corridor = WildernessPathing.corridorFor(layout)
        if corridor is None:
            cls.notify.warning(
                f"no walkable floor for layout {getattr(layout, 'zone_id', '?')}; "
                "enemies fall back to one spot")
            computed = [ENEMY_FALLBACK_POSITION] * count
        else:
            posts = corridor.guardPosts(
                [(g.x, g.y) for g in gates], originOffsets, ENEMY_GATE_STANDOFF,
                permanentPoints=permanent)
            while len(posts) < count:
                posts.append(ENEMY_FALLBACK_POSITION)
            computed = posts

        # every enemy stands up to ENEMY_DROP_PIXELS lower than its post so the grass patches
        posts = [cls.getDroppedPost(corridor, post, originOffsets[i]) for i, post in enumerate(computed)]
        return posts

    # post moved down by as much of ENEMY_DROP_PIXELS as the origin can take
    @staticmethod
    def getDroppedPost(corridor, post: tuple, originDy: int) -> tuple:
        x, y = post
        if corridor is None:
            return (x, y + ENEMY_DROP_PIXELS)

        needed = min(corridor.roomAt((x, y + originDy)), WildernessPathing.ORIGIN_MARGIN)
        for drop in range(ENEMY_DROP_PIXELS, -1, -ENEMY_DROP_STEP):
            if corridor.roomAt((x, y + drop + originDy)) >= needed:
                return (x, y + drop)
        return (x, y)

    # exit signs 
    # the signpost by the arrival point that walks a fairy back to the meadow the gateway
    def spawnExitSign(self, layout) -> None:
        self.layout = layout
        position = self.getNearExitPosition(layout)
        if position is not None:
            self.exitSign = self.buildExitSign(position)

    # the way out at the deep end of the run so a party that fought all the way in doesn't
    def spawnFarExitSign(self) -> None:
        if self.farExitSign is not None:
            return
        position = self.getFarExitPosition(self.layout)
        if position is not None:
            self.farExitSign = self.buildExitSign(position)

    def buildExitSign(self, position: tuple):
        sign = exitSignFor(self.wildernessId)
        if sign is None:
            self.notify.warning(
                f"no exit sign configured for wilderness {self.wildernessId}")
            return None

        gateway = DistributedGatewayAI(self.air)
        gateway.setName(str(sign["itemId"]))
        gateway.setPosition(int(position[0]), int(position[1]))
        gateway.setPositionByName("")
        gateway.setTargetLocationName("")
        gateway.setTargetZoneID(sign["zone"])
        gateway.setOpenState("open")
        gateway.setVelvetRope(0)
        gateway.setRewardList([])
        gateway.generateOtpObject(
            self.parentId, self.zoneId, doId=self.air.allocateChannel())
        self.air.setAIReceiver(gateway.getDoId(), self.air.ourChannel)
        return gateway

    # just off where the party lands
    @staticmethod
    def getNearExitPosition(layout) -> tuple:
        override = WildernessCoordOverrides.overrideForLayout(layout)
        if override is not None and override.nearExit is not None:
            return override.nearExit

        corridor = WildernessPathing.corridorFor(layout)
        if corridor is None:
            return EXIT_SIGN_FALLBACK_POSITION
        run = corridor.deepestPath()
        beside = corridor.alongPath(run, NEAR_EXIT_SETBACK) if run else layout.default_spawn
        spot = corridor.openFloorNear(beside, radius=3) or beside
        return (spot[0], spot[1] - EXIT_SIGN_RAISE)

    # the way out at the deep end of the reachable run, short of any permanent barrier
    @classmethod
    def getFarExitPosition(cls, layout) -> tuple:
        override = WildernessCoordOverrides.overrideForLayout(layout)
        if override is not None and override.farExit is not None:
            return override.farExit

        corridor, run, reach = cls.getCorridorReach(layout)
        if corridor is None or not run:
            return EXIT_SIGN_FALLBACK_POSITION
        deep = corridor.alongPath(run, max(0.0, reach - FAR_EXIT_SETBACK))
        spot = corridor.openFloorNear(deep, radius=3) or deep
        return (spot[0], spot[1] - EXIT_SIGN_RAISE)

    def removeExitSign(self) -> None:
        for sign in (self.exitSign, self.farExitSign):
            if sign is not None:
                sign.requestDelete()
        self.exitSign = None
        self.farExitSign = None

    def onEnemyDefeated(self, enemy: DistributedEnemyAI) -> None:
        if self.defeated:
            return

        self.openGate(self.enemyGates.pop(enemy.doId, None))

        # for wilderness badge progress
        creatureEvent = badge_events.CREATURE_TO_EVENT.get(enemy.itemId)
        if creatureEvent is not None:
            for avId in self.activeFairies:
                self.air.badgeManager.d_accumulate(avId, creatureEvent)

        if self.enemies and all(e.defeated for e in self.enemies.values()):
            self.grantRewards()
            self.spawnFarExitSign()
            self.completeRun()

    # drops a barrier for the rest of this instance's life so a fairy who arrives late
    def openGate(self, barrierIndex) -> None:
        if barrierIndex is None or barrierIndex not in self.activeBarriers:
            return
        self.b_setActiveBarriers(
            [i for i in self.activeBarriers if i != barrierIndex])

    def grantRewards(self) -> None:
        if self.rewardsGranted:
            return
        self.rewardsGranted = True

        ingredient = REWARD_INGREDIENT.get(self.wildernessId, fc.TWIGS)
        # per microgame, as the config's own name says, counting creatures paid 2-4 points for a whole run
        spellsCast = sum(
            1 for enemy in self.enemies.values()
            for result in enemy.gamesDefeated if result == WC.MG_WON)
        baseXp = XPConfig.WILDERNESS_XP_PER_MICROGAME * spellsCast

        for avId in self.activeFairies:
            # goes through the uberdog so it lands even when the fairy is on another district
            self.air.badgeManager.d_accumulate(
                avId,
                badge_events.EVENT_LED_WILDERNESS if avId == self.leaderId
                else badge_events.EVENT_JOINED_WILDERNESS)

            av = self.air.doId2do.get(avId)
            xp = max(XPConfig.WILDERNESS_MIN_XP, baseXp * XPConfig.getBalanceRate("wilderness"))

            if av is None:
                # avatar is on another district's AI, so no live update and no quest credit
                self.notify.warning(f"wilderness reward for {avId}: not local, paid to the database, xp {xp}")
                self.air.inventoryManager.addIngredientsToPouch(avId, ingredient, 1, -1)
                self.air.experienceManager.grantOfflineExp(avId, xp, source="wilderness")
                continue

            if self.air.inventoryManager.addIngredientsToPouch(avId, ingredient, 1, -1):
                av.d_setPouch(self.air.inventoryManager.getPouch(avId))

            self.notify.info(f"wilderness reward for {avId}: xp {xp}")
            self.air.experienceManager.grantExp(avId, xp, source="wilderness")

            QuestMgr.getInstance().addQuestGoalProgress(
                self.air, avId, QUEST_TYPE_ADVENTURE, amount=1, adventure_id=self.adventureId)

    def removeEnemies(self) -> None:
        for enemy in list(self.enemies.values()):
            enemy.requestDelete()
        self.enemies.clear()
        self.enemyGates.clear()

    # starts waiting for arrivals, falls back to a timer for a client that never checks in
    def armAllPlayersReady(self) -> None:
        taskMgr.doMethodLater(
            ALL_READY_FALLBACK_SECONDS, self.sendAllPlayersReady, f"wildReady-{self.doId}")

    # distributedMeadow field the client fires from afterGenerate()
    def requestHotspotStates(self) -> None:
        avId = self.air.getAvatarIdFromSender()
        if avId not in self.activeFairies:
            return
        self.arrivedFairies.add(avId)
        self.sendUpdateToAvatarId(avId, "setHotspotStates", [avId, []])
        if not self.allReadySent and self.arrivedFairies.issuperset(self.activeFairies):
            taskMgr.remove(f"wildReady-{self.doId}")
            self.sendAllPlayersReady()

    def sendAllPlayersReady(self, _task=None):
        if self.allReadySent:
            return Task.done
        self.allReadySent = True

        count = len(self.activeFairies)
        for avId in self.activeFairies:
            av = self.air.doId2do.get(avId)
            if av is not None:
                av.sendUpdate("allPlayersReady", [self.doId, count, 0, 0])
            else:
                self.air.sendUpdateToDoId(
                    "DistributedFairyPlayer", "allPlayersReady", avId,
                    [self.doId, count, 0, 0], channelId=avId)

        if WAKE_ON_ENTRY:
            for n, enemy in enumerate(self.enemies.values()):
                taskMgr.doMethodLater(
                    WAKE_FIRST_SECONDS + WAKE_STAGGER_SECONDS * n, self.wakeEnemy, f"wildWake-{self.doId}-{n}",
                    extraArgs=[enemy], appendTask=False)
        return Task.done

    def wakeEnemy(self, enemy: DistributedEnemyAI) -> None:
        if enemy.state != WC.ENEMY_HIDDEN or enemy.defeated:
            return
        if any(e.currentGameIndex >= 0 or e.state == WC.ENEMY_ACTIVE for e in self.enemies.values()):
            taskMgr.doMethodLater(WAKE_RETRY_SECONDS, self.wakeEnemy, f"wildWake-{self.doId}-{enemy.doId}",
                                  extraArgs=[enemy], appendTask=False)
            return
        enemy.b_setEnemyState(WC.ENEMY_ANIMATED)

    def delete(self) -> None:
        for t in (f"wildTeardown-{self.doId}", f"wildReady-{self.doId}",
                  f"wildCleanOut-{self.doId}"):
            taskMgr.remove(t)
        for n in range(len(self.enemies)):
            taskMgr.remove(f"wildWake-{self.doId}-{n}")
        for enemy in self.enemies.values():
            taskMgr.remove(f"wildWake-{self.doId}-{enemy.doId}")
        self.removeEnemies()
        self.removeGatherables()
        self.removeExitSign()
        super().delete()
