from datetime import datetime, timedelta, timezone

from game.fairies.badges.badge_state import STATUS_EARNED
from game.fairies.daily.TimeUtils import get_season_start_utc
from game.fairies.leaderboard import leaderboard_xml
from game.fairies.leaderboard.leaderboard_period import TYPE_SEASONAL, period_key

HARVEST_HUSTLE = 8
HARVEST_HUSTLE_CHAMPION = 10598
TALENT_GAME_CHAMPION = 10695

WIN_COUNT_GAMES = leaderboard_xml.WINS_GAME_IDS

AWARDS_COLLECTION = "leaderboardAwards"


def championBadgeFor(gameId: int) -> int | None:
    if gameId == HARVEST_HUSTLE:
        return HARVEST_HUSTLE_CHAMPION

    if gameId in WIN_COUNT_GAMES or not leaderboard_xml.is_leaderboard_game(gameId):
        return None

    return TALENT_GAME_CHAMPION


def previousSeasonKey(now: datetime) -> str | None:
    start = get_season_start_utc(now)

    try:
        return period_key(TYPE_SEASONAL, start - timedelta(seconds=1))
    except ValueError:
        return None


def topScorers(mongodb, key: str, gameId: int) -> list[int]:
    threshold = leaderboard_xml.get_threshold(gameId)
    boards = mongodb.leaderboards

    best = boards.find_one(
        {"periodKey": key, "gameId": gameId, "score": {"$gte": threshold}},
        sort=[("score", -1)],
    )

    if best is None:
        return []

    rows = boards.find({"periodKey": key, "gameId": gameId, "score": best["score"]}, {"avId": 1})
    return [row["avId"] for row in rows]


def hasEarned(mongodb, avatarId: int, badgeId: int) -> bool:
    return mongodb.fairies.count_documents({
        "_id": avatarId,
        "badgeData.badges": {"$elemMatch": {"badgeId": badgeId, "status": STATUS_EARNED}},
    }, limit=1) > 0


def awardSeasonChampions(mongodb, badgeManager, now: datetime | None = None) -> dict | None:
    """
    Hands out the champion badge for the season that just ended, once. Returns
    what was awarded, or None when there was nothing to do.

    The very first run only records the season that had already ended as done,
    so a season nobody was watching is never awarded after the fact.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    key = previousSeasonKey(now)

    if key is None:
        return None

    awards = mongodb[AWARDS_COLLECTION]

    if awards.find_one({"_id": key}) is not None:
        return None

    if awards.estimated_document_count() == 0:
        awards.insert_one({"_id": key, "baseline": True, "winners": {}, "recordedAt": now})
        return None

    winners = {}
    for gameId in sorted(leaderboard_xml.gameIds()):
        badgeId = championBadgeFor(gameId)

        if badgeId is None:
            continue

        avatarIds = topScorers(mongodb, key, gameId)

        if avatarIds:
            winners[str(gameId)] = {"badgeId": badgeId, "avatarIds": avatarIds}

    given = set()
    for entry in winners.values():
        for avatarId in entry["avatarIds"]:
            if (avatarId, entry["badgeId"]) in given or hasEarned(mongodb, avatarId, entry["badgeId"]):
                continue

            badgeManager.unlockBadge(avatarId, entry["badgeId"])
            badgeManager.giveBadge(avatarId, entry["badgeId"])
            given.add((avatarId, entry["badgeId"]))

    awards.insert_one({"_id": key, "baseline": False, "winners": winners, "recordedAt": now})
    return winners
