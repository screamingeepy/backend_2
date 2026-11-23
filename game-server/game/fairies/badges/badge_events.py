import game.fairies.ai.FairiesConstants as fc
import game.fairies.ai.ZoneConstants as zc
import game.fairies.minigame.MinigameConstants as mc
import game.fairies.wilderness.WildernessChallenges as wch

# ─────────────────────────────────── CLIENT STUFF ─────────────────────────────────── #
EVENT_FRIEND_ADDED = 25003

CLIENT_RAISED_EVENTS = frozenset({EVENT_FRIEND_ADDED})

# ───────────────────────────────────── MINIGAMES ──────────────────────────────────── #
EVENT_PLAYED_FIREFLY_LIGHT_UP = 30001
EVENT_PLAYED_WATER_WEB = 30002
EVENT_PLAYED_HARVEST_HUSTLE = 30003
EVENT_PLAYED_TINKER_TOSS = 30004
EVENT_PLAYED_SEED_SORTER = 30005
EVENT_PLAYED_SNOWY_LULLABY = 30006
EVENT_PLAYED_PETAL_PICKUP = 30007
EVENT_PLAYED_PINECONE_POP = 30008
EVENT_PLAYED_GEM_JUGGLE = 30009
EVENT_PLAYED_SUNBEAM_BEND = 30010
EVENT_PLAYED_BUBBLE_BOUNCE = 30011
EVENT_PLAYED_BUTTERFLY_PAINTER = 30012
EVENT_PLAYED_FAIRY_FIREWORKS = 30013
EVENT_PLAYED_SNOWFLAKE_SWEEP = 30014
EVENT_PLAYED_FIRST_FLIGHT = 30015
EVENT_PLAYED_DAILY_SPIN = 30016

# ───────────────────────────────────── CRAFTING ───────────────────────────────────── #
EVENT_PRACTICE_TAILORING = 30020
EVENT_PRACTICE_BAKING = 30021
EVENT_PRACTICE_TINKERING = 30022
EVENT_PERSONAL_TAILORING = 30023
EVENT_PERSONAL_BAKING = 30024
EVENT_PERSONAL_TINKERING = 30025

# ──────────────────────────────────── DAILY SPIN ──────────────────────────────────── #
EVENT_WON_ROCK = 30030

EVENT_WON_SOUR_PLUM_BADGE = 30031
EVENT_WON_LUCKY_PURPLE_FEATHERS_BADGE = 30032
EVENT_WON_SNEAKY_MR_TWITCHES_BADGE = 30033

# ─────────────────────────────────── MEADOW GAMES ─────────────────────────────────── #

EVENT_PLAYED_CRAZY_CAKES = 30040
EVENT_PLAYED_TWO_FOR_TEA = 30041
EVENT_PLAYED_ANIMAL_DERBY = 30042

# ──────────────────────────────────── PARTY GAMES ─────────────────────────────────── #
EVENT_PLAYED_PARTY_GAME = 30043
EVENT_HOSTED_PARTY_GAME = 30044
EVENT_TRICK_OR_TREATED = 30055

# ─────────────────────────────────────── WILDERNESS ───────────────────────────────── #
EVENT_LED_WILDERNESS = 30070
EVENT_JOINED_WILDERNESS = 30071
EVENT_HELPED_BIRD = 30072
EVENT_HELPED_SQUIRREL = 30073
EVENT_HELPED_BUTTERFLY = 30074
EVENT_HELPED_FROG = 30075
EVENT_HELPED_SPIDER = 30076
EVENT_HELPED_FIREFLY = 30077
EVENT_HELPED_LIZARD = 30078
EVENT_HELPED_TRUFFLE = 30079

CREATURE_TO_EVENT: dict[int, int] = {
    wch.BIRD:      EVENT_HELPED_BIRD,
    wch.SQUIRREL:  EVENT_HELPED_SQUIRREL,
    wch.BUTTERFLY: EVENT_HELPED_BUTTERFLY,
    wch.FROG:      EVENT_HELPED_FROG,
    wch.SPIDER:    EVENT_HELPED_SPIDER,
    wch.FIREFLY:   EVENT_HELPED_FIREFLY,
    wch.LIZARD:    EVENT_HELPED_LIZARD,
    wch.TRUFFLE:   EVENT_HELPED_TRUFFLE,
}

