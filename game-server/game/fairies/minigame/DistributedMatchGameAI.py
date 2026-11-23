from game.fairies.minigame.DistributedMeadowGameAI import (
    DistributedMeadowGameAI,
    MEADOW_GAME_JOIN_RESPONSE_ACCEPTED,
    MEADOW_GAME_STATE_GROUPING,
    MEADOW_GAME_STATE_PLAY,
    MEADOW_GAME_STATE_RESET,
    MEADOW_GAME_STATE_REWARD,
)
import game.fairies.ai.FairiesConstants as fc
from game.fairies.daily.TimeUtils import get_season
from direct.task.TaskManagerGlobal import taskMgr
from datetime import datetime, timezone
import random

CARD_COUNT = 24

# end of game reward, a seasonal ingredient by placement (30 first, 15 second), season keys match TimeUtils.SEASON_NAMES
SEASONAL_REWARD_ITEM = {
    "spring": fc.SPIDER_SILK,      # 8008
    "summer": fc.SUNFLOWER_SEEDS,  # 8010
    "autumn": fc.DANDELION_FLUFF,  # 8013
    "winter": fc.SNOWFLAKES,       # 8016
}

REWARD_FIRST_PLACE = 30
REWARD_SECOND_PLACE = 15

# Seconds to leave the finished game standing before wiping it back to grouping.
RESET_DELAY = 5.0

# a finished game resets later than a broken up one, so the end-game show can finish first
DEFERRED_END_RESET_DELAY = 12.0

MEADOW_GAME_MEMORY_REQUEST_NO_MOVE = 0
MEADOW_GAME_MEMORY_REQUEST_FLIP = 1

MEADOW_GAME_MEMORY_PLAYTYPE_NONE = 0
MEADOW_GAME_MEMORY_PLAYTYPE_FLIP_FIRST = 2
MEADOW_GAME_MEMORY_PLAYTYPE_NOMATCH = 3
MEADOW_GAME_MEMORY_PLAYTYPE_MATCH = 4
MEADOW_GAME_MEMORY_PLAYTYPE_SHUFFLE = 5

MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS = 6
MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_REVEAL = 7
MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_SHUFFLE = 8
MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BADNEWS = 9
MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_LOSETURN = 11
MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS_X2 = 12
MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_GOLDEN = 13

CARD_POINTS = {**{i: 1 for i in range(1, 13)}, **{i: 2 for i in range(21, 26)}, 42: 3}

