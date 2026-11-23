import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "game-server" / "assets"
FAIRIES = ROOT / "game-server" / "game" / "fairies"

QUESTS_PER_GROUP = 32


def questmgr_constants():
    import ast

    tree = ast.parse((FAIRIES / "fairy" / "npc" / "QuestMgr.py").read_text(encoding="utf-8"))
    found = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "").startswith("DISABLED_QUEST_"):
            found[node.targets[0].id] = {
                n.value for n in ast.walk(node.value) if isinstance(n, ast.Constant)
            }
    return found


_disabled = questmgr_constants()
DISABLED_QUEST_IDS = _disabled["DISABLED_QUEST_IDS"]
DISABLED_CATEGORIES = _disabled["DISABLED_QUEST_CATEGORIES"]
DISABLED_TAGS = _disabled["DISABLED_QUEST_TAGS"]

TALK, TURN_IN, TALENT_GAME, CRAFT, ADVENTURE, VISIT_ZONE, ITEM_HUNT, WIN_GAME = range(8)
GOAL_NAMES = ["talk", "turn in", "talent game", "craft", "adventure", "visit zone", "item hunt", "win game"]

problems = []
warnings = []


def problem(quest_id, text):
    problems.append((quest_id, text))


def warn(quest_id, text):
    warnings.append((quest_id, text))


def ints(value):
    return [int(part) for part in re.findall(r"\d+", value or "")]


def first(value, default=0):
    found = ints(value)
    return found[0] if found else default


def sourced_item_ids():
    found = set()

    for path in (FAIRIES / "shop" / "data").glob("*.py"):
        found.update(int(n) for n in re.findall(r"itemId\s*=\s*(\d+)", path.read_text(encoding="utf-8")))

    recipes = ET.parse(ASSETS / "recipes.xml").getroot()
    found.update(int(r.get("itemId")) for r in recipes.iter("recipe") if (r.get("itemId") or "").isdigit())

    constants = (FAIRIES / "ai" / "FairiesConstants.py").read_text(encoding="utf-8")
    found.update(int(n) for n in re.findall(r"\bid\s*=\s*(8\d{3})\b", constants))
    found.update(int(n) for n in re.findall(r"\b(8\d{3})\b", constants))

    giveaways = (FAIRIES / "meadow" / "GiveawaySpawnData.py").read_text(encoding="utf-8")
    found.update(int(n) for n in re.findall(r"\b(\d{4,5})\b", giveaways))

    garden = ET.parse(ASSETS / "gardenAssets.xml").getroot()
    found.update(int(n) for n in re.findall(r"\b(\d{4,5})\b", ET.tostring(garden, encoding="unicode")))

    return found


def load_hunts():
    import importlib.util
    import types

    for name in ("game", "game.fairies", "game.fairies.ai"):
        sys.modules.setdefault(name, types.ModuleType(name))

    def load(name, path):
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module

    zones = load("game.fairies.ai.ZoneConstants", FAIRIES / "ai" / "ZoneConstants.py")
    sys.modules["game.fairies.ai"].ZoneConstants = zones
    hunts = load("hunt_data", FAIRIES / "meadow" / "HuntData.py").HUNTS

    data = (FAIRIES / "meadow" / "IngredientSpawnData.py").read_text(encoding="utf-8")
    block = data[data.index("ZONE_MAP_BOUNDS: dict"):data.index("def zoneMapArea")]
    placeable = {getattr(zones, name) for name in re.findall(r"zc\.(\w+):", block)}
    return hunts, placeable


