"""
The staff tiers, and how they rank against each other.

The tier is a string the whole way through -- it is set on the account document
(web-api's Account.accountType), read by FairyClient.lua at login, and broadcast
to every district AI as ALLOW_MODERATION_ACTIONS with the tier as its payload. It
is kept a string rather than a number so that wire format never has to change.

Ranking is what the magic word registry gates on: a command declares the lowest
tier that may run it, and anything below is refused. An unknown or missing tier
ranks as PLAYER -- lower than every command -- so the failure mode of "we do not
know who this is" is that nothing runs.
"""

from __future__ import annotations

PLAYER = "Player"
MODERATOR = "Moderator"
ADMINISTRATOR = "Administrator"

# Ordered, least to most. Only the tiers named here are staff; see the identical
# allowlist in FairyClient.lua.
_RANKS = {
    PLAYER: 0,
    MODERATOR: 1,
    ADMINISTRATOR: 2,
}


def rank(tier: str) -> int:
    return _RANKS.get(tier, 0)


def isStaff(tier: str) -> bool:
    return rank(tier) > rank(PLAYER)
