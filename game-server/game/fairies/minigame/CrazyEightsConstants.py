# protocol constants for crazy cakes (gameId 13070), the tearoom's crazy eights game

# --- suits
SUIT_ORANGE = 101
SUIT_BLUE = 102
SUIT_PURPLE = 103
SUIT_YELLOW = 104

SUITS = (SUIT_ORANGE, SUIT_BLUE, SUIT_PURPLE, SUIT_YELLOW)

# two pseudo suits mark the wilds, a wild has no color until its owner declares one
SUIT_CHANGE = 8   # "Change Color" wild  -> art master_crazy_08
SUIT_POWER = 4    # "Pixie Power" wild   -> art master_crd

WILD_SUITS = (SUIT_CHANGE, SUIT_POWER)

# --- values
MIN_NUMBER_VALUE = 1
MAX_NUMBER_VALUE = 9
WILD_NUMBER_VALUE = 8   # not dealt as a color card -- see SUIT_CHANGE
NUMBER_VALUES = tuple(
    value
    for value in range(MIN_NUMBER_VALUE, MAX_NUMBER_VALUE + 1)
    if value != WILD_NUMBER_VALUE
)

VALUE_DRAW_TWO = 11
VALUE_REVERSE = 12
VALUE_SKIP = 13

# a color card with no number, never dealt, the client makes it when rendering a resolved wild
VALUE_BASE = 14

ACTION_VALUES = (VALUE_DRAW_TWO, VALUE_REVERSE, VALUE_SKIP)

# an unplayed wild carries value -1, the client keys the face up wild art off it
VALUE_UNDECLARED = -1

# --- resolved pixie power actions, what a power card becomes once the wheel is spun
VALUE_ALL_DRAW_ONE = 21
VALUE_SELF_GO_AGAIN = 22
VALUE_ALL_PASS_ONE = 23     # reverse
VALUE_ALL_CHANGE_SUIT = 24

POWER_ACTION_VALUES = (
    VALUE_ALL_DRAW_ONE,
    VALUE_SELF_GO_AGAIN,
    VALUE_ALL_PASS_ONE,
    VALUE_ALL_CHANGE_SUIT,
)

# an unresolved action card on top of the pile makes every card playable
UNRESOLVED_ACTION_VALUES = (
    VALUE_ALL_DRAW_ONE,
    VALUE_SELF_GO_AGAIN,
    VALUE_ALL_PASS_ONE,
)

# --- power spinner slots
POWER_OFFSET = 50
VALUE_POWER_0 = 50
VALUE_POWER_1 = 51
VALUE_POWER_2 = 52
VALUE_POWER_3 = 53

POWER_SLOTS = (VALUE_POWER_0, VALUE_POWER_1, VALUE_POWER_2, VALUE_POWER_3)

# which action each wheel slot resolves to
POWER_SLOT_TO_ACTION = {
    VALUE_POWER_0: VALUE_SELF_GO_AGAIN,     # wheel 1 "Extra Turn"
    VALUE_POWER_1: VALUE_ALL_PASS_ONE,      # wheel 2 "Reverse"
    VALUE_POWER_2: VALUE_ALL_CHANGE_SUIT,   # wheel 3 "Change Color"
    VALUE_POWER_3: VALUE_ALL_DRAW_ONE,      # wheel 4 "All Players Draw 1 Card"
}

# --- play types (the int8 in setGameData / turnRequest)
PLAYTYPE_NONE = 0           # client->AI: turn timer expired. AI->client: nothing to animate
PLAYTYPE_DISCARD = 1
PLAYTYPE_DRAW = 2
PLAYTYPE_REWARD = 4         # AI->client only; suppresses the client's SET_GAMEDATA dispatch
PLAYTYPE_SHOW_SPECIAL = 5   # a wild was played and is awaiting its color/spin
PLAYTYPE_PLAYER_REMOVED = 6

# --- direction
DIRECTION_RIGHT = 1
DIRECTION_LEFT = 2

# --- turnResponse codes
TURN_RESPONSE_VALID = 0
TURN_RESPONSE_INVALID_PLAYER = 1
TURN_RESPONSE_INVALID_CARD = 2
TURN_RESPONSE_INVALID_MOVE = 3

# --- table and deck configuration
GAME_ID = 13070

MIN_PLAYERS = 2
MAX_PLAYERS = 4

# seconds the table sits in INIT with seats open after the second player sits
LOBBY_COUNTDOWN = 10

STARTING_HAND_SIZE = 7

# 4 suits x (1..7 + 9 + draw two + reverse + skip) = 44, plus 8 wilds = 52
CHANGE_WILD_COUNT = 4
POWER_WILD_COUNT = 4


# builds the (value, suit) pair the Card struct expects, value comes first
def makeCard(value, suit):
    return (int(value), int(suit))


def getCardValue(card):
    return card[0]


def getCardSuit(card):
    return card[1]


def isWildCard(card):
    return getCardSuit(card) in WILD_SUITS


# whether value carries a declared color
def isColor(value):
    return value in SUITS


# the full 52 card deck, unshuffled and in a stable order
def buildDeck():
    deck = []

    for suit in SUITS:
        for value in NUMBER_VALUES:
            deck.append(makeCard(value, suit))
        for value in ACTION_VALUES:
            deck.append(makeCard(value, suit))

    deck.extend([makeCard(VALUE_UNDECLARED, SUIT_CHANGE)] * CHANGE_WILD_COUNT)
    deck.extend([makeCard(VALUE_UNDECLARED, SUIT_POWER)] * POWER_WILD_COUNT)

    return deck


# the color a play must match
def getActiveSuit(top_discard):
    value, suit = top_discard

    if isColor(value):
        return value

    if suit in SUITS:
        return suit

    return None


# mirror of the client's Model.getValidCardSets
def isCardPlayable(card, top_discard):
    value, suit = card
    top_value, top_suit = top_discard

    # wilds are always playable
    if suit in WILD_SUITS:
        return True

    # an unresolved action card on the pile opens the board up
    if top_value in UNRESOLVED_ACTION_VALUES:
        return True

    if suit == top_suit or value == top_value:
        return True

    # suit == top_value catches a resolved wild, its declared color is in the top card's value
    if suit == top_value:
        return True

    return False
