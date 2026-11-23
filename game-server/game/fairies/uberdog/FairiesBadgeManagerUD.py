from datetime import datetime, timezone

from pymongo import ReturnDocument

from direct.distributed.DistributedObjectGlobalUD import DistributedObjectGlobalUD

from game.fairies.badges import badge_events, badge_lookup, badge_xml
from game.fairies.badges.badge_state import STATUS_ACTIVE, STATUS_EARNED
from game.fairies.daily.TimeUtils import to_pacific

# chapters tracked from first login, the rest of the book is left alone
# 1 starter, 2 friends, 3 explore, 7 games, 10 ingredients, 12 quests, 14 parties, 17 wilderness, 18-20 crafts, 21 donations, 22 pets, 24 tearoom, 26 gardens
TRACKED_CHAPTER_IDS = (1, 2, 3, 7, 10, 12, 14, 17, 18, 19, 20, 21, 22, 24, 26)

# badges left off the page entirely (unused content)
EXCLUDED_BADGE_IDS = frozenset({
    10821,  # Royal Wardrobe and Storage Donation
    10822,  # Mainland Sorter
    10823,  # Super Mainland Sorter
    10824,  # Flitterific Mainland Sorter
})

# badges tracked one at a time outside the chapters above
# earned is given the first time we see the fairy, active accumulates normally
FOUNDING_FAIRY = 10573
NEW_FAIRY = 10574

INCLUDED_BADGES: dict[int, str] = {
    FOUNDING_FAIRY: STATUS_EARNED,
    NEW_FAIRY: STATUS_EARNED,
    # Autumn 2012 Challenges (chapter 53); only what has a server trigger
    11154: STATUS_ACTIVE,  # Animal Masquerade
    **{badgeId: STATUS_ACTIVE for badgeId in badge_events.ZONE_TO_VISIT_BADGE.values()},
    **{
        badgeId: STATUS_ACTIVE
        for badgeIds in (
            badge_events.EVENT_TO_BADGES[eventId]
            for eventId in badge_events.BUNCH_TO_EVENT.values()
        )
        for badgeId in badgeIds
    },
}

def _badgeIdsIn(chapterIds) -> tuple[int, ...]:
    return tuple(
        badge["id"]
        for chapterId in chapterIds
        for badge in badge_lookup.get_badges_for_chapter(chapterId)
        if badge["id"] not in EXCLUDED_BADGE_IDS
    )


def _pageIdsIn(chapterIds) -> tuple[int, ...]:
    return tuple(
        page["id"]
        for chapterId in chapterIds
        for page in badge_lookup.get_pages_for_chapter(chapterId)
    )


def _pageIdsForBadges(badgeIds) -> tuple[int, ...]:
    seen = set()
    pageIds = []

    for badgeId in badgeIds:
        page = badge_lookup.get_page_for_badge(badgeId)

        if page is None or page["id"] in seen:
            continue

        seen.add(page["id"])
        pageIds.append(page["id"])

    return tuple(pageIds)


TRACKED_BADGE_IDS = _badgeIdsIn(TRACKED_CHAPTER_IDS)
TRACKED_PAGE_IDS = _pageIdsIn(TRACKED_CHAPTER_IDS)
INCLUDED_PAGE_IDS = _pageIdsForBadges(INCLUDED_BADGES)


