def returnPlacedItemsToStorage(air, avId: int) -> bool:
    result = air.mongoInterface.mongodb.fairies.update_one(
        {"_id": avId},
        {
            "$set": {"avatar.items.$[placed].location": "Storage"},
            "$unset": {"avatar.items.$[placed].home": ""}
        },
        array_filters=[{"placed.home.roomId": 1}]
    )

    return result.modified_count > 0

def clearPlacedHomeItems(air, avId: int) -> None:
    realm = next(
        (realm for realm in getattr(air, "homeRealms", {}).values()
         if realm.ownerId == avId),
        None
    )

    if realm is not None:
        realm.clearHomeItems()
        return

    returnPlacedItemsToStorage(air, avId)

    from game.fairies.housing.HomeGames import removeHouseTables
    removeHouseTables(air, avId)
