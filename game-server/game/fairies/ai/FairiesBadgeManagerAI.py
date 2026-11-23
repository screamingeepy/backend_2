from direct.distributed.DistributedObjectGlobalAI import DistributedObjectGlobalAI

from game.fairies.badges import badge_events

# accumulate() takes an int16 amount in fairy.dc.
MAX_AMOUNT = 32767

class FairiesBadgeManagerAI(DistributedObjectGlobalAI):
    def __init__(self, air) -> None:
        super().__init__(air)

    def d_accumulate(self, avatarId: int, eventId: int, amount: int = 1) -> None:
        """Report `amount` occurrences of a badge event (see badge_events)."""
        if amount <= 0:
            return

        self.sendUpdate("accumulate", [avatarId, eventId, min(amount, MAX_AMOUNT)])

    def d_exploreMeadow(self, avatarId: int, zoneId: int) -> None:
        """report that a fairy entered a meadow, rides the accumulate field with the zone id as amount"""
        self.sendUpdate(
            "accumulate", [avatarId, badge_events.EVENT_EXPLORE_MEADOW, zoneId]
        )

    def d_giveBadge(self, avatarId: int, badgeId: int) -> None:
        """award a badge outright, for badges the district decides itself (high scores, quest rewards)"""
        self.sendUpdate("giveBadge", [avatarId, badgeId])

    def d_unlockBadge(self, avatarId: int, badgeId: int) -> None:
        """give a fairy a fresh unearned row for a badge, magic words only"""
        self.sendUpdate("unlockBadge", [avatarId, badgeId])

    def d_unlockPage(self, avatarId: int, pageId: int) -> None:
        """show a fairy a badge book page they can't see yet"""
        self.sendUpdate("unlockPage", [avatarId, pageId])