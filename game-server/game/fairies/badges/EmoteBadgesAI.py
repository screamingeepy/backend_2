import time

from game.fairies.badges import badge_events

GROUP_OTHERS = 3
GROUP_SECONDS = 10


class EmoteBadgesAI:
    def __init__(self, air) -> None:
        self.air = air
        self.singers: dict[int, tuple[int, float]] = {}

    def emoted(self, avatarId: int, zoneId: int, emoteId: int) -> None:
        for eventId in badge_events.get_emote_events(emoteId, zoneId):
            self.air.badgeManager.d_accumulate(avatarId, eventId, 1)

        if emoteId == badge_events.EMOTE_SINGING:
            self.sang(avatarId, zoneId)

    def sang(self, avatarId: int, zoneId: int) -> None:
        now = time.monotonic()
        self.singers[avatarId] = (zoneId, now)
        self.singers = {
            fairyId: (zone, at) for fairyId, (zone, at) in self.singers.items()
            if now - at <= GROUP_SECONDS
        }

        group = [fairyId for fairyId, (zone, at) in self.singers.items() if zone == zoneId]

        if len(group) <= GROUP_OTHERS:
            return

        for fairyId in group:
            for eventId in badge_events.get_group_sing_events(zoneId):
                self.air.badgeManager.d_accumulate(fairyId, eventId, 1)

    def left(self, avatarId: int) -> None:
        self.singers.pop(avatarId, None)
