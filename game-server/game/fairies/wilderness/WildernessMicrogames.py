
import math
import random
from typing import List, Optional

from game.fairies.wilderness.WildernessChallenges import (
    MECH_CLICK,
    MECH_CLICK_MANY,
    MECH_DRAG_INTO,
    MECH_DRAG_OFF,
    MECH_DRAG_ONTO,
    MECH_FAST_CLICK,
    MECH_FAST_CLICK_MANY,
    MECH_ROLL_OVER,
    MECH_SHAKE,
)

# everything gamePrep/gameStart/gameUpdate carries is int8[] on the wire so every
WIRE_MAX = 127

# GameGridUtil lays the grid out as rows*rows blocks per player
GRID_ROWS = 7
GRID_BLOCKS = GRID_ROWS * GRID_ROWS
NO_MOVE = -1
POINTS_PER_OBJECT = 10
OBJECTS_PER_PLAYER = 3
ROLLOVER_OBJECTS_PER_PLAYER = 12
ROLLOVER_POINTS_EACH = 1
C_INNER_RADIUS = 1.8
C_OUTER_RADIUS = 3.2
C_OPENING_DEGREES = 80
CLICKS_PER_PLAYER = 7
POINTS_PER_CLICK = 1
DRAG_OBJECTS_PER_PLAYER = 5
# several fairies each get one pile of exactly this many
DRAG_PILE_SIZE = 5
CLICKS_TO_FILL = 4
SHAKE_DRAG_TENTHS = 20
SHAKE_SETTLE_SECONDS = 2.0
BRUSH_SIZE = 1
DRAG_IDLE = 0
DRAG_HELD = 1
DRAG_DONE = 2
SHAKE_SHAKING = 0
SHAKE_STILL = 1
SHAKE_DROP = 2
DRAG_TARGET_BLOCK = 24
DRAG_TARGET_OFFSET_X = 0
DRAG_TARGET_OFFSET_Y = 0


# clickAndDragSort (drag into) gives every fairy a basket of their own instead of one shared target,
# its targetPositions, and reads a prep record per fairy as [offset, ?, ?, points] where move/remove read 3 slots
SORT_BASKET_BLOCKS = (14, 41, 20, 35)
SORT_PREP_STRIDE = 4


# the blocks that sit inside the target's collision box
def blocksOnTarget(target: int = DRAG_TARGET_BLOCK) -> List[int]:
    row, col = divmod(target, GRID_ROWS)
    return [r * GRID_ROWS + c
            for r in range(row - 1, row + 2)
            for c in range(col - 1, col + 2)
            if 0 <= r < GRID_ROWS and 0 <= c < GRID_ROWS]


# the blocks that make a C around the middle of the grid, where the enemy is, for rollover minigame
def cShapeBlocks() -> List[int]:
    centerRow, centerCol = divmod(DRAG_TARGET_BLOCK, GRID_ROWS)
    found = []

    for row in range(GRID_ROWS):
        for col in range(GRID_ROWS):
            across, down = col - centerCol, row - centerRow
            if not C_INNER_RADIUS <= math.hypot(across, down) <= C_OUTER_RADIUS:
                continue

            angle = math.degrees(math.atan2(down, across))
            if abs(angle) <= C_OPENING_DEGREES / 2:
                continue

            found.append(((angle + 360) % 360, row * GRID_ROWS + col))

    return [block for _, block in sorted(found)]


def makePadding(size: int) -> List[int]:
    return [0] * size


def blockDistance(a: int, b: int) -> int:
    rowA, colA = divmod(a, GRID_ROWS)
    rowB, colB = divmod(b, GRID_ROWS)
    return max(abs(rowA - rowB), abs(colA - colB))


# one of the blocks farthest from every taken block, up to three apart
# a seat only nudges an object 11px off its block and a block is 44px, so neighbours overlap
def pickApart(pool: List[int], taken) -> Optional[int]:
    if not pool:
        return None

    taken = list(taken)
    reach = {b: min((blockDistance(b, t) for t in taken), default=3) for b in pool}
    best = min(max(reach.values()), 3)
    return random.choice([b for b in pool if reach[b] >= best])


