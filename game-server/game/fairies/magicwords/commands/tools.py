import time

from game.fairies.ai.StaffTiers import MODERATOR
from game.fairies.magicwords.registry import command, dispatch

# DistributedQuest step status the client treats as a declined/aborted quest.
QUEST_STATE_ABORTED = 10


@command("abandon-quest", "abandon-quest <questId>", tier=MODERATOR, hidden=True)
def abandonQuest(ctx) -> str:
    # setQuestChoice commits a quest as active (Mongo questState + a live
    # DistributedQuest) the moment it is picked from the NPC's list, before the
    # accept/decline card renders. If that card throws before the player can
    # decline, the quest is stuck active with no client path to remove it. This
    # does the cleanup DistributedQuest.removeQuest does on a normal decline.
    questId = ctx.intArg(0)
    avatar = ctx.avatar

    ctx.air.mongoInterface.mongodb.fairies.update_one(
        {"_id": avatar.doId},
        {"$pull": {"questState": {"questId": questId}}}
    )

    activeQuests = getattr(avatar, "activeQuests", {})
    if questId in activeQuests:
        questObj = activeQuests.pop(questId)
        questObj.setStepStatus(QUEST_STATE_ABORTED)
        questObj.requestDelete()
        return f"abandoned quest {questId} (was active)"

    return f"cleared quest {questId} from questState (no live quest object)"


@command("give-quest", "give-quest <questId> [step]", tier=MODERATOR, hidden=True)
def giveQuest(ctx) -> str:
    # starts the quest on the caller without the npc, optionally on a later step, skips offer rules and the 4 per tab cap
    # imported here so loading the magic words doesn't pull in the quest npc code
    from game.fairies.fairy.npc.DistributedQuest import DistributedQuest, QUEST_OBJECT_ZONE
    from game.fairies.fairy.npc.QuestMgr import QuestMgr

    questId = ctx.intArg(0)
    step = ctx.intArg(1) if len(ctx.args) > 1 else 0
    avatar = ctx.avatar

    qdef = QuestMgr.getInstance().getQuestById(questId)
    if qdef is None:
        ctx.fail(f"no quest {questId}")
    if not 0 <= step < len(qdef.steps):
        ctx.fail(f"quest {questId} has steps 0 to {len(qdef.steps) - 1}")

    activeQuests = getattr(avatar, "activeQuests", {})
    if questId in activeQuests:
        ctx.fail(f"quest {questId} is already active, abandon-quest {questId} first")

    now = int(time.time())
    ctx.air.mongoInterface.mongodb.fairies.update_one(
        {"_id": avatar.doId},
        {"$pull": {"questState": {"questId": questId}}}
    )
    ctx.air.mongoInterface.mongodb.fairies.update_one(
        {"_id": avatar.doId},
        {"$push": {"questState": {"questId": questId, "currentStep": step, "startTime": now, "accumulator": 0}}}
    )

    questObj = DistributedQuest(ctx.air, avatar.doId, questId, step=step, startTime=now)
    questObj.generateWithRequired(QUEST_OBJECT_ZONE)
    ctx.air.sendSetOwnerDoId(questObj.doId, avatar.doId)
    activeQuests[questId] = questObj

    return f"gave quest {questId} at step {step}"


def _wildernessOf(ctx):
    avatarId = getattr(ctx.avatar, "doId", None)
    instances = list(ctx.air.wildernessInstances.values())

    for instance in instances:
        if avatarId in getattr(instance, "activeFairies", ()):
            return instance

    zones = {ctx.zoneId, getattr(ctx.avatar, "zoneId", None)}
    return next((w for w in instances if getattr(w, "zoneId", None) in zones), None)

@command("game-on", "game-on <magic word> [args]", tier=MODERATOR, hidden=True)
def consoleTunnel(ctx) -> str:
    if not ctx.args:
        ctx.fail(f"usage: {ctx.usage}")
    if ctx.args[0].lower() == "game-on":
        ctx.fail("game-on can't run itself")

    return dispatch(ctx.air, ctx.avatar, " ".join(ctx.args), ctx.zoneId)


@command("gm-mode", "gm-mode <on|off>", tier=MODERATOR, hidden=True)
def gmMode(ctx) -> str:
    setting = ctx.arg(0).lower()

    if setting not in ("on", "off"):
        ctx.fail(f"usage: {ctx.usage}")

    ctx.air.mongoInterface.mongodb.accounts.update_one(
        {"_id": ctx.avatar.DISLid},
        {"$set": {"gmVisible": setting == "on"}},
    )

    return f"gm avatar {setting} for this account -- log out and back in for it to take effect"


@command("set-self-invisible", "set-self-invisible", tier=MODERATOR, hidden=True)
def setSelfInvisible(ctx) -> str:
    from game.fairies.fairy.DistributedFairyGMAI import DistributedFairyGMAI

    avatar = ctx.avatar
    if not isinstance(avatar, DistributedFairyGMAI):
        ctx.fail("you must be logged in as a GM avatar (enable gm-mode)")

    # TODO: Toggle visibility flag or move to ghost zone
    return "invisibility toggle stub (not yet implemented on server side)"
