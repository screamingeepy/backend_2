from game.fairies.minigame.DistributedMeadowGameAI import (
    DistributedMeadowGameAI,
    MEADOW_GAME_JOIN_RESPONSE_ACCEPTED,
    MEADOW_GAME_JOIN_RESPONSE_GAMEON_FULL,
    MEADOW_GAME_STATE_GROUPING,
    MEADOW_GAME_STATE_INIT,
    MEADOW_GAME_STATE_PLAY,
    MEADOW_GAME_STATE_RESET,
    MEADOW_GAME_STATE_REWARD,
)
from game.fairies.minigame.DerbyCartConstants import (
    ACTION_ANIMATION,
    ACTION_BOOST,
    ACTION_POWER_UP,
    ACTION_SPEED,
    ACTION_UPDATE_SPEED,
    ANIMATION_IDS,
    ANIMATIONS_CANCEL_BOOST,
    ANIMATION_NONE,
    ANIMATION_STANDING,
    ANIMATION_TORNADO,
    BOOSTING,
    BOOST_DECELERATION_DURATION,
    BOOST_DURATION,
    BOOST_SPEED,
    CARTS,
    CART_ID_BASE,
    CART_SELECT_SECONDS,
    COUNTDOWN_LEAD,
    DEFAULT_CART,
    FIRST_PLACE,
    FPS,
    FREEZE_TIME,
    LOBBY_COUNTDOWN,
    MAX_PLAYERS,
    MAX_POWER_UPS_PER_RACE,
    MAX_RACE_SECONDS,
    MIN_PLAYERS,
    MUD_END,
    MUD_START,
    NOT_BOOSTING,
    OBSTACLE_SLOTS,
    PERCENTAGE_CLAMP,
    POWERUP_WIRE_BEE,
    POWERUP_WIRE_FREEZE,
    POWERUP_WIRE_THISTLE,
    POWERUP_WIRE_TORNADO,
    POWERUP_WIRE_TO_SLOT,
    RACE_TICK,
    RESET_DELAY,
    RESUME_ACCELERATION,
    SERVER_DATA_PERCENTAGE_MULT,
    SERVER_DATA_SPEED_MULT,
    TIME_PER_FRAME,
    TORNADO_TIME,
    TRACK_ID,
    TRACK_LENGTH,
    WASPS_DELAY_TIME,
    WASPS_SPEED_DIVISOR,
    cart_id_for,
)
import game.fairies.ai.FairiesConstants as fc
from game.fairies.daily.TimeUtils import get_season
from direct.task.TaskManagerGlobal import taskMgr
from datetime import datetime, timezone

# The one extra game-over state this game uses. Controller.onGameStateUpdatedCalled
# handles exactly two outcomes -- REWARD (7), which runs the results panel if the
# table is still at or above minPlayers, and this one, which always shows the
# "not enough players to continue" popup and pays nobody.
#
# REWARD_NO_CARD (9) is a Crazy Eights concept and is not handled here at all.
MEADOW_GAME_STATE_REWARD_NO_PLAYER = 8

# shared with crazy cakes so every meadow game pays the same seasonal item and amounts
from game.fairies.minigame.DistributedCrazyEightsAI import SEASONAL_REWARD_ITEM, REWARD_BY_PLACE

# Seconds between the last racer crossing the line and the results panel. The
# client stops its own cart at trackLength + 300 rather than at the line
# (DerbyCartPlayer.checkToStop), which is most of a second past the finish at the
# slowest cart, and showPlaceEOR plays after that. Ending the race any sooner
# tears the course down mid-celebration.
FINISH_GRACE = 3.0


class _Racer:
    """
    One cart, as the server models it.

    Everything here has a twin in DerbyCartPlayer.as. Field names follow that
    class rather than this codebase's usual style, so the physics in
    DistributedDerbyCartRacingAI._step can be read side by side with
    DerbyCartPlayer.accelerate.
    """

    __slots__ = (
        "avId", "index", "cartId", "color1", "color2",
        "maxSpeed", "acceleration",
        "speed", "position", "carryTime", "useAcceleration", "boostingTime",
        "waspTimes", "freezeTime", "tornadoTime",
        "animation", "finished", "finishOrder", "place", "powerUpsUsed",
    )

    def __init__(self, avId: int, index: int, cartId: int, color1: int, color2: int) -> None:
        _, maxSpeed, accel, _ = CARTS[cartId]

        self.avId = avId
        self.index = index
        self.cartId = cartId
        self.color1 = color1
        self.color2 = color2

        self.maxSpeed = maxSpeed
        # Per frame, not per second -- DerbyCartPlayer divides by FPS once in its
        # constructor and adds the result whole in accelerate().
        self.acceleration = accel / FPS

        self.speed = 0.0
        self.position = 0.0
        self.carryTime = 0.0
        self.useAcceleration = True
        self.boostingTime = NOT_BOOSTING

        # One entry per wasp swarm, each the ms it has left. The client keeps a
        # list too (DerbyCartPlayer._wasps) because swarms stack.
        self.waspTimes: list[float] = []
        self.freezeTime = 0.0
        self.tornadoTime = 0.0

        self.animation = ANIMATION_NONE
        self.finished = False
        self.finishOrder = 0
        self.place = FIRST_PLACE
        self.powerUpsUsed = 0

    @property
    def hasWasps(self) -> bool:
        return any(time > 0 for time in self.waspTimes)

    @property
    def shouldBeStill(self) -> bool:
        return self.freezeTime != 0 or self.tornadoTime != 0

    @property
    def percentage(self) -> float:
        return self.position / TRACK_LENGTH

    @property
    def speedCeiling(self) -> float:
        """The fastest a client can legitimately claim to be going right now."""
        return BOOST_SPEED if self.boostingTime != NOT_BOOSTING else self.maxSpeed