class Round:

    # where the player count sits in prepData, and how wide a player record is
    prepPlayersOffset = 5
    prepPlayerStride = 2

    # seconds to hold a won round open after the goal is reached so the mechanic's
    settleSeconds = 0.0

    def __init__(self, playerCount: int) -> None:
        self.playerCount = max(1, playerCount)
        self.total = 0
        self.goal = 0

    @property
    def won(self) -> bool:
        return self.goal > 0 and self.total >= self.goal

    # what the board looks like right now, for the log line a rejected click prints
    def debugState(self) -> str:
        return f"{self.total}/{self.goal}"

    # who is playing, as the offsets the client matches itself against
    def prepData(self) -> List[int]:
        prep = makePadding(self.prepPlayersOffset)
        prep.append(self.playerCount)

        for offset in range(self.playerCount):
            prep.extend(self.prepPlayerRecord(offset))

        prep.append(0)

        return prep

    def prepPlayerRecord(self, offset: int) -> List[int]:
        record = makePadding(self.prepPlayerStride)
        record[0] = offset
        return record

    # the opening board
    def gameData(self) -> List[int]:
        raise NotImplementedError

    # what the last accepted move changed
    def updateData(self) -> List[int]:
        raise NotImplementedError

    # take one move. False means it wasn't one we were waiting for
    def applyMove(self, playerOffset: int, moveState: list) -> bool:
        raise NotImplementedError


# singleclick single/multiple spawning, and rollover spawning
class GridRound(Round):

    def __init__(self, playerCount: int, mechId: int) -> None:
        super().__init__(playerCount)
        self.mechId = mechId
        # single spawning shows one object at a time
        self.oneAtATime = mechId == MECH_CLICK
        self.replenishes = mechId in (MECH_CLICK, MECH_CLICK_MANY)

        self.rollover = mechId == MECH_ROLL_OVER
        # one fairy at a time in roster order, the others wait their turn
        self.sequential = mechId in (MECH_CLICK, MECH_CLICK_MANY, MECH_ROLL_OVER)
        self.turnPlayer = 0

        if self.rollover:
            quota = ROLLOVER_OBJECTS_PER_PLAYER
            self.pointsEach = ROLLOVER_POINTS_EACH
        elif self.replenishes:
            quota = CLICKS_PER_PLAYER
            self.pointsEach = POINTS_PER_CLICK
        else:
            quota = OBJECTS_PER_PLAYER
            self.pointsEach = POINTS_PER_OBJECT

        self.remaining = {offset: quota for offset in range(self.playerCount)}
        self.live: set[tuple[int, int]] = set()
        self.goal = self.pointsEach * quota * self.playerCount

        self.movePlayer = NO_MOVE
        self.moveBlock = NO_MOVE
        self.movePoints = 0
        self.spawns: List[tuple[int, int]] = []

        if self.rollover:
            # Give each fairy the same board in roster order, one turn at a time.
            cells = cShapeBlocks()
            self.rolloverShape = random.sample(cells, min(quota, len(cells)))
            for offset in range(self.playerCount):
                self.remaining[offset] = len(self.rolloverShape)
            self.goal = self.pointsEach * len(self.rolloverShape) * self.playerCount
            self.spawnRolloverPlayer()
            return

        for offset in ([0] if self.sequential else range(self.playerCount)):
            self.spawnOpening(offset)

    def spawnOpening(self, offset: int) -> None:
        for _ in range(1 if self.oneAtATime else OBJECTS_PER_PLAYER):
            self.spawnObject(offset)

    def spawnRolloverPlayer(self) -> None:
        for block in self.rolloverShape:
            self.live.add((self.turnPlayer, block))
            self.spawns.append((self.turnPlayer, block))

    def pickFreeBlock(self, offset: int) -> Optional[int]:
        return pickApart(list(range(GRID_BLOCKS)), {block for _, block in self.live})

    def spawnObject(self, offset: int) -> None:
        if self.remaining.get(offset, 0) <= len([1 for player, _ in self.live if player == offset]):
            return

        block = self.pickFreeBlock(offset)
        if block is None:
            return

        self.live.add((offset, block))
        self.spawns.append((offset, block))

    def debugState(self) -> str:
        return f"live={sorted(self.live)}"

    def buildHeader(self) -> List[int]:
        header = makePadding(6)
        header[0] = self.goal
        header[1] = self.total
        header[2] = self.movePlayer
        header[3] = self.moveBlock
        header[4] = BRUSH_SIZE if self.mechId == MECH_ROLL_OVER else self.movePoints
        header[5] = len(self.spawns)
        return header

    def buildDataWithSpawns(self) -> List[int]:
        data = self.buildHeader()
        for offset, block in self.spawns:
            data.extend([offset, block])
        return data

    def gameData(self) -> List[int]:
        return self.buildDataWithSpawns()

    def updateData(self) -> List[int]:
        return self.buildDataWithSpawns()

    def applyMove(self, playerOffset: int, moveState: list) -> bool:
        if not moveState:
            return False

        if self.sequential and playerOffset != self.turnPlayer:
            return False

        claim = (playerOffset, int(moveState[0]))
        if claim not in self.live:
            return False

        self.live.remove(claim)
        self.remaining[playerOffset] = max(0, self.remaining.get(playerOffset, 0) - 1)
        self.total += self.pointsEach
        self.movePlayer = playerOffset
        self.moveBlock = claim[1]
        self.movePoints = self.pointsEach
        self.spawns = []

        if self.replenishes:
            self.spawnObject(playerOffset)

        if self.sequential and self.remaining[playerOffset] == 0:
            self.turnPlayer += 1
            if self.turnPlayer < self.playerCount:
                if self.rollover:
                    self.spawnRolloverPlayer()
                else:
                    self.spawnOpening(self.turnPlayer)

        return True


