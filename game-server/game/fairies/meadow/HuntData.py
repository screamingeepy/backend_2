from dataclasses import dataclass

from game.fairies.ai import ZoneConstants as zc

# any badge id, the client checks inventory space for a giveaway's item id and badges
# always pass, the id is never paid out
STACK_ITEM_ID = 10574


@dataclass(frozen=True)
class HuntDef:
    # tooltip over the item
    name: str
    # giveaway art ids from cacheableMedia.xml, item i draws art[i % len(art)]
    art: tuple[int, ...]
    # meadows the items are spread over, item i stands in zones[i % len(zones)]
    zones: tuple[int, ...]


SPRING = (zc.CHERRYBLOSSOM_HEIGHTS, zc.SPRINGTIME_ORCHARD, zc.DEWDROP_VALE, zc.NEVERBERRY_THICKET, zc.TREETOP_BEND)
SUMMER = (zc.PALM_TREE_COVE, zc.SUNFLOWER_GULLY, zc.NEVERFRUIT_GROVE)
WINTER = (zc.EVERGREEN_OVERLOOK, zc.SNOWCAP_GLADE, zc.CHILLY_FALLS)

# (questId, stepIndex) -> what to put out
HUNTS: dict[tuple[int, int], HuntDef] = {
    (75, 6): HuntDef("Green Button", (15086, 15087, 15088, 15089), SUMMER),
    (79, 7): HuntDef("Bow", (15103,), (zc.CHERRYBLOSSOM_HEIGHTS, zc.SPRINGTIME_ORCHARD, zc.TREETOP_BEND)),
    (93, 5): HuntDef("Autumn Leaf Pile", (15239,), (100, 102, 300, 302, 400, 402)),
    (419, 7): HuntDef("Broken Lantern", (15135, 15136, 15137, 15138, 15139, 15140), WINTER),
    (422, 6): HuntDef("Special Snowflake", (15013, 15014, 15015), (zc.DEWDROP_VALE,)),
    (423, 5): HuntDef("Buzz Brother", (15220, 15221), SPRING[:4]),
    (233, 1): HuntDef("Walnut", (15090,), (zc.ACORN_SUMMIT, zc.MAPLE_TREE_HILL)),
    (240, 0): HuntDef("Tidy Bunny Fur Soap", (15120,), (zc.SPRINGTIME_ORCHARD,)),
    (240, 2): HuntDef("Bag of Acorn Chips", (15121,), (zc.MAPLE_TREE_HILL,)),
    (240, 4): HuntDef("Book of Mainland Lullabies", (15119,), (zc.SNOWCAP_GLADE,)),
    (250, 0): HuntDef("Baby Fireflies", (15170,), (zc.SPRINGTIME_ORCHARD,)),
    (250, 2): HuntDef("Strange Red Blob", (15168,), (zc.NEVERBERRY_THICKET,)),
    (250, 4): HuntDef("Baby Dragonflies", (15171,), (zc.DEWDROP_VALE,)),
    (250, 5): HuntDef("Baby Hummingbirds", (15169,), (zc.TREETOP_BEND,)),
    (250, 6): HuntDef("Baby Bees", (15172,), (zc.CHERRYBLOSSOM_HEIGHTS,)),
    (251, 1): HuntDef("Glinda the Never Dove", (15149,), (zc.MAPLE_TREE_HILL,)),
    (251, 2): HuntDef("Whisperwing the Never Dove", (15150,), (zc.CHERRYBLOSSOM_HEIGHTS,)),
    (251, 4): HuntDef("Skysong the Never Dove", (15151,), (zc.PALM_TREE_COVE,)),
    (252, 0): HuntDef("Tidy Bunny Fur Soap", (15120,), (zc.SPRINGTIME_ORCHARD,)),
    (252, 2): HuntDef("Book of Mainland Lullabies", (15119,), (zc.SNOWCAP_GLADE,)),
    (252, 5): HuntDef("Bag of Acorn Chips", (15121,), (zc.MAPLE_TREE_HILL,)),
    (256, 1): HuntDef("Never Egg", (15222, 15223, 15224, 15225, 15226), (zc.SPRINGTIME_ORCHARD,)),
    (256, 2): HuntDef("Skysong the Never Dove", (15151,), (zc.SUNFLOWER_GULLY,)),
    (256, 4): HuntDef("Never Egg", (15227, 15228, 15229, 15230, 15231), (zc.NEVERFRUIT_GROVE,)),
    (257, 0): HuntDef("Rabbit Tracks", (15236,), (zc.FAIRY_COLISEUM,)),
    (257, 3): HuntDef("White Rabbit", (15237,), (zc.COTTONPUFF_FIELD,)),
    (808, 3): HuntDef("Lost Gem", (15118,), (zc.SNOWCAP_GLADE, zc.EVERGREEN_OVERLOOK, zc.CHILLY_FALLS)),
    (817, 0): HuntDef("Perry Opossum", (15144,), (zc.CHERRYBLOSSOM_HEIGHTS,)),
    (817, 2): HuntDef("Anderson Otter", (15143,), (zc.SUNFLOWER_GULLY,)),
    (817, 3): HuntDef("Rebecca Robin", (15141,), (zc.COTTONPUFF_FIELD,)),
    (817, 6): HuntDef("Tallulah the Arctic Fox", (15145,), (zc.EVERGREEN_OVERLOOK,)),
    (817, 7): HuntDef("Palm Tree Cove Visitor", (15142,), (zc.PALM_TREE_COVE,)),
    (823, 4): HuntDef("Something Special", (15238,), (zc.ACORN_SUMMIT,)),
    (554, 6): HuntDef("Lucky Clover", (15104,), (zc.SPRINGTIME_ORCHARD, zc.DEWDROP_VALE, zc.NEVERBERRY_THICKET)),
    (571, 5): HuntDef("Tidy Bunny Fur Soap", (15120,), (zc.SPRINGTIME_ORCHARD,)),
}
