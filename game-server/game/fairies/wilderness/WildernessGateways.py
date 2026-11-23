# placement of the three wilderness gateway signs
# exit signs that appear in the wilderness themselves

from game.fairies.ai import ZoneConstants as zc

WILDERNESS_GATEWAYS: dict[int, dict] = {
    1: {"zone": zc.CHILLY_FALLS,  "itemId": 9153, "position": (510, 1210)},
    2: {"zone": zc.PUMPKIN_PATCH, "itemId": 9152, "position": (198, 198)},
    3: {"zone": zc.DEWDROP_VALE,  "itemId": 9151, "position": (980, 364)},
}

EXIT_SIGN_ITEMS: dict[int, int] = {
    1: 9120, 
    2: 9201,
    3: 9048,
}


def exitSignFor(wildernessId: int) -> dict | None:
    gateway = WILDERNESS_GATEWAYS.get(wildernessId)
    itemId = EXIT_SIGN_ITEMS.get(wildernessId)

    if gateway is None or itemId is None:
        return None

    return {"itemId": itemId, "zone": gateway["zone"]}