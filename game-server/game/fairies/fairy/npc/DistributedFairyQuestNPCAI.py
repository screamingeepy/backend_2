from .DistributedFairyNPCAI import DistributedFairyNPCAI
from .QuestMgr import QuestMgr, QUESTS_PER_QUEST_GROUP
from .DistributedQuest import DistributedQuest, QUEST_OBJECT_ZONE
from game.fairies.experience import XPConfig
from game.fairies.ai.BakingAssets import BAKED_ITEMS
from game.fairies.ai.FairiesConstants import get_item_type, INGREDIENTS
from game.fairies.pet import pet_state
from game.fairies.badges import badge_events, badge_lookup
from game.fairies.uberdog.HolidayManagerUD import getActiveQuestTags, getGatedQuestTags
import time as _time

INGREDIENT_IDS = frozenset(i.id for i in INGREDIENTS.values())


class DistributedFairyQuestNPCAI(DistributedFairyNPCAI):
    def __init__(self, air) -> None:
        DistributedFairyNPCAI.__init__(self, air)
        self.questGiverId: int = 0
        # avId -> questId waiting on a reward pick, the client always sends quest (0, 0) for it
        self.pendingReward: dict[int, int] = {}

    def setQuestGiverId(self, questGiverId: int) -> None:
        self.questGiverId = questGiverId

    def getQuestGiverId(self) -> int:
        return self.questGiverId

    def getQuestStateForPlayer(self, avId: int) -> tuple[set, set, int, bool]:

        doc = self.air.mongoInterface.mongodb.fairies.find_one({'_id': avId})

        completed_quests: set = set()
        active_quests: set = set()
        talent_id: int = 0
        is_member: bool = True  

        if not doc:
            return completed_quests, active_quests, talent_id, is_member

        talent_id = doc.get('talent', 0)

        avatar_do = self.air.doId2do.get(avId)
        if avatar_do:
            is_member = avatar_do.isPaid()

        for entry in (doc.get('questHistory') or []):
            group = entry.get('questGroup', 0)
            bitmask = entry.get('questBitmask', 0)
            for i in range(32):
                if (bitmask >> i) & 1:
                    completed_quests.add(group * QUESTS_PER_QUEST_GROUP + i)

        for entry in (doc.get('questState') or []):
            q_id = entry.get('questId')
            if q_id is not None:
                active_quests.add(q_id)

        return completed_quests, active_quests, talent_id, is_member

    def requestQuestChoices(self, questSeed: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        print(f'[QuestNPCAI] requestQuestChoices: avId={avId} questGiverId={self.questGiverId} doId={self.doId}')

        try:
            completed, active, talent_id, is_member = self.getQuestStateForPlayer(avId)
            pet = pet_state.loadPetAndApplyDecay(self.air, avId)

            choices, quest_states = QuestMgr.getInstance().getQuestChoicesForPlayer(
                self.questGiverId,
                completed_quests=completed,
                active_quests=active,
                player_talent=talent_id,
                is_member=is_member,
                petItemId=int(pet.get('itemId', 0)) if pet_state.hasPet(pet) else 0,
                petSickLevel=pet_state.getSickLevel(pet),
                questSeed=questSeed,
                activeTags=getActiveQuestTags(),
                gatedTags=getGatedQuestTags(),
            )

            choice_tuples = [(g, b) for g, b in choices]
            state_tuples = [(cat, st) for cat, st in quest_states]

            print(f'[QuestNPCAI] requestQuestChoices: sending {len(choice_tuples)} choices to avId={avId}')
            self.sendUpdateToAvatarId(avId, 'setQuestChoices', [choice_tuples, state_tuples])
        except Exception:
            import traceback
            traceback.print_exc()

    def setQuestChoice(self, questId: int) -> None:
        avId = self.air.getAvatarIdFromSender()
        if not avId:
            return

        print(f'[QuestNPCAI] setQuestChoice: avId={avId} questId={questId}')

        qdef = QuestMgr.getInstance().getQuestById(questId)
        if qdef is None:
            print(f'[QuestNPCAI] setQuestChoice: unknown questId {questId}')
            return

        doc = self.air.mongoInterface.mongodb.fairies.find_one({'_id': avId})
        if not doc:
            print(f'[QuestNPCAI] setQuestChoice: no document for avId {avId}')
            return

        for entry in (doc.get('questState') or []):
            if entry.get('questId') == questId:
                self.sendUpdateToAvatarId(avId, 'setQuestChoice', [questId])
                return

        now_ts = int(_time.time())
        self.air.mongoInterface.mongodb.fairies.update_one(
            {'_id': avId},
            {'$push': {'questState': {
                'questId': questId, 'currentStep': 0, 'startTime': now_ts, 'accumulator': 0,
            }}},
        )

        avatar = self.air.doId2do.get(avId)
        if avatar and hasattr(avatar, 'activeQuests'):
            if questId not in avatar.activeQuests:
                q_obj = DistributedQuest(self.air, avId, questId, step=0, startTime=now_ts)
                # zone 1, not the avatar's zone, see DistributedQuest.py
                q_obj.generateWithRequired(QUEST_OBJECT_ZONE)
                # fields are ownrequired so the client needs the owner id or it never gets them
                self.air.sendSetOwnerDoId(q_obj.doId, avId)
                avatar.activeQuests[questId] = q_obj

        self.sendUpdateToAvatarId(avId, 'setQuestChoice', [questId])

    def requestStepComplete(self, questId_struct, turnin_items) -> None:
        avId = self.air.getAvatarIdFromSender()

        quest_group = questId_struct[0]
        quest_bitmask_index = questId_struct[1]
        quest_id = QuestMgr.dcGroupAndBitToQuestId(quest_group, quest_bitmask_index)

        qdef = QuestMgr.getInstance().getQuestById(quest_id)
        if qdef is None:
            print(f'[QuestNPCAI] requestStepComplete: unknown questId {quest_id}')
            return

        doc = self.air.mongoInterface.mongodb.fairies.find_one({'_id': avId})
        if not doc:
            return

        # what quest
        quest_entry = None
        for entry in (doc.get('questState') or []):
            if entry.get('questId') == quest_id:
                quest_entry = entry
                break

        if quest_entry is None:
            print(f'[QuestNPCAI] requestStepComplete: quest {quest_id} not active for {avId}')
            return

        current_step = quest_entry.get('currentStep', 0)
        self.takeGoalIngredients(avId, quest_id, current_step)
        self.takeTurnInItems(avId, quest_id, current_step, turnin_items)
        total_steps = len(qdef.steps)
        next_step = current_step + 1

        if next_step >= total_steps:
            self.completeQuest(avId, quest_id, qdef)
        else:
            # each step has its own goal so the accumulator resets with it
            self.air.mongoInterface.mongodb.fairies.update_one(
                {'_id': avId, 'questState.questId': quest_id},
                {'$set': {'questState.$.currentStep': next_step, 'questState.$.accumulator': 0}},
            )
            avatar = self.air.doId2do.get(avId)
            if avatar and hasattr(avatar, 'activeQuests') and quest_id in avatar.activeQuests:
                q_obj = avatar.activeQuests[quest_id]
                q_obj.setStep(next_step)
                q_obj.setAccumulator(0)

            self.sendUpdateToAvatarId(avId, 'setQuestChoice', [quest_id])

    def takeGoalIngredients(self, avId: int, quest_id: int, step: int) -> None:
        goal = QuestMgr.getInstance().getGoalForQuestStep(quest_id, step)

        if goal is None or goal.goal_type != 1 or goal.quantity <= 0:
            return

        if goal.goal_item_id not in INGREDIENT_IDS:
            return

        # a short pouch just keeps what it has, the step already counted
        if not self.air.inventoryManager.removeIngredientsFromPouch(avId, goal.goal_item_id, goal.quantity):
            return

        avatar = self.air.doId2do.get(avId)

        if avatar is not None:
            avatar.d_syncPouchAfterChanges()

    def takeTurnInItems(self, avId: int, quest_id: int, step: int, turnin_items) -> None:
        goal = QuestMgr.getInstance().getGoalForQuestStep(quest_id, step)

        if goal is None or goal.goal_type != 1 or goal.goal_item_id in INGREDIENT_IDS:
            return

        avatar = self.air.doId2do.get(avId)

        if avatar is None:
            return

        invIds = []

        for entry in turnin_items or []:
            invId = entry[0] if isinstance(entry, (tuple, list)) else entry

            if invId not in invIds:
                invIds.append(invId)

        fairies = self.air.mongoInterface.mongodb.fairies

        for invId in invIds[:max(goal.quantity, 1)]:
            found = fairies.find_one(
                {'_id': avId, 'avatar.items': {'$elemMatch': {'inv_id': invId, 'item_id': {'$in': list(goal.goal_item_ids or (goal.goal_item_id,))}}}},
                {'avatar.items.$': 1},
            )

            if not found:
                continue

            location = found['avatar']['items'][0].get('location')
            fairies.update_one({'_id': avId}, {'$pull': {'avatar.items': {'inv_id': invId}}})

            field = 'storageRemove' if location == 'Storage' else 'wardrobeRemove'
            self.air.inventoryManager.sendUpdateToAvatarId(avId, field, [0, invId])
            avatar._invalidateOutfitsForItem(invId)

    def completeQuest(self, avId: int, quest_id: int, qdef) -> None:
        # no rewards means no reward panel, finalize straight away
        needsRewardPick = bool(qdef.rewards)
        if needsRewardPick:
            self.pendingReward[avId] = quest_id

        self.grantQuestExp(avId, qdef)

        # quests.xml tags each quest with the ladder it counts toward
        questEvent = badge_events.QUEST_ACCUMULATOR_TO_EVENT.get(qdef.badge_accumulator_id)
        if questEvent is not None:
            self.air.badgeManager.d_accumulate(avId, questEvent)

        self.air.mongoInterface.mongodb.fairies.update_one(
            {'_id': avId},
            {'$pull': {'questState': {'questId': quest_id}}},
        )

        group, bit_idx = QuestMgr.questIdToDcGroupAndBit(quest_id)
        bit_mask_bit = 1 << bit_idx

        doc = self.air.mongoInterface.mongodb.fairies.find_one({'_id': avId})
        history = (doc.get('questHistory') or []) if doc else []

        existing = next((h for h in history if h.get('questGroup') == group), None)
        now_ts = int(_time.time())

        if existing:
            new_mask = existing.get('questBitmask', 0) | bit_mask_bit
            self.air.mongoInterface.mongodb.fairies.update_one(
                {'_id': avId, 'questHistory.questGroup': group},
                {'$set': {
                    'questHistory.$.questBitmask': new_mask,
                    'questHistory.$.acceptTimeForLastDone': now_ts,
                }},
            )
        else:
            self.air.mongoInterface.mongodb.fairies.update_one(
                {'_id': avId},
                {'$push': {'questHistory': {
                    'questGroup': group,
                    'questBitmask': bit_mask_bit,
                    'acceptTimeForLastDone': now_ts,
                }}},
                upsert=False,
            )

        avatar = self.air.doId2do.get(avId)

        if not needsRewardPick:
            if qdef.petRequirement:
                self.healPetForQuest(avId, avatar)
            if avatar and hasattr(avatar, 'sendQuestHistory'):
                avatar.sendQuestHistory()
            self.finalizeQuestObject(avId, quest_id, qdef.repeat)
            self.sendUpdateToAvatarId(avId, 'questResponse', [0])
            return

        if avatar:
            if hasattr(avatar, 'sendQuestHistory'):
                avatar.sendQuestHistory()
            if hasattr(avatar, 'activeQuests') and quest_id in avatar.activeQuests:
                # only flag it reward pending, setQuestRewardChoice finalizes and deletes
                q_obj = avatar.activeQuests[quest_id]
                q_obj.setStepStatus(2)  # QUEST_STATE_REWARD_PENDING

        group_dc, bit_dc = QuestMgr.questIdToDcGroupAndBit(quest_id)
        quest_id_struct = (group_dc, bit_dc)
        self.sendUpdateToAvatarId(avId, 'questResponse', [0])

    def setQuestRewardChoice(self, rewardChoice: int, questId_struct) -> None:
        avId = self.air.getAvatarIdFromSender()

        # questId_struct is always (0, 0) from the client, use pendingReward
        quest_id = self.pendingReward.pop(avId, None)
        if quest_id is None:
            print(f'[QuestNPCAI] setQuestRewardChoice: no pending reward for avId {avId}')
            return

        qdef = QuestMgr.getInstance().getQuestById(quest_id)
        if qdef is None:
            print(f'[QuestNPCAI] setQuestRewardChoice: unknown questId {quest_id}')
            self.finalizeQuestObject(avId, quest_id, repeat=False)
            return

        if not qdef.rewards:
            # nothing to grant
            self.finalizeQuestObject(avId, quest_id, qdef.repeat)
            return

        choice_idx = max(0, min(rewardChoice, len(qdef.rewards) - 1))
        reward = qdef.rewards[choice_idx]

        if badge_lookup.get_badge(reward.reward_item_id) is not None:
            # badge rewards are not items, they used to land in the wardrobe
            self.air.badgeManager.d_giveBadge(avId, reward.reward_item_id)
        elif reward.reward_item_id != 0 and not (18000 <= reward.reward_item_id < 19000):
            # 18000-18999 are spell ids, not items, nothing to grant
            item_id = reward.reward_item_id
            if 8000 <= item_id < 9000:
                # ingredient
                self.air.inventoryManager.addIngredientsToPouch(
                    avId, item_id, reward.quantity, -1
                )
                avatar = self.air.doId2do.get(avId)
                if avatar:
                    avatar.d_syncPouchAfterChanges()
            else:
                # wardrobe clothing reward
                self.grantItemReward(avId, reward)

        self.finalizeQuestObject(avId, quest_id, qdef.repeat)

    # tells the client the quest is done, the reward panel is waiting on that
    def finalizeQuestObject(self, avId: int, quest_id: int, repeat: bool) -> None:
        avatar = self.air.doId2do.get(avId)
        if avatar and hasattr(avatar, 'activeQuests') and quest_id in avatar.activeQuests:
            q_obj = avatar.activeQuests.pop(quest_id)
            # 12 = repeatable, 11 = not
            q_obj.setStepStatus(12 if repeat else 11)
            q_obj.requestDelete()

    def healPetForQuest(self, avId: int, avatar) -> None:
        # client snapshots the pet when the turn in starts and waits for a new setPetDetail
        if avatar and hasattr(avatar, 'healPetAndRefresh'):
            avatar.healPetAndRefresh()
            return

        pet = pet_state.loadPetAndApplyDecay(self.air, avId)
        if pet_state.hasPet(pet):
            pet_state.healPet(pet)
            pet_state.savePet(self.air, avId, pet)

    def grantQuestExp(self, avId: int, qdef) -> None:
        # QUEST_XP is keyed by the goal type of the last step
        goal = qdef.steps[-1].goal if qdef.steps else None
        goal_type = goal.goal_type if goal else 0
        base_xp = XPConfig.QUEST_XP.get(str(goal_type), 1)
        self.air.experienceManager.grantScaledExp(avId, base_xp, "quest")

    # dyes and baked goods go to the pouch
    def grantItemReward(self, avId: int, reward) -> None:
        item_id = reward.reward_item_id

        if 14000 <= item_id < 15000 or item_id in BAKED_ITEMS:
            # dyes and baked goods are pouch stackables
            self.air.inventoryManager.addIngredientsToPouch(
                avId, item_id, reward.quantity, -1)
            avatar = self.air.doId2do.get(avId)
            if avatar:
                avatar.d_syncPouchAfterChanges()
            return

        # type has to be the real item type or worn quest items vanish on relog
        item_type = get_item_type(item_id)
        if item_type in ('Furniture', 'Lamp', 'Decoration'):
            location, update_name = 'Storage', 'storageItem'
        else:
            location, update_name = 'Wardrobe', 'wardrobeItem'

        inv_id = self.air.mongoInterface.getNextDoId()

        new_item = {
            'inv_id': inv_id,
            'type': item_type,
            'item_id': reward.reward_item_id,
            'slot': -1,
            'createdById': reward.created_by,
            'createdByName': '',
            'giftedById': 0,
            'giftedByName': '',
            'quality': reward.quality,
            'color1': reward.color1,
            'color2': reward.color2,
            'howAcquired': 11,   # 11 = Quest reward
            'location': location,
        }

        self.air.mongoInterface.mongodb.fairies.update_one(
            {'_id': avId},
            {'$push': {'avatar.items': new_item}},
        )

        gender_default = 0
        invItemExt = [
            inv_id,
            reward.reward_item_id,
            -1,                         
            reward.created_by,
            '',
            0,
            '',
            reward.quality,
            reward.color1,
            reward.color2,
            11,
        ]
        self.air.inventoryManager.sendUpdateToAvatarId(
            avId, update_name, [reward.reward_item_id, invItemExt]
        )