# ───────────────────────────────────────── GARDENS ────────────────────────────────── #
EVENT_GREW_ONE_DAY_PLANT = 30080
EVENT_GREW_THREE_DAY_PLANT = 30081
EVENT_GREW_FIVE_DAY_PLANT = 30082

EVENT_SANG_TO_FRIENDS_PLANT = 30083

SEED_DAYS_TO_EVENT: dict[int, int] = {
    1: EVENT_GREW_ONE_DAY_PLANT,
    3: EVENT_GREW_THREE_DAY_PLANT,
    5: EVENT_GREW_FIVE_DAY_PLANT,
}

# ─────────────────────────────────────── ANIMAL FRIENDS ───────────────────────────── #
EVENT_ADOPTED_FIREFLY = 30090
EVENT_ADOPTED_LADYBUG = 30091
EVENT_ADOPTED_HUMMINGBIRD = 30092
EVENT_ADOPTED_DRAGONFLY = 30093
EVENT_ADOPTED_BEE = 30094
EVENT_ADOPTED_BUTTERFLY = 30095
EVENT_PET_FULL_GROWN = 30096
SPECIES_TO_ADOPT_EVENT: dict[int, int] = {
    73000: EVENT_ADOPTED_FIREFLY,
    73001: EVENT_ADOPTED_LADYBUG,
    73002: EVENT_ADOPTED_HUMMINGBIRD,
    73003: EVENT_ADOPTED_DRAGONFLY,
    73004: EVENT_ADOPTED_BEE,
    73006: EVENT_ADOPTED_BUTTERFLY,
}

# ──────────────────────────────────────── QUESTS ──────────────────────────────────── #
EVENT_COMPLETED_KIT_QUEST = 30084
QUEST_ACCUMULATOR_TO_EVENT: dict[str, int] = {
    "real_world_quest": EVENT_COMPLETED_KIT_QUEST,
}

# ──────────────────────────────────────── BUNCHES ──────────────────────────────────── #
EVENT_BUNCH_DANDELION_FLUFF = 30400
EVENT_BUNCH_MAPLE_LEAVES = 30401
EVENT_BUNCH_BLUEBERRIES = 30402
EVENT_BUNCH_ACORNS = 30403
EVENT_BUNCH_OAK_LEAVES = 30404

# ───────────────────────────────────── DONATIONS ──────────────────────────────────── #
EVENT_DONATE_WARDROBE_ITEM = 30300
EVENT_DONATE_STORAGE_ITEM = 30301

# ──────────────────────────────────── INGREDIENTS ─────────────────────────────────── #
COLLECTION_EVENT_BASE = 30100

INGREDIENT_BADGE_TIERS: dict[int, tuple[int, int, int, int]] = {
    fc.ACORNS:            (10654, 10655, 10656, 10657),
    fc.BITS_OF_METAL:     (10723, 10724, 10725, 10726),
    fc.BLUEBERRIES:       (10634, 10635, 10636, 10637),
    fc.BLUE_GEMS:         (10719, 10720, 10721, 10722),
    fc.BUTTERCUP_PETALS:  (10618, 10619, 10620, 10621),
    fc.DAISY_PETALS:      (10622, 10623, 10624, 10625),
    fc.DANDELION_FLUFF:   (10674, 10675, 10676, 10677),
    fc.FEATHERS:          (10744, 10745, 10746, 10747),
    fc.HONEYCOMBS:        (10690, 10691, 10692, 10693),
    fc.IVY:               (10678, 10679, 10680, 10681),
    fc.LILY_PETALS:       (10626, 10627, 10628, 10629),
    fc.MAPLE_LEAVES:      (10642, 10643, 10644, 10645),
    fc.MEADOW_GRASS:      (10670, 10671, 10672, 10673),
    fc.OAK_LEAVES:        (10646, 10647, 10648, 10649),
    fc.PINE_NEEDLES:      (10650, 10651, 10652, 10653),
    fc.RASPBERRIES:       (10638, 10639, 10640, 10641),
    fc.ROSE_PETALS:       (10630, 10631, 10632, 10633),
    fc.SNOWFLAKES:        (10662, 10663, 10664, 10665),
    fc.SPIDER_SILK:       (10666, 10667, 10668, 10669),
    fc.SUNFLOWER_SEEDS:   (10658, 10659, 10660, 10661),
    fc.TRUFFLES:          (10748, 10712, 10713, 10714),
    fc.TWIGS:             (10686, 10687, 10688, 10689),
    fc.YELLOW_GEMS:       (10715, 10716, 10717, 10718),
}