# fastClick single: one meter per fairy, filled by clicking it
class FastClickSingleRound(Round):

    prepPlayerStride = 3

    # fastClickSingle.targetPositions, where each player's meter sits
    METER_BLOCKS = (8, 40, 12, 36)
    CLICKS_PER_METER = 8
    POINTS_PER_CLICK = 1

    def __init__(self, playerCount: int) -> None:
        super().__init__(playerCount)
        self.clicked = {offset: 0 for offset in range(self.playerCount)}
        self.goal = POINTS_PER_OBJECT * self.playerCount
        self.movePlayer = NO_MOVE

    def prepData(self) -> List[int]:
        prep = makePadding(self.prepPlayersOffset)
        prep[0] = self.CLICKS_PER_METER
        prep.append(self.playerCount)

        for offset in range(self.playerCount):
            prep.extend([offset, 0, self.POINTS_PER_CLICK])

        prep.append(0)
        return prep

    def prepPlayerRecord(self, offset: int) -> List[int]:
        return [offset, 0, self.POINTS_PER_CLICK]

    def buildBoard(self) -> List[int]:
        # long enough to carry a slot at every player's meter position
        data = makePadding(max(self.METER_BLOCKS) + 1)
        data[0] = self.goal
        data[1] = self.clicked.get(self.movePlayer, 0) if self.movePlayer != NO_MOVE else 0
        data[2] = self.movePlayer

        for offset in range(self.playerCount):
            left = self.CLICKS_PER_METER - self.clicked.get(offset, 0)
            data[self.METER_BLOCKS[offset % len(self.METER_BLOCKS)]] = max(0, left)

        return data

    def gameData(self) -> List[int]:
        return self.buildBoard()

    def updateData(self) -> List[int]:
        return self.buildBoard()

    def applyMove(self, playerOffset: int, moveState: list) -> bool:
        if not moveState:
            return False

        block = int(moveState[0])
        if block != self.METER_BLOCKS[playerOffset % len(self.METER_BLOCKS)]:
            return False
        if self.clicked.get(playerOffset, 0) >= self.CLICKS_PER_METER:
            return False

        self.clicked[playerOffset] = self.clicked.get(playerOffset, 0) + self.POINTS_PER_CLICK
        self.movePlayer = playerOffset

        if self.clicked[playerOffset] >= self.CLICKS_PER_METER:
            self.total += POINTS_PER_OBJECT

        return True