def load_challenges():
    import importlib.util

    spec = importlib.util.spec_from_file_location("wild_challenges", FAIRIES / "wilderness" / "WildernessChallenges.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.CHALLENGES


def main() -> int:
    verbose = "--verbose" in sys.argv
    root = ET.parse(ASSETS / "quests.xml").getroot()
    quests = {}

    for element in root.iter("quest"):
        quests[int(element.get("questId"))] = element

    # item names live in several files (avatarAssets, homeAssets, items, ...) as <item1668>
    item_ids = set()
    for path in ASSETS.glob("*.xml"):
        if path.name != "quests.xml":
            item_ids.update(int(n) for n in re.findall(r"<item(\d+)[\s>/]", path.read_text(encoding="utf-8", errors="ignore")))

    # dyes are 14000 plus a color id
    colors = ET.parse(ASSETS / "colorAssets.xml").getroot()
    item_ids.update(14000 + int(e.get("color_id")) for e in colors.iter("color") if e.get("color_id"))

    badges = ET.parse(ASSETS / "badges.xml").getroot()
    badge_ids = {int(m.group(1)) for e in badges.iter() for m in [re.match(r"name(\d+)$", e.tag)] if m}

    givers = {int(e.text) for e in ET.parse(ASSETS / "questNPCs.xml").getroot().iter("ActiveNPC")}
    obtainable = sourced_item_ids()
    hunts, placeable = load_hunts()
    adventures = {int(e.get("adventureID")) for e in ET.parse(ASSETS / "adventureIndex.xml").getroot().iter("adventure")}
    challenges = load_challenges()
    games = {int(e.get("id")) for e in ET.parse(ASSETS / "minigames.xml").getroot().iter("game") if e.get("id")}
    named_art = {int(n) for n in re.findall(r"<item(\d+)>", (ASSETS / "giveaways.xml").read_text(encoding="utf-8"))}
    unused_hunts = set(hunts)

    # quests that can never be offered
    offerable = {}
    for quest_id, element in quests.items():
        category = first(element.get("category"))
        tags = set(re.split(r"[,\s]+", (element.get("tags") or "").strip()))
        offerable[quest_id] = (
            quest_id not in DISABLED_QUEST_IDS and category not in DISABLED_CATEGORIES and not tags & DISABLED_TAGS
        )

    # unlockedBy references, then which quests are reachable from the start
    prereqs = {}
    for quest_id, element in quests.items():
        raw = (element.get("unlockedBy") or "").strip()
        groups = []
        for token in re.split(r",(?![^(]*\))", raw):
            token = token.strip().strip("()")
            ids = {int(p) for p in token.split("|") if p.strip().isdigit()}
            if ids:
                groups.append(ids)
        prereqs[quest_id] = groups

        for group in groups:
            for ref in group:
                if ref not in quests:
                    problem(quest_id, f"unlockedBy names quest {ref}, which does not exist")

    reachable = set()
    changed = True
    while changed:
        changed = False
        for quest_id, groups in prereqs.items():
            if quest_id in reachable or not offerable[quest_id]:
                continue
            if all(group & reachable for group in groups):
                reachable.add(quest_id)
                changed = True

    for quest_id in sorted(quests):
        if offerable[quest_id] and quest_id not in reachable:
            blockers = sorted({ref for group in prereqs[quest_id] if not group & reachable for ref in group})
            problem(quest_id, f"can never be offered, needs one of {blockers} first and none of them can be finished")

    ladder_gaps = defaultdict(list)

    for quest_id, element in sorted(quests.items()):
        giver = ints(element.get("giverNpc"))
        if len(giver) != 1 or giver[0] not in givers:
            problem(quest_id, f"giverNpc {element.get('giverNpc')!r} is not an active quest giver")

        if not offerable[quest_id]:
            continue

        for reward in element.iter("reward"):
            item = first(reward.get("rewardItemId"))
            if item and item not in item_ids and item not in badge_ids and not 18000 <= item < 19000:
                problem(quest_id, f"reward item {item} is not a known item or badge")

        steps = element.findall("./steps/step")
        declared = element.find("steps")
        if declared is not None and declared.get("total") and int(declared.get("total")) != len(steps):
            problem(quest_id, f"steps total={declared.get('total')} but {len(steps)} steps are defined")

        for index, step in enumerate(steps):
            closer = step.find("./npcs/closerNpc")
            if closer is not None and first(closer.get("npcId")) not in givers:
                problem(quest_id, f"step {index} closerNpc {closer.get('npcId')} is not an active quest giver")

            goal = step.find("goal")
            if goal is None:
                continue

            kind = first(goal.get("type"))
            item = first(goal.get("goalItemId"))
            where = f"step {index} ({GOAL_NAMES[kind] if kind < len(GOAL_NAMES) else kind})"

            if kind == TURN_IN:
                if item and item % 500 == 0 and goal.get("createdByMe"):
                    pass  # "make any belt", the goal is an item type
                elif item and item not in item_ids:
                    problem(quest_id, f"{where} wants item {item}, which is not a known item")
                elif item and item not in obtainable:
                    warn(quest_id, f"{where} wants item {item}, no shop, recipe or giveaway hands it out")
            elif kind == ITEM_HUNT:
                hunt = hunts.get((quest_id, index))
                unused_hunts.discard((quest_id, index))
                quantity = first(goal.get("quantity"), 1)
                if hunt is None:
                    problem(quest_id, f"{where} is an item hunt ({goal.get('huntTag')}) with no entry in HuntData")
                else:
                    if quantity > 15:
                        problem(quest_id, f"{where} wants {quantity} items, the accumulator only has 15 bits")
                    for art in hunt.art:
                        if art not in named_art:
                            problem(quest_id, f"{where} uses art {art}, which giveaways.xml does not name")
                    for zone in {hunt.zones[i % len(hunt.zones)] for i in range(quantity)}:
                        if zone not in placeable:
                            problem(quest_id, f"{where} puts items in zone {zone}, which has no spawn bounds so they are never placed")
            elif kind in (TALENT_GAME, WIN_GAME) and first(goal.get("gameId")) not in games:
                problem(quest_id, f"{where} uses game {goal.get('gameId')}, which is not in minigames.xml")
            elif kind == ADVENTURE:
                adventure = first(goal.get("adventureId")) or item
                if adventure not in adventures:
                    problem(quest_id, f"{where} wants adventure {adventure}, which is not in adventureIndex.xml")
                elif not challenges.get(adventure):
                    problem(quest_id, f"{where} wants adventure {adventure}, which has no creatures to clear")
            elif kind == CRAFT and not first(goal.get("quantity"), 1):
                problem(quest_id, f"{where} has quantity 0")

        if not steps:
            problem(quest_id, "has no steps")

    for quest_id, index in sorted(unused_hunts):
        problem(quest_id, f"HuntData has an entry for step {index}, which is not an item hunt goal")

    # a tag that no holiday can switch on hides the quest for good once gating is on
    holidays_path = ASSETS / "holidays.json"
    if holidays_path.exists():
        import json
        catalog = json.loads(holidays_path.read_text(encoding="utf-8"))["holidays"]
        known = {t for h in catalog for t in h.get("tags", []) + h.get("questTags", [])}
        unmapped = defaultdict(list)
        for quest_id, element in quests.items():
            for tag in re.split(r"[,\s]+", (element.get("tags") or "").strip()):
                if tag and tag not in known:
                    unmapped[tag].append(quest_id)
        for tag, ids in sorted(unmapped.items()):
            warn(ids[0], f"tag {tag} (quests {sorted(ids)}) is on no holiday, so it is never gated")

        # an untagged quest behind only event quests is hidden along with them
        gated_ids = {
            quest_id for quest_id, element in quests.items()
            if any(t in known for t in re.split(r"[,\s]+", (element.get("tags") or "").strip()))
        }
        for quest_id in sorted(quests):
            groups = prereqs[quest_id]
            if quest_id not in gated_ids and offerable[quest_id] and groups and any(group <= gated_ids for group in groups):
                warn(quest_id, f"is not an event quest but needs {sorted(set().union(*groups) & gated_ids)}, which only show during their event")

    print(f"{len(quests)} quests, {sum(offerable.values())} offerable, {len(reachable)} reachable")

    for label, rows in (("PROBLEM", problems), ("warn", warnings)):
        if label == "warn" and not verbose:
            print(f"{len(rows)} warnings (use --verbose to list them)")
            continue
        for quest_id, text in sorted(rows):
            print(f"{label} quest {quest_id}: {text}")

    print(f"{len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