INGREDIENT_TO_EVENT: dict[int, int] = {
    itemId: COLLECTION_EVENT_BASE + index
    for index, itemId in enumerate(sorted(INGREDIENT_BADGE_TIERS))
}


EVENT_TO_BADGES: dict[int, tuple[int, ...]] = {
    EVENT_FRIEND_ADDED:               (10531, 10532, 10533),
    EVENT_PLAYED_FIREFLY_LIGHT_UP:    (10576, 10577, 10578),  # Firefly Helper
    EVENT_PLAYED_WATER_WEB:           (10584, 10585, 10586),  # Web Wonder
    EVENT_PLAYED_HARVEST_HUSTLE:      (10592, 10593, 10594),  # Harvest Helper
    EVENT_PLAYED_TINKER_TOSS:         (10740, 10741, 10742),  # Tinker Sorter
    EVENT_PLAYED_SEED_SORTER:         (10785, 10786, 10787),  # Seed Sorter Helper
    EVENT_PLAYED_SNOWY_LULLABY:       (10761, 10762, 10763),  # Lullaby Helper
    EVENT_PLAYED_PETAL_PICKUP:        (10588, 10589, 10590),  # Petal Collector
    EVENT_PLAYED_PINECONE_POP:        (10970, 10971, 10972),  # Pinecone Popper
    EVENT_PLAYED_GEM_JUGGLE:          (10981, 10982, 10983),  # Gem Juggler
    EVENT_PLAYED_SUNBEAM_BEND:        (11015, 11016, 11017),  # Sunbeam Bender
    EVENT_PLAYED_BUBBLE_BOUNCE:       (10580, 10581, 10582),  # Fish Bouncer
    EVENT_PLAYED_BUTTERFLY_PAINTER:   (10889, 10890, 10891),  # Butterfly Painter
    EVENT_PLAYED_FAIRY_FIREWORKS:     (10600, 10601, 10602),  # Fireworks Helper
    EVENT_PLAYED_SNOWFLAKE_SWEEP:     (10682, 10683, 10684),  # Snowflake Star
    EVENT_PLAYED_FIRST_FLIGHT:        (10817, 10818, 10819),  # First Flight Helper
    EVENT_PLAYED_DAILY_SPIN:          (10899, 10900, 10901),  # Daily Spin Challenger
    EVENT_PRACTICE_BAKING:    (10772, 10773, 10774, 10804),  # Baking Helper / Big Help / Super Star / Royal Star
    EVENT_PRACTICE_TINKERING: (10798, 10799, 10800, 11136),  # Tinkering Helper / Big Help / Super Star / Royal Star
    EVENT_PRACTICE_TAILORING: (10883, 10884, 10885, 10894),  # Tailoring Helper / Big Help / Super Star / Royal Star
    EVENT_PERSONAL_BAKING:    (10775, 10776, 10777, 10805),  # Beginning / Bright / Brilliant / Royal Brilliance Baker
    EVENT_PERSONAL_TINKERING: (10801, 10802, 10803, 11129),  # Tinker-tastic / Super / Flitterific / Royal
    EVENT_PERSONAL_TAILORING: (10886, 10887, 10888, 10895),  # Talented Tailor / Super / Flitterific / Royal
    EVENT_WON_ROCK:                   (10974, 10975, 10976),  # Rocks / Rock and Roll / Rock Star
    EVENT_WON_SOUR_PLUM_BADGE:             (10903,),  # Sour Plum
    EVENT_WON_LUCKY_PURPLE_FEATHERS_BADGE: (10902,),  # Lucky Purple Feathers
    EVENT_WON_SNEAKY_MR_TWITCHES_BADGE:    (11130,),  # Sneaky Mr. Twitches
    EVENT_PLAYED_CRAZY_CAKES:         (10896, 10897, 10898),  # Crazy Cakes Fan / Super Fan / Devotee
    EVENT_PLAYED_TWO_FOR_TEA:         (11001, 11002, 11003),  # Two for Tea Fan / Super Fan / Devotee
    EVENT_PLAYED_ANIMAL_DERBY:        (11040, 11041, 11042),  # Animal Derby Fan / Super Fan / Devotee
    EVENT_PLAYED_PARTY_GAME:          (10727, 10728, 10729),  # Party Guest / Super / Flitterific
    EVENT_HOSTED_PARTY_GAME:          (10730, 10731, 10732),  # Party Planner / Super / Flitterific
    EVENT_TRICK_OR_TREATED:           (11154,),  # 2012 Animal Masquerade
    EVENT_LED_WILDERNESS:             (10765, 10766, 10767),  # Wilderness Leader / Super / Flitterific
    EVENT_JOINED_WILDERNESS:          (10768, 10769, 10770),  # Helping Hand / Big Help / Super Star
    EVENT_HELPED_BIRD:                (10789,),  # Birds of a Feather
    EVENT_HELPED_SQUIRREL:            (10790,),  # Squirrel Buddy
    EVENT_HELPED_BUTTERFLY:           (10791,),  # Butterfly Helper
    EVENT_HELPED_FROG:                (10792,),  # Friends of Frogs
    EVENT_HELPED_SPIDER:              (10793,),  # Spider Sidekick
    EVENT_HELPED_FIREFLY:             (10794,),  # Firefly Pal
    EVENT_HELPED_LIZARD:              (11004,),  # Lizard Wrangler
    EVENT_HELPED_TRUFFLE:             (11005,),  # Truffle Finder
    EVENT_GREW_ONE_DAY_PLANT:         (11119, 11120, 11121),  # One Day Grower / Super / Flitterific
    EVENT_GREW_THREE_DAY_PLANT:       (11122, 11123, 11124),  # Three Day Grower
    EVENT_GREW_FIVE_DAY_PLANT:        (11125, 11126, 11127),  # Five Day Grower
    EVENT_SANG_TO_FRIENDS_PLANT:      (11134, 11135, 11133),  # Singing Friend (250) / Super (500) / Flitterific (1000)
    EVENT_ADOPTED_FIREFLY:            (10904,),  # Firefly Trainer
    EVENT_ADOPTED_LADYBUG:            (10905,),  # Ladybug Trainer
    EVENT_ADOPTED_HUMMINGBIRD:        (10906,),  # Hummingbird Trainer
    EVENT_ADOPTED_DRAGONFLY:          (10907,),  # Dragonfly Trainer
    EVENT_ADOPTED_BEE:                (10908,),  # Bee Trainer
    EVENT_ADOPTED_BUTTERFLY:          (11255,),  # Butterfly Trainer
    EVENT_PET_FULL_GROWN:             (10826,),  # Flitterific Animal Trainer
    EVENT_COMPLETED_KIT_QUEST:        (10703, 10704, 10705, 10706, 10707, 10708, 10709, 10710, 10711),  # Paw of Approval ... Kit's Flitterific Cadet
    EVENT_BUNCH_DANDELION_FLUFF:      (11137, 11138, 11139),  # Dandelion Fluff Bunches
    EVENT_BUNCH_MAPLE_LEAVES:         (11140, 11141, 11142),  # Maple Leaf Bunches
    EVENT_BUNCH_BLUEBERRIES:          (11143, 11144, 11145),  # Blueberry Bunches
    EVENT_BUNCH_ACORNS:               (11146, 11147, 11148),  # Acorn Bunches
    EVENT_BUNCH_OAK_LEAVES:           (11149, 11150, 11151),  # Oak Leaf Bunches
    EVENT_DONATE_WARDROBE_ITEM:       (10811, 10812, 10813),  # Wardrobe / Super / Flitterific Donation
    EVENT_DONATE_STORAGE_ITEM:        (10814, 10815, 10816),  # Storage / Super / Flitterific Donation
}

