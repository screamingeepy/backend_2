import re
import xml.etree.ElementTree as ET

from paths import XML

BADGES_XML = XML / "badges.xml"

# <goals> and <copy> both bake the badge id into the tag name.
_GOAL_TAG = re.compile(r"^goal(\d+)$")
_NAME_TAG = re.compile(r"^name(\d+)$")

_goals: dict[int, int] | None = None
_velvetRope: dict[int, str] | None = None


def _parse(path) -> tuple[dict[int, int], dict[int, str]]:
    root = ET.parse(path).getroot()

    goalsNode = root.find("goals")
    if goalsNode is None:
        raise ValueError(f"{path} has no <goals> section")

    copyNode = root.find("copy")
    if copyNode is None:
        raise ValueError(f"{path} has no <copy> section")

    goals = {}
    for element in goalsNode:
        match = _GOAL_TAG.match(element.tag)
        text = (element.text or "").strip()

        if match is None or not text.isdigit():
            continue

        goals[int(match.group(1))] = int(text)

    # keep the attribute as written, the client treats absent and empty differently from "0"
    velvetRope = {}
    for element in copyNode:
        match = _NAME_TAG.match(element.tag)

        if match is None:
            continue

        velvetRope[int(match.group(1))] = element.get("velvetRope")

    return goals, velvetRope


def load() -> None:
    global _goals, _velvetRope

    if _goals is None:
        _goals, _velvetRope = _parse(BADGES_XML)


def get_goal(badge_id: int) -> int | None:
    load()
    return _goals.get(badge_id)


def is_velvet_rope_restricted(badge_id: int) -> bool:
    """member only check, mirrors the client: no velvetRope attribute means restricted"""
    load()
    raw = _velvetRope.get(badge_id)

    if raw is None or raw == "":
        return True

    try:
        return int(float(raw)) != 0
    except ValueError:
        # Present but not a number: the client's Number() gives NaN and it keeps
        # its restricted default.
        return True
