from game.fairies.ai import ZoneConstants
from game.fairies.ai.FairiesConstants import INGREDIENTS
from game.fairies.fairy import FamousFairyData
from game.fairies.fairy.structs.ShopCollection import ShopCollection
from game.fairies.fairy.structs.ShopItem import ShopItem
from game.fairies.fairy.structs.ShopOutfit import ShopOutfit
from game.fairies.fairy.structs.OutfitItem import OutfitItem
from game.fairies.shop.ShopHelpers import NPCShop, Shopkeeper

# Cassie's - OutfitId 4000 - 4999

SHOP = NPCShop(
    zone=ZoneConstants.CASSIES_COSTUME_SHOP,
    shopId=4,
    shopkeeper=Shopkeeper(
        name=FamousFairyData.CASSIE,
        position=(500, 350),
        famousFairyId=FamousFairyData.FAMOUS_FAIRY_CASSIE
    ),
    collections=[
        ShopCollection(
            collectionId=4031, # ToT Baskets
            currencyId=INGREDIENTS["SPIDER_SILK"].id,
            items=[
                ShopItem(itemId=1583, price=30, goldPrice=3, color1=228, color2=125, itemType="WristItem"), # Duckbill Orange Trick or Treat Basket
                ShopItem(itemId=1583, price=30, goldPrice=3, color1=216, color2=206, itemType="WristItem"), # Slate Gray Trick or Treat Basket
                ShopItem(itemId=1583, price=30, goldPrice=3, color1=193, color2=197, itemType="WristItem"), # Electric Green Trick or Treat Basket
                ShopItem(itemId=1583, price=30, goldPrice=3, color1=194, color2=195, itemType="WristItem"), # Electric Pink Trick or Treat Basket
                ShopItem(itemId=1583, price=30, goldPrice=3, color1=30, color2=55, itemType="WristItem"), # Pumpkin Orange Trick or Treat Basket
            ],
        ),
        ShopCollection(
            collectionId=28, # Animal-Inspired Fashions
            currencyId=INGREDIENTS["SPIDER_SILK"].id,
            outfits=[
                ShopOutfit(
                    outfitId=4061,
                    items = [
                        OutfitItem(itemId=2073, price=25, goldPrice=10, color1=206, color2=142, itemType="HeadItem"), # Raven Black Buzzy Bee Mask
                        OutfitItem(itemId=76, price=45, goldPrice=16, color1=206, color2=142, itemType="Shirt"), # Raven Black Buzzy Bee Striped Wrap
                        OutfitItem(itemId=1003, price=45, goldPrice=16, color1=142, color2=0, itemType="Skirt"), # Bumble Bee Yellow Leafy Bubble Skirt
                        OutfitItem(itemId=3501, price=25, goldPrice=10, color1=142, color2=0, itemType="Shoes"), # Bumble Bee Yellow Petal Slippers
                    ],
                ),

                ShopOutfit(
                    outfitId=4062,
                    items = [
                        OutfitItem(itemId=2071, price=25, goldPrice=10, color1=44, color2=257, itemType="HeadItem"), # Plumblossom Pink Little Light Antennae
                        OutfitItem(itemId=91, price=45, goldPrice=16, color1=44, color2=44, itemType="Shirt"), # Plumblossom Pink Little Light Top
                        OutfitItem(itemId=1091, price=45, goldPrice=16, color1=44, color2=257, itemType="Skirt"), #  Plumblossom Pink Little Light Mini
                        OutfitItem(itemId=3501, price=25, goldPrice=10, color1=44, color2=0, itemType="Shoes"), #  Plumblossom Pink Petal Slippers
                    ],
                ),
                ShopOutfit(
                    outfitId=4063,
                    items = [
                        OutfitItem(itemId=2071, price=25, goldPrice=10, color1=206, color2=189, itemType="HeadItem"), # Raven Black Little Light Antennae
                        OutfitItem(itemId=172, price=45, goldPrice=16, color1=206, color2=189, itemType="Shirt"), # Raven Black Ladybug Tank
                        OutfitItem(itemId=1156, price=45, goldPrice=16, color1=206, color2=189, itemType="Skirt"), # Raven Black Ladybug Skirt
                        OutfitItem(itemId=3501, price=25, goldPrice=10, color1=189, color2=0, itemType="Shoes"), # Ladybug Red Petal Slippers
                    ],
                ),
                ShopOutfit(
                    outfitId=4064,
                    items = [
                        OutfitItem(itemId=2151, price=25, goldPrice=10, color1=193, color2=175, itemType="HeadItem"), # Mint Green Dragonfly Mask
                        OutfitItem(itemId=186, price=45, goldPrice=16, color1=175, color2=193, itemType="Shirt"), # Mint Green Dragonfly Top
                        OutfitItem(itemId=1168, price=45, goldPrice=16, color1=175, color2=193, itemType="Skirt"), # Mint Green Dragonfly Skirt
                        OutfitItem(itemId=3501, price=25, goldPrice=10, color1=175, color2=0, itemType="Shoes"), # Creek Green Petal Slippers
                    ],
                ),
                ShopOutfit(
                    outfitId=4065,
                    items = [
                        OutfitItem(itemId=2150, price=25, goldPrice=10, color1=267, color2=186, itemType="HeadItem"), # Celestial Blue Hummingbird Mask
                        OutfitItem(itemId=187, price=45, goldPrice=16, color1=267, color2=186, itemType="Shirt"), # Celestial Blue Hummingbird Top
                        OutfitItem(itemId=1169, price=45, goldPrice=16, color1=267, color2=186, itemType="Skirt"), # Celestial Blue Hummingbird Skirt
                        OutfitItem(itemId=3501, price=25, goldPrice=10, color1=267, color2=0, itemType="Shoes"), # Celestial Blue Petal Slippers
                    ],
                ),
                ShopOutfit(
                    outfitId=4066,
                    items = [
                        OutfitItem(itemId=2033, price=25, goldPrice=10, color1=175, color2=159, itemType="HeadItem"), # Creek Green Firefly Spotlight Barrette
                        OutfitItem(itemId=2524, price=15, goldPrice=6, color1=175, color2=159, itemType="Necklace"), # Creek Green Firefly Glow Choker
                        OutfitItem(itemId=29, price=45, goldPrice=16, color1=175, color2=159, itemType="Shirt"), # Creek Green Orchid Firefly Wrap
                        OutfitItem(itemId=1032, price=45, goldPrice=16, color1=175, color2=159, itemType="Skirt"), # Creek Green Slit Satin Firefly Skirt
                        OutfitItem(itemId=3519, price=25, goldPrice=10, color1=175, color2=159, itemType="Shoes"), # Creek Green Firefly Glow Toes Slippers
                    ],
                ),
                ShopOutfit(
                    outfitId=4067,
                    items = [
                        OutfitItem(itemId=90, price=45, goldPrice=16, color1=63, color2=166, itemType="Shirt"), # Butterfly Blue Fanciful Flutter Top with White Trim
                        OutfitItem(itemId=548, price=15, goldPrice=1, color1=63, color2=166, itemType="Belt"), # Butterfly Blue Fanciful Flutter Sash with White Trim
                        OutfitItem(itemId=1090, price=45, goldPrice=16, color1=63, color2=166, itemType="Skirt"), # Butterfly Blue Fanciful Flutter Gown with White Trim
                        OutfitItem(itemId=3559, price=25, goldPrice=10, color1=63, color2=166, itemType="Shoes"), # Butterfly Blue Fanciful Flutter Flats with White Trim
                    ],
                ),
                ShopOutfit(
                    outfitId=4068,
                    items = [
                        OutfitItem(itemId=376, price=45, goldPrice=16, color1=189, color2=206, itemType="Shirt"), # Ladybug Red Morpho Butterfly Top with Raven Black Trim
                        OutfitItem(itemId=635, price=15, goldPrice=1, color1=189, color2=206, itemType="Belt"), # Ladybug Red Morpho Butterfly Sash
                        OutfitItem(itemId=1294, price=45, goldPrice=16, color1=30, color2=206, itemType="Skirt"), # Pumpkin Orange Morpho Butterfly Skirt with Raven Black Trim
                        OutfitItem(itemId=3716, price=25, goldPrice=10, color1=206, color2=189, itemType="Shoes"), # Raven Black Morpho Butterfly Shoes
                    ],
                ),
                ShopOutfit(
                    outfitId=4069,
                    items = [
                        OutfitItem(itemId=2367, price=25, goldPrice=10, color1=216, color2=206, itemType="HeadItem"), # Slate Gray Raven Mask
                        OutfitItem(itemId=499, price=45, goldPrice=16, color1=206, color2=216, itemType="Shirt"), # Raven Black Raven Costume Top with Slate Gray Trim
                        OutfitItem(itemId=1415, price=45, goldPrice=16, color1=206, color2=216, itemType="Skirt"), # Raven Black Raven Skirt with Slate Gray Trim
                        OutfitItem(itemId=3794, price=25, goldPrice=10, color1=206, color2=216, itemType="Shoes"), # Raven Black Raven Heels with Slate Gray Trim
                    ],
                ),
                ShopOutfit(
                    outfitId=4070,
                    items = [
                        OutfitItem(itemId=2347, price=25, goldPrice=10, color1=224, color2=128, itemType="HeadItem"), # Ivory White Fox Mask
                        OutfitItem(itemId=1000011, price=45, goldPrice=16, color1=224, color2=128, itemType="Shirt"), # Ivory White Fox Top
                        OutfitItem(itemId=1395, price=45, goldPrice=16, color1=224, color2=128, itemType="Skirt"), # Ivory White Fox Skirt
                        OutfitItem(itemId=3801, price=25, goldPrice=10, color1=224, color2=128, itemType="Shoes"), # Ivory White Furry Critter Boots
                    ],
                ),
                ShopOutfit(
                    outfitId=4071,
                    items = [
                        OutfitItem(itemId=2360, price=25, goldPrice=10, color1=206, color2=169, itemType="HeadItem"), # Raven Black Raccoon Mask
                        OutfitItem(itemId=481, price=45, goldPrice=16, color1=169, color2=206, itemType="Shirt"), # Squirrel Gray Raccoon Top
                        OutfitItem(itemId=1398, price=45, goldPrice=16, color1=169, color2=206, itemType="Skirt"), # Squirrel Gray Raccoon Skirt
                        OutfitItem(itemId=3801, price=25, goldPrice=10, color1=206, color2=169, itemType="Shoes"), # Raven Black Furry Critter Boots
                    ],
                ),
                ShopOutfit(
                    outfitId=4072,
                    items = [
                        OutfitItem(itemId=2440, price=25, goldPrice=10, color1=212, color2=194, itemType="HeadItem"), # Indigo Purple Songbird Headband
                        OutfitItem(itemId=1000078, price=45, goldPrice=16, color1=194, color2=212, itemType="Shirt"), # Electric Pink Songbird Top
                        OutfitItem(itemId=1484, price=45, goldPrice=16, color1=212, color2=194, itemType="Skirt"), # Indigo Purple Songbird Skirt
                        OutfitItem(itemId=3869, price=25, goldPrice=10, color1=212, color2=194, itemType="Shoes"), # Indigo Purple Songbird Heels
                    ],
                ),
                ShopOutfit(
                    outfitId=4073,
                    items = [ # lobster f
                        OutfitItem(itemId=2286, price=25, goldPrice=10, color1=45, color2=25, itemType="HeadItem"),
                        OutfitItem(itemId=347, price=45, goldPrice=16, color1=45, color2=25, itemType="Shirt"),
                        OutfitItem(itemId=1293, price=45, goldPrice=16, color1=45, color2=25, itemType="Skirt"),
                    ]
                ),
                ShopOutfit(
                    outfitId=4074,
                    items = [ # lobster m
                        OutfitItem(itemId=2288, price=25, goldPrice=10, color1=45, color2=25, itemType="HeadItem"),
                        OutfitItem(itemId=360, price=45, goldPrice=16, color1=45, color2=25, itemType="Shirt"),
                        OutfitItem(itemId=1290, price=45, goldPrice=16, color1=45, color2=25, itemType="Skirt"),
                    ]
                )
            ],
        ),

        ShopCollection(
            collectionId=133, # Mermaid Friends Forever
            currencyId=INGREDIENTS["SPIDER_SILK"].id,
            outfits=[
                ShopOutfit(
                    outfitId=4081,
                    items = [
                        OutfitItem(itemId=2083, price=25, goldPrice=10, color1=30, color2=86, itemType="HeadItem"), # Coral Pink Mer-Made Crown
                        OutfitItem(itemId=86, price=45, goldPrice=16, color1=13, color2=107, itemType="Shirt"), # Coral Pink Mer-Made Top
                        OutfitItem(itemId=1180, price=45, goldPrice=16, color1=65, color2=21, itemType="Skirt"), # Summer Green Long Mermaid Skirt
                        OutfitItem(itemId=3511, price=25, goldPrice=10, color1=13, color2=0, itemType="Shoes"), # Coral Pink Sparkle Slippers
                        OutfitItem(itemId=1088, price=45, goldPrice=16, color1=65, color2=21, itemType="Skirt"), # Summer Green Mer-Made Lagoon Drape
                        OutfitItem(itemId=3520, price=25, goldPrice=10, color1=13, color2=0, itemType="Shoes"), # Coral Pink Bubble Top Slippers
                    ],
                ),
                ShopOutfit(
                    outfitId=4082,
                    items = [
                        OutfitItem(itemId=2083, price=25, goldPrice=10, color1=11, color2=40, itemType="HeadItem"), # Marigold Yellow Mer-Made Crown
                        OutfitItem(itemId=86, price=45, goldPrice=16, color1=11, color2=40, itemType="Shirt"), # Marigold Yellow Mer-Made Top
                        OutfitItem(itemId=1180, price=45, goldPrice=16, color1=40, color2=266, itemType="Skirt"), # Candy Blue Long Mermaid Skirt
                        OutfitItem(itemId=3511, price=25, goldPrice=10, color1=11, color2=0, itemType="Shoes"), # Marigold Yellow Sparkle Slippers
                        OutfitItem(itemId=1088, price=45, goldPrice=16, color1=40, color2=266, itemType="Skirt"), # Candy Blue Mer-Made Lagoon Drape
                        OutfitItem(itemId=3520, price=25, goldPrice=10, color1=11, color2=0, itemType="Shoes"), # Coral Pink Bubble Top Slippers
                    ],
                ),
                ShopOutfit(
                    outfitId=4083,
                    items = [
                        OutfitItem(itemId=2075, price=25, goldPrice=10, color1=43, color2=55, itemType="HeadItem"),
                        OutfitItem(itemId=78, price=45, goldPrice=16, color1=43, color2=0, itemType="Shirt"),
                        OutfitItem(itemId=1180, price=45, goldPrice=16, color1=55, color2=43, itemType="Skirt"),
                        OutfitItem(itemId=3511, price=25, goldPrice=10, color1=43, color2=0, itemType="Shoes"),
                        OutfitItem(itemId=1081, price=45, goldPrice=16, color1=55, color2=43, itemType="Skirt"),
                        OutfitItem(itemId=3501, price=25, goldPrice=10, color1=43, color2=0, itemType="Shoes"),
                    ],
                ),
                ShopOutfit(
                    outfitId=4084,
                    items = [
                        OutfitItem(itemId=2075, price=25, goldPrice=10, color1=166, color2=156, itemType="HeadItem"),
                        OutfitItem(itemId=78, price=45, goldPrice=16, color1=156, color2=0, itemType="Shirt"),
                        OutfitItem(itemId=1180, price=45, goldPrice=16, color1=166, color2=156, itemType="Skirt"),
                        OutfitItem(itemId=3511, price=25, goldPrice=10, color1=156, color2=0, itemType="Shoes"),
                        OutfitItem(itemId=1081, price=45, goldPrice=16, color1=156, color2=166, itemType="Skirt"),
                        OutfitItem(itemId=3501, price=25, goldPrice=10, color1=156, color2=0, itemType="Shoes"),
                    ],
                ),
                ShopOutfit(
                    outfitId=4085,
                    items = [
                        OutfitItem(itemId=2637, price=25, goldPrice=10, color1=282, color2=168, itemType="Necklace"),
                        OutfitItem(itemId=1000086, price=45, goldPrice=16, color1=191, color2=135, itemType="Shirt"),
                        OutfitItem(itemId=1493, price=45, goldPrice=16, color1=191, color2=135, itemType="Skirt"),
                        OutfitItem(itemId=3501, price=25, goldPrice=10, color1=135, color2=0, itemType="Shoes"),
                    ],
                ),
            ]
        ),

        ShopCollection(
            collectionId=58, # Animal Friend Costumes (Sparrows)
            currencyId=INGREDIENTS["SPIDER_SILK"].id,
            outfits=[
                ShopOutfit(
                    outfitId=4075,
                    items = [
                        OutfitItem(itemId=230, price=45, goldPrice=16, color1=142, color2=206, itemType="Shirt"), # Bumble Bee Yellow Buzzy Bee Top
                        OutfitItem(itemId=1170, price=45, goldPrice=16, color1=206, color2=206, itemType="Skirt"), # Raven Black Pocket Pants
                        OutfitItem(itemId=3577, price=25, goldPrice=10, color1=206, color2=206, itemType="Shoes"), # Raven Black Ivy Lace Work Boots
                    ],
                ),
                ShopOutfit(
                    outfitId=4076,
                    items = [
                        OutfitItem(itemId=175, price=45, goldPrice=16, color1=44, color2=190, itemType="Shirt"), # Plumblossom Pink Firefly Wrap
                        OutfitItem(itemId=1195, price=45, goldPrice=16, color1=190, color2=190, itemType="Skirt"), # Firefly Green Dry Leaf Shorts
                        OutfitItem(itemId=3577, price=25, goldPrice=10, color1=44, color2=44, itemType="Shoes"), # Plumblossom Pink Ivy Lace Work Boots
                    ],
                ),
                ShopOutfit(
                    outfitId=4077,
                    items = [
                        OutfitItem(itemId=177, price=45, goldPrice=16, color1=206, color2=189, itemType="Shirt"), # Raven Black Ladybug Tee
                        OutfitItem(itemId=1175, price=45, goldPrice=16, color1=206, color2=189, itemType="Skirt"), # Raven Black Ladybug Shorts
                        OutfitItem(itemId=3577, price=25, goldPrice=10, color1=206, color2=206, itemType="Shoes"), # Raven Black Ivy Lace Work Boots
                    ],
                ),
                ShopOutfit(
                    outfitId=4078,
                    items = [
                        OutfitItem(itemId=2149, price=25, goldPrice=10, color1=193, color2=175, itemType="HeadItem"), # Electric Green Dragonfly Mask
                        OutfitItem(itemId=178, price=45, goldPrice=16, color1=175, color2=175, itemType="Shirt"), # Creek Green Dragonfly Top
                        OutfitItem(itemId=1173, price=45, goldPrice=16, color1=175, color2=193, itemType="Skirt"), # Creek Green Dragonfly Trousers
                        OutfitItem(itemId=3577, price=25, goldPrice=10, color1=175, color2=175, itemType="Shoes"), # Creek Green Ivy Lace Work Boots
                    ],
                ),
                ShopOutfit(
                    outfitId=4079,
                    items = [
                        OutfitItem(itemId=2153, price=25, goldPrice=10, color1=267, color2=27, itemType="HeadItem"), # Celestial Blue Hummingbird Mask
                        OutfitItem(itemId=190, price=45, goldPrice=16, color1=267, color2=27, itemType="Shirt"), # Celestial Blue Hummingbird Top
                        OutfitItem(itemId=1174, price=45, goldPrice=16, color1=267, color2=267, itemType="Skirt"), # Celestial Blue Hummingbird Trousers
                        OutfitItem(itemId=3577, price=25, goldPrice=10, color1=267, color2=267, itemType="Shoes"), # Celestial Blue Ivy Lace Work Boots
                    ],
                ),
                ShopOutfit(
                    outfitId=4080,
                    items = [
                        OutfitItem(itemId=2362, price=25, goldPrice=10, color1=224, color2=128, itemType="HeadItem"), # Ivory White Fox Mask
                        OutfitItem(itemId=497, price=45, goldPrice=16, color1=224, color2=128, itemType="Shirt"), # Ivory White Fox Top
                        OutfitItem(itemId=1413, price=45, goldPrice=16, color1=224, color2=128, itemType="Skirt"), # Ivory White Fox Trousers
                        OutfitItem(itemId=3793, price=25, goldPrice=10, color1=224, color2=128, itemType="Shoes"), # Ivory White Fox Boots
                    ],
                ),
            ]
        ),


        ShopCollection(
            collectionId=4022, # Troop Rabbit Uniforms
            currencyId=INGREDIENTS["MEADOW_GRASS"].id,
            outfits=[
                # Rabbit 2013 - Fairies
                ShopOutfit(
                    outfitId=4001,
                    items = [
                        OutfitItem(itemId=1000088, price=37, goldPrice=11, color1=178, color2=237, itemType="Shirt"), # Fawn Orange, Melon Orange
                        OutfitItem(itemId=1496, price=33, goldPrice=10, color1=178, color2=237, itemType="Skirt"), # Fawn Orange, Melon Orange
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=178, color2=237, itemType="Shoes"), # Fawn Orange, Melon Orange
                    ],
                ),
                ShopOutfit(
                    outfitId=4002,
                    items = [
                        OutfitItem(itemId=1000088, price=37, goldPrice=11, color1=239, color2=154, itemType="Shirt"), # Coffee Black, Beetle Brown
                        OutfitItem(itemId=1496, price=33, goldPrice=10, color1=239, color2=154, itemType="Skirt"), # Coffee Black, Beetle Brown
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=239, color2=154, itemType="Shoes"), # Coffee Black, Beetle Brown
                    ],
                ),
                # Rabbit 2013 - Sparrowmen
                ShopOutfit(
                    outfitId=4003,
                    items = [
                        OutfitItem(itemId=142, price=37, goldPrice=11, color1=237, color2=178, itemType="Shirt"), # Melon Orange Animal-Talent Tee 
                        OutfitItem(itemId=1193, price=33, goldPrice=10, color1=178, color2=178, itemType="Skirt"), # Fawn Orange Sporty Shorts
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=178, color2=237, itemType="Shoes"), # Fawn Orange Camp Referee Shoes with Melon Orange Trim
                    ],
                ),
                ShopOutfit(
                    outfitId=4004,
                    items = [
                        OutfitItem(itemId=142, price=37, goldPrice=11, color1=108, color2=91, itemType="Shirt"), # Creamy Tan, Coconut Brown Animal-Talent Tee
                        OutfitItem(itemId=1193, price=33, goldPrice=10, color1=91, color2=91, itemType="Skirt"), # Coconut Brown Sporty Shorts
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=91, color2=108, itemType="Shoes"), # Coconut Brown Camp Referee Shoes with Creamy Tan Trim
                    ],
                ),
                # Rabbit 2012 - Fairies
                ShopOutfit(
                    outfitId=4005,
                    items = [
                        OutfitItem(itemId=2126, price=20, goldPrice=7, color1=178, color2=178, itemType="HeadItem"), # Fawn Orange
                        OutfitItem(itemId=2546, price=20, goldPrice=7, color1=90, color2=178, itemType="Necklace"), # Custard Yellow, Fawn Orange
                        OutfitItem(itemId=136, price=37, goldPrice=11, color1=166, color2=161, itemType="Shirt"), # Snow White, Buried Treasure Brown
                        OutfitItem(itemId=1048, price=33, goldPrice=10, color1=166, color2=161, itemType="Skirt"), # Snow White, Buried Treasure Brown
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=178, color2=166, itemType="Shoes"), # Fawn Orange, Snow White
                    ],
                ),
                # Rabbit 2012 - Sparrow Men
                ShopOutfit(
                    outfitId=4006,
                    items = [
                        OutfitItem(itemId=2127, price=20, goldPrice=7, color1=178, color2=178, itemType="HeadItem"), # Fawn Orange
                        OutfitItem(itemId=2547, price=20, goldPrice=7, color1=90, color2=178, itemType="Necklace"), # Custard Yellow, Fawn Orange
                        OutfitItem(itemId=142, price=37, goldPrice=11, color1=166, color2=161, itemType="Shirt"), # Snow White, Buried Treasure Brown
                        OutfitItem(itemId=1133, price=33, goldPrice=10, color1=161, color2=161, itemType="Skirt"), # Snow White, Buried Treasure Brown
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=178, color2=166, itemType="Shoes"), # Fawn Orange, Snow White
                    ],
                ),
                # Butterfly 2013 - Fairies
                ShopOutfit(
                    outfitId=4007,
                    items = [
                        OutfitItem(itemId=1000084, price=37, goldPrice=11, color1=174, color2=121, itemType="Shirt"), # Rosetta Red, Daisy Pink
                        OutfitItem(itemId=1491, price=33, goldPrice=10, color1=174, color2=121, itemType="Skirt"), # Rosetta Red, Daisy Pink
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=174, color2=121, itemType="Shoes"), # Rosetta Red, Daisy Pink
                    ],
                ),
                ShopOutfit(
                    outfitId=4008,
                    items = [
                        OutfitItem(itemId=1000084, price=37, goldPrice=11, color1=194, color2=16, itemType="Shirt"), # Electric Pink, Camellia Pink
                        OutfitItem(itemId=1491, price=33, goldPrice=10, color1=194, color2=16, itemType="Skirt"), # Electric Pink, Camellia Pink
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=194, color2=16, itemType="Shoes"), # Electric Pink, Camellia Pink
                    ],
                ),
                # Butterfly 2013 - Sparrowmen
                ShopOutfit(
                    outfitId=4009,
                    items = [
                        OutfitItem(itemId=139, price=37, goldPrice=11, color1=174, color2=121, itemType="Shirt"), # Rosetta Red Garden-Talent Tee 
                        OutfitItem(itemId=1193, price=33, goldPrice=10, color1=174, color2=174, itemType="Skirt"), # Rosetta Red Sporty Shorts
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=174, color2=121, itemType="Shoes"), # Rosetta Red Camp Referee Shoes with Daisy Pink Trim
                    ],
                ),
                ShopOutfit(
                    outfitId=4010,
                    items = [
                        OutfitItem(itemId=139, price=37, goldPrice=11, color1=81, color2=282, itemType="Shirt"), # Crimson Red, Magnolia White
                        OutfitItem(itemId=1193, price=33, goldPrice=10, color1=81, color2=282, itemType="Skirt"), # Crimson Red, Magnolia White
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=81, color2=282, itemType="Shoes"), # Crimson Red, Magnolia White
                    ],
                ),
                # Butterfly 2012 - Fairies
                ShopOutfit(
                    outfitId=4011,
                    items = [
                        OutfitItem(itemId=2126, price=20, goldPrice=7, color1=174, color2=174, itemType="HeadItem"), # Rosetta Red
                        OutfitItem(itemId=2546, price=20, goldPrice=7, color1=86, color2=174, itemType="Necklace"), # Nutmeg Brown, Rosetta Red
                        OutfitItem(itemId=135, price=37, goldPrice=11, color1=166, color2=16, itemType="Shirt"), # Snow White, Camellia Pink
                        OutfitItem(itemId=1048, price=33, goldPrice=10, color1=166, color2=16, itemType="Skirt"), # Snow White, Camellia Pink
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=174, color2=166, itemType="Shoes"), # Rosetta Red, Snow White
                    ],
                ),
                # Butterfly 2012 - Sparrow Men
                ShopOutfit(
                    outfitId=4012,
                    items = [
                        OutfitItem(itemId=2127, price=20, goldPrice=7, color1=174, color2=174, itemType="HeadItem"), # Rosetta Red
                        OutfitItem(itemId=2547, price=20, goldPrice=7, color1=86, color2=174, itemType="Necklace"), # Nutmeg Brown, Rosetta Red
                        OutfitItem(itemId=139, price=37, goldPrice=11, color1=166, color2=113, itemType="Shirt"), # Snow White, Pale Rose Red
                        OutfitItem(itemId=1133, price=33, goldPrice=10, color1=113, color2=113, itemType="Skirt"), # Snow White, Pale Rose Red
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=174, color2=166, itemType="Shoes"), # Rosetta Red, Snow White
                    ],
                ),
                # Otter 2013 - Fairies
                ShopOutfit(
                    outfitId=4013,
                    items = [
                        OutfitItem(itemId=1000087, price=37, goldPrice=11, color1=176, color2=219, itemType="Shirt"), # Silvermist Blue, Crystal Blue
                        OutfitItem(itemId=1494, price=33, goldPrice=10, color1=176, color2=219, itemType="Skirt"), # Silvermist Blue, Crystal Blue
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=176, color2=219, itemType="Shoes"), # Silvermist Blue, Crystal Blue
                    ],
                ),
                ShopOutfit(
                    outfitId=4014,
                    items = [
                        OutfitItem(itemId=1000087, price=37, goldPrice=11, color1=267, color2=207, itemType="Shirt"), # Celestial Blue, Diamond Blue
                        OutfitItem(itemId=1494, price=33, goldPrice=10, color1=267, color2=207, itemType="Skirt"), # Celestial Blue, Diamond Blue
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=267, color2=207, itemType="Shoes"), # Celestial Blue, Diamond Blue
                    ],
                ),
                # Otters 2013 - Sparrowmen
                ShopOutfit(
                    outfitId=4015,
                    items = [
                        OutfitItem(itemId=141, price=37, goldPrice=11, color1=176, color2=219, itemType="Shirt"), # Silvermist Blue Water-Talent Tee
                        OutfitItem(itemId=1193, price=33, goldPrice=10, color1=176, color2=176, itemType="Skirt"), # Silvermist Blue Sporty Shorts
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=176, color2=219, itemType="Shoes"), # Silvermist Blue Camp Referee Shoes with Crystal Blue Trim
                    ],
                ),
                ShopOutfit(
                    outfitId=4016,
                    items = [
                        OutfitItem(itemId=141, price=37, goldPrice=11, color1=267, color2=207, itemType="Shirt"), # Celestial Blue Water-Talent Tee
                        OutfitItem(itemId=1193, price=33, goldPrice=10, color1=267, color2=267, itemType="Skirt"), # Celestial Blue Sporty Shorts
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=267, color2=207, itemType="Shoes"), # Celestial Blue Camp Referee Shoes with Diamond Blue Trim
                    ],
                ),
                # Otter 2012 - Fairies
                ShopOutfit(
                    outfitId=4017,
                    items = [
                        OutfitItem(itemId=2126, price=20, goldPrice=7, color1=176, color2=176, itemType="HeadItem"), # Silvermist Blue
                        OutfitItem(itemId=2546, price=20, goldPrice=7, color1=161, color2=176, itemType="Necklace"), # Buried Treasure Brown, Silvermist Blue
                        OutfitItem(itemId=137, price=37, goldPrice=11, color1=166, color2=126, itemType="Shirt"), # Snow White, Raindrop Blue
                        OutfitItem(itemId=1048, price=33, goldPrice=10, color1=166, color2=126, itemType="Skirt"), # Snow White, Raindrop Blue
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=176, color2=166, itemType="Shoes"), # Silvermist Blue, Snow White
                    ],
                ),
                # Otter 2012 - Sparrow Men
                ShopOutfit(
                    outfitId=4018,
                    items = [
                        OutfitItem(itemId=2127, price=20, goldPrice=7, color1=176, color2=176, itemType="HeadItem"), # Silvermist Blue
                        OutfitItem(itemId=2547, price=20, goldPrice=7, color1=161, color2=176, itemType="Necklace"), # Buried Treasure Brown, Silvermist Blue
                        OutfitItem(itemId=141, price=37, goldPrice=11, color1=166, color2=126, itemType="Shirt"), # Snow White, Raindrop Blue
                        OutfitItem(itemId=1133, price=33, goldPrice=10, color1=126, color2=126, itemType="Skirt"), # Raindrop Blue
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=176, color2=166, itemType="Shoes"), # Silvermist Blue, Snow White
                    ],
                ),
                # Turtle 2013 - Fairies
                ShopOutfit(
                    outfitId=4019,
                    items = [
                        OutfitItem(itemId=1000089, price=37, goldPrice=11, color1=145, color2=250, itemType="Shirt"), # Tinker Bell Green, Caramel Tan
                        OutfitItem(itemId=1495, price=33, goldPrice=10, color1=145, color2=250, itemType="Skirt"), # Tinker Bell Green, Caramel Tan
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=145, color2=250, itemType="Shoes"), # Tinker Bell Green, Caramel Tan
                    ],
                ),
                ShopOutfit(
                    outfitId=4020,
                    items = [
                        OutfitItem(itemId=1000089, price=37, goldPrice=11, color1=261, color2=222, itemType="Shirt"), # Kelly Green, Keylime Green
                        OutfitItem(itemId=1495, price=33, goldPrice=10, color1=261, color2=222, itemType="Skirt"), # Kelly Green, Keylime Green
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=261, color2=222, itemType="Shoes"), # Kelly Green, Keylime Green
                    ],
                ),
                # Turtle 2013 - Sparrowmen
                ShopOutfit(
                    outfitId=4021,
                    items = [
                        OutfitItem(itemId=143, price=37, goldPrice=11, color1=145, color2=250, itemType="Shirt"), # Tinker Bell Green Tinker-Talent Tee
                        OutfitItem(itemId=1193, price=33, goldPrice=10, color1=145, color2=145, itemType="Skirt"), # Tinker Bell Green Sporty Shorts
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=145, color2=250, itemType="Shoes"), # Tinker Bell Green Camp Referee Shoes with Caramel Tan Trim
                    ],
                ),
                ShopOutfit(
                    outfitId=4022,
                    items = [
                        OutfitItem(itemId=143, price=37, goldPrice=11, color1=261, color2=222, itemType="Shirt"), # Kelly Green, Keylime Green
                        OutfitItem(itemId=1193, price=33, goldPrice=10, color1=261, color2=261, itemType="Skirt"), # Kelly Green, Keylime Green
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=261, color2=222, itemType="Shoes"), # Kelly Green, Keylime Green
                    ],
                ),
                # Turtle 2012 - Fairies
                ShopOutfit(
                    outfitId=4023,
                    items = [
                        OutfitItem(itemId=2126, price=20, goldPrice=7, color1=145, color2=145, itemType="HeadItem"), # Tinker Bell Green
                        OutfitItem(itemId=2546, price=20, goldPrice=7, color1=28, color2=145, itemType="Necklace"), # Cinnamon Brown, Tinkerbell Green
                        OutfitItem(itemId=134, price=37, goldPrice=11, color1=166, color2=2, itemType="Shirt"), # Snow White, Clover Green
                        OutfitItem(itemId=1048, price=33, goldPrice=10, color1=166, color2=2, itemType="Skirt"), # Snow White, Clover Green
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=145, color2=166, itemType="Shoes"), # Tinker Bell Green, Snow White
                    ],
                ),
                # Turtle 2012 - Sparrow Men
                ShopOutfit(
                    outfitId=4024,
                    items = [
                        OutfitItem(itemId=2127, price=20, goldPrice=7, color1=145, color2=145, itemType="HeadItem"), # Tinker Bell Green
                        OutfitItem(itemId=2547, price=20, goldPrice=7, color1=28, color2=145, itemType="Necklace"), # Cinnamon Brown, Tinkerbell Green
                        OutfitItem(itemId=143, price=37, goldPrice=11, color1=166, color2=2, itemType="Shirt"), # Snow White, Clover Green
                        OutfitItem(itemId=1133, price=33, goldPrice=10, color1=2, color2=2, itemType="Skirt"), # Clover Green
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=145, color2=166, itemType="Shoes"), # Tinker Bell Green, Snow White
                    ],
                ),
                # Glowworm 2013 - Fairies
                ShopOutfit(
                    outfitId=4025,
                    items = [
                        OutfitItem(itemId=1000085, price=37, goldPrice=11, color1=179, color2=137, itemType="Shirt"), # Iridessa Yellow, Lemon Yellow
                        OutfitItem(itemId=1492, price=33, goldPrice=10, color1=179, color2=137, itemType="Skirt"), # Iridessa Yellow, Lemon Yellow
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=179, color2=137, itemType="Shoes"), # Iridessa Yellow, Lemon Yellow
                    ],
                ),
                ShopOutfit(
                    outfitId=4026,
                    items = [
                        OutfitItem(itemId=1000085, price=37, goldPrice=11, color1=162, color2=224, itemType="Shirt"), # Sunglow Yellow, Ivory White
                        OutfitItem(itemId=1492, price=33, goldPrice=10, color1=162, color2=224, itemType="Skirt"), # Sunglow Yellow, Ivory White
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=162, color2=224, itemType="Shoes"), # Sunglow Yellow, Ivory White
                    ],
                ),
                # Glowworm 2013 - Sparrow Men
                ShopOutfit(
                    outfitId=4027,
                    items = [
                        OutfitItem(itemId=140, price=37, goldPrice=11, color1=179, color2=137, itemType="Shirt"), # Iridessa Yellow Light-Talent Tee 
                        OutfitItem(itemId=1193, price=33, goldPrice=10, color1=179, color2=179, itemType="Skirt"), # Iridessa Yellow Sporty Shorts
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=179, color2=137, itemType="Shoes"), # Iridessa Yellow Camp Referee Shoes with Lemon Yellow Trim
                    ],
                ),
                ShopOutfit(
                    outfitId=4028,
                    items = [
                        OutfitItem(itemId=140, price=37, goldPrice=11, color1=162, color2=224, itemType="Shirt"), # Sunglow Yellow, Ivory White
                        OutfitItem(itemId=1193, price=33, goldPrice=10, color1=162, color2=224, itemType="Skirt"), # Sunglow Yellow, Ivory White
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=162, color2=224, itemType="Shoes"), # Sunglow Yellow, Ivory White
                    ],
                ),
                # Glowworm 2012 - Fairies
                ShopOutfit(
                    outfitId=4029,
                    items = [
                        OutfitItem(itemId=2126, price=20, goldPrice=7, color1=179, color2=179, itemType="HeadItem"), # Iridessa Yellow
                        OutfitItem(itemId=2546, price=20, goldPrice=7, color1=84, color2=179, itemType="Necklace"), # Copper Brown, Iridessa Yellow
                        OutfitItem(itemId=138, price=37, goldPrice=11, color1=166, color2=9, itemType="Shirt"), # Snow White, Daffodil Yellow
                        OutfitItem(itemId=1048, price=33, goldPrice=10, color1=166, color2=9, itemType="Skirt"), # Snow White, Daffodil Yellow
                        OutfitItem(itemId=3595, price=33, goldPrice=10, color1=179, color2=166, itemType="Shoes"), # Iridessa Yellow, Snow White
                    ],
                ),
                # Glowworm 2012 - Sparrow Men
                ShopOutfit(
                    outfitId=4030,
                    items = [
                        OutfitItem(itemId=2127, price=20, goldPrice=7, color1=179, color2=179, itemType="HeadItem"), # Iridessa Yellow
                        OutfitItem(itemId=2547, price=20, goldPrice=7, color1=84, color2=179, itemType="Necklace"), # Copper Brown, Iridessa Yellow
                        OutfitItem(itemId=140, price=37, goldPrice=11, color1=166, color2=9, itemType="Shirt"), # Snow White, Daffodil Yellow
                        OutfitItem(itemId=1133, price=33, goldPrice=10, color1=9, color2=9, itemType="Skirt"), # Snow White, Daffodil Yellow
                        OutfitItem(itemId=3597, price=33, goldPrice=10, color1=179, color2=166, itemType="Shoes"), # Iridessa Yellow, Snow White
                    ],
                )
            ],
        ),
        ShopCollection(
            collectionId=4027, # Pep Squad
            currencyId=INGREDIENTS["MEADOW_GRASS"].id,
            outfits=[
                # Animal Talent Pep Squad
                # F
                ShopOutfit(
                    outfitId=4031,
                    items = [
                        OutfitItem(itemId=307, price=37, goldPrice=11, color1=178, color2=56, itemType="Shirt"), # Fawn Orange, Bole Brown
                        OutfitItem(itemId=1575, price=20, goldPrice=7, color1=178, color2=56, itemType="WristItem"), # Fawn Orange, Bole Brown
                        OutfitItem(itemId=1224, price=33, goldPrice=10, color1=178, color2=56, itemType="Skirt"), # Fawn Orange, Bole Brown
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=178, color2=16, itemType="Shoes"), # Fawn Orange, Snow White
                    ],
                ),
                # SM
                ShopOutfit(
                    outfitId=4032,
                    items = [
                        OutfitItem(itemId=312, price=37, goldPrice=11, color1=178, color2=56, itemType="Shirt"), # Fawn Orange, Bole Brown
                        OutfitItem(itemId=1241, price=33, goldPrice=10, color1=178, color2=56, itemType="Skirt"), # Fawn Orange, Bole Brown
                        OutfitItem(itemId=3633, price=33, goldPrice=10, color1=178, color2=0, itemType="Shoes"), # Fawn Orange
                    ],
                ),
                # Garden Talent Pep Squad
                # F
                ShopOutfit(
                    outfitId=4033,
                    items = [
                        OutfitItem(itemId=308, price=37, goldPrice=11, color1=174, color2=121, itemType="Shirt"), # Rosetta Red, Daisy Pink
                        OutfitItem(itemId=1575, price=20, goldPrice=7, color1=174, color2=121, itemType="WristItem"), # Rosetta Red, Daisy Pink
                        OutfitItem(itemId=1224, price=33, goldPrice=10, color1=174, color2=121, itemType="Skirt"), # Rosetta Red, Daisy Pink
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=174, color2=16, itemType="Shoes"), # Rosetta Red, Snow White
                    ],
                ),
                # SM
                ShopOutfit(
                    outfitId=4034,
                    items = [
                        OutfitItem(itemId=314, price=37, goldPrice=11, color1=174, color2=81, itemType="Shirt"), # Rosetta Red, Crimson Red
                        OutfitItem(itemId=1241, price=33, goldPrice=10, color1=174, color2=81, itemType="Skirt"), # Rosetta Red, Crimson Red
                        OutfitItem(itemId=3633, price=33, goldPrice=10, color1=174, color2=0, itemType="Shoes"), # Rosetta Red
                    ],
                ),
                # Water Talent Pep Squad
                # F
                ShopOutfit(
                    outfitId=4035,
                    items = [
                        OutfitItem(itemId=311, price=37, goldPrice=11, color1=176, color2=219, itemType="Shirt"), # Silvermist Blue, Crystal Blue
                        OutfitItem(itemId=1575, price=20, goldPrice=7, color1=176, color2=219, itemType="WristItem"), # Silvermist Blue, Crystal Blue
                        OutfitItem(itemId=1224, price=33, goldPrice=10, color1=176, color2=219, itemType="Skirt"), # Silvermist Blue, Crystal Blue
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=176, color2=16, itemType="Shoes"), # Silvermist Blue, Snow White
                    ],
                ),
                # SM
                ShopOutfit(
                    outfitId=4036,
                    items = [
                        OutfitItem(itemId=316, price=37, goldPrice=11, color1=132, color2=176, itemType="Shirt"), # Bubble Blue, Silvermist Blue
                        OutfitItem(itemId=1241, price=33, goldPrice=10, color1=176, color2=132, itemType="Skirt"), # Silvermist Blue, Bubble Blue
                        OutfitItem(itemId=3633, price=33, goldPrice=10, color1=176, color2=0, itemType="Shoes"), # Silvermist Blue
                    ],
                ),
                # Tinker Talent Pep Squad
                # F
                ShopOutfit(
                    outfitId=4037,
                    items = [
                        OutfitItem(itemId=310, price=37, goldPrice=11, color1=145, color2=1, itemType="Shirt"), # Tinker Bell Green, Mint Green
                        OutfitItem(itemId=1575, price=20, goldPrice=7, color1=145, color2=1, itemType="WristItem"), # Tinker Bell Green, Mint Green
                        OutfitItem(itemId=1224, price=33, goldPrice=10, color1=145, color2=1, itemType="Skirt"), # Tinker Bell Green, Mint Green
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=145, color2=16, itemType="Shoes"), # Tinker Bell Green, Snow White
                    ],
                ),
                # SM
                ShopOutfit(
                    outfitId=4038,
                    items = [
                        OutfitItem(itemId=313, price=37, goldPrice=11, color1=1, color2=145, itemType="Shirt"), # Mint Green, Tinker Bell Green
                        OutfitItem(itemId=1241, price=33, goldPrice=10, color1=145, color2=1, itemType="Skirt"), # Tinker Bell Green, Mint Green
                        OutfitItem(itemId=3633, price=33, goldPrice=10, color1=145, color2=0, itemType="Shoes"), # Tinker Bell Green
                    ],
                ),
                # Light Talent Pep Squad
                # F
                ShopOutfit(
                    outfitId=4039,
                    items = [
                        OutfitItem(itemId=309, price=37, goldPrice=11, color1=179, color2=111, itemType="Shirt"), # Iridessa Yellow, Sparkling Yellow
                        OutfitItem(itemId=1575, price=20, goldPrice=7, color1=179, color2=111, itemType="WristItem"), # Iridessa Yellow, Sparkling Yellow
                        OutfitItem(itemId=1224, price=33, goldPrice=10, color1=179, color2=111, itemType="Skirt"), # Iridessa Yellow, Sparkling Yellow
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=179, color2=16, itemType="Shoes"), # Iridessa Yellow, Sparkling Yellow
                    ],
                ),
                # SM
                ShopOutfit(
                    outfitId=4040,
                    items = [
                        OutfitItem(itemId=315, price=37, goldPrice=11, color1=111, color2=179, itemType="Shirt"), # Sparkling Yellow, Iridessa Yellow
                        OutfitItem(itemId=1241, price=33, goldPrice=10, color1=179, color2=111, itemType="Skirt"), # Iridessa Yellow, Sparkling Yellow
                        OutfitItem(itemId=3633, price=33, goldPrice=10, color1=179, color2=0, itemType="Shoes"), # Iridessa Yellow
                    ],
                )
            ],
        ),
        ShopCollection(
            collectionId=4028, # Training Outfits
            currencyId=INGREDIENTS["MEADOW_GRASS"].id,
            outfits=[
                # Fairies
                ShopOutfit(
                    outfitId=4041,
                    items = [
                        OutfitItem(itemId=278, price=37, goldPrice=11, color1=178, color2=186, itemType="Shirt"), # Fawn Orange, Honeycomb Yellow
                        OutfitItem(itemId=1228, price=33, goldPrice=10, color1=178, color2=186, itemType="Skirt"), # Fawn Orange, Honeycomb Yellow
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=178, color2=0, itemType="Shoes"), # Fawn Orange, Snow White
                    ],
                ),
                ShopOutfit(
                    outfitId=4042,
                    items = [
                        OutfitItem(itemId=278, price=37, goldPrice=11, color1=12, color2=29, itemType="Shirt"), # Tangerine Orange, Goldfish Orange
                        OutfitItem(itemId=1228, price=33, goldPrice=10, color1=12, color2=29, itemType="Skirt"), # Tangerine Orange, Goldfish Orange
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=12, color2=0, itemType="Shoes"), # Tangerine Orange, Snow White
                    ],
                ),
                ShopOutfit(
                    outfitId=4043,
                    items = [
                        OutfitItem(itemId=279, price=37, goldPrice=11, color1=174, color2=54, itemType="Shirt"), # Rosetta Red, Peony Pink
                        OutfitItem(itemId=1229, price=33, goldPrice=10, color1=174, color2=54, itemType="Skirt"), # Rosetta Red, Peony Pink
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=174, color2=0, itemType="Shoes"), # Rosetta Red, Snow White
                    ],
                ),
                ShopOutfit(
                    outfitId=4044,
                    items = [
                        OutfitItem(itemId=279, price=37, goldPrice=11, color1=8, color2=81, itemType="Shirt"), # Watermelon Pink, Crimson Red
                        OutfitItem(itemId=1229, price=33, goldPrice=10, color1=8, color2=81, itemType="Skirt"), # Watermelon Pink, Crimson Red
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=8, color2=0, itemType="Shoes"), # Watermelon Pink, Snow White
                    ],
                ),
                ShopOutfit(
                    outfitId=4045,
                    items = [
                        OutfitItem(itemId=282, price=37, goldPrice=11, color1=176, color2=18, itemType="Shirt"), # Silvermist Blue, Waterfall Blue
                        OutfitItem(itemId=1232, price=33, goldPrice=10, color1=176, color2=18, itemType="Skirt"), # Silvermist Blue, Waterfall Blue
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=176, color2=0, itemType="Shoes"), # Silvermist Blue, Snow White
                    ],
                ),
                ShopOutfit(
                    outfitId=4046,
                    items = [
                        OutfitItem(itemId=282, price=37, goldPrice=11, color1=118, color2=124, itemType="Shirt"), # Sapphire Blue, Forget-Me-Not Blue
                        OutfitItem(itemId=1232, price=33, goldPrice=10, color1=118, color2=124, itemType="Skirt"), # Sapphire Blue, Forget-Me-Not Blue
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=118, color2=0, itemType="Shoes"), # Sapphire Blue, Snow White
                    ],
                ),
                ShopOutfit(
                    outfitId=4047,
                    items = [
                        OutfitItem(itemId=281, price=37, goldPrice=11, color1=145, color2=186, itemType="Shirt"), # Tinker Bell Green, Honeycomb Yellow
                        OutfitItem(itemId=1231, price=33, goldPrice=10, color1=145, color2=186, itemType="Skirt"), # Tinker Bell Green, Honeycomb Yellow
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=145, color2=0, itemType="Shoes"), # Tinker Bell Green, Snow White
                    ],
                ),
                ShopOutfit(
                    outfitId=4048,
                    items = [
                        OutfitItem(itemId=281, price=37, goldPrice=11, color1=64, color2=1, itemType="Shirt"), # Emerald Green, Mint Green
                        OutfitItem(itemId=1231, price=33, goldPrice=10, color1=64, color2=1, itemType="Skirt"), # Emerald Green, Mint Green
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=64, color2=0, itemType="Shoes"), # Emerald Green, Snow White
                    ],
                ),
                ShopOutfit(
                    outfitId=4049,
                    items = [
                        OutfitItem(itemId=280, price=37, goldPrice=11, color1=179, color2=9, itemType="Shirt"), # Iridessa Yellow, Daffodil Yellow
                        OutfitItem(itemId=1230, price=33, goldPrice=10, color1=179, color2=9, itemType="Skirt"), # Iridessa Yellow, Daffodil Yellow
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=179, color2=0, itemType="Shoes"), # Iridessa Yellow, Snow White
                    ],
                ),
                ShopOutfit(
                    outfitId=4050,
                    items = [
                        OutfitItem(itemId=280, price=37, goldPrice=11, color1=116, color2=151, itemType="Shirt"), # Mushroom White, Peanut Yellow
                        OutfitItem(itemId=1230, price=33, goldPrice=10, color1=116, color2=151, itemType="Skirt"), # Mushroom White, Peanut Yellow
                        OutfitItem(itemId=3504, price=33, goldPrice=10, color1=116, color2=0, itemType="Shoes"), # Mushroom White, Snow White
                    ],
                ),
                # Sparrow Men
                ShopOutfit(
                    outfitId=4051,
                    items = [
                        OutfitItem(itemId=288, price=37, goldPrice=11, color1=178, color2=186, itemType="Shirt"), # Fawn Orange, Honeycomb Yellow
                        OutfitItem(itemId=1241, price=33, goldPrice=10, color1=186, color2=178, itemType="Skirt"), # Honeycomb Yellow, Fawn Orange 
                        OutfitItem(itemId=3625, price=33, goldPrice=10, color1=178, color2=186, itemType="Shoes"), # Fawn Orange, Honeycomb Yellow
                    ],
                ),
                ShopOutfit(
                    outfitId=4052,
                    items = [
                        OutfitItem(itemId=288, price=37, goldPrice=11, color1=12, color2=29, itemType="Shirt"), # Tangerine Orange, Goldfish Orange
                        OutfitItem(itemId=1241, price=33, goldPrice=10, color1=29, color2=12, itemType="Skirt"), # Goldfish Orange, Tangerine Orange
                        OutfitItem(itemId=3625, price=33, goldPrice=10, color1=12, color2=29, itemType="Shoes"), # Tangerine Orange, Goldfish Orange
                    ],
                ),
                ShopOutfit(
                    outfitId=4053,
                    items = [
                        OutfitItem(itemId=289, price=37, goldPrice=11, color1=174, color2=54, itemType="Shirt"), # Rosetta Red, Peony Pink
                        OutfitItem(itemId=1242, price=33, goldPrice=10, color1=54, color2=174, itemType="Skirt"), # Peony Pink, Rosetta Red
                        OutfitItem(itemId=3625, price=33, goldPrice=10, color1=174, color2=54, itemType="Shoes"), # Rosetta Red, Peony Pink
                    ],
                ),
                ShopOutfit(
                    outfitId=4054,
                    items = [
                        OutfitItem(itemId=289, price=37, goldPrice=11, color1=81, color2=8, itemType="Shirt"), # Crimson Red, Watermelon Pink
                        OutfitItem(itemId=1242, price=33, goldPrice=10, color1=8, color2=81, itemType="Skirt"), # Watermelon Pink, Crimson Red
                        OutfitItem(itemId=3625, price=33, goldPrice=10, color1=81, color2=8, itemType="Shoes"), # Crimson Red, Watermelon Pink
                    ],
                ),
                ShopOutfit(
                    outfitId=4055,
                    items = [
                        OutfitItem(itemId=292, price=37, goldPrice=11, color1=176, color2=18, itemType="Shirt"), # Silvermist Blue, Waterfall Blue
                        OutfitItem(itemId=1244, price=33, goldPrice=10, color1=18, color2=176, itemType="Skirt"), # Waterfall Blue, Silvermist Blue
                        OutfitItem(itemId=3625, price=33, goldPrice=10, color1=176, color2=18, itemType="Shoes"), # Silvermist Blue, Waterfall Blue
                    ],
                ),
                ShopOutfit(
                    outfitId=4056,
                    items = [
                        OutfitItem(itemId=292, price=37, goldPrice=11, color1=118, color2=124, itemType="Shirt"), # Sapphire Blue, Forget-Me-Not Blue
                        OutfitItem(itemId=1244, price=33, goldPrice=10, color1=124, color2=118, itemType="Skirt"), # Forget-Me-Not Blue, Sapphire Blue
                        OutfitItem(itemId=3625, price=33, goldPrice=10, color1=118, color2=124, itemType="Shoes"), # Sapphire Blue, Forget-Me-Not Blue
                    ],
                ),
                ShopOutfit(
                    outfitId=4057,
                    items = [
                        OutfitItem(itemId=291, price=37, goldPrice=11, color1=145, color2=186, itemType="Shirt"), # Tinker Bell Green, Honeycomb Yellow
                        OutfitItem(itemId=1245, price=33, goldPrice=10, color1=186, color2=145, itemType="Skirt"), # Honeycomb Yellow, Tinker Bell Green
                        OutfitItem(itemId=3625, price=33, goldPrice=10, color1=145, color2=186, itemType="Shoes"), # Tinker Bell Green, Honeycomb Yellow
                    ],
                ),
                ShopOutfit(
                    outfitId=4058,
                    items = [
                        OutfitItem(itemId=291, price=37, goldPrice=11, color1=64, color2=1, itemType="Shirt"), # Emerald Green, Mint Green
                        OutfitItem(itemId=1245, price=33, goldPrice=10, color1=1, color2=64, itemType="Skirt"), # Mint Green, Emerald Green
                        OutfitItem(itemId=3625, price=33, goldPrice=10, color1=64, color2=1, itemType="Shoes"), # Emerald Green, Snow White
                    ],
                ),
                ShopOutfit(
                    outfitId=4059,
                    items = [
                        OutfitItem(itemId=290, price=37, goldPrice=11, color1=179, color2=9, itemType="Shirt"), # Iridessa Yellow, Daffodil Yellow
                        OutfitItem(itemId=1243, price=33, goldPrice=10, color1=9, color2=179, itemType="Skirt"), # Daffodil Yellow, Iridessa Yellow
                        OutfitItem(itemId=3625, price=33, goldPrice=10, color1=179, color2=9, itemType="Shoes"), # Iridessa Yellow, Daffodil Yellow
                    ],
                ),
                ShopOutfit(
                    outfitId=4060,
                    items = [
                        OutfitItem(itemId=290, price=37, goldPrice=11, color1=116, color2=151, itemType="Shirt"), # Mushroom White, Peanut Yellow
                        OutfitItem(itemId=1243, price=33, goldPrice=10, color1=151, color2=116, itemType="Skirt"), # Peanut Yellow, Mushroom White 
                        OutfitItem(itemId=3625, price=33, goldPrice=10, color1=116, color2=151, itemType="Shoes"), # Mushroom White, Peanut Yellow
                    ],
                )
            ],
        ),
    ],
)