# fastClick multiple: objects that take several clicks to fill
class FastClickRound(Round):

    def __init__(self, playerCount: int, mechId: int) -> None:
        super().__init__(playerCount)
        self.oneAtATime = False

        self.remaining = {offset: OBJECTS_PER_PLAYER for offset in range(self.playerCount)}
        self.live: dict[tuple[int, int], int] = {}
        self.goal = POINTS_PER_OBJECT * OBJECTS_PER_PLAYER * self.playerCount

        self.movePlayer = NO_MOVE
        self.moveBlock = NO_MOVE
        self.moveFill = 0
        self.movePoints = 0
        self.spawns: List[tuple[int, int]] = []

        for offset in range(self.playerCount):
            for _ in range(1 if self.oneAtATime else OBJECTS_PER_PLAYER):
                self.spawnObject(offset)

    def spawnObject(self, offset: int) -> None:
        onScreen = len([1 for player, _ in self.live if player == offset])
        if self.remaining.get(offset, 0) <= onScreen:
            return

        block = pickApart(list(range(GRID_BLOCKS)), {block for _, block in self.live})
        if block is None:
            return

        self.live[(offset, block)] = CLICKS_TO_FILL
        self.spawns.append((offset, block))

    def debugState(self) -> str:
        return f"live={sorted(self.live.items())}"

    def buildHeader(self) -> List[int]:
        # fastClickMultiple has no movePoints slot
        header = makePadding(6)
        header[0] = self.goal
        header[1] = self.total
        header[2] = self.movePlayer
        header[3] = self.moveBlock
        header[4] = self.moveFill
        header[5] = len(self.spawns)
        return header

    def buildDataWithSpawns(self) -> List[int]:
        data = self.buildHeader()
        for offset, block in self.spawns:
            data.extend([offset, block, CLICKS_TO_FILL])
        return data

    def gameData(self) -> List[int]:
        return self.buildDataWithSpawns()

    def updateData(self) -> List[int]:
        return self.buildDataWithSpawns()

    def applyMove(self, playerOffset: int, moveState: list) -> bool:
        if not moveState:
            return False

        key = (playerOffset, int(moveState[0]))
        if key not in self.live:
            return False

        left = self.live[key] - 1
        self.movePlayer = playerOffset
        self.moveBlock = key[1]
        self.moveFill = max(0, left)
        self.movePoints = 0
        self.spawns = []

        if left > 0:
            self.live[key] = left
            return True

        del self.live[key]
        self.remaining[playerOffset] = max(0, self.remaining.get(playerOffset, 0) - 1)
        self.total += POINTS_PER_OBJECT
        self.movePoints = POINTS_PER_OBJECT

        if self.oneAtATime:
            self.spawnObject(playerOffset)

        return True