EVENT_TO_BADGES.update(
    {
        INGREDIENT_TO_EVENT[itemId]: tiers
        for itemId, tiers in INGREDIENT_BADGE_TIERS.items()
    }
)

BUNCH_TO_EVENT: dict[int, int] = {
    fc.DANDELION_FLUFF: EVENT_BUNCH_DANDELION_FLUFF,
    fc.MAPLE_LEAVES:    EVENT_BUNCH_MAPLE_LEAVES,
    fc.BLUEBERRIES:     EVENT_BUNCH_BLUEBERRIES,
    fc.ACORNS:          EVENT_BUNCH_ACORNS,
    fc.OAK_LEAVES:      EVENT_BUNCH_OAK_LEAVES,
}

GAME_TO_EVENT: dict[int, int] = {
    mc.MINIGAME_FIREFLY_LIGHT_UP: EVENT_PLAYED_FIREFLY_LIGHT_UP,
    mc.MINIGAME_WATER_WEB:        EVENT_PLAYED_WATER_WEB,
    mc.MINIGAME_HARVEST_HUSTLE:   EVENT_PLAYED_HARVEST_HUSTLE,
    mc.MINIGAME_TINKER_TOSS:      EVENT_PLAYED_TINKER_TOSS,
    mc.MINIGAME_SEED_SORTING:     EVENT_PLAYED_SEED_SORTER,
    mc.MINIGAME_LULLABY:          EVENT_PLAYED_SNOWY_LULLABY,
    mc.MINIGAME_PETAL_PICKUP:     EVENT_PLAYED_PETAL_PICKUP,
    mc.MINIGAME_PINECONE_POP:     EVENT_PLAYED_PINECONE_POP,
    mc.MINIGAME_GEM_JUGGLE:       EVENT_PLAYED_GEM_JUGGLE,
    mc.MINIGAME_LIGHT_PIPE:       EVENT_PLAYED_SUNBEAM_BEND,
    mc.MINIGAME_BUBBLE_BOUNCE:    EVENT_PLAYED_BUBBLE_BOUNCE,
    mc.MINIGAME_BUTTERFLY:        EVENT_PLAYED_BUTTERFLY_PAINTER,
    mc.MINIGAME_FAIRY_FIREWORKS:  EVENT_PLAYED_FAIRY_FIREWORKS,
    mc.MINIGAME_SNOWFLAKE_SWEEP:  EVENT_PLAYED_SNOWFLAKE_SWEEP,
    mc.MINIGAME_FIRST_FLIGHT:     EVENT_PLAYED_FIRST_FLIGHT,
}

