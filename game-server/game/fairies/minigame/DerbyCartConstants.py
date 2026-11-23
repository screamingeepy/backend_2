"""
Protocol and physics constants for Animal Derby (gameId 13073), the Fairy
Coliseum's animal cart race.

Two sources feed this module, and neither is ours to choose:

  * ``DerbyCartConstants.as`` in mgDerbyCartRacing.swf -- the wire enums. Names are
    kept identical to the client's so the two can be diffed by eye.
  * ``web/xml/panels/meadowgameDerbyCartRacing.xml`` -- the ``<config>`` block and
    the cart table. The client reads those numbers at runtime; we mirror them.

The mirror is the dangerous half. Animal Derby is the only meadow game where the
server runs its own copy of the client's physics (see
DistributedDerbyCartRacingAI's docstring for why), so a cart re-tune that edits
only the XML desyncs the simulation silently -- no error, just rubber-banding for
whoever is riding that cart. Anything below marked "mirrors XML" has a twin in
that file and must be changed in both places.
"""

# --- Table shape -------------------------------------------------------------
MIN_PLAYERS = 2
MAX_PLAYERS = 4

# Seconds the table waits between reaching minPlayers and starting, so a third
# and fourth racer can still sit down. Same value Crazy Cakes uses -- both are
# 2-4 player meadow tables and there is no reason for them to feel different.
LOBBY_COUNTDOWN = 10

# Seconds the cart selector stays open once the round starts. The client has no
# opinion about this: CartSelector.show() blanks its timer field and waits for the
# server's first chooseCarUpdate, so the whole duration is ours.
CART_SELECT_SECONDS = 20

# Seconds between raceCountDown(3) and raceStart. The client's 3-2-1-0 MovieClip
# is self-playing and takes about four seconds; raceStart is what actually starts
# the carts, so it has to land after the clip has run.
COUNTDOWN_LEAD = 4.0

# Wall-clock ceiling on a single race. A racer who closes the tab never sends
# leaveRequest -- nothing removes a fairy from a meadow table on disconnect -- so
# without this a race with one such player would never reach an ending and the
# track would never reopen. Generous: 35000px at the slowest cart's 425px/s is
# about 82 seconds before obstacles and power-ups.
MAX_RACE_SECONDS = 240.0

# Seconds to leave the finished race standing before wiping it back to grouping.
# Matches Crazy Cakes: long enough to outlast the client's results panel.
RESET_DELAY = 8.0

# --- raceMove actions (client -> AI) ----------------------------------------
ACTION_SPEED = 0           # value = new speed * SERVER_DATA_SPEED_MULT
ACTION_BOOST = 1           # value = BOOSTING
ACTION_ANIMATION = 2       # value = one of the ANIMATION_* ids
ACTION_UPDATE_SPEED = 3    # value = HALT_ACCELERATION / RESUME_ACCELERATION
ACTION_POWER_UP = 4        # value = a POWERUP_WIRE_* id

BOOSTING = 1
NOT_BOOSTING = -99999      # DerbyCartPlayer's "no boost running" sentinel

HALT_ACCELERATION = 0
RESUME_ACCELERATION = 1

# --- Animations --------------------------------------------------------------
# Ids 1-10, from the comment block in meadowgameDerbyCartRacing.xml. The server
# never picks one except for the tornado; it relays whatever a client reports.
ANIMATION_STANDING = 1
ANIMATION_ANTICIPATION = 2
ANIMATION_WALKING = 3
ANIMATION_RUNNING = 4
ANIMATION_TRIPPING = 5
ANIMATION_JUMPING = 6
ANIMATION_FAIL_WATER_JUMP = 7
ANIMATION_WATER_JUMP = 8
ANIMATION_DUCKING = 9
ANIMATION_TORNADO = 10

ANIMATION_IDS = frozenset(range(ANIMATION_STANDING, ANIMATION_TORNADO + 1))

# DerbyCartPlayer.setAnimation isn't only cosmetic: three of these cancel a boost
# outright, and standing brakes the cart. A client reports its animation and then
# reports the speed that followed, so mirroring these keeps the two in step for
# the tick in between rather than waiting for the correction.
ANIMATIONS_CANCEL_BOOST = frozenset({
    ANIMATION_TRIPPING,
    ANIMATION_FAIL_WATER_JUMP,
    ANIMATION_TORNADO,
})

