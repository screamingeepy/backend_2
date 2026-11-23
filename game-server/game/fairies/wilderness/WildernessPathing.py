
import math
import random
from typing import Dict, List, Optional, Tuple

from direct.directnotify import DirectNotifyGlobal

notify = DirectNotifyGlobal.directNotify.newCategory("WildernessPathing")

# floor sampling step, passages are wider than this and the biggest layout is about 3200x5000
CELL_SIZE = 40
NEIGHBORS = ((1, 0), (-1, 0), (0, 1), (0, -1),
              (1, 1), (1, -1), (-1, 1), (-1, -1))
# how far a gate may sit from the floor before its coordinate is treated as meaningless
MAX_GATE_SNAP = 600.0
# how much clear floor an enemy's origin needs around it
ORIGIN_MARGIN = 2
# and how much the creature itself needs so it isn't drawn jammed into a wall
POST_MARGIN = 2
# how far off a route a post may be nudged
SEARCH_RADIUS = 8
# the client wakes an enemy when the fairy's sprite overlaps its hit box, both measured in pixels
WAKE_HIT = 81
WAKE_FAIRY_HEIGHT = 170
WAKE_HALF_REACH = 81
# overlap known to wake in the game, and the most a post is worth chasing
WAKE_OK = 34
WAKE_GOOD = 60
# candidates the exact check is run on after the quick ranking
WAKE_FINALISTS = 4
# how far past the edge of the floor an enemy's origin is sunk, the grass patch is meant to sit behind the terrain
# 0 puts it right on the edge, more buries it, None leaves it wherever the floor had room
ORIGIN_SINK_PIXELS = 0

Point = Tuple[int, int]


def pointInPolygon(point: tuple, polygon: list) -> bool:
    x, y = point
    inside = False
    j = len(polygon) - 1

    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i

    return inside