# clickAndDrag move/remove/sort
class DragRound(Round):

    prepPlayersOffset = 9
    prepPlayerStride = 3

    def __init__(self, playerCount: int, mechId: int) -> None:
        super().__init__(playerCount)
        self.mechId = mechId

        self.sort = mechId == MECH_DRAG_INTO
        if self.sort:
            self.prepPlayerStride = SORT_PREP_STRIDE

        # a drag off object has to start on the target
        self.spawnPool = list(blocksOnTarget() if mechId == MECH_DRAG_OFF else range(GRID_BLOCKS))
        if self.sort:
            # nothing starts on top of anyone's basket
            covered = {b for offset in range(self.playerCount) for b in blocksOnTarget(self.basketBlock(offset))}
            self.spawnPool = [b for b in self.spawnPool if b not in covered]

        # with company each fairy gets one pile of exactly what the goal needs, solo spreads them about
        self.piled = self.playerCount > 1
        quota = DRAG_PILE_SIZE if self.piled else CLICKS_PER_PLAYER
        if self.piled and mechId not in (MECH_DRAG_OFF, MECH_DRAG_INTO):
            onTarget = set(blocksOnTarget())
            self.spawnPool = [b for b in self.spawnPool if b not in onTarget]

        self.objects: dict[int, List[dict]] = {offset: [] for offset in range(self.playerCount)}
        self.remaining = {offset: quota for offset in range(self.playerCount)}
        self.goal = POINTS_PER_CLICK * quota * self.playerCount

        self.movePlayer = NO_MOVE
        self.moveIndex = NO_MOVE
        self.movePoints = 0
        self.moveState = DRAG_IDLE
        self.spawns: List[tuple[int, int, int]] = []
        # every object in the order it was sent to the clients, as (owner offset, index within the owner's list)
        self.spawnOrder: List[tuple[int, int]] = []
        # offsets whose client numbers objects across the whole table instead of within its own pile
        self.tableIndexed: set[int] = set()

        if self.piled:
            pileBlocks: List[int] = []
            for offset in range(self.playerCount):
                block = pickApart(self.spawnPool, pileBlocks)
                pileBlocks.append(block)
                for _ in range(self.remaining[offset]):
                    self.addObject(offset, block)
            return

        for offset in range(self.playerCount):
            for _ in range(min(DRAG_OBJECTS_PER_PLAYER, self.remaining[offset])):
                self.spawnObject(offset)

    def countLiveObjects(self, offset: int) -> int:
        return sum(1 for e in self.objects[offset] if e["state"] != DRAG_DONE)

    def pickFreeBlock(self, offset: int) -> Optional[int]:
        taken = {e["block"] for e in self.objects[offset] if e["state"] != DRAG_DONE}
        free = [b for b in self.spawnPool if b not in taken]
        if free:
            return random.choice(free)
        return random.choice(self.spawnPool) if self.spawnPool else None

    def spawnObject(self, offset: int) -> None:
        if self.piled:
            return

        if self.remaining.get(offset, 0) <= 0 or self.countLiveObjects(offset) >= DRAG_OBJECTS_PER_PLAYER:
            return

        block = self.pickFreeBlock(offset)
        if block is None:
            return

        self.addObject(offset, block)

    def addObject(self, offset: int, block: int) -> None:
        self.spawnOrder.append((offset, len(self.objects[offset])))
        self.objects[offset].append({"block": block, "state": DRAG_IDLE})
        self.spawns.append((offset, block, DRAG_IDLE))

    # a client names an object by its place in its own list, or by its place among everything on the table.
    # the second shows up as the party leader (offset 0, where both agree) being the only one who can score
    def resolveObject(self, playerOffset: int, index: int) -> Optional[int]:
        objects = self.objects.get(playerOffset, [])

        if playerOffset not in self.tableIndexed and 0 <= index < len(objects):
            return index

        if 0 <= index < len(self.spawnOrder):
            owner, local = self.spawnOrder[index]
            if owner == playerOffset:
                if playerOffset not in self.tableIndexed and playerOffset != 0:
                    print(f"[Wilderness] player {playerOffset} numbers drag objects across the table "
                          f"(sent {index}, own object {local})")
                    self.tableIndexed.add(playerOffset)
                return local

        if playerOffset in self.tableIndexed and 0 <= index < len(objects):
            return index

        return None

    def debugState(self) -> str:
        return f"objects={ {o: [e['state'] for e in v] for o, v in self.objects.items()} }"

    @staticmethod
    def basketBlock(offset: int) -> int:
        return SORT_BASKET_BLOCKS[offset % len(SORT_BASKET_BLOCKS)]

    def prepPlayerRecord(self, offset: int) -> List[int]:
        record = makePadding(self.prepPlayerStride)
        record[0] = offset
        if self.sort:
            # the points one object is worth to this fairy, shown on their basket
            record[3] = POINTS_PER_CLICK
        return record

    def prepData(self) -> List[int]:
        prep = makePadding(self.prepPlayersOffset)
        prep[6] = DRAG_TARGET_BLOCK
        prep[7] = DRAG_TARGET_OFFSET_X
        prep[8] = DRAG_TARGET_OFFSET_Y
        prep.append(self.playerCount)

        for offset in range(self.playerCount):
            prep.extend(self.prepPlayerRecord(offset))

        prep.append(0)
        return prep

    def buildHeader(self) -> List[int]:
        header = makePadding(7)
        header[0] = self.goal
        header[1] = self.total
        header[2] = self.movePlayer
        header[3] = self.moveIndex
        header[4] = self.movePoints
        header[5] = self.moveState
        header[6] = len(self.spawns)
        return header

    def buildDataWithSpawns(self) -> List[int]:
        data = self.buildHeader()
        for offset, block, state in self.spawns:
            data.extend([offset, block, state])
        return data

    def gameData(self) -> List[int]:
        return self.buildDataWithSpawns()

    def updateData(self) -> List[int]:
        return self.buildDataWithSpawns()

    def applyMove(self, playerOffset: int, moveState: list) -> bool:
        if len(moveState) < 2:
            return False

        sent = int(moveState[0])
        state = int(moveState[1])
        objects = self.objects.get(playerOffset, [])

        index = self.resolveObject(playerOffset, sent)
        if index is None:
            return False

        entry = objects[index]
        if entry["state"] == DRAG_DONE or state not in (DRAG_IDLE, DRAG_HELD, DRAG_DONE):
            return False

        entry["state"] = state
        self.movePlayer = playerOffset
        # the others' clients read it the way the sender wrote it
        self.moveIndex = sent if playerOffset in self.tableIndexed else index
        self.moveState = state
        self.movePoints = 0
        self.spawns = []

        # picking one up and putting it back down are relayed so the other fairies see it move
        if state == DRAG_DONE:
            self.total += POINTS_PER_CLICK
            self.movePoints = POINTS_PER_CLICK
            self.remaining[playerOffset] = max(0, self.remaining.get(playerOffset, 0) - 1)
            self.spawnObject(playerOffset)

        return True