# raceUpdate's animation slot. The client's reader skips this value, so it means
# "nothing new to play" rather than any particular animation.
ANIMATION_NONE = -1

# --- Power-ups ---------------------------------------------------------------
# The client's POWERUP_* constants are frame numbers in the spinner's icon clip,
# but what goes on the wire is `icons.currentFrame - 1` (DerbyCartHud.onPowerUp).
# So every id arrives one lower than the constant it came from -- and boost never
# arrives at all, because the client handles it locally as ACTION_BOOST.
POWERUP_WIRE_THISTLE = 1
POWERUP_WIRE_BEE = 2
POWERUP_WIRE_FREEZE = 3
POWERUP_WIRE_TORNADO = 4

POWERUP_WIRE_IDS = frozenset({
    POWERUP_WIRE_THISTLE,
    POWERUP_WIRE_BEE,
    POWERUP_WIRE_FREEZE,
    POWERUP_WIRE_TORNADO,
})

# Where each power-up's target bits go in the raceState header.
RACESTATE_THISTLE = 0
RACESTATE_WASPS = 1
RACESTATE_FREEZE = 2
RACESTATE_TORNADO = 3

POWERUP_WIRE_TO_SLOT = {
    POWERUP_WIRE_THISTLE: RACESTATE_THISTLE,
    POWERUP_WIRE_BEE: RACESTATE_WASPS,
    POWERUP_WIRE_FREEZE: RACESTATE_FREEZE,
    POWERUP_WIRE_TORNADO: RACESTATE_TORNADO,
}

# --- Wire scaling ------------------------------------------------------------
# raceState carries speed and percentage as scaled ints. Both fields are int16, so
# percentage tops out a little past 3x the track -- far beyond checkToStop's
# trackLength + 300 -- but PERCENTAGE_CLAMP keeps a runaway sim from wrapping the
# field into a negative and teleporting everyone backwards.
SERVER_DATA_SPEED_MULT = 10
SERVER_DATA_PERCENTAGE_MULT = 10000
PERCENTAGE_CLAMP = 2.0

# --- Simulation --------------------------------------------------------------
# FPS and TIME_PER_FRAME are DerbyCartPlayer's, not a frame rate we chose: the
# client integrates position in TIME_PER_FRAME chunks and adds speed/FPS each
# time, which is very slightly faster than speed*33/1000. Mirroring the arithmetic
# exactly matters more than making it correct.
FPS = 27.0
TIME_PER_FRAME = 33.0

# DerbyCartPlayer.TICK_TIME. The client pushes one entry onto its reconciliation
# queues every TICK_TIME of simulated time and consumes exactly one server value
# per entry, so raceUpdate has to go out at this rate for the whole race -- faster
# and its queue of corrections grows stale, slower and corrections stop arriving.
TICK_TIME = 240.0
RACE_TICK = TICK_TIME / 1000.0

# --- Carts (mirrors XML: <carts>) --------------------------------------------
CART_ID_BASE = 87500       # racerData carries cartId - this; the client re-adds it
DEFAULT_CART = 87500       # <defaultCart>, the free Turtle

# cartId -> (name, maxSpeed, accel, triggerTime). accel is per second; the client
# divides it by FPS to get its per-frame step, and so do we. triggerTime is how
# early the client warns about an obstacle -- unused server-side, kept so the
# table can be diffed against the XML in one glance.
CARTS: dict[int, tuple[str, float, float, int]] = {
    87500: ("Turtle",      425.0, 125.0, 2000),
    87501: ("Mouse",       475.0, 100.0, 1500),
    87502: ("Rabbit",      500.0,  65.0, 1250),
    87503: ("Squirrel",    450.0, 150.0, 1750),
    87504: ("Snow Weasel", 460.0, 140.0, 1350),
}

# --- Effects (mirrors XML: <config>) -----------------------------------------
BOOST_SPEED = 650.0
BOOST_DURATION = 3000              # ms held at boostSpeed
BOOST_DECELERATION_DURATION = 500  # ms ramping back down to maxSpeed