# the walkable floor of one layout
class CorridorMap:

    def __init__(self, validArea: list, spawn: tuple) -> None:
        self.spawn = (int(spawn[0]), int(spawn[1]))
        self.validArea = list(validArea)
        xs = [v[0] for v in validArea]
        ys = [v[1] for v in validArea]
        self.minX = int(min(xs)) - CELL_SIZE
        self.minY = int(min(ys)) - CELL_SIZE
        self.cols = int((max(xs) - self.minX) // CELL_SIZE) + 2
        self.rows = int((max(ys) - self.minY) // CELL_SIZE) + 2

        self.walkable = [False] * (self.cols * self.rows)
        self.rasterize(validArea)

        self.cameFrom: Dict[int, int] = {}
        self.stepsFrom: Dict[int, int] = {}
        self.clearance: List[int] = []
        self.flood()
        self.measureClearance()

    # marks the floor a row at a time
    def rasterize(self, validArea: list) -> None:
        edges = list(zip(validArea, validArea[-1:] + validArea[:-1]))

        for row in range(self.rows):
            y = self.minY + (row + 0.5) * CELL_SIZE
            crossings = sorted(
                x1 + (x2 - x1) * (y - y1) / (y2 - y1)
                for (x1, y1), (x2, y2) in edges if (y1 > y) != (y2 > y))
            base = row * self.cols
            for i in range(0, len(crossings) - 1, 2):
                left, right = crossings[i], crossings[i + 1]
                first = int(math.ceil((left - self.minX) / CELL_SIZE - 0.5))
                last = int(math.floor((right - self.minX) / CELL_SIZE - 0.5))
                for col in range(max(0, first), min(self.cols - 1, last) + 1):
                    self.walkable[base + col] = True

    def worldOf(self, col: int, row: int) -> Point:
        return (int(self.minX + (col + 0.5) * CELL_SIZE),
                int(self.minY + (row + 0.5) * CELL_SIZE))

    def cellOf(self, point: tuple) -> int:
        col = min(self.cols - 1, max(0, int((point[0] - self.minX) // CELL_SIZE)))
        row = min(self.rows - 1, max(0, int((point[1] - self.minY) // CELL_SIZE)))
        return row * self.cols + col

    def worldOfCell(self, cell: int) -> Point:
        return self.worldOf(cell % self.cols, cell // self.cols)

    def flood(self) -> None:
        start = self.nearestWalkable(self.spawn)
        if start is None:
            notify.warning("layout spawn %s is not on the walkable floor" % (self.spawn,))
            return

        self.stepsFrom[start] = 0
        queue = [start]
        head = 0
        while head < len(queue):
            cell = queue[head]
            head += 1
            col, row = cell % self.cols, cell // self.cols
            for dx, dy in NEIGHBORS:
                nc, nr = col + dx, row + dy
                if not (0 <= nc < self.cols and 0 <= nr < self.rows):
                    continue
                nextCell = nr * self.cols + nc
                if nextCell in self.stepsFrom or not self.walkable[nextCell]:
                    continue
                self.stepsFrom[nextCell] = self.stepsFrom[cell] + 1
                self.cameFrom[nextCell] = cell
                queue.append(nextCell)

    # how far each floor sample is from the nearest wall, in samples
    def measureClearance(self) -> None:
        self.clearance = [0] * len(self.walkable)
        queue = []
        for cell, isFloor in enumerate(self.walkable):
            if isFloor:
                continue
            self.clearance[cell] = 0
            queue.append(cell)

        seen = set(queue)
        head = 0
        while head < len(queue):
            cell = queue[head]
            head += 1
            col, row = cell % self.cols, cell // self.cols
            for dx, dy in NEIGHBORS:
                nc, nr = col + dx, row + dy
                if not (0 <= nc < self.cols and 0 <= nr < self.rows):
                    continue
                nextCell = nr * self.cols + nc
                if nextCell in seen:
                    continue
                seen.add(nextCell)
                self.clearance[nextCell] = self.clearance[cell] + 1
                queue.append(nextCell)

    # the nearest spot to point that a creature can stand on, tunable if you can't see enemies
    def openFloorNear(self, point: Point, radius: int = SEARCH_RADIUS,
                      originDy: int = 0) -> Optional[Point]:
        here = self.cellOf(point)
        col, row = here % self.cols, here // self.cols
        best, bestGap = None, None
        for dr in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                gap = dc * dc + dr * dr
                if bestGap is not None and gap >= bestGap:
                    continue
                nc, nr = col + dc, row + dr
                if not (0 <= nc < self.cols and 0 <= nr < self.rows):
                    continue
                cell = nr * self.cols + nc
                if cell not in self.stepsFrom or self.clearance[cell] < POST_MARGIN:
                    continue
                spot = self.worldOfCell(cell)
                if self.roomAt((spot[0], spot[1] + originDy)) < ORIGIN_MARGIN:
                    continue
                best, bestGap = spot, gap
        return best

    # how far the floor runs in every direction from point
    def roomAt(self, point: tuple) -> int:
        cell = self.cellOf(point)
        wx, wy = self.worldOfCell(cell)
        if abs(wx - point[0]) > CELL_SIZE or abs(wy - point[1]) > CELL_SIZE:
            return 0
        if not self.walkable[cell]:
            return 0
        return self.clearance[cell]

    # the floor sample closest to point
    def nearestWalkable(self, point: tuple, reachableOnly: bool = False) -> Optional[int]:
        best = None
        bestGap = None
        for cell, isFloor in enumerate(self.walkable):
            if not isFloor:
                continue
            if reachableOnly and cell not in self.stepsFrom:
                continue
            wx, wy = self.worldOfCell(cell)
            gap = (wx - point[0]) ** 2 + (wy - point[1]) ** 2
            if bestGap is None or gap < bestGap:
                best, bestGap = cell, gap
        return best

    @property
    def usable(self) -> bool:
        return len(self.stepsFrom) > 1

    # floor positions from the party's arrival point to point
    def pathTo(self, point: tuple) -> List[Point]:
        cell = self.nearestWalkable(point, reachableOnly=True)
        if cell is None:
            return []
        path = []
        while cell is not None:
            path.append(self.worldOfCell(cell))
            cell = self.cameFrom.get(cell)
        path.reverse()
        return path

    # the way to the far end of the layout
    def deepestPath(self) -> List[Point]:
        if not self.stepsFrom:
            return []
        far = max(self.stepsFrom, key=lambda c: self.stepsFrom[c])
        return self.pathTo(self.worldOfCell(far))

    # how far along run its closest point to point sits
    def markAlongRun(self, run: List[Point], point: tuple) -> float:
        if not run:
            return 0.0
        nearest = min(range(len(run)),
                     key=lambda i: math.hypot(run[i][0] - point[0], run[i][1] - point[1]))
        return self.walkLength(run[:nearest + 1])

    # how far the party can actually get along run
    def reachLimit(self, run: List[Point], pastMark: float,
                   permanentPoints: List[tuple]) -> float:
        runLength = self.walkLength(run)
        beyond = [self.markAlongRun(run, p) for p in permanentPoints]
        beyond = [m for m in beyond if m > pastMark + CELL_SIZE]
        return min(beyond) if beyond else runLength

    @staticmethod
    def walkLength(path: List[Point]) -> float:
        return sum(math.hypot(b[0] - a[0], b[1] - a[1])
                   for a, b in zip(path, path[1:]))

    # where you stand after walking distance along path
    @staticmethod
    def alongPath(path: List[Point], distance: float) -> Point:
        if not path:
            return (0, 0)
        if distance <= 0:
            return path[0]
        walked = 0.0
        for a, b in zip(path, path[1:]):
            step = math.hypot(b[0] - a[0], b[1] - a[1])
            if walked + step >= distance:
                return b
            walked += step
        return path[-1]

    # the flood fill step count of the floor sample nearest point
    def stepsAt(self, point: tuple) -> int:
        cell = self.nearestWalkable(point, reachableOnly=True)
        return self.stepsFrom.get(cell, 0) if cell is not None else 0


    def wakeReach(self, ox: int, oy: int, top: bool, maxSteps: Optional[int] = None,
                  exact: bool = True, stopAt: Optional[int] = None) -> Tuple[int, Optional[Point]]:
        b0 = oy if top else oy - WAKE_HIT
        b1 = b0 + WAKE_HIT
        stepX, stepY = (4, 2) if exact else (20, 10)
        best, spot = -10 ** 9, None
        for fx in range(ox - WAKE_HALF_REACH, ox + WAKE_HALF_REACH + 1, stepX):
            for fy in range(b0 - 260, b1 + 261, stepY):
                steps = self.stepsFrom.get(self.cellOf((fx, fy)))
                if steps is None or (maxSteps is not None and steps > maxSteps):
                    continue
                if exact and not pointInPolygon((fx, fy), self.validArea):
                    continue
                overlap = min(fy, b1) - max(fy - WAKE_FAIRY_HEIGHT, b0)
                if overlap > best:
                    best, spot = overlap, (fx, fy)
                    if stopAt is not None and best >= stopAt:
                        return best, spot
        return best, spot

    # spots spread over the reachable run rather than bunched anywhere
    def scatter(self, count: int, minGap: float, avoid: tuple = (),
               maxSteps: Optional[int] = None) -> List[Point]:
        if count <= 0 or not self.stepsFrom:
            return []

        deepest = maxSteps if maxSteps is not None else max(self.stepsFrom.values())
        stretches: List[List[int]] = [[] for _ in range(count)]
        for cell, steps in self.stepsFrom.items():
            if self.clearance[cell] < 2 or steps > deepest:
                continue
            stretches[min(count - 1, steps * count // (deepest + 1))].append(cell)

        taken: List[Point] = []
        for stretch in stretches:
            random.shuffle(stretch)
            for cell in stretch:
                spot = self.worldOfCell(cell)
                if all(math.hypot(spot[0] - other[0], spot[1] - other[1]) >= minGap
                       for other in list(taken) + list(avoid)):
                    taken.append(spot)
                    break
        return taken

    # the edge of the floor straight below (down) or above (up) a point, scanning no further than limit
    def edgeOf(self, point: tuple, down: bool, limit: int = 700) -> Optional[int]:
        x, y = point
        step = 2 if down else -2
        edge = None
        for distance in range(0, limit, 2):
            probe = y + step * distance // 2
            if (self.stepsFrom.get(self.cellOf((x, probe))) is None
                    or not pointInPolygon((x, probe), self.validArea)):
                break
            edge = probe
        return edge

    # the post moved so its origin sits ORIGIN_SINK_PIXELS past the edge of the floor, or left alone if that
    # would leave the creature in a wall or out of the fairy's reach
    def sinkOrigin(self, spot: Point, originDy: int, maxSteps: Optional[int] = None) -> Point:
        if ORIGIN_SINK_PIXELS is None:
            return spot
        top = originDy < 0
        edge = self.edgeOf((spot[0], spot[1] + originDy), down=not top)
        if edge is None:
            return spot
        originY = edge - ORIGIN_SINK_PIXELS if top else edge + ORIGIN_SINK_PIXELS
        sunk = (spot[0], originY - originDy)
        if self.roomAt(sunk) < POST_MARGIN:
            return spot
        reach, _ = self.wakeReach(sunk[0], originY, top, maxSteps)
        return sunk if reach >= WAKE_OK else spot

    # the post near mark along path a fairy can best wake from, the nearest one when several are as good
    def postOnPath(self, path: List[Point], mark: float, originDy: int,
                   standoff: float, avoid: List[Point],
                   minimum: float = 0.0,
                   maximum: Optional[float] = None,
                   maxSteps: Optional[int] = None) -> Optional[Point]:
        top = originDy < 0
        found: List[Tuple[int, int, Point]] = []
        seen = set()
        for slide in range(0, int(standoff * 4), CELL_SIZE):
            towards = (mark,) if slide == 0 else (mark - slide, mark + slide)
            for distance in towards:
                if distance < minimum or (maximum is not None and distance > maximum):
                    continue
                spot = self.openFloorNear(
                    self.alongPath(path, distance), originDy=originDy)
                if spot is None or spot in seen:
                    continue
                seen.add(spot)
                if minimum > 0 or maximum is not None:
                    actualDistance = self.markAlongRun(path, spot)
                    if actualDistance < minimum or (
                            maximum is not None and actualDistance > maximum):
                        continue
                if any(math.hypot(spot[0] - p[0], spot[1] - p[1]) < standoff * 0.5
                       for p in avoid):
                    continue
                quick, _ = self.wakeReach(spot[0], spot[1] + originDy, top, maxSteps, exact=False, stopAt=WAKE_GOOD)
                found.append((min(quick, WAKE_GOOD), slide, spot))

        if not found:
            return None

        # nearest to the mark among the best reaching, the exact check settles the finalists
        found.sort(key=lambda c: (-c[0], c[1]))
        best, bestKey = None, None
        for _, slide, spot in found[:WAKE_FINALISTS]:
            exact, _ = self.wakeReach(spot[0], spot[1] + originDy, top, maxSteps, stopAt=WAKE_GOOD)
            key = (min(exact, WAKE_GOOD), -slide)
            if bestKey is None or key > bestKey:
                best, bestKey = spot, key
        return self.sinkOrigin(best, originDy, maxSteps)

    # one post per enemy, each waits in the middle of the stretch it guards
    def guardPosts(self, gates: List[tuple], originOffsets: List[int],
                   standoff: float, permanentPoints: List[tuple] = ()) -> List[Point]:
        run = self.deepestPath()
        count = len(originOffsets)
        spare = max(0, count - len(gates))
        posts: List[Point] = []
        previousMark = 0.0
        deepestMark = 0.0

        lastGateMark = self.markAlongRun(run, gates[-1]) if gates else 0.0
        reach = self.reachLimit(run, lastGateMark, permanentPoints)

        for index, originDy in enumerate(originOffsets):
            if index < len(gates):
                gate = gates[index]
                path = self.pathTo(gate) or run
                gap = math.hypot(path[-1][0] - gate[0], path[-1][1] - gate[1]) if path else 0
                if gap > MAX_GATE_SNAP:
                    notify.warning("gate %s is %d from any floor; posting on the run instead"
                                   % (gate, gap))
                    path = run
                gateMark = self.walkLength(path)
                mark = (previousMark + gateMark) * 0.5
                # Keep off both ends of the chamber when it is long enough to.
                if gateMark - previousMark > standoff * 2:
                    mark = min(max(mark, previousMark + standoff), gateMark - standoff)
                previousMark = gateMark
            else:
                path = run
                first = max(deepestMark, lastGateMark) + standoff
                last = reach - standoff
                if last < first:
                    first = last = (lastGateMark + reach) * 0.5
                slot = index - len(gates)
                mark = first + (last - first) * (slot + 1) / float(spare + 1)

            deepestMark = max(deepestMark, mark)
            if not path:
                continue

            if index < len(gates):
                spot = self.postOnPath(path, mark, originDy, standoff, posts,
                                       maxSteps=self.stepsAt(gates[index]))
            else:
                spot = self.postOnPath(
                    path, mark, originDy, standoff, posts,
                    minimum=first, maximum=last)
            if spot is None:
                notify.warning(
                    "no floor with room for an origin near %d along the run; "
                    "posting the creature anyway" % mark)
                spot = self.alongPath(path, mark)
            posts.append(spot)

        return posts


corridors: Dict[int, Optional[CorridorMap]] = {}


# the walkable floor of layout, built on first use
def corridorFor(layout) -> Optional[CorridorMap]:
    if layout is None:
        return None
    zoneId = getattr(layout, "zone_id", 0)
    if zoneId in corridors:
        return corridors[zoneId]

    validArea = getattr(layout, "valid_area", None)
    spawn = getattr(layout, "default_spawn", None)
    corridor = None
    if validArea and spawn:
        corridor = CorridorMap(validArea, spawn)
        if not corridor.usable:
            notify.warning("layout %d has no walkable floor to flood" % zoneId)
            corridor = None

    corridors[zoneId] = corridor
    return corridor
