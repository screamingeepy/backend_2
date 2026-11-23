import datetime

from direct.distributed.PyDatagram import PyDatagram
from panda3d.direct import DCPacker

DBSS_OBJECT_ACTIVATE_WITH_DEFAULTS_OTHER = 2201
PUPPET_CLASS = "DistributedFamousFairyGM"
PUPPET_ACCESS = 2


def puppets(air):
    return air.mongoInterface.mongodb.puppets


def famousFairies(air) -> list[dict]:
    return list(air.mongoInterface.mongodb.fairies.find(
        {"famousFairy": True}, {"name": 1, "accountId": 1, "ownerAccount": 1}).sort("name", 1))


def puppetDclass(air):
    return air.dclassesByName.get(PUPPET_CLASS + "AI") or air.dclassesByName[PUPPET_CLASS]


def packField(dclass, fieldName: str, args: list) -> bytes:
    field = dclass.getFieldByName(fieldName)
    packer = DCPacker()
    packer.rawPackUint16(field.getNumber())
    packer.beginPack(field)
    field.packArgs(packer, args)
    packer.endPack()
    return packer.getBytes()


def activatePuppet(air, fairy: dict, account: dict, parentId: int, zoneId: int) -> None:
    dclass = puppetDclass(air)
    fields = [
        ("setAccess", [PUPPET_ACCESS]),
        ("setDISLname", [account.get("username", "")]),
        ("setDISLid", [account["_id"]]),
        ("setFamousFairyId", [fairy["_id"]]),
    ]

    dg = PyDatagram()
    dg.addServerHeader(fairy["_id"], air.ourChannel, DBSS_OBJECT_ACTIVATE_WITH_DEFAULTS_OTHER)
    dg.addUint32(fairy["_id"])
    dg.addUint32(parentId)
    dg.addUint32(zoneId)
    dg.addUint16(len(fields))
    for fieldName, args in fields:
        dg.appendData(packField(dclass, fieldName, args))
    air.send(dg)

    puppets(air).replace_one({"_id": fairy["_id"]}, {
        "_id": fairy["_id"],
        "name": fairy.get("name", ""),
        "districtId": air.districtId,
        "zoneId": zoneId,
        "summonedAt": datetime.datetime.utcnow(),
    }, upsert=True)


def isPuppet(air, fairyId: int) -> bool:
    return puppets(air).find_one({"_id": fairyId}, {"_id": 1}) is not None


def dismissPuppet(air, puppet) -> None:
    puppets(air).delete_one({"_id": puppet.doId})
    air.requestDelete(puppet)


def forgetDistrictPuppets(air) -> None:
    puppets(air).delete_many({"districtId": air.districtId})