MEADOW_GAME_TO_EVENT: dict[int, int] = {
    13070: EVENT_PLAYED_CRAZY_CAKES,  # Crazy Cakes (MEADOW_GAME_CRAZY_EIGHTS)
    13072: EVENT_PLAYED_TWO_FOR_TEA,  # Two for Tea (MEADOW_GAME_TWO_FOR_TEA)
    13073: EVENT_PLAYED_ANIMAL_DERBY, # Animal Derby (MEADOW_GAME_CART_RACING)
}

GAME_TO_HIGH_SCORE_BADGE: dict[int, int] = {
    mc.MINIGAME_FIREFLY_LIGHT_UP: 10579,
    mc.MINIGAME_WATER_WEB:        10587,
    mc.MINIGAME_HARVEST_HUSTLE:   10595,
    mc.MINIGAME_TINKER_TOSS:      10743,
    mc.MINIGAME_SEED_SORTING:     10788,
    mc.MINIGAME_LULLABY:          10764,
    mc.MINIGAME_PETAL_PICKUP:     10591,
    mc.MINIGAME_PINECONE_POP:     10973,
    mc.MINIGAME_GEM_JUGGLE:       10984,
    mc.MINIGAME_LIGHT_PIPE:       11018,  # Sunbeam Bend
    mc.MINIGAME_BUBBLE_BOUNCE:    10583,
    mc.MINIGAME_BUTTERFLY:        10892,
    mc.MINIGAME_FAIRY_FIREWORKS:  10603,
    mc.MINIGAME_SNOWFLAKE_SWEEP:  10685,
    mc.MINIGAME_FIRST_FLIGHT:     10820,
}