class DistributedDerbyCartRacingAI(DistributedMeadowGameAI):
    """
    Animal Derby (gameId 13073) -- one of the Fairy Coliseum's six race tracks,
    2-4 players.

    This is the only meadow game that is NOT server-authoritative on position, and
    that is baked into the wire protocol rather than being a policy we picked.
    raceMove never carries a position: every call site of appendMove in the client
    reports only speed changes, acceleration halt/resume, animation, boost and
    power-up pickups, and DerbyCartPlayer integrates its own position at 30fps
    from those.

    So the server runs its own copy of the client's integration (see _step, which
    is a line-by-line port of DerbyCartPlayer.accelerate) purely to derive
    percentage and placing -- `place` is server-fed and can only come from a
    position the server maintains. The client then soft-reconciles toward us:
    setPercentage stores the difference and bleeds it off, setSpeed only corrects
    a divergence over 3 units. Small mismatches are invisible; a material one is
    continuous rubber-banding, which is the failure mode to watch for.

    The consequence for security is that a hacked client can report whatever speed
    it likes and win. That is inherent. What we can do is bounds-check -- raceMove
    refuses a speed above the chosen cart's ceiling -- and cap power-ups at the
    three the track actually offers.

    Two hard constraints, both from the client's reader (Controller.updateRacers):

      * raceUpdate must fire at exactly 4Hz. The client consumes exactly one
        server value per 250ms tick of its own via shift(); faster and its queue
        of corrections grows stale, slower and corrections stop arriving.
      * Every raceUpdate must carry a record for every still-present racer, and
        for nobody else. getRacer() is dereferenced with no null check, so naming
        a departed racer is a null reference inside the client's update loop; and
        the recipient's own percentage is only assigned inside the
        `playerIndex == myIndex` branch but passed to adjustPlayers()
        unconditionally, so omitting their record runs adjustPlayers(NaN) and
        corrupts every other racer's interpolated position.

    Roster indices are frozen for the life of a round. MeadowGameBase.onPlay runs
    once, at the PLAY edge, and snapshots both myIndex and originalRacerIDs; it is
    never re-run while the round lasts. So a racer who leaves mid-round leaves a
    hole in the index space rather than renumbering everyone -- renumbering would
    point some other client's myIndex at the wrong cart. A hole costs one missing
    HUD marker and nothing else; every client loop that walks _racers guards on a
    null slot.
    """

    # Derby holds a lobby countdown between minPlayers and maxPlayers, so the base
    # must not start the round the moment the fourth seat fills -- startCountdown /
    # _countdownTask own the INIT -> PLAY transition.
    autoStartWhenFull = False

    def __init__(self, air) -> None:
        super().__init__(air)

        self.minPlayers = MIN_PLAYERS
        self.maxPlayers = MAX_PLAYERS

        # globalClock time the lobby countdown expires, or None when it isn't
        # running. Kept so a latecomer is told how much of the countdown is
        # actually left rather than being handed a fresh full one.
        self.countdownEnds: float | None = None

        # globalClock time the cart selector closes, or None outside that phase.
        self.selectionEnds: float | None = None

        # The roster as it stood at the PLAY edge. Index into this is the
        # playerIndex every client message and every raceState record uses, and it
        # must not be rebuilt until the round is over.
        self.raceOrder: list[int] = []

        # avId -> (cartId, color1, color2), the last selection each player sent,
        # confirmed or not. The client sends UNCONFIRMED as the player scrolls and
        # again on a confirm it cannot finish yet, so the last one to arrive is the
        # best answer we have about what they actually want to ride.
        self.selections: dict[int, tuple[int, int, int]] = {}

        # Who has pressed Confirm. Only gates the early exit out of selection --
        # what they ride comes from self.selections either way.
        self.confirmed: set[int] = set()

        # avId -> _Racer, for the racers still in the race. A departure removes the
        # entry, which is what stops their record going out in raceUpdate.
        self.racers: dict[int, _Racer] = {}

        self.racing = False
        self.raceEnds: float | None = None
        self.lastStepTime: float = 0.0
        self.finishCount = 0

        # Power-up target bits for the next raceUpdate only. The client fires an
        # effect on the edge, so these are set for exactly one update and cleared.
        self.effectBits = [0, 0, 0, 0]

    # ------------------------------------------------------------------ helpers

    def liveRacers(self) -> list[_Racer]:
        """Racers still in the race, in roster order. The order raceState uses."""
        return sorted(self.racers.values(), key=lambda r: r.index)

    # ------------------------------------------------------------------ lobby countdown

    @property
    def countdownTaskName(self) -> str:
        return f"DerbyCountdown-{self.doId}"

    def countdownRemaining(self) -> int:
        """Whole seconds left on the lobby countdown, or 0 if it isn't running."""
        if self.countdownEnds is None:
            return 0

        return max(0, int(round(self.countdownEnds - globalClock.getRealTime())))

    def startCountdown(self) -> None:
        """Open the pre-race wait: INIT with a timeOutSecs the launcher counts down."""
        taskMgr.remove(self.countdownTaskName)
        self.countdownEnds = globalClock.getRealTime() + LOBBY_COUNTDOWN
        taskMgr.doMethodLater(LOBBY_COUNTDOWN, self._countdownTask, self.countdownTaskName)

        # INIT is what makes the client load the game swf and start the launcher's
        # clock, so timeOutSecs has to go out *with* the state change -- there is no
        # separate "here is the timer" message.
        self.setGameState(MEADOW_GAME_STATE_INIT, LOBBY_COUNTDOWN)
        self.d_setGameState()

    def cancelCountdown(self) -> None:
        """Abandon the wait and go back to grouping (the client's CANCEL_COUNTDOWN)."""
        taskMgr.remove(self.countdownTaskName)
        self.countdownEnds = None

        # DistributedMeadowGame.setGameState only fires CANCEL_COUNTDOWN on an
        # INIT -> GROUPING edge, so this must not be sent from any other state or
        # the launcher keeps ticking down to a race that never starts.
        if self.state != MEADOW_GAME_STATE_INIT:
            return

        self.setGameState(MEADOW_GAME_STATE_GROUPING, 0)
        self.d_setGameState()

    def _countdownTask(self, task):
        self.countdownEnds = None

        # Players can have drained away in the last few seconds. leaveRequest
        # cancels the countdown when that happens, but a task already in flight for
        # this frame still runs, so re-check rather than start a one-fairy race.
        if len(self.players) >= self.minPlayers:
            self.startPlay()
        else:
            self.cancelCountdown()

        return task.done

    # ------------------------------------------------------------------ lifecycle

    def joinRequest(self) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        # A round in progress is closed to newcomers. Every playerIndex on the wire
        # is a position in the roster snapshot the clients took at the PLAY edge,
        # and seating a latecomer would shift those under all of them.
        if self.state == MEADOW_GAME_STATE_PLAY and avatarId not in self.players:
            self.sendUpdateToAvatarId(
                avatarId, "joinResponse", [MEADOW_GAME_JOIN_RESPONSE_GAMEON_FULL])
            return

        # Joining a countdown that's already running: everyone else's clock is
        # mid-flight, so hand this client the remainder rather than the full
        # duration. This has to go out BEFORE super() -- super() sends joinResponse,
        # and that is what drives the client through ACCEPT_JOIN ->
        # renderMatchMaker -> reading timeOutSecond.
        if self.state == MEADOW_GAME_STATE_INIT and avatarId not in self.players:
            self.sendUpdateToAvatarId(
                avatarId, "setGameState",
                [MEADOW_GAME_STATE_INIT, self.countdownRemaining()])

        responseCode = super().joinRequest(avatarId)

        if responseCode != MEADOW_GAME_JOIN_RESPONSE_ACCEPTED:
            return

        # The last seat filling ends the wait early -- there is nobody left to wait for.
        if len(self.players) >= self.maxPlayers:
            taskMgr.remove(self.countdownTaskName)
            self.countdownEnds = None
            self.startPlay()
            return

        # Second racer down: start the lobby countdown and leave the other seats open.
        if len(self.players) >= self.minPlayers and self.state == MEADOW_GAME_STATE_GROUPING:
            self.startCountdown()

    def leaveRequest(self) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        if avatarId not in self.players:
            return

        wasPlaying = self.state == MEADOW_GAME_STATE_PLAY

        self.players.remove(avatarId)

        if not wasPlaying:
            self.d_setPlayers()

            # Below the minimum again while the lobby was counting down: call the
            # countdown off and go back to waiting. Whoever is still sitting there
            # keeps their seat -- they're waiting for players again, which is
            # exactly the state they were in a moment ago.
            if self.state == MEADOW_GAME_STATE_INIT and len(self.players) < self.minPlayers:
                self.cancelCountdown()
            elif not self.players:
                # An empty table that isn't in play gets wiped, so no stale roster
                # outlives the group that made it.
                self.scheduleReset()
            return

        # Drop their cart BEFORE the roster goes out. Once the clients process the
        # shrunken playerList they null their slot for this racer, and a raceState
        # record naming them after that is a null dereference inside
        # Controller.updateRacers.
        self.racers.pop(avatarId, None)
        self.selections.pop(avatarId, None)
        self.confirmed.discard(avatarId)

        self.d_setPlayers()

        # Below minimum mid-round: the race can't continue.
        if len(self.players) < self.minPlayers:
            self.handleBelowMinimum()
            return

        if not self.racing:
            # Still in cart selection, or in the 3-2-1 lead-in after it. If it is
            # selection they may have been the last holdout; if it is the lead-in,
            # checkSelectionComplete refuses and the race starts without them.
            self.checkSelectionComplete()
            return

        # The leaver may have been the only one still driving.
        self.checkRaceComplete()

    def startPlay(self) -> None:
        """Freeze the roster and open the cart selector."""
        self.raceOrder = list(self.players)
        self.selections = {}
        self.confirmed = set()
        self.racers = {}
        self.racing = False
        self.finishCount = 0
        self.effectBits = [0, 0, 0, 0]

        self.setGameState(MEADOW_GAME_STATE_PLAY, 0)
        self.d_setGameState()

        self.startSelection()

    # ------------------------------------------------------------------ cart selection

    @property
    def selectionTaskName(self) -> str:
        return f"DerbySelect-{self.doId}"

    def selectionRemaining(self) -> int:
        if self.selectionEnds is None:
            return 0

        return max(0, int(round(self.selectionEnds - globalClock.getRealTime())))

    def startSelection(self) -> None:
        taskMgr.remove(self.selectionTaskName)
        self.selectionEnds = globalClock.getRealTime() + CART_SELECT_SECONDS
        taskMgr.doMethodLater(1.0, self._selectionTask, self.selectionTaskName)

        self.d_chooseCarUpdate()

    def cancelSelection(self) -> None:
        taskMgr.remove(self.selectionTaskName)
        self.selectionEnds = None

    def d_chooseCarUpdate(self) -> None:
        """[secondsLeft, confirmedCount, ...playerIndex of each confirmed player]."""
        indices = sorted(
            self.raceOrder.index(avId)
            for avId in self.confirmed
            if avId in self.raceOrder)

        data = [self.selectionRemaining(), len(indices), *indices]

        # Targeted rather than broadcast: only the fairies at this track have a
        # selector open, and six tracks each shouting at the whole Coliseum once a
        # second would be pure waste. See d_raceState for the same reasoning at 4Hz.
        for avId in self.players:
            self.sendUpdateToAvatarId(avId, "chooseCarUpdate", [data])

    def _selectionTask(self, task):
        # The countdown display is also what flushes a deferred confirm: a client
        # whose avatars hadn't finished pre-rendering sends UNCONFIRMED on the
        # button and upgrades to CONFIRMED out of updateTimeLeft. So keep ticking
        # all the way down to zero rather than stopping a second early.
        self.d_chooseCarUpdate()

        if self.selectionRemaining() <= 0:
            self.beginRace()
            return task.done

        return task.again

    def chooseCar(self, data) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        if not self.validateSelecting(avatarId, data):
            return

        cartId = cart_id_for(data[0])

        if cartId is None:
            self.notify.warning(f"chooseCar from {avatarId} names no cart: {data[0]}")
            return

        # color1/color2 are dead in this build -- chooseCartColor1 hardcodes 50 and
        # is never called, so both always arrive as 0. Echoed back in racerData
        # rather than dropped, in case a later client build revives them.
        self.selections[avatarId] = (cartId, data[1], data[2])

        # The same player confirms more than once: the deferred-render path sends
        # UNCONFIRMED on the button and CONFIRMED later. A set makes that idempotent,
        # and cartsChoosen is monotonic on the client anyway -- it is only ever set
        # true, and only reset on the next transition into PLAY.
        if data[3]:
            self.confirmed.add(avatarId)
            self.d_chooseCarUpdate()
            self.checkSelectionComplete()

    def validateSelecting(self, avId, data) -> bool:
        """House style from DistributedMatchGameAI.validatePlayer: warn and refuse,
        never raise -- an exception here takes the district down."""
        if self.state != MEADOW_GAME_STATE_PLAY or self.racing:
            self.notify.warning(
                f"chooseCar from {avId} outside cart selection (state={self.state})")
            return False

        if avId not in self.players:
            self.notify.warning(f"chooseCar from non-player {avId}")
            return False

        if len(data) < 4:
            self.notify.warning(f"short chooseCar from {avId}: {data}")
            return False

        return True

    def checkSelectionComplete(self) -> None:
        # self.racers is the phase marker between selection ending and the race
        # actually starting: beginRace fills it, and the 3-2-1 lead-in that follows
        # is a window where self.racing is still False. Without this check a
        # departure during those four seconds would run beginRace a second time and
        # rebuild the course under everyone mid-countdown.
        if self.racing or self.racers or self.state != MEADOW_GAME_STATE_PLAY:
            return

        if self.players and self.confirmed.issuperset(self.players):
            self.cancelSelection()
            self.beginRace()

    # ------------------------------------------------------------------ race start

    def buildTrackData(self) -> list[int]:
        """
        [trackId, unused, unused, (obstacleSlotId, obstacleArtNumber) * n]

        Indices 1 and 2 are read by nothing -- DerbyCartCourse.buildTrack does
        _obstacleInfo = pTrackData.slice(3) and skips straight past them -- so they
        go out as zeroes.
        """
        data = [TRACK_ID, 0, 0]

        for slotId in OBSTACLE_SLOTS:
            # Art number equals slot id. The two obstacle families in the track XML
            # line up one-for-one with the two art ranges, which is how the jump and
            # duck placement comes out identical between them.
            data += [slotId, slotId]

        return data

    def buildRacerData(self) -> list[int]:
        """[racerCount, (playerIndex, cartId - 87500, color1, color2) * n]."""
        racers = self.liveRacers()
        data = [len(racers)]

        for racer in racers:
            data += [racer.index, racer.cartId - CART_ID_BASE, racer.color1, racer.color2]

        return data

    def beginRace(self) -> None:
        self.cancelSelection()

        if len(self.players) < self.minPlayers:
            self.handleBelowMinimum()
            return

        for avId in self.players:
            if avId not in self.raceOrder:
                # Nothing should be able to seat a fairy after the PLAY edge --
                # joinRequest refuses it -- but list.index raising here would take
                # the whole district with it, so it is refused rather than trusted.
                self.notify.warning(
                    f"{avId} is at track {self.doId} but not in its race roster")
                continue

            index = self.raceOrder.index(avId)

            # Anyone who never told us anything rides the free Turtle. Note this
            # takes the last selection whether or not it was confirmed: a client
            # that pressed Confirm before its avatars finished pre-rendering has
            # already sent the cart it wants, flagged UNCONFIRMED.
            cartId, color1, color2 = self.selections.get(avId, (DEFAULT_CART, 0, 0))

            self.racers[avId] = _Racer(avId, index, cartId, color1, color2)

        if len(self.racers) < self.minPlayers:
            self.handleBelowMinimum()
            return

        trackData = self.buildTrackData()
        racerData = self.buildRacerData()

        for avId in self.players:
            self.sendUpdateToAvatarId(avId, "racePrep", [trackData, racerData])

            # The client acts on 3 and nothing else: it starts a self-playing
            # 3-2-1-0 MovieClip. Streaming 3,2,1 would just restart the clip twice.
            self.sendUpdateToAvatarId(avId, "raceCountDown", [3])

        taskMgr.remove(self.startTaskName)
        taskMgr.doMethodLater(COUNTDOWN_LEAD, self._raceStartTask, self.startTaskName)

    def _raceStartTask(self, task):
        if len(self.players) < self.minPlayers:
            self.handleBelowMinimum()
            return task.done

        self.racing = True
        self.lastStepTime = globalClock.getRealTime()
        self.raceEnds = self.lastStepTime + MAX_RACE_SECONDS

        # Everyone at zero, so the usual placing pass just ranks them in roster
        # order -- which is what we want, and is right even when a departure during
        # the lead-in left a hole in the index space. (Seeding place from the index
        # would then hand a two-racer field places 1 and 3.) raceStart carries the
        # same payload raceUpdate does; it is the send that makes the client call
        # startCarts().
        self._assignPlaces()
        self.d_raceState("raceStart")

        taskMgr.doMethodLater(RACE_TICK, self._raceTask, self.raceTaskName)

        return task.done

    # ------------------------------------------------------------------ simulation

    @property
    def startTaskName(self) -> str:
        return f"DerbyStart-{self.doId}"

    @property
    def raceTaskName(self) -> str:
        return f"DerbyRace-{self.doId}"

    def _raceTask(self, task):
        now = globalClock.getRealTime()
        elapsedMs = max(0.0, (now - self.lastStepTime) * 1000.0)
        self.lastStepTime = now

        for racer in self.liveRacers():
            self._step(racer, elapsedMs)

        self._assignPlaces()
        self.d_raceState("raceUpdate")

        # Effects are edge-triggered on the client, so one update carries them and
        # the next carries none. Animations likewise: the reader skips -1, so
        # clearing here is what stops a reported animation replaying every tick.
        self.effectBits = [0, 0, 0, 0]

        for racer in self.racers.values():
            racer.animation = ANIMATION_NONE

        if self.checkRaceComplete():
            return task.done

        return task.again

    def _step(self, racer: _Racer, elapsedMs: float) -> None:
        """
        One tick of DerbyCartPlayer.accelerate, from the server's side.

        Read this against that function rather than against physics. The frame
        branch adds speed/FPS per TIME_PER_FRAME chunk, which is very slightly
        faster than the speed*dt/1000 the steady-state branch uses; that is the
        client's arithmetic and reproducing it is the whole point, so it is not a
        bug to be tidied.
        """
        self._tickEffects(racer, elapsedMs)

        # inMud is read once per call on the client too, not once per frame.
        inMud = MUD_START < racer.position < MUD_END

        if racer.speed != racer.maxSpeed or racer.boostingTime != NOT_BOOSTING:
            remaining = elapsedMs + racer.carryTime

            while remaining > TIME_PER_FRAME:
                if racer.boostingTime != NOT_BOOSTING:
                    if racer.boostingTime > 0:
                        racer.speed = BOOST_SPEED
                        racer.boostingTime -= TIME_PER_FRAME
                    elif abs(racer.boostingTime) < BOOST_DECELERATION_DURATION:
                        ratio = ((BOOST_DECELERATION_DURATION + racer.boostingTime)
                                 / BOOST_DECELERATION_DURATION)
                        racer.speed = (BOOST_SPEED - racer.maxSpeed) * ratio + racer.maxSpeed
                        racer.boostingTime -= TIME_PER_FRAME
                    else:
                        racer.boostingTime = NOT_BOOSTING
                else:
                    if racer.useAcceleration and not inMud:
                        racer.speed += racer.acceleration

                    if racer.speed > racer.maxSpeed:
                        racer.speed = racer.maxSpeed

                    if racer.hasWasps and racer.speed > racer.maxSpeed / WASPS_SPEED_DIVISOR:
                        racer.speed = racer.maxSpeed / WASPS_SPEED_DIVISOR
                        racer.useAcceleration = False

                racer.position += racer.speed / FPS
                remaining -= TIME_PER_FRAME

            racer.carryTime = remaining
        else:
            if racer.hasWasps:
                racer.speed = racer.maxSpeed / WASPS_SPEED_DIVISOR
                racer.useAcceleration = False

            racer.position += racer.speed * (elapsedMs + racer.carryTime) / 1000.0
            racer.carryTime = 0.0

        if not racer.finished and racer.percentage > 1:
            racer.finished = True
            self.finishCount += 1
            racer.finishOrder = self.finishCount

    def _tickEffects(self, racer: _Racer, elapsedMs: float) -> None:
        """
        Run down the freeze/tornado/wasp timers, mirroring the client's three
        separate update callbacks. All three tick on raw elapsed time, not on
        consumed frames -- only the boost does that.
        """
        wasStill = racer.shouldBeStill

        if racer.freezeTime > 0:
            racer.freezeTime = max(0.0, racer.freezeTime - elapsedMs)

        if racer.tornadoTime > 0:
            racer.tornadoTime = max(0.0, racer.tornadoTime - elapsedMs)

        waspExpired = False

        for i, remaining in enumerate(racer.waspTimes):
            if remaining > 0:
                racer.waspTimes[i] = max(0.0, remaining - elapsedMs)
                waspExpired = waspExpired or racer.waspTimes[i] <= 0

        racer.waspTimes = [time for time in racer.waspTimes if time > 0]

        # Coming out of a freeze or a tornado hands acceleration back, but only if
        # nothing else is still holding it: onUpdateFreeze checks the tornado and
        # the mud, onCheckTornado checks the freeze and the mud.
        if wasStill and not racer.shouldBeStill:
            if not (MUD_START < racer.position < MUD_END):
                racer.useAcceleration = True

        # A swarm wearing off does the same. This one is easy to leave out and
        # expensive to leave out: the wasp cap sets useAcceleration False, so
        # without it the racer stays pinned at half speed for the rest of the race
        # while their own client accelerates away. onCheckWasps tests only
        # shoulBeStill here, not the mud, and accelerate re-checks the mud every
        # frame anyway, so this deliberately does not either.
        if waspExpired and not racer.shouldBeStill:
            racer.useAcceleration = True

    def _assignPlaces(self) -> None:
        """
        Sort finished racers by the order they crossed and everyone else by
        distance. Ordering purely on position would tie every finisher together,
        since they all brake at trackLength + 300.
        """
        ordered = sorted(
            self.racers.values(),
            key=lambda r: (0, r.finishOrder) if r.finished else (1, -r.position))

        for place, racer in enumerate(ordered, start=FIRST_PLACE):
            racer.place = place

    # ------------------------------------------------------------------ raceState

    def buildRaceState(self) -> list[int]:
        """
        [thistleBits, waspBits, freezeBits, tornadoBits, racerCount,
         (playerIndex, speed*10, isBoosting, percentage*10000, animation, place) * n]

        Every still-present racer appears, always. See the class docstring for the
        two ways the client's reader breaks when that isn't true.
        """
        racers = self.liveRacers()
        state = list(self.effectBits) + [len(racers)]

        for racer in racers:
            percentage = min(racer.percentage, PERCENTAGE_CLAMP)

            state += [
                racer.index,
                int(round(racer.speed * SERVER_DATA_SPEED_MULT)),
                1 if racer.boostingTime != NOT_BOOSTING else 0,
                int(round(percentage * SERVER_DATA_PERCENTAGE_MULT)),
                racer.animation,
                racer.place,
            ]

        return state

    def d_raceState(self, fieldName: str) -> None:
        state = self.buildRaceState()

        # Targeted, not broadcast. The Coliseum can hold six simultaneous races and
        # a broadcast field goes to every fairy in the zone, so at 4Hz that would be
        # 24 updates a second aimed at people who have no race panel open. Nothing
        # needs the breadth: the client filters on isMyActualGame, and only a seated
        # player has a _DistributedMeadowGame to match against.
        for avId in self.players:
            self.sendUpdateToAvatarId(avId, fieldName, [state])

    # ------------------------------------------------------------------ raceMove

    def raceMove(self, data) -> None:
        avatarId = self.air.getAvatarIdFromSender()
        racer = self.validateRacer(avatarId, data)

        if racer is None:
            return

        pairCount = data[0]
        read = 1

        for _ in range(pairCount):
            if read + 1 >= len(data):
                self.notify.warning(f"truncated raceMove from {avatarId}: {data}")
                return

            action, value = data[read], data[read + 1]
            read += 2

            self.applyMove(racer, action, value)

    def validateRacer(self, avId, data) -> _Racer | None:
        if not self.racing:
            self.notify.warning(f"raceMove from {avId} with no race running")
            return None

        racer = self.racers.get(avId)

        if racer is None:
            self.notify.warning(f"raceMove from non-racer {avId}")
            return None

        if not data:
            self.notify.warning(f"empty raceMove from {avId}")
            return None

        return racer

    def applyMove(self, racer: _Racer, action: int, value: int) -> None:
        if action == ACTION_SPEED:
            # The one place a modified client could simply declare victory. Nothing
            # legitimate exceeds the cart's ceiling, so clamp rather than trust --
            # and clamp rather than refuse, because a client whose speed we ignore
            # outright would rubber-band for the rest of the race.
            speed = value / SERVER_DATA_SPEED_MULT
            racer.speed = max(0.0, min(speed, racer.speedCeiling))

        elif action == ACTION_BOOST:
            # setBoost only starts a boost when one isn't already running.
            if value == BOOSTING and racer.boostingTime == NOT_BOOSTING:
                racer.boostingTime = BOOST_DURATION

        elif action == ACTION_ANIMATION:
            if value in ANIMATION_IDS:
                # Relayed to the other clients in the next raceUpdate and cleared
                # afterwards, so it plays once. Each client ignores its own: the
                # reader only calls setAnimation on the non-local branch.
                racer.animation = value

                # setAnimation has side effects on the client, and every remote
                # client applies them to their copy of this racer, so we do too.
                if value in ANIMATIONS_CANCEL_BOOST:
                    racer.boostingTime = NOT_BOOSTING
                elif value == ANIMATION_STANDING:
                    racer.speed = 0.0
                    racer.boostingTime = NOT_BOOSTING

        elif action == ACTION_UPDATE_SPEED:
            racer.useAcceleration = value == RESUME_ACCELERATION

        elif action == ACTION_POWER_UP:
            self.firePowerUp(racer, value)

        else:
            self.notify.warning(f"unknown raceMove action {action} from {racer.avId}")

    # ------------------------------------------------------------------ power-ups

    def firePowerUp(self, thrower: _Racer, wireId: int) -> None:
        """
        Who a power-up hits is entirely ours to decide -- the bitmask permits any
        subset and the client says nothing about it.

        The rule here is catch-up: a power-up hits everyone ahead of the thrower,
        falling back to everyone else still racing when nobody is ahead -- the
        leader's case, and also the trailer whose rivals have all crossed the line.
        That follows the client's own hand: DerbyCartHud.selectPowerUp weights the
        spinner by place, offering a leader nothing but boost and thistle while last
        place gets the disruptive set. Targeting forward keeps the two halves
        pointing the same way instead of letting a leader compound their lead.
        """
        if wireId not in POWERUP_WIRE_TO_SLOT:
            self.notify.warning(f"unknown power-up {wireId} from {thrower.avId}")
            return

        # The track lays down exactly three power-up lines, so three is all a
        # legitimate client can pick up.
        if thrower.powerUpsUsed >= MAX_POWER_UPS_PER_RACE:
            self.notify.warning(
                f"{thrower.avId} sent power-up {wireId} past the {MAX_POWER_UPS_PER_RACE} "
                "the track offers")
            return

        targets = self.powerUpTargets(thrower)

        if not targets:
            return

        thrower.powerUpsUsed += 1
        slot = POWERUP_WIRE_TO_SLOT[wireId]

        for target in targets:
            self.effectBits[slot] |= 1 << target.index
            self.applyPowerUp(target, wireId)

    def powerUpTargets(self, thrower: _Racer) -> list[_Racer]:
        others = [r for r in self.liveRacers() if r is not thrower and not r.finished]
        ahead = [r for r in others if r.position > thrower.position]

        return ahead or others

    def applyPowerUp(self, target: _Racer, wireId: int) -> None:
        """
        Mirror the effect the client is about to apply to the same racer.

        The one that is deliberately absent is the thistle. sendThistleAtPlayer
        only spawns a thistle rolling down that racer's lane; whether it connects
        is decided by the victim's own checkHitThistle, and their hitThistle then
        reports the resulting speed back as an ordinary ACTION_SPEED. Applying a
        penalty here as well would slow them twice for one hit.
        """
        if wireId == POWERUP_WIRE_THISTLE:
            return

        if target.finished:
            # freezePlayer and addTornado both return early on a finished racer,
            # and addWasps does too. Staying in step with that matters more than
            # the effect.
            return

        if wireId == POWERUP_WIRE_BEE:
            target.waspTimes.append(float(WASPS_DELAY_TIME))

        elif wireId == POWERUP_WIRE_FREEZE:
            target.speed = 0.0
            target.boostingTime = NOT_BOOSTING
            target.useAcceleration = False
            target.freezeTime = float(FREEZE_TIME)

        elif wireId == POWERUP_WIRE_TORNADO:
            target.speed = 0.0
            # addTornado doesn't clear the boost itself; its setAnimation call does,
            # because ANIMATION_TORNADO is one of the three that cancel one.
            target.boostingTime = NOT_BOOSTING
            target.useAcceleration = False
            target.tornadoTime = float(TORNADO_TIME)
            target.animation = ANIMATION_TORNADO

    # ------------------------------------------------------------------ endings

    def checkRaceComplete(self) -> bool:
        """True if the race is over and has been wound up."""
        if not self.racing:
            return True

        if not self.racers:
            self.handleBelowMinimum()
            return True

        timedOut = self.raceEnds is not None and globalClock.getRealTime() >= self.raceEnds

        if not timedOut and not all(r.finished for r in self.racers.values()):
            return False

        if timedOut:
            self.notify.warning(
                f"race on track {self.doId} hit the {MAX_RACE_SECONDS}s cap with "
                f"{sum(1 for r in self.racers.values() if not r.finished)} racer(s) unfinished")

        self.racing = False
        taskMgr.remove(self.raceTaskName)

        # Let the client run its own cart past the line and play showPlaceEOR
        # before the results panel takes the course away.
        taskMgr.doMethodLater(
            FINISH_GRACE if not timedOut else 0.0, self._finishTask, self.finishTaskName)

        return True

    @property
    def finishTaskName(self) -> str:
        return f"DerbyFinish-{self.doId}"

    def _finishTask(self, task):
        self.finishRace()
        return task.done

    def finishRace(self) -> None:
        if len(self.players) < self.minPlayers:
            self.handleBelowMinimum()
            return

        # Order-critical, the same trap Two For Tea and Crazy Cakes document:
        # Controller.onSetRewards is what calls onStopGame and tears the race down,
        # and it only does so while the table is still at or above minPlayers. The
        # state change is what runs the results panel. Rewards first.
        self.d_setRewards()

        # a race nobody finished has no winner
        winner = min(self.racers.values(), key=lambda r: r.place, default=None)
        if winner is not None and winner.finished:
            self.notifyWin(winner.avId)

        self.setGameState(MEADOW_GAME_STATE_REWARD, 0)
        self.d_setGameState()

        self.scheduleReset()

    def handleBelowMinimum(self) -> None:
        """Someone left and took the race below two racers. Nobody is paid."""
        self.racing = False
        taskMgr.remove(self.startTaskName)
        taskMgr.remove(self.raceTaskName)
        taskMgr.remove(self.finishTaskName)
        self.cancelSelection()

        self.setGameState(MEADOW_GAME_STATE_REWARD_NO_PLAYER, 0)
        self.d_setGameState()

        self.scheduleReset()

    # ------------------------------------------------------------------ rewards

    def grantReward(self, avId, itemId, amount) -> None:
        avatar = self.air.doId2do.get(avId)

        if avatar is None:
            return

        if self.air.inventoryManager.addIngredientsToPouch(avId, itemId, amount, -1):
            avatar.d_setPouch(self.air.inventoryManager.getPouch(avId))

    def d_setRewards(self) -> None:
        if len(self.players) < self.minPlayers:
            return

        payouts = REWARD_BY_PLACE.get(len(self.racers))

        if payouts is None:
            # Only 2-4 is reachable, and finishRace has already refused anything
            # below minPlayers. A KeyError here would take the district down, so
            # the race ends unpaid rather than not at all.
            self.notify.warning(
                f"track {self.doId} finished with {len(self.racers)} racer(s) and no payout row")
            return

        itemId = SEASONAL_REWARD_ITEM[get_season(datetime.now(timezone.utc))]

        ranks = []
        allRanks = list(range(len(self.racers)))

        # `place` is already the finishing order, 1-based, from _assignPlaces. The
        # Rank struct's rank is 0-based instead, because
        # MeadowGameRewardPlayingCard does gotoAndStop(rank + 1) and
        # DistributedMeadowGame reads the winner off whoever has rank == 0.
        for racer in sorted(self.racers.values(), key=lambda r: r.place):
            rank = racer.place - FIRST_PLACE
            amount = payouts[rank]

            self.grantReward(racer.avId, itemId, amount)
            self.creditGamePlayed(racer.avId, rank, allRanks)

            # Rank struct order: (fairyId, score, Reward(itemId, amount), rank).
            # score is never displayed for this game -- MeadowGameRewards only
            # un-hides it for Crazy Eights -- so it carries the finishing place,
            # which is the number worth having in a log.
            ranks.append((racer.avId, racer.place, (itemId, amount), rank))

        for avId in self.players:
            self.sendUpdateToAvatarId(avId, "setRewards", [ranks])

    # ------------------------------------------------------------------ reset

    @property
    def resetTaskName(self) -> str:
        return f"DerbyReset-{self.doId}"

    def scheduleReset(self, delay=RESET_DELAY) -> None:
        taskMgr.remove(self.resetTaskName)
        taskMgr.doMethodLater(delay, self._resetTask, self.resetTaskName)

    def cancelReset(self) -> None:
        taskMgr.remove(self.resetTaskName)

    def _resetTask(self, task):
        self.resetGame()
        return task.done

    def delete(self) -> None:
        self.cancelReset()
        self.cancelSelection()
        taskMgr.remove(self.countdownTaskName)
        taskMgr.remove(self.startTaskName)
        taskMgr.remove(self.raceTaskName)
        taskMgr.remove(self.finishTaskName)
        super().delete()

    def resetGame(self) -> None:
        # Empty the track and return to grouping so a fresh group can sit down. The
        # client's end-of-race path doesn't send a leaveRequest, so the server has
        # to clear the roster itself or the seats stay occupied forever.
        self.cancelSelection()
        taskMgr.remove(self.countdownTaskName)
        taskMgr.remove(self.startTaskName)
        taskMgr.remove(self.raceTaskName)
        taskMgr.remove(self.finishTaskName)

        self.countdownEnds = None
        self.raceEnds = None
        self.racing = False
        self.finishCount = 0

        self.players = []
        self.raceOrder = []
        self.selections = {}
        self.confirmed = set()
        self.racers = {}
        self.effectBits = [0, 0, 0, 0]

        self.setGameState(MEADOW_GAME_STATE_RESET, 0)
        self.d_setGameState()

        # Then back to GROUPING so the hotspot is joinable again. RESET isn't a
        # stable joinable state (the launcher reads it as "clear and close"), so it
        # has to be followed by GROUPING. Ordering GROUPING ahead of the empty
        # setPlayers keeps clients from reading the empty roster as a mid-race
        # player removal.
        self.setGameState(MEADOW_GAME_STATE_GROUPING, 0)
        self.d_setGameState()
        self.d_setPlayers()