# shake: one object per fairy, shaken until things fall out of it
class ShakeRound(Round):

    prepPlayersOffset = 4
    prepPlayerStride = 2
    settleSeconds = SHAKE_SETTLE_SECONDS

    def __init__(self, playerCount: int) -> None:
        super().__init__(playerCount)
        self.dropsLeft = {offset: CLICKS_PER_PLAYER for offset in range(self.playerCount)}
        self.goal = POINTS_PER_CLICK * CLICKS_PER_PLAYER * self.playerCount

        self.movePlayer = NO_MOVE
        self.moveState = SHAKE_STILL

    def prepPlayerRecord(self, offset: int) -> List[int]:
        return [offset, SHAKE_DRAG_TENTHS]

    def buildHeader(self) -> List[int]:
        header = makePadding(4)
        header[0] = self.goal
        header[1] = self.total
        header[2] = self.movePlayer
        header[3] = self.moveState
        return header

    def gameData(self) -> List[int]:
        return self.buildHeader()

    def updateData(self) -> List[int]:
        return self.buildHeader()

    def applyMove(self, playerOffset: int, moveState: list) -> bool:
        if not moveState:
            return False

        state = int(moveState[0])
        if state not in (SHAKE_SHAKING, SHAKE_STILL, SHAKE_DROP):
            return False

        self.movePlayer = playerOffset
        self.moveState = state

        if state != SHAKE_DROP:
            return True

        if self.dropsLeft.get(playerOffset, 0) <= 0:
            # their own tree is bare, let the shake show but don't score it
            return True

        self.dropsLeft[playerOffset] -= 1
        self.total += POINTS_PER_CLICK
        return True


GRID_MECHS = (MECH_CLICK, MECH_CLICK_MANY, MECH_ROLL_OVER)
FAST_CLICK_MECHS = (MECH_FAST_CLICK, MECH_FAST_CLICK_MANY)
DRAG_MECHS = (MECH_DRAG_ONTO, MECH_DRAG_OFF, MECH_DRAG_INTO)


def asPlayableStruct(spec) -> list:
    return spec.asStruct()


def roundFor(mechId: int, playerCount: int) -> Optional[Round]:
    if mechId in GRID_MECHS:
        return GridRound(playerCount, mechId)
    if mechId == MECH_FAST_CLICK:
        return FastClickSingleRound(playerCount)
    if mechId == MECH_FAST_CLICK_MANY:
        return FastClickRound(playerCount, mechId)
    if mechId in DRAG_MECHS:
        return DragRound(playerCount, mechId)
    if mechId == MECH_SHAKE:
        return ShakeRound(playerCount)

    return None