PROFESSION_TO_PRACTICE_EVENT: dict[int, int] = {
    mc.CRAFT_TYPE_TAILORING: EVENT_PRACTICE_TAILORING,
    mc.CRAFT_TYPE_BAKING:    EVENT_PRACTICE_BAKING,
    mc.CRAFT_TYPE_TINKERING: EVENT_PRACTICE_TINKERING,
}

PROFESSION_TO_PERSONAL_EVENT: dict[int, int] = {
    mc.CRAFT_TYPE_TAILORING: EVENT_PERSONAL_TAILORING,
    mc.CRAFT_TYPE_BAKING:    EVENT_PERSONAL_BAKING,
    mc.CRAFT_TYPE_TINKERING: EVENT_PERSONAL_TINKERING,
}

SPIN_BADGE_TO_EVENT: dict[int, int] = {
    10903: EVENT_WON_SOUR_PLUM_BADGE,
    10902: EVENT_WON_LUCKY_PURPLE_FEATHERS_BADGE,
    11130: EVENT_WON_SNEAKY_MR_TWITCHES_BADGE,
}


ZONE_TO_VISIT_BADGE: dict[int, int] = {
    zc.FAIRY_TALE_THEATER: 11155,  # Haunted Dollhouse
}

# ─────────────────────────────────── MEADOW EXPLORER ──────────────────────────────── #
EVENT_EXPLORE_MEADOW = 30200

MEADOW_EXPLORER_ZONES: dict[int, tuple[int, ...]] = {
    10534: (  # Spring Meadow Explorer (goal 5)
        zc.CHERRYBLOSSOM_HEIGHTS,
        zc.SPRINGTIME_ORCHARD,
        zc.DEWDROP_VALE,
        zc.NEVERBERRY_THICKET,
        zc.TREETOP_BEND,
    ),
    10554: (  # Autumn Meadow Explorer (goal 4)
        zc.ACORN_SUMMIT,
        zc.COTTONPUFF_FIELD,
        zc.MAPLE_TREE_HILL,
        zc.PUMPKIN_PATCH,
    ),
    10604: (  # Winter Meadow Explorer (goal 3)
        zc.EVERGREEN_OVERLOOK,
        zc.SNOWCAP_GLADE,
        zc.CHILLY_FALLS,
    ),
    10694: (  # Summer Meadow Explorer (goal 3)
        zc.PALM_TREE_COVE,
        zc.SUNFLOWER_GULLY,
        zc.NEVERFRUIT_GROVE,
    ),
}

ZONE_TO_MEADOW_BADGE: dict[int, int] = {
    zoneId: badgeId
    for badgeId, zoneIds in MEADOW_EXPLORER_ZONES.items()
    for zoneId in zoneIds
}


EVENT_ATTENDED_PLAY = 30050
EVENT_ATTENDED_COMEDY_SHOW = 30051
EVENT_ATTENDED_UNICORN_TALE = 30052

SHOW_KIND_EVENTS: dict[str, tuple[int, ...]] = {
    "play": (EVENT_ATTENDED_PLAY,),
    "comedy": (EVENT_ATTENDED_COMEDY_SHOW,),
    "unicorn": (EVENT_ATTENDED_PLAY, EVENT_ATTENDED_UNICORN_TALE),
}

EVENT_TEACUP_IN_TEAROOM = 30060
EVENT_TEACUP_IN_GROVE_OR_GULLY = 30061
EVENT_CAKE_IN_COVE = 30062
EVENT_SING_GROUP_IN_GLADE = 30063
EVENT_SING_GROUP = 30064

EMOTE_CAKE = 15
EMOTE_SINGING = 27
EMOTE_TEACUP = 29

EMOTE_EVENTS = (
    (EMOTE_TEACUP, (zc.THE_TEAROOM,), EVENT_TEACUP_IN_TEAROOM),
    (EMOTE_TEACUP, (zc.NEVERFRUIT_GROVE, zc.SUNFLOWER_GULLY), EVENT_TEACUP_IN_GROVE_OR_GULLY),
    (EMOTE_CAKE, (zc.PALM_TREE_COVE,), EVENT_CAKE_IN_COVE),
)

