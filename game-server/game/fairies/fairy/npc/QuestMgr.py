
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

QUESTS_PER_QUEST_GROUP = 32

# goal types, same numbers as the client's QUEST_TYPE_*
QUEST_TYPE_TALK = 0                 # just reach/talk to the closerNpc, no goal check
QUEST_TYPE_TURN_IN = 1              # hand in an item; client checks pouch/wardrobe/storage itself
QUEST_TYPE_TALENTGAME_SCORE = 2     # score `points` in talent minigame `game_id`
QUEST_TYPE_COMMUNITY_CRAFT = 3      # craft something at meadow_zone
QUEST_TYPE_ADVENTURE = 4            # clear wilderness adventure `goal_item_id`
QUEST_TYPE_VISIT_ZONE = 5           # visit meadow_zone
QUEST_TYPE_ITEM_HUNT = 6            # accumulator used as a bitmask of items found
QUEST_TYPE_WIN_MEADOW_GAME = 7      # win meadow game `game_id`

# client works these out itself, nothing calls addQuestGoalProgress for them
CLIENT_RESOLVED_GOAL_TYPES = {QUEST_TYPE_TALK, QUEST_TYPE_TURN_IN}

# zone on a community craft goal is a crafting shop code, not a real zone
CRAFT_ZONE_ANY = 100000

# status values for setQuestChoices, anything else acts like normal
QUEST_RESP_NORMAL = 0
QUEST_RESP_FREE_PLAYER_GIVEN_PAID_QUEST = 2  # shows the members-only label/prompt
QUEST_RESP_LOCKED_QUEST_ID = 3               # shown grayed out, can't be picked

# dataclasses here

@dataclass
class QuestGoal:
    goal_type: int = 0
    goal_item_id: int = 0
    # every item that satisfies a turn in, goalItemId can list color or gender variants
    goal_item_ids: Tuple[int, ...] = ()
    quantity: int = 1
    meadow_zone: int = 0
    game_id: int = 0
    points: int = 0
    # crafting shop code for community craft goals
    zone: int = 0
    # the client ignores this, hunts are matched by quest and step (see HuntData)
    hunt_tag: str = ""


@dataclass
class QuestReward:
    reward_item_id: int = 0
    quantity: int = 1
    gender: int = 0
    known: int = 0
    color1: int = 0
    color2: int = 0
    quality: int = 0
    created_by: int = 0


@dataclass
class QuestStep:
    step_id: int = 0
    closer_npc_id: int = 0      # whose quest is it
    delay: int = 0
    goal: Optional[QuestGoal] = None


@dataclass
class QuestDefinition:
    quest_id: int = 0
    giver_npc_id: int = 0
    talent: int = 0             # 0 = any talent
    # every talent the quest is for, talent="1,3,4,5" lists several
    talents: Set[int] = field(default_factory=set)
    repeat: bool = False
    priority: int = 1
    category: int = 0
    velvet_rope: bool = False  
    icon: int = 0
    badge_accumulator_id: str = ''
    tags: str = ''
    unlocked_by: List[Set[int]] = field(default_factory=list) # prerequisites
    petRequirement: int = 0
    petSickLevel: int = 0
    rewards: List[QuestReward] = field(default_factory=list)
    steps: List[QuestStep] = field(default_factory=list)


# the learn-your-first-talent-skill chains, one per talent
# skills come from levels here, so their spell reward can't be granted and the turn in hangs
DISABLED_QUEST_IDS = frozenset({48, 194, 385, 524, 778})

# category 2 is the talent tab: eight repeatable quests per talent per giver, all offered at once,
# and finishing one can leave the quest buttons stuck grey. Empty this to bring the tab back
DISABLED_QUEST_CATEGORIES = frozenset({2})

# the key quests for lizzy's home, the ice palace and the mermaid grotto, offered all year whatever holiday is on
ALWAYS_LIVE_QUEST_IDS = frozenset({75, 404, 419, 422, 80, 420, 423})