FREEZE_TIME = 5000        # ms pinned at zero by a freeze
TORNADO_TIME = 3000       # ms pinned at zero by a tornado
WASPS_DELAY_TIME = 5000   # ms capped at maxSpeed/2 by one wasp swarm

# Wasps don't stop a racer, they halve them.
WASPS_SPEED_DIVISOR = 2.0

# --- Track (mirrors XML: <track id="0">) -------------------------------------
TRACK_ID = 0
TRACK_LENGTH = 35000

TILE_WIDTH = 719                # DerbyCartConstants.TILE_WIDTH
OBSTACLE_DISTANCE_BUFFER = 150  # DerbyCartConstants.OBSTACLE_DISTANCE_BUFFER

WATER_TILES_IN = 16
WATER_MID_TILES = 2
MUD_TILES_IN = 30
MUD_MID_TILES = 4

# DerbyCartCourse.buildTrack's own arithmetic. Only mud is load-bearing for the
# simulation -- DerbyCartPlayer.accelerate gates acceleration on inMud() and
# nothing else -- but water is mirrored too so the two zones stay together.
WATER_START = (WATER_TILES_IN + 0.5) * TILE_WIDTH
WATER_END = WATER_START + (WATER_MID_TILES + 0.5) * TILE_WIDTH
MUD_START = (MUD_TILES_IN + 0.5) * TILE_WIDTH - OBSTACLE_DISTANCE_BUFFER
MUD_END = MUD_START + (MUD_MID_TILES + 1) * TILE_WIDTH

# The track defines three power-up lines, so a legitimate client can pick up at
# most three per race. Enforced rather than trusted.
POWER_UP_LINES = (2300, 16500, 28000)
MAX_POWER_UPS_PER_RACE = len(POWER_UP_LINES)

# --- Obstacles ---------------------------------------------------------------
# racePrep's trackData carries (obstacleSlotId, obstacleArtNumber) pairs. The slot
# id indexes <obstacle id=... position=...> in the track XML -- that is where the
# position comes from -- and the art number picks the sprite: ad_obstacle_NN, plus
# an ad_obstacle_NN_above variant if there is one. Art WITH an _above variant is a
# DUCK obstacle, art without is a JUMP (DerbyCartCourse.addObstacles puts _above
# clips in _aboveObstacles, and findNextObstacleTriggerPosition classifies that
# container as OBSTACLE_DUCK).
#
# Slot id and art number line up one-for-one in both families, which is almost
# certainly how the original was authored: the two families sit at identical
# positions and produce an identical jump/duck pattern, differing only in art.
OBSTACLE_SLOTS_NORMAL = tuple(range(0, 14))    # art 00-13
OBSTACLE_SLOTS_WINTER = tuple(range(17, 31))   # art 17-30

# Which family a race is built from. Fixed rather than randomised per race: a
# fixed layout makes a desync reproducible, which matters more for a game whose
# whole failure mode is drift. Point this at OBSTACLE_SLOTS_WINTER to run the
# snow art instead -- but check first that ad_obstacle_17.._30 are actually
# reaching the client's media cache, because addObstacles silently skips art it
# cannot find and the obstacle then has no trigger at all.
OBSTACLE_SLOTS = OBSTACLE_SLOTS_NORMAL

# Art ids that ship an _above variant, and so read as DUCK rather than JUMP. Kept
# for the magic words and for anyone checking a layout by eye; the server does not
# simulate obstacles itself, since the client reports the speed it came out with.
DUCK_OBSTACLE_ART = frozenset({0, 6, 11, 12, 13, 14, 15, 17, 23, 28, 29, 30, 31, 32})

# Two different conventions - `place` in raceState is 1-BASED while
# The `rank` in a setRewards Rank struct is 0-BASED and
# DistributedMeadowGame reads the winner off whoever has rank == 0.
FIRST_PLACE = 1


def cart_id_for(offset: int) -> int | None:
    """The real cart id for a chooseCar offset, or None if it names no cart."""
    cartId = CART_ID_BASE + offset

    return cartId if cartId in CARTS else None