GROUP_SING_EVENTS = (
    ((zc.SNOWCAP_GLADE,), EVENT_SING_GROUP_IN_GLADE),
    (None, EVENT_SING_GROUP),
)

TALENT_TRAINING_SHIRTS = frozenset({278, 279, 280, 281, 282, 288, 289, 290, 291, 292})
CAMP_PIXIE_DUST_ITEMS = frozenset({2546, 2547, 2126, 2127})
TEA_BREWER_CAPS = frozenset({2176, 2178})
TEATIME_HAT = frozenset({2177})
SERVING_TALENT_HATS = frozenset({2188, 2184})
STARS_ARE_OUT_CAP = frozenset({2180})
TROOP_SPIRIT_TOPS = frozenset({1000084, 1000085, 1000087, 1000088, 1000089})
GIANT_BOW_TIE = frozenset({2554})
WACKY_RAINBOW_WIG = frozenset({2276})

CONDITIONAL_BADGES: dict[int, tuple[tuple[int, frozenset], ...]] = {
    EVENT_PLAYED_HARVEST_HUSTLE:    ((11007, TALENT_TRAINING_SHIRTS),),
    EVENT_PLAYED_TINKER_TOSS:       ((11008, TALENT_TRAINING_SHIRTS),),
    EVENT_PLAYED_WATER_WEB:         ((11010, TALENT_TRAINING_SHIRTS),),
    EVENT_PLAYED_PINECONE_POP:      ((11012, TALENT_TRAINING_SHIRTS),),
    EVENT_PLAYED_GEM_JUGGLE:        ((11013, TALENT_TRAINING_SHIRTS),),
    EVENT_PLAYED_BUTTERFLY_PAINTER: ((10873, CAMP_PIXIE_DUST_ITEMS),),
    EVENT_ATTENDED_PLAY: (
        (10870, CAMP_PIXIE_DUST_ITEMS),
        (11094, CAMP_PIXIE_DUST_ITEMS),
        (11009, TALENT_TRAINING_SHIRTS),
    ),
    EVENT_TEACUP_IN_TEAROOM:        ((10997, TEA_BREWER_CAPS), (11089, TEA_BREWER_CAPS)),
    EVENT_TEACUP_IN_GROVE_OR_GULLY: ((10998, TEATIME_HAT), (11091, TEATIME_HAT)),
    EVENT_CAKE_IN_COVE:             ((10999, SERVING_TALENT_HATS), (11090, SERVING_TALENT_HATS)),
    EVENT_SING_GROUP_IN_GLADE:      ((10980, STARS_ARE_OUT_CAP),),
    EVENT_SING_GROUP:               ((11087, STARS_ARE_OUT_CAP),),
    EVENT_ATTENDED_UNICORN_TALE:    ((11235, TROOP_SPIRIT_TOPS),),
    EVENT_ATTENDED_COMEDY_SHOW: (
        (10966, GIANT_BOW_TIE),
        (11081, WACKY_RAINBOW_WIG),
    ),
}


def get_emote_events(emote_id: int, zone_id: int) -> tuple[int, ...]:
    return tuple(
        eventId for emote, zones, eventId in EMOTE_EVENTS
        if emote == emote_id and zone_id in zones
    )


def get_group_sing_events(zone_id: int) -> tuple[int, ...]:
    return tuple(
        eventId for zones, eventId in GROUP_SING_EVENTS
        if zones is None or zone_id in zones
    )


def get_conditional_badges(event_id: int) -> tuple[tuple[int, frozenset], ...]:
    return CONDITIONAL_BADGES.get(event_id, ())


def get_badges_for_event(event_id: int) -> tuple[int, ...]:
    """Return the badge ids an event advances, empty if nothing tracks it."""
    return EVENT_TO_BADGES.get(event_id, ())


def get_meadow_badge_for_zone(zone_id: int) -> int | None:
    """Return the Meadow Explorer badge a zone counts toward, or None."""
    return ZONE_TO_MEADOW_BADGE.get(zone_id)