# nature days and the great games are switched off for now, every quest carrying one of these tags is dropped
DISABLED_QUEST_TAGS = frozenset({
    'Quest_NatureDays_2010', 'Quest_NatureDays2011', 'Quest_NatureDays2012', 'Quest_NatureDays2013',
    'Quest_45_Great_Games', 'Quest_GreatGames', 'Quest_PHG2011_Prep',
    'Quest_Animal_Games', 'Quest_Garden_Games', 'Quest_Light_Games', 'Quest_Tinker_Games', 'Quest_Water_Games',
})


class QuestMgr:
    _instance: Optional['QuestMgr'] = None

    def __init__(self) -> None:
        self.quests: Dict[int, QuestDefinition] = {}
        self.quests_by_giver: Dict[int, List[QuestDefinition]] = {}
        self.loaded: bool = False

    @classmethod
    def getInstance(cls) -> 'QuestMgr':
        if cls._instance is None:
            cls._instance = QuestMgr()
        return cls._instance

    def loadQuestsFromXml(self, xml_path: str) -> None:
        if not os.path.exists(xml_path):
            print(f'[QuestMgr] Warning: Quest XML not found at {xml_path}')
            return

# xml loader
        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()

            self.quests.clear()
            self.quests_by_giver.clear()

            for quest_elem in root.iter('quest'):
                qdef = self.parseQuestElement(quest_elem)
                if qdef is None or qdef.quest_id in DISABLED_QUEST_IDS or qdef.category in DISABLED_QUEST_CATEGORIES:
                    continue

                if DISABLED_QUEST_TAGS.intersection(re.split(r'[,\s]+', qdef.tags)):
                    continue

                self.quests[qdef.quest_id] = qdef
                self.quests_by_giver.setdefault(qdef.giver_npc_id, []).append(qdef)

            self.loaded = True
            print(
                f'[QuestMgr] Loaded {len(self.quests)} quests '
                f'across {len(self.quests_by_giver)} NPCs from {xml_path}'
            )

        except Exception as e:
            print(f'[QuestMgr] Error loading quests from {xml_path}: {e}')

    def parseQuestElement(self, elem: ET.Element) -> Optional[QuestDefinition]:
        def parseIntOrDefault(val: str, default: int = 0) -> int:
            if not val:
                return default
            if isinstance(val, str) and ',' in val:
                val = val.split(',')[0].strip()
            try:
                return int(val)
            except ValueError:
                return default

        try:
            quest_id = parseIntOrDefault(elem.attrib.get('questId', '-1'), -1)
            if quest_id < 0:
                return None

            giver_npc = parseIntOrDefault(elem.attrib.get('giverNpc', '0'))
            talent = parseIntOrDefault(elem.attrib.get('talent', '0'))
            talents = {int(n) for n in re.findall(r'\d+', elem.attrib.get('talent', ''))} - {0}
            repeat = bool(parseIntOrDefault(elem.attrib.get('repeat', '0')))
            priority = parseIntOrDefault(elem.attrib.get('priority', '1'), 1)
            category = parseIntOrDefault(elem.attrib.get('category', '0'))
            velvet_rope = bool(parseIntOrDefault(elem.attrib.get('velvetRope', '0')))
            icon = parseIntOrDefault(elem.attrib.get('icon', '0'))
            badge_accumulator_id = elem.attrib.get('badgeAccumulatorId', '')
            tags = elem.attrib.get('tags', '')
            unlocked_by_str = elem.attrib.get('unlockedBy', '')

            unlocked_by = self.parseUnlockedByText(unlocked_by_str)

            # rewards
            rewards: List[QuestReward] = []
            rewards_elem = elem.find('rewards')
            if rewards_elem is not None:
                for rew in rewards_elem.findall('reward'):
                    rewards.append(QuestReward(
                        reward_item_id=parseIntOrDefault(rew.attrib.get('rewardItemId', '0')),
                        quantity=parseIntOrDefault(rew.attrib.get('quantity', '1'), 1),
                        gender=parseIntOrDefault(rew.attrib.get('gender', '0')),
                        known=parseIntOrDefault(rew.attrib.get('known', '0')),
                        color1=parseIntOrDefault(rew.attrib.get('color1', '0')),
                        color2=parseIntOrDefault(rew.attrib.get('color2', '0')),
                        quality=parseIntOrDefault(rew.attrib.get('quality', '0')),
                        created_by=parseIntOrDefault(rew.attrib.get('createdBy', '0')),
                    ))

            # steps
            steps: List[QuestStep] = []
            steps_elem = elem.find('steps')
            if steps_elem is not None:
                for step_el in steps_elem.findall('step'):
                    steps.append(self.parseStepElement(step_el))

            return QuestDefinition(
                quest_id=quest_id,
                giver_npc_id=giver_npc,
                talent=talent,
                talents=talents,
                repeat=repeat,
                priority=priority,
                category=category,
                velvet_rope=velvet_rope,
                icon=icon,
                badge_accumulator_id=badge_accumulator_id,
                tags=tags,
                unlocked_by=unlocked_by,
                petRequirement=parseIntOrDefault(elem.attrib.get('petRequirement', '0')),
                petSickLevel=parseIntOrDefault(elem.attrib.get('petSickLevel', '0')),
                rewards=rewards,
                steps=steps,
            )

        except Exception as e:
            print(f'[QuestMgr] Failed to parse quest: {e}')
            return None

    def parseStepElement(self, step_el: ET.Element) -> QuestStep:
        def parseIntOrDefault(val: str, default: int = 0) -> int:
            if not val:
                return default
            if isinstance(val, str) and ',' in val:
                val = val.split(',')[0].strip()
            try:
                return int(val)
            except ValueError:
                return default

        step_id = parseIntOrDefault(step_el.attrib.get('stepId', '0'))
        delay = parseIntOrDefault(step_el.attrib.get('delay', '0'))

        closer_npc_id = 0
        npcs_elem = step_el.find('npcs')
        if npcs_elem is not None:
            closer_el = npcs_elem.find('closerNpc')
            if closer_el is not None:
                closer_npc_id = parseIntOrDefault(closer_el.attrib.get('npcId', '0'))

        goal = None
        goal_elem = step_el.find('goal')
        if goal_elem is not None:
            g_type = parseIntOrDefault(goal_elem.attrib.get('type', '0'))
            g_item = parseIntOrDefault(goal_elem.attrib.get('goalItemId', '0'))
            g_items = tuple(int(n) for n in re.findall(r'\d+', goal_elem.attrib.get('goalItemId', '')))
            g_qty = parseIntOrDefault(goal_elem.attrib.get('quantity', '1'), 1)
            g_zone = parseIntOrDefault(goal_elem.attrib.get('meadowZone', '0'))
            g_game = parseIntOrDefault(goal_elem.attrib.get('gameId', '0'))
            g_pts = parseIntOrDefault(goal_elem.attrib.get('points', '0'))
            g_craft_zone = parseIntOrDefault(goal_elem.attrib.get('zone', '0'))
            g_hunt_tag = goal_elem.attrib.get('huntTag', '')
            goal = QuestGoal(
                goal_type=g_type,
                goal_item_id=g_item,
                goal_item_ids=g_items,
                quantity=g_qty,
                meadow_zone=g_zone,
                game_id=g_game,
                points=g_pts,
                zone=g_craft_zone,
                hunt_tag=g_hunt_tag,
            )

        return QuestStep(step_id=step_id, closer_npc_id=closer_npc_id, delay=delay, goal=goal)

    @staticmethod
    def parseUnlockedByText(raw: str) -> List[Set[int]]:
        raw = raw.strip()
        if not raw:
            return []

        result: List[Set[int]] = []
        tokens = re.split(r',(?![^(]*\))', raw)
        for token in tokens:
            token = token.strip().strip('()')
            if not token:
                continue
            ids: Set[int] = set()
            for part in token.split('|'):
                part = part.strip()
                if part.isdigit():
                    ids.add(int(part))
            if ids:
                result.append(ids)
        return result


    def getQuestById(self, quest_id: int) -> Optional[QuestDefinition]:
        return self.quests.get(quest_id)

    def getGoalForQuestStep(self, quest_id: int, step: int) -> Optional[QuestGoal]:
        qdef = self.getQuestById(quest_id)
        if qdef is None or not (0 <= step < len(qdef.steps)):
            return None
        return qdef.steps[step].goal

    @staticmethod
    def goalMatchesProgressEvent(
        goal: QuestGoal,
        goal_type: int,
        game_id: Optional[int],
        meadow_zone: Optional[int],
        item_id: Optional[int],
        adventure_id: Optional[int],
        craft_zone: Optional[int] = None,
    ) -> bool:
        if goal is None or goal.goal_type != goal_type:
            return False

        if goal_type in (QUEST_TYPE_TALENTGAME_SCORE, QUEST_TYPE_WIN_MEADOW_GAME):
            return game_id is None or goal.game_id == game_id
        if goal_type == QUEST_TYPE_COMMUNITY_CRAFT:
            # zone 0 or CRAFT_ZONE_ANY means any crafting shop
            return (craft_zone is None or goal.zone in (0, CRAFT_ZONE_ANY)
                   or goal.zone == craft_zone)
        if goal_type == QUEST_TYPE_ADVENTURE:
            return adventure_id is None or goal.goal_item_id == adventure_id
        if goal_type == QUEST_TYPE_VISIT_ZONE:
            return meadow_zone is None or goal.meadow_zone == meadow_zone
        if goal_type == QUEST_TYPE_ITEM_HUNT:
            # finds are recorded by recordHuntFind, nothing else moves a hunt
            return False
        # talk and turn in never get here, match anyway so progress isn't dropped
        return True

    # something happened that might move one of avId's quests
    def addQuestGoalProgress(
        self,
        air,
        avId: int,
        goal_type: int,
        *,
        amount: int = 1,
        set_value: Optional[int] = None,
        game_id: Optional[int] = None,
        meadow_zone: Optional[int] = None,
        item_id: Optional[int] = None,
        adventure_id: Optional[int] = None,
        craft_zone: Optional[int] = None,
    ) -> List[int]:
        avatar = air.doId2do.get(avId)
        if avatar is None or not hasattr(avatar, "activeQuests"):
            return []

        updated: List[int] = []
        for quest_id, q_obj in list(avatar.activeQuests.items()):
            goal = self.getGoalForQuestStep(quest_id, q_obj.step)
            if not self.goalMatchesProgressEvent(goal, goal_type, game_id, meadow_zone, item_id,
                                      adventure_id, craft_zone):
                continue

            if goal_type in (QUEST_TYPE_TALENTGAME_SCORE, QUEST_TYPE_WIN_MEADOW_GAME):
                target = goal.points or goal.quantity or 1
            else:
                target = goal.quantity or 1

            if set_value is not None:
                new_value = set_value
            elif goal_type == QUEST_TYPE_ITEM_HUNT:
                new_value = q_obj.accumulator | amount  # `amount` is a bit to OR in
            else:
                new_value = min(target, q_obj.accumulator + amount)

            if new_value == q_obj.accumulator:
                continue

            q_obj.setAccumulator(new_value)  # updates locally + pushes to the client
            air.mongoInterface.mongodb.fairies.update_one(
                {"_id": avId, "questState.questId": quest_id},
                {"$set": {"questState.$.accumulator": new_value}},
            )
            updated.append(quest_id)

        return updated

    @staticmethod
    def getActiveQuest(air, avId: int, quest_id: int):
        avatar = air.doId2do.get(avId)
        return getattr(avatar, "activeQuests", {}).get(quest_id)

    def canFindHuntItem(self, air, avId: int, quest_id: int, step: int, bit: int) -> bool:
        # the fairy has to be on this exact step and not have found this item yet
        q_obj = self.getActiveQuest(air, avId, quest_id)
        return q_obj is not None and q_obj.step == step and not (q_obj.accumulator >> bit) & 1

    def recordHuntFind(self, air, avId: int, quest_id: int, step: int, bit: int) -> bool:
        if not self.canFindHuntItem(air, avId, quest_id, step, bit):
            return False

        q_obj = self.getActiveQuest(air, avId, quest_id)
        new_value = q_obj.accumulator | (1 << bit)
        q_obj.setAccumulator(new_value)
        air.mongoInterface.mongodb.fairies.update_one(
            {"_id": avId, "questState.questId": quest_id},
            {"$set": {"questState.$.accumulator": new_value}},
        )
        return True

    def getQuestsByGiver(self, giver_npc_id: int) -> List[QuestDefinition]:
        return self.quests_by_giver.get(giver_npc_id, [])

    def getQuestChoicesForPlayer(
        self,
        giver_npc_id: int,
        completed_quests: Set[int],
        active_quests: Set[int],
        player_talent: int = 0,
        is_member: bool = True,
        petItemId: int = 0,
        petSickLevel: int = 0,
        questSeed: int = 0,
        activeTags: Optional[Set[str]] = None,
        gatedTags: Optional[Set[str]] = None,
    ) -> Tuple[List[Tuple[int, int]], List[Tuple[int, int]]]:
        available: List[QuestDefinition] = []
        npc_quests = self.getQuestsByGiver(giver_npc_id)

        # a pet that got sicker since the quest was taken would match a second
        # healing quest, so one already running is the only one offered
        petQuestActive = any(q.petRequirement and q.quest_id in active_quests for q in npc_quests)

        for qdef in npc_quests:
            if qdef.quest_id in active_quests:
                available.append(qdef)
                continue

            # elixa's healing quests, one set per species and sickness level
            if qdef.petRequirement:
                if petQuestActive:
                    continue
                if qdef.petRequirement != petItemId or qdef.petSickLevel != petSickLevel:
                    continue

            if not qdef.repeat and qdef.quest_id in completed_quests:
                continue

            if qdef.velvet_rope and not is_member:
                continue

            if not self.isQuestLive(qdef, activeTags, gatedTags):
                continue

            if qdef.talents and player_talent != 0 and player_talent not in qdef.talents:
                continue

            if not self.arePrerequisitesMet(qdef.unlocked_by, completed_quests):
                continue

            available.append(qdef)

        # quests.xml carries several healing quests for each species and sickness level,
        # which are variants of one another rather than a menu, so the seed picks one
        newPetQuests = [q for q in available if q.petRequirement and q.quest_id not in active_quests]
        if len(newPetQuests) > 1:
            keep = newPetQuests[questSeed % len(newPetQuests)]
            available = [q for q in available if q not in newPetQuests or q is keep]

        # group by category first so each tab is one block, the client indexes by it
        available.sort(key=lambda q: (q.category, q.priority))

        # 4 new quests per category tab, the client ui crashes with more
        final_available = []
        new_count_by_category: Dict[int, int] = {}
        for qdef in available:
            if qdef.quest_id in active_quests or qdef.quest_id in completed_quests:
                final_available.append(qdef)
            else:
                count = new_count_by_category.get(qdef.category, 0)
                if count < 4:
                    final_available.append(qdef)
                    new_count_by_category[qdef.category] = count + 1

        choices: List[Tuple[int, int]] = []
        states: List[Tuple[int, int]] = []

        for qdef in final_available:
            group, bit_idx = self.questIdToDcGroupAndBit(qdef.quest_id)
            choices.append((group, bit_idx))

            # client tracks active and completed itself, so always send normal
            states.append((qdef.category, QUEST_RESP_NORMAL))

        return choices, states

    @staticmethod
    def isQuestLive(qdef: 'QuestDefinition', activeTags: Optional[Set[str]], gatedTags: Optional[Set[str]]) -> bool:
        # event quests only show while one of their tags is live, tags no holiday knows don't gate
        if qdef.quest_id in ALWAYS_LIVE_QUEST_IDS:
            return True
        if activeTags is None or gatedTags is None or not qdef.tags:
            return True

        eventTags = [t for t in re.split(r'[,\s]+', qdef.tags) if t in gatedTags]
        return not eventTags or any(t in activeTags for t in eventTags)

    @staticmethod
    def arePrerequisitesMet(unlocked_by: List[Set[int]], completed: Set[int]) -> bool:
        for group in unlocked_by:
            if not group.intersection(completed):
                return False
        return True


    @staticmethod
    def questIdToDcGroupAndBit(quest_id: int) -> Tuple[int, int]:
        group = quest_id // QUESTS_PER_QUEST_GROUP
        bit_idx = quest_id % QUESTS_PER_QUEST_GROUP
        return group, bit_idx

    @staticmethod
    def dcGroupAndBitToQuestId(quest_group: int, quest_bitmask_index: int) -> int:
        return quest_group * QUESTS_PER_QUEST_GROUP + quest_bitmask_index