"""
Puts the giveaways in the meadows, once, at startup.

Much less machinery than IngredientSpawnMgrAI, because a giveaway is permanent
scenery rather than a spawn: it stands at a hand-picked coordinate, is never
collected away, and never respawns. Eligibility is per fairy and lives on the
fairy, so there is nothing here to tick, time or re-place.

Started once by FairiesAIRepository.createObjects().
"""

from direct.directnotify import DirectNotifyGlobal
from direct.task.TaskManagerGlobal import taskMgr

from game.fairies.meadow.DistributedGiveawayAI import DistributedGiveawayAI
from game.fairies.meadow.GiveawaySpawnData import GIVEAWAY_DEFS, PLACEMENTS
from game.fairies.uberdog.HolidayManagerUD import getActiveTags

# how often a holiday's giveaways are put out or taken in, the holiday switch itself is read every 10s
HOLIDAY_CHECK_SECONDS = 30


class GiveawaySpawnMgrAI:
    notify = DirectNotifyGlobal.directNotify.newCategory("GiveawaySpawnMgrAI")

    def __init__(self, air) -> None:
        self.air = air
        self.giveaways: list[DistributedGiveawayAI] = []

    def start(self) -> None:
        self.placed: dict[int, DistributedGiveawayAI] = {}
        self.syncHoliday()
        taskMgr.doMethodLater(HOLIDAY_CHECK_SECONDS, self.holidayTask, "giveaway-holiday-sync")

        self.notify.info("Placed %d giveaways" % len(self.giveaways))

    def holidayTask(self, task):
        self.syncHoliday()
        return task.again

    def syncHoliday(self) -> None:
        # a holiday giveaway stands only while its holiday is on, and comes down when it ends,
        # otherwise the art (and a label with nothing to collect) lingers all year
        tags = set(getActiveTags())

        for index, placement in enumerate(PLACEMENTS):
            if not placement.enabled:
                continue

            definition = GIVEAWAY_DEFS.get(placement.key)

            if definition is None:
                if index not in self.placed:
                    self.notify.warning(
                        "no giveaway %d to place in zone %d"
                        % (placement.key, placement.zone_id)
                    )
                    self.placed[index] = None
                continue

            live = not definition.holiday_tag or definition.holiday_tag in tags
            giveaway = self.placed.get(index)

            if live and giveaway is None:
                giveaway = self.place(definition, placement)
                self.placed[index] = giveaway
                self.giveaways.append(giveaway)
            elif not live and giveaway is not None:
                self.giveaways.remove(giveaway)
                self.placed[index] = None
                giveaway.requestDelete()
                self.notify.info("took down giveaway %d in zone %d" % (placement.key, placement.zone_id))

    def place(self, definition, placement) -> DistributedGiveawayAI:
        giveaway = DistributedGiveawayAI(self.air)

        giveaway.setGiveawayID(definition.giveaway_id)
        giveaway.setClaimId(definition.key)
        giveaway.setPhraseOnly(definition.phrase_only)
        giveaway.setEventID(definition.event_id)
        giveaway.setHolidayBit(definition.holiday_bit)
        giveaway.setItemEventId(definition.item_event_id)
        giveaway.setMembersOnly(definition.members_only)
        giveaway.setRewardColors(
            definition.reward_color1, definition.reward_color2
        )
        giveaway.setRewardAmount(definition.reward_amount)

        # Inherited spawn stack fields. itemID is the *reward*, not the art --
        # the client picks the art off giveawayID and only uses itemID to decide
        # which inventory limit to size-check before letting the fairy click.
        giveaway.setItemID(definition.reward_item_id)
        # The client labels a stack with its name like an ingredient's, which on a trick-or-treat
        # pumpkin names the prize before anyone has spoken to it
        giveaway.setName("" if definition.phrase_only else definition.display_name)
        giveaway.setPosition(placement.x, placement.y)
        giveaway.setColorIDs(list(definition.color_ids))

        # One item, one serving: a giveaway is always a single thing, and the
        # client never renders a count on giveaway art.
        giveaway.setItemCount(1)
        giveaway.setServingSize(1)

        # Deliberately no spawnMgr. That hook is how a collected ingredient
        # stack tells its pool to delete and respawn it; a giveaway does neither.
        giveaway.generateWithRequired(placement.zone_id)

        self.notify.debug(
            "Placed giveaway %d (%s, reward %d) in zone %d at (%d, %d)"
            % (
                definition.giveaway_id,
                definition.display_name,
                definition.reward_item_id,
                placement.zone_id,
                placement.x,
                placement.y,
            )
        )

        return giveaway