class DistributedMatchGameAI(DistributedMeadowGameAI):
    def __init__(self, air) -> None:
        super().__init__(air)

        self.card_ids = []

        self.lastPlayType: int = 0 # p1
        self.deckStyle: int = 0 # p2
        self.lastFlipOffset: int = -1 # p3
        self.cardStates: list[int] = [-1 for _ in range(CARD_COUNT)] # p4
        self.matchCounts: list[int] = [0, 0] # p5 # Player Scores
        self.lastPlayer: int = 0 # p6
        self.whoseTurn: int = 0 # p7

        # set by the `match-spin-result` magic word, used by the next spinner match
        self.forcedSpinResult: int | None = None

    def init_game(self) -> None:
        # a pending reset belongs to the previous game, don't let it wipe a new pair's board
        self.cancelReset()

        valid_cards = list(range(1, 13)) + list(range(21, 26)) + [41]
        chosen = random.sample(valid_cards, 12)
        cards = chosen * 2
        random.shuffle(cards)

        # Store the shuffled IDs but initialize everything as face down
        self.card_ids = cards  # remember the actual IDs server-side
        self.cardStates = [-1 for _ in range(CARD_COUNT)] # Reset card states

        # Init the rest of the vars in-case we're in a dirty state.
        self.lastPlayType = 0
        self.deckStyle = 0
        self.lastFlipOffset = -1
        self.matchCounts = [0, 0]
        self.lastPlayer = 0 # lastPlayer is 0 on init
        # A forced spin belongs to the game it was asked for; a new pair sitting
        # down must not inherit it.
        self.forcedSpinResult = None

        self.d_setGameData()

        self.setGameState(2, 0)
        self.d_setGameState()

    def setGameData(self, lastPlayType, deckStyle, lastFlipOffset, cardStates, matchCounts, lastPlayer, whoseTurn) -> None:
        print("Got Sent Data from client")
        self.lastPlayType = lastPlayType
        self.deckStyle = deckStyle
        self.lastFlipOffset = lastFlipOffset
        self.cardStates = cardStates
        self.matchCounts = matchCounts
        self.lastPlayer = lastPlayer
        self.whoseTurn = whoseTurn

    def d_setGameData(self) -> None:
        print("setGameData sent", self.lastPlayType, self.deckStyle, self.lastFlipOffset, self.cardStates, self.matchCounts, self.lastPlayer, self.whoseTurn)
        self.sendUpdate("setGameData", [self.lastPlayType, self.deckStyle, self.lastFlipOffset, self.cardStates, self.matchCounts, self.lastPlayer, self.whoseTurn])

    def d_revealBoard(self) -> None:
        if not self.card_ids:
            return

        revealed = [
            cardId if state == -1 else state
            for state, cardId in zip(self.cardStates, self.card_ids)
        ]

        self.sendUpdate("setGameData", [
            MEADOW_GAME_MEMORY_PLAYTYPE_NONE,
            self.deckStyle,
            self.lastFlipOffset,
            revealed,
            self.matchCounts,
            self.lastPlayer,
            self.whoseTurn,
        ])

    def joinRequest(self) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        responseCode = super().joinRequest(avatarId)

        if responseCode != MEADOW_GAME_JOIN_RESPONSE_ACCEPTED:
            return

        # First accepted player takes the first turn.
        if self.whoseTurn == 0:
            self.whoseTurn = avatarId

        self.d_setGameData()

        # The pair just filled the table - deal a fresh game.
        if len(self.players) == 2:
            self.init_game()

    def leaveRequest(self) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        if avatarId not in self.players:
            return

        self.players.remove(avatarId)

        # leaving mid-game is a forfeit, nobody is rewarded and the table comes down at once

        # whoseTurn 0 means the results are showing, so use the normal delayed reset
        if self.state == MEADOW_GAME_STATE_PLAY and self.whoseTurn != 0:
            self.cancelReset()

            # broadcast the empty roster while still in PLAY, the remaining client only cancels its board then
            self.players = []
            self.d_setPlayers()

            # Now wipe back to a clean grouping state for the next pair. No
            # d_setRewards is sent on this path, so neither player is rewarded.
            self.resetGame()
            return

        # broadcast the new roster, the leaving client sees itself drop out and closes its view
        self.d_setPlayers()

        # under two players the game can't continue, reset the hotspot after the client shows game over
        if len(self.players) < 2:
            self.scheduleReset()

    @property
    def resetTaskName(self) -> str:
        return f"MatchGameReset-{self.doId}"

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
        super().delete()

    def resetGame(self) -> None:
        # empty the table, the client sends no leaveRequest so we clear the roster ourselves
        self.players = []
        self.card_ids = []
        self.cardStates = [-1 for _ in range(CARD_COUNT)]
        self.lastPlayType = 0
        self.deckStyle = 0
        self.lastFlipOffset = -1
        self.matchCounts = [0, 0]
        self.lastPlayer = 0
        self.whoseTurn = 0
        self.forcedSpinResult = None

        self.setGameState(MEADOW_GAME_STATE_RESET, 0)
        self.d_setGameState()

        # return to GROUPING so the hotspot is joinable again, before the empty roster so it isn't read as a removal
        self.setGameState(MEADOW_GAME_STATE_GROUPING, 0)
        self.d_setGameState()
        self.d_setPlayers()

    def turnRequest(self, playType, card_index):
        player_id = self.air.getAvatarIdFromSender()

        if playType == MEADOW_GAME_MEMORY_REQUEST_NO_MOVE:
            self.handleNoMove(player_id)
            return

        if not self.validateTurn(player_id, card_index):
            return

        card_id = self.card_ids[card_index]

        if self.lastFlipOffset == -1:
            # First Flip
            self.lastFlipOffset = card_index
            self.lastPlayer = player_id
            self.cardStates[card_index] = card_id # reveal card
            self.lastPlayType = MEADOW_GAME_MEMORY_PLAYTYPE_FLIP_FIRST

            self.d_setGameData()

        else:

            if card_index == self.lastFlipOffset:
                return

            # Second Flip - check for match
            first_card_index = self.lastFlipOffset
            first_card_id = self.card_ids[first_card_index]
            self.cardStates[card_index] = card_id  # reveal second card
            self.lastFlipOffset = card_index

            if first_card_id == card_id:
                # Only award points for normal cards, not spinner card
                if first_card_id != 41:
                    points = CARD_POINTS.get(first_card_id, 1)
                    player_index = self.players.index(player_id)
                    self.matchCounts[player_index] += points
                else:
                    # Spinner match - consume the pair and spin the power wheel.
                    # handleSpinner removes the pair and sends the update itself.
                    self.handleSpinner(first_card_index, card_index)
                    return

                if first_card_id == 11 or first_card_id == 12:
                    # Pumpkin pie or smores
                    self.handlePouchItems(first_card_id)

                other_cards = [st for i, st in enumerate(self.cardStates)
                            if i != first_card_index and i != card_index]
                would_be_last = all(st == 0 for st in other_cards)
                self.lastPlayer = player_id

                # Every match animates, the last one included.
                self.lastPlayType = MEADOW_GAME_MEMORY_PLAYTYPE_MATCH
                self.d_setGameData()  # client animates with cards still showing

                self.cardStates[first_card_index] = 0
                self.cardStates[card_index] = 0

                if would_be_last:
                    # the pair emptied the board, end the round on top of the match show so the score repaints
                    self.handleEndGame()
                    return

            else:
                self.whoseTurn = self.get_other_player(self.whoseTurn)
                self.lastPlayType = MEADOW_GAME_MEMORY_PLAYTYPE_NOMATCH
                self.lastPlayer = player_id
                self.d_setGameData()

                self.cardStates[first_card_index] = -1
                self.cardStates[card_index] = -1

            self.lastPlayType = MEADOW_GAME_MEMORY_PLAYTYPE_NONE
            self.lastFlipOffset = -1

    def handleNoMove(self, player_id) -> None:
        # the turn timer ran out and the client sent a no-move, the turn just passes
        if not self.validatePlayer(player_id):
            return

        if self.lastFlipOffset != -1 and self.cardStates[self.lastFlipOffset] != 0:
            self.cardStates[self.lastFlipOffset] = -1

        self.lastFlipOffset = -1

        self.lastPlayType = MEADOW_GAME_MEMORY_PLAYTYPE_NONE
        self.lastPlayer = player_id
        self.whoseTurn = self.get_other_player(self.whoseTurn)

        self.d_setGameData()

    def validatePlayer(self, player_id) -> bool:
        # a stale client can still send flips at an empty table
        if self.state != MEADOW_GAME_STATE_PLAY or len(self.card_ids) != CARD_COUNT:
            self.notify.warning(
                f"turnRequest from {player_id} with no game in play "
                f"(state={self.state}, cards={len(self.card_ids)})")
            return False

        # a player left mid-game and the board isn't wiped yet, don't process turns under two players
        if len(self.players) != 2:
            self.notify.warning(
                f"turnRequest from {player_id} with {len(self.players)} player(s)")
            return False

        # Log errors instead of throwing a tantrum - we'll see if this fixes the issue.
        if player_id not in self.players:
            self.notify.warning(f"turnRequest from non-player {player_id}")
            return False

        if player_id != self.whoseTurn:
            self.notify.warning(f"turnRequest from {player_id} out of turn")
            return False

        return True

    def validateTurn(self, player_id, card_index) -> bool:
        if not self.validatePlayer(player_id):
            return False

        if not 0 <= card_index < CARD_COUNT:
            self.notify.warning(f"turnRequest from {player_id} for card {card_index}")
            return False

        # -1 is face down. Anything else is already revealed by this turn's first
        # flip, or 0 for a slot whose pair has been matched away.
        if self.cardStates[card_index] != -1:
            return False

        return True

    def get_other_player(self, current_doid):
        # never raise StopIteration into the reader loop, fall back to the current player
        return next((p for p in self.players if p != current_doid), current_doid)

    def handleSpinner(self, first_index, second_index):
        # the matched spinner pair is removed, zero them before working out what's still in play
        self.card_ids[first_index] = 0
        self.card_ids[second_index] = 0
        self.cardStates[first_index] = 0
        self.cardStates[second_index] = 0

        player_index = self.players.index(self.whoseTurn)
        other_index = 1 - player_index
        self.lastPlayer = self.whoseTurn

        # if that was the last pair the game is over, decide that before picking a wheel result
        game_over = all(state == 0 for state in self.cardStates)

        if game_over:
            result = random.choice([
                MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS,     # +2 points
                MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS_X2,  # +3 points
            ])
        else:
            # the wheel has four slots, shuffle or golden depending on who is dominating (score > other + 2)
            # reveal and loseturn aren't real slots, never send them
            dominating = self.matchCounts[player_index] > self.matchCounts[other_index] + 2
            third_slot = (MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_SHUFFLE if dominating
                          else MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_GOLDEN)

            result = random.choice([
                MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS,     # +2 points
                MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS_X2,  # +3 points
                MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BADNEWS,   # lose a turn
                third_slot,                                 # shuffle or golden pair
            ])

        # a gm asked for a wheel result, it overrides the draw once (end of game still wins)
        if self.forcedSpinResult is not None and not game_over:
            result = self.forcedSpinResult
            self.forcedSpinResult = None

        self.lastPlayType = result

        if result == MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS:
            # +2 points
            self.matchCounts[player_index] += 2

        elif result == MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BONUS_X2:
            # +3 points
            self.matchCounts[player_index] += 3

        elif result == MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_BADNEWS:
            # Lose a turn - switch to other player
            self.whoseTurn = self.get_other_player(self.whoseTurn)

        elif result == MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_SHUFFLE:
            # Reshuffle every card still in play (kept face down).
            self.reshuffle_in_play()

        elif result == MEADOW_GAME_MEMORY_PLAYTYPE_SPIN_GOLDEN:
            # turn a hidden pair golden (3 points), then reshuffle so the board really changes
            unmatched_indices = [i for i, s in enumerate(self.cardStates) if s != 0]

            # Group by card_id to find pairs
            pairs = {}
            for idx in unmatched_indices:
                card = self.card_ids[idx]
                if card not in pairs:
                    pairs[card] = []
                pairs[card].append(idx)

            # Pick a random pair and replace with golden pair
            valid_pairs = [indices for indices in pairs.values() if len(indices) == 2]
            if valid_pairs:
                chosen = random.choice(valid_pairs)
                for idx in chosen:
                    self.card_ids[idx] = 42

            self.reshuffle_in_play()

        self.d_setGameData()
        self.lastFlipOffset = -1

        if game_over:
            self.handleEndGame()

    def reshuffle_in_play(self):
        ids = [self.card_ids[i] for i, s in enumerate(self.cardStates) if s != 0]
        random.shuffle(ids)
        for i in range(CARD_COUNT):
            if i < len(ids):
                self.card_ids[i] = ids[i]
                self.cardStates[i] = -1
            else:
                self.card_ids[i] = 0
                self.cardStates[i] = 0

    def handlePouchItems(self, card):
        avId = self.whoseTurn
        avatar = self.air.doId2do.get(avId)

        itemCount = 1
        itemSlot = -1

        if card == 11:
            itemID = 22512
        else:
            itemID = 22511

        if self.air.inventoryManager.addIngredientsToPouch(avId, itemID, itemCount, itemSlot):
            avatar.d_setPouch(self.air.inventoryManager.getPouch(avId))

    def handleEndGame(self):
        self.d_setRewards()

        self.lastFlipOffset = -1

        # A decided game advances WIN_MEADOW_GAME quests and earns XP for the
        # winner (see DistributedMeadowGameAI.notifyWin). A tie has no winner.
        if len(self.players) == 2 and self.matchCounts[0] != self.matchCounts[1]:
            winner = self.players[0] if self.matchCounts[0] > self.matchCounts[1] else self.players[1]
            self.notifyWin(winner)

        self.setGameState(MEADOW_GAME_STATE_REWARD, 0)
        self.d_setGameState()

        # Once the results panel has run its course, wipe the hotspot back to a
        # clean grouping state for the next pair of players.
        self.scheduleReset(DEFERRED_END_RESET_DELAY)

    def grantReward(self, avId, itemId, amount):
        avatar = self.air.doId2do.get(avId)
        if avatar is None:
            return
        if self.air.inventoryManager.addIngredientsToPouch(avId, itemId, amount, -1):
            avatar.d_setPouch(self.air.inventoryManager.getPouch(avId))

    def d_setRewards(self):
        if len(self.players) < 2:
            return

        itemId = SEASONAL_REWARD_ITEM[get_season(datetime.now(timezone.utc))]

        # A tie ranks both first.
        allRanks = [0 if self.matchCounts[i] >= self.matchCounts[1 - i] else 1 for i in range(2)]

        ranks = []
        for i, avId in enumerate(self.players):
            score = self.matchCounts[i]
            rank = allRanks[i]

            # Two players pays the same 30/15 as a party game would.
            amount = REWARD_FIRST_PLACE if rank == 0 else REWARD_SECOND_PLACE
            self.grantReward(avId, itemId, amount)
            self.creditGamePlayed(avId, rank, allRanks)

            # Rank struct order: (fairyId, score, Reward(itemId, amount), rank)
            ranks.append((avId, score, (itemId, amount), rank))

        self.creditHostedGame()

        for avId in self.players:
            self.sendUpdateToAvatarId(avId, "setRewards", [ranks])
