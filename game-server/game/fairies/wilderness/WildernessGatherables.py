# the five ingredients that only grow out in the wilderness

import random
from dataclasses import dataclass
from typing import List

from game.fairies.ai import FairiesConstants as fc


@dataclass(frozen=True)
class Gatherable:
    itemId: int
    displayName: str
    weight: int


GATHERABLES = (
    Gatherable(fc.TRUFFLES, "Truffles", 24),
    Gatherable(fc.FEATHERS, "Feathers", 12),
    Gatherable(fc.YELLOW_GEMS, "Yellow Gems", 8),
    Gatherable(fc.BLUE_GEMS, "Blue Gems", 8),
    Gatherable(fc.BITS_OF_METAL, "Bits of Metal", 3),
)

# roughly how many stacks each stretch of cave between two barriers holds
PER_CHAMBER = 3
# how close together two stacks may sit and how far they keep off a creature
MIN_SPACING = 260.0
# only the gems have bunch art, see spawnableIdRemaps in spawnableAssets.xml
# a bunch waits out a countdown for company, so a fairy on their own gets a plain pile
BUNCH_ITEM_IDS = (fc.YELLOW_GEMS, fc.BLUE_GEMS)


def stackCount(chambers: int) -> int:
    return max(PER_CHAMBER, PER_CHAMBER * max(1, chambers))


# what a run's worth of stacks turns out to be
def roll(count: int) -> List[Gatherable]:
    if count <= 0:
        return []
    weights = [g.weight for g in GATHERABLES]
    return random.choices(GATHERABLES, weights=weights, k=count)
