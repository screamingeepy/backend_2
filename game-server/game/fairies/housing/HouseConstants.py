HOUSING_ZONE_OFFSET = 1000000000

# which room of a home realm something is in, must match MMOConstants in the client
# any third value draws in the house but can never be selected or moved
ROOM_TYPE_HOME = 1
ROOM_TYPE_GARDEN = 2

VALID_ROOM_TYPES = (ROOM_TYPE_HOME, ROOM_TYPE_GARDEN)


def isValidRoomType(roomId: int) -> bool:
    return roomId in VALID_ROOM_TYPES