class FairiesBadgeManagerUD(DistributedObjectGlobalUD):
    def __init__(self, air) -> None:
        super().__init__(air)

    def announceGenerate(self) -> None:
        DistributedObjectGlobalUD.announceGenerate(self)

        try:
            badge_xml.load()
        except (OSError, ValueError) as e:
            self.notify.warning(
                f"Could not read badge data from {badge_xml.BADGES_XML} ({e}). "
                f"No badge can be awarded until this is fixed. On Windows, run "
                f"startup/win32/symlink.bat to link the XML data into place."
            )

        self.accept("avatarOnline", self.avatarOnline)

    def avatarOnline(self, avatarId, avatarType) -> None:
        # avatarType is unused, but it is sent over the messenger anyways.
        rows, unlockedPages = self._ensureTrackedBadges(avatarId)

        if rows is None:
            return

        # drop the row on the way out instead of deleting it, so un-excluding brings back progress
        rows = [row for row in rows if row["badgeId"] not in EXCLUDED_BADGE_IDS]

        earnedBadges = [
            [row["badgeId"], self._formatDateEarned(row.get("dateEarned"))]
            for row in rows
            if row.get("status") == STATUS_EARNED
        ]
        badgeProgress = [
            [row["badgeId"], row.get("progress", 0)]
            for row in rows
            if row.get("status") == STATUS_ACTIVE
        ]

        self.sendUpdateToAvatarId(
            avatarId, "setBadges", [earnedBadges, unlockedPages, badgeProgress]
        )

    def accumulateForMe(self, eventId: int) -> None:
        avatarId = self.air.getAvatarIdFromSender()

        if eventId not in badge_events.CLIENT_RAISED_EVENTS:
            self.notify.warning(
                f"accumulateForMe: avId={avatarId} sent unexpected eventId={eventId}"
            )
            return

        self._accumulate(avatarId, eventId, 1)

    def accumulate(self, avatarId: int, eventId: int, amount: int) -> None:
        # meadow explorer sends the zone id in the amount slot and we dedupe it
        if eventId == badge_events.EVENT_EXPLORE_MEADOW:
            self._exploreMeadow(avatarId, amount)
            return

        self._accumulate(avatarId, eventId, amount)

    def giveBadge(self, avatarId: int, badgeId: int) -> None:
        if badgeId in EXCLUDED_BADGE_IDS:
            return

        if badge_xml.is_velvet_rope_restricted(badgeId) and not self.air.isAvatarPaid(avatarId):
            return

        # store the goal as progress, high score badges never show the number
        goal = badge_xml.get_goal(badgeId) or 0

        # no row yet (untracked chapter), so create one earned and show its page first
        if not any(row["badgeId"] == badgeId for row in self._badgeRows(avatarId)):
            self._ensurePageUnlocked(avatarId, badgeId)
            self._awardOneShot(avatarId, badgeId)
            return

        self._awardBadge(avatarId, badgeId, goal)

    def unlockBadge(self, avatarId: int, badgeId: int) -> None:
        if badgeId in EXCLUDED_BADGE_IDS:
            self.notify.warning(f"unlockBadge: badgeId={badgeId} is excluded")
            return

        if badge_lookup.get_badge(badgeId) is None:
            self.notify.warning(f"unlockBadge: no such badgeId={badgeId}")
            return

        row = self._newRow(badgeId, STATUS_ACTIVE)
        fairies = self.air.mongoInterface.mongodb.fairies

        # `zones` is only carried by the Meadow Explorer rows; unsetting it on a
        # row that never had one is a no-op, so one write covers both kinds.
        updated = fairies.update_one(
            {"_id": avatarId, "badgeData.badges.badgeId": badgeId},
            {
                "$set": {
                    "badgeData.badges.$.status": STATUS_ACTIVE,
                    "badgeData.badges.$.progress": 0,
                    "badgeData.badges.$.dateEarned": None,
                },
                "$unset": {"badgeData.badges.$.zones": ""},
            },
        )

        if updated.matched_count == 0:
            fairies.update_one(
                {"_id": avatarId}, {"$push": {"badgeData.badges": row}}
            )

        # the client never moves a badge back to unearned, so send a fresh badgeUnlocked
        self.sendUpdateToAvatarId(avatarId, "badgeUnlocked", [[badgeId, 0]])

    def unlockPage(self, avatarId: int, pageId: int) -> None:
        badges = badge_lookup.get_badges_for_page(pageId)

        if not badges:
            self.notify.warning(f"unlockPage: no such pageId={pageId}")
            return

        result = self.air.mongoInterface.mongodb.fairies.update_one(
            {"_id": avatarId}, {"$addToSet": {"badgeData.unlockedPages": pageId}}
        )

        if result.matched_count == 0:
            self.notify.warning(f"unlockPage: no fairy document for avId={avatarId}")
            return

        # badges the fairy has no row for are left out of the page
        onPage = {badge["id"] for badge in badges}
        rows = self._badgeRows(avatarId)
        progress = [
            [row["badgeId"], row.get("progress", 0)]
            for row in rows
            if row["badgeId"] in onPage and row.get("status") == STATUS_ACTIVE
        ]

        self.sendUpdateToAvatarId(avatarId, "pageUnlocked", [pageId, progress])

    def _badgeRows(self, avatarId: int) -> list:
        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": avatarId}, {"badgeData.badges": 1}
        )

        if fairy is None:
            return []

        return (fairy.get("badgeData") or {}).get("badges") or []

    def _accumulate(self, avatarId: int, eventId: int, amount: int) -> None:
        if amount <= 0:
            return

        for badgeId in badge_events.get_badges_for_event(eventId):
            self._addProgress(avatarId, badgeId, amount)

        for badgeId, itemIds in badge_events.get_conditional_badges(eventId):
            if self._isWearing(avatarId, itemIds):
                self._awardOneShot(avatarId, badgeId)

    def _isWearing(self, avatarId: int, itemIds) -> bool:
        return self.air.mongoInterface.mongodb.fairies.count_documents(
            {
                "_id": avatarId,
                "avatar.items": {
                    "$elemMatch": {"location": "Equipped", "item_id": {"$in": list(itemIds)}}
                },
            },
            limit=1,
        ) > 0

    def _ensurePageUnlocked(self, avatarId: int, badgeId: int) -> None:
        page = badge_lookup.get_page_for_badge(badgeId)

        if page is None:
            return

        fairy = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": avatarId}, {"badgeData.unlockedPages": 1}
        )
        unlocked = ((fairy or {}).get("badgeData") or {}).get("unlockedPages") or []

        if page["id"] not in unlocked:
            self.unlockPage(avatarId, page["id"])

    def _awardOneShot(self, avatarId: int, badgeId: int) -> None:
        if badgeId in EXCLUDED_BADGE_IDS:
            return

        if badge_xml.is_velvet_rope_restricted(badgeId) and not self.air.isAvatarPaid(avatarId):
            return

        dateEarned = datetime.now(timezone.utc)
        goal = badge_xml.get_goal(badgeId) or 0
        fairies = self.air.mongoInterface.mongodb.fairies

        earned = fairies.update_one(
            {
                "_id": avatarId,
                "badgeData.badges": {
                    "$elemMatch": {"badgeId": badgeId, "status": {"$ne": STATUS_EARNED}}
                },
            },
            {
                "$set": {
                    "badgeData.badges.$.status": STATUS_EARNED,
                    "badgeData.badges.$.dateEarned": dateEarned,
                    "badgeData.badges.$.progress": goal,
                }
            },
        )

        if not earned.modified_count:
            row = self._newRow(badgeId, STATUS_EARNED, dateEarned)
            row["progress"] = goal
            pushed = fairies.update_one(
                {"_id": avatarId, "badgeData.badges.badgeId": {"$ne": badgeId}},
                {"$push": {"badgeData.badges": row}},
            )

            if not pushed.modified_count:
                return

        self.sendUpdateToAvatarId(
            avatarId, "badgeAcquired", [[badgeId, self._formatDateEarned(dateEarned)]]
        )

    def _addProgress(self, avatarId: int, badgeId: int, amount: int) -> None:
        # excluded badges must not accumulate from an old row, badgeAcquired puts it back on the page
        if badgeId in EXCLUDED_BADGE_IDS:
            return

        goal = badge_xml.get_goal(badgeId)

        if goal is None:
            self.notify.warning(f"No goal for badgeId={badgeId}, cannot award it")
            return

        if badge_xml.is_velvet_rope_restricted(badgeId) and not self.air.isAvatarPaid(avatarId):
            return

        fairy = self.air.mongoInterface.mongodb.fairies.find_one_and_update(
            {
                "_id": avatarId,
                "badgeData.badges": {
                    "$elemMatch": {"badgeId": badgeId, "status": STATUS_ACTIVE}
                },
            },
            {"$inc": {"badgeData.badges.$.progress": amount}},
            projection={"badgeData.badges.$": 1},
            return_document=ReturnDocument.BEFORE,
        )

        if fairy is None:
            # Badge already earned, or not tracked for this fairy.
            return

        previous = fairy["badgeData"]["badges"][0]["progress"]
        progress = previous + amount

        # the client adds the delta, so send what landed and never count past the goal
        applied = max(0, min(amount, goal - previous))

        if applied:
            self.sendUpdateToAvatarId(avatarId, "progressUpdate", [badgeId, applied])

        if progress >= goal:
            self._awardBadge(avatarId, badgeId, goal)

    def _exploreMeadow(self, avatarId: int, zoneId: int) -> None:
        badgeId = badge_events.get_meadow_badge_for_zone(zoneId)

        if badgeId is None:
            self.notify.warning(f"_exploreMeadow: zoneId={zoneId} is not a meadow")
            return

        goal = badge_xml.get_goal(badgeId)

        if goal is None:
            self.notify.warning(f"No goal for badgeId={badgeId}, cannot award it")
            return

        # Every current explorer badge is free; the gate is here for parity with
        # the other award paths, should a later season badge be Member-only.
        if badge_xml.is_velvet_rope_restricted(badgeId) and not self.air.isAvatarPaid(avatarId):
            return

        # $addToSet makes the visit idempotent; reading the row as it stood
        # BEFORE is how we tell a first visit from a revisit.
        fairy = self.air.mongoInterface.mongodb.fairies.find_one_and_update(
            {
                "_id": avatarId,
                "badgeData.badges": {
                    "$elemMatch": {"badgeId": badgeId, "status": STATUS_ACTIVE}
                },
            },
            {"$addToSet": {"badgeData.badges.$.zones": zoneId}},
            projection={"badgeData.badges.$": 1},
            return_document=ReturnDocument.BEFORE,
        )

        if fairy is None:
            # Badge already earned, or not tracked for this fairy.
            return

        visitedBefore = set(fairy["badgeData"]["badges"][0].get("zones") or [])

        if zoneId in visitedBefore:
            # A meadow already visited -- nothing changed, so say nothing.
            return

        progress = len(visitedBefore) + 1
        self.sendUpdateToAvatarId(avatarId, "progressUpdate", [badgeId, 1])

        if progress >= goal:
            self._awardBadge(avatarId, badgeId, goal)
            return

        # Keep the numeric progress mirror in step with the visited set, so the
        # badge book shows the right count when avatarOnline reads it next login.
        self.air.mongoInterface.mongodb.fairies.update_one(
            {
                "_id": avatarId,
                "badgeData.badges": {
                    "$elemMatch": {"badgeId": badgeId, "status": STATUS_ACTIVE}
                },
            },
            {"$set": {"badgeData.badges.$.progress": progress}},
        )

    def _awardBadge(self, avatarId: int, badgeId: int, goal: int) -> None:
        dateEarned = datetime.now(timezone.utc)

        # Clamping progress to the goal keeps an overshoot (collecting 60 twigs
        # in one go against a goal of 50) from being stored as 60 of 50.
        result = self.air.mongoInterface.mongodb.fairies.update_one(
            {
                "_id": avatarId,
                "badgeData.badges": {
                    "$elemMatch": {"badgeId": badgeId, "status": STATUS_ACTIVE}
                },
            },
            {
                "$set": {
                    "badgeData.badges.$.status": STATUS_EARNED,
                    "badgeData.badges.$.dateEarned": dateEarned,
                    "badgeData.badges.$.progress": goal,
                }
            },
        )

        if result.modified_count == 0:
            # Someone else got there first; they will send badgeAcquired.
            return

        self.sendUpdateToAvatarId(
            avatarId, "badgeAcquired", [[badgeId, self._formatDateEarned(dateEarned)]]
        )

    def _ensureTrackedBadges(self, avatarId: int):
        fairies = self.air.mongoInterface.retrieveDocs("fairies", avatarId, "_id")

        if not fairies:
            self.notify.warning(f"avatarOnline: no fairy document for avId={avatarId}")
            return None, None

        badgeData = fairies[0].get("badgeData") or {}
        rows = badgeData.get("badges") or []
        unlockedPages = list(badgeData.get("unlockedPages") or [])

        tracked = {row["badgeId"] for row in rows}
        newRows = [
            self._newRow(badgeId, STATUS_ACTIVE)
            for badgeId in TRACKED_BADGE_IDS
            if badgeId not in tracked
        ]

        for badgeId, status in INCLUDED_BADGES.items():
            if badgeId not in tracked:
                newRows.append(
                    self._newRow(
                        badgeId,
                        status,
                        dateEarned=(
                            datetime.now(timezone.utc)
                            if status == STATUS_EARNED
                            else None
                        ),
                    )
                )

        newPages = [
            pageId
            for pageId in (*TRACKED_PAGE_IDS, *INCLUDED_PAGE_IDS)
            if pageId not in unlockedPages
        ]

        update = {}

        if newRows:
            update["$push"] = {"badgeData.badges": {"$each": newRows}}

        if newPages:
            update["$addToSet"] = {"badgeData.unlockedPages": {"$each": newPages}}

        if update:
            self.air.mongoInterface.mongodb.fairies.update_one({"_id": avatarId}, update)

        return rows + newRows, unlockedPages + newPages

    def _newRow(self, badgeId: int, status: str, dateEarned=None) -> dict:
        return {
            "badgeId": badgeId,
            "status": status,
            "progress": 0,
            "dateEarned": dateEarned,
        }

    def _formatDateEarned(self, dateEarned) -> str:
        # the badge panel shows this as is in "earned on", bad dates become an empty string
        if not isinstance(dateEarned, datetime):
            return ""

        local = to_pacific(dateEarned)

        return f"{local.strftime('%B')} {local.day}, {local.year}"

