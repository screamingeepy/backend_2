from direct.directnotify import DirectNotifyGlobal

from game.fairies.experience.XPLevelService import XPLevelService
from game.fairies.experience.XPRewardsService import XPRewardsService
from game.fairies.experience.XPProgressService import XPProgressService
from game.fairies.experience import XPConfig

notify = DirectNotifyGlobal.directNotify.newCategory("FairyExperienceManagerAI")

class FairyExperienceManagerAI:

    def __init__(self, air):

        self.air = air

        self.progress = XPProgressService(air)
        self.levels = XPLevelService()
        self.rewards = XPRewardsService()


    def totalExp(self, avId: int, level: int) -> int:

        # a level set by hand (set-level, the database) leaves the saved xp below that level's threshold
        # without this a fairy at level 4 with 4 xp reads as level 1 and the bar shows nothing

        return max(self.progress.getExp(avId), self.levels.getCumulativeExp(level))

    def syncOnLogin(self, avatar) -> None:

        # setExperiencePoints has no mapping in APIDatabase.lua, so the bar starts at 0 unless it's rebuilt from the saved xp

        level = int(avatar.getLevel() or 0)

        # at the cap there is nothing to level into, overflow would reopen the level-up panel every login
        if level >= self.levels.getLevelCap(self._isMember(avatar)):
            self._publishExperience(avatar, 0)
            return

        self._publishExperience(avatar, self.barXp(self.totalExp(avatar.doId, level), level))

    def barXp(self, totalXp: int, level: int) -> int:

        # the client's bar is xp into the fairy's *current* level. It can run past the cost of the next one, and that
        # overflow is what makes the client raise its level-up panel, so it is measured against the level the fairy
        # holds, not the level the total would earn

        if level >= XPConfig.MAX_LEVEL:
            return 0

        return max(0, int(totalXp) - self.levels.getCumulativeExp(level))

    # professionId -> balance rate type
    CRAFT_SOURCES = {0: "tailoring", 1: "baking", 2: "tinkering"}

    def grantCraftExp(self, avId: int, professionId: int, difficulty: int, practice: bool) -> None:

        # a craft is a fraction of the next level by recipe difficulty (xpConfig.xml craftXp), balance rate on top
        # the original formula isn't recorded, this is a guess, tune it here

        avatar = self.air.doId2do.get(avId)

        if not avatar:
            return

        cost = self.levels.getRequiredExpForLevel(int(avatar.getLevel() or 0) + 1)

        if cost <= 0:
            return

        base = max(1, round(cost * XPConfig.getCraftXpFraction(difficulty, practice)))
        self.grantScaledExp(avId, base, self.CRAFT_SOURCES.get(professionId, "tailoring"))

    def grantLevelShareExp(self, avId: int, share: float, sourceType: str, tag: str = "") -> None:

        # share of the next level, 1.0 is a whole one
        # the balance rate is divided out so retuning it in xpConfig.xml doesn't change the payout

        avatar = self.air.doId2do.get(avId)

        if not avatar or share <= 0:
            return

        cost = self.levels.getRequiredExpForLevel(int(avatar.getLevel() or 0) + 1)

        if cost <= 0:
            return

        rate = XPConfig.getBalanceRate(sourceType, tag) or 1
        self.grantScaledExp(avId, max(1, round(cost * share / rate)), sourceType, tag)

    def grantOfflineExp(self, avId: int, amount: int, source: str = "generic") -> None:

        # for a fairy whose avatar is on another district's AI, straight to the database
        # no live bar, level-up gifts or dust, syncOnLogin shows it next time the avatar is generated

        amount = int(amount or 0)

        if amount <= 0:
            return

        oldlevel = self.progress.getLevel(avId)
        newxp = self.totalExp(avId, oldlevel) + amount
        newlevel = max(oldlevel, min(self.levels.getLevelForExp(newxp), self.levels.getLevelCap(False)))

        self.progress.setExp(avId, newxp)
        self.progress.setLevel(avId, newlevel)

        notify.info(f"XP grant (offline): avId={avId}, source={source}, amount={amount}, xp={newxp - amount}->{newxp}, level={newlevel}")

    def grantScaledExp(self, avId: int, baseAmount: int, sourceType: str, tag: str = "") -> None:

        # Grants XP after applying balance rates

        rate = XPConfig.getBalanceRate(sourceType, tag)
        self.grantExp(avId, int(baseAmount or 0) * rate, source=sourceType)

    def grantExp(self, avId: int, amount: int, source: str = "generic") -> None:

        amount = int(amount or 0)

        if amount<= 0:
            return

        avatar = self.air.doId2do.get(avId)

        if not avatar:

            notify.warning(f"grantExp: avatar {avId} not found")
            return

        member = self._isMember(avatar)
        levelcap = self.levels.getLevelCap(member)

        oldlevel = int(avatar.getLevel() or 0)
        oldxp = self.totalExp(avId, oldlevel)

        if oldlevel >= levelcap:
            notify.debug(f"grantExp: avatar {avId} is already capped at level {oldlevel}")
            return


        newxp = oldxp + amount
        newlevel = min(self.levels.getLevelForExp(newxp), levelcap)

        self.progress.setExp(avId, newxp)

        # setExperiencePoints on the wire is the client's *current-level* progress bar. When it passes the cost of the
        # next level the client raises its level-up panel (DistributedFairyPlayer.as spawnLevelUpPanelIfAppropriate,
        # run on zone entry), plays the sparkle, and answers with levelUpRequest. So the level is NOT raised here: the
        # bar is published as overflow on the old level and handleLevelUpRequest does the level once the client asks.
        # Levelling here instead skips the panel and leaves the end-of-game screen showing 0 points earned.
        self._publishExperience(avatar, self.barXp(newxp, oldlevel))

        notify.info(
            f"XP grant: avId={avId}, source={source}, amount={amount},"
            f"xp={oldxp}->{newxp}, level={oldlevel}, pending={newlevel - oldlevel}"
        )

    def handleLevelUpRequest(self, avatar) -> None:

        # the client's level-up panel (or the Pixie Dust Mill, which asks the same way) wants the level its bar has earned
        # a big grant can be worth several levels, and the client keeps sending fairies back to the mill until its bar is
        # under the next cost, so every earned level is applied here, each with its own rewards
        # a request with no level earned (a stale or repeated panel) changes nothing

        avId = avatar.doId
        oldlevel = int(avatar.getLevel() or 0)
        levelcap = self.levels.getLevelCap(self._isMember(avatar))
        totalxp = self.totalExp(avId, oldlevel)

        notify.info(f"levelUpRequest: avId={avId}, level={oldlevel}, xp={totalxp}, cap={levelcap}")
        print(f"[XP] levelUpRequest from {avId}: level {oldlevel}, total xp {totalxp}, cap {levelcap}")

        level = oldlevel

        while level < levelcap and totalxp >= self.levels.getCumulativeExp(level + 1):
            self.handleLevelUp(avatar, level, level + 1)
            level += 1

        if level == oldlevel:
            notify.debug(f"levelUpRequest from {avId} at level {oldlevel} with {totalxp} xp, nothing earned")

        self._publishExperience(avatar, self.barXp(totalxp, level) if level < levelcap else 0)
        print(f"[XP] {avId} now level {level}, bar {self.barXp(totalxp, level)}")

    def handleLevelUp(self, avatar, oldLevel: int, newLevel: int) -> None:

        # Applies the level up

        avId = avatar.doId

        avatar.b_setLevel(newLevel)
        self.progress.setLevel(avId, newLevel)

        member = self._isMember(avatar)
        gender = self._getGender(avatar)
        rewards = self.rewards.getRewards(newLevel, member, gender)

        notify.info(f"Level up: avId={avId}, {oldLevel}->{newLevel}")

        self.grantLevelRewards(avatar, rewards)


    def grantLevelRewards(self, avatar, rewards: dict) -> None:

        avId = avatar.doId
        level = int(rewards.get("level", 0) or 0)
        dustcap = int(rewards.get("dustCap", 0) or 0)

        if dustcap > 0:
            self._grantDustCapReward(avatar, level, dustcap)

        inventory = getattr(self.air, "inventoryManager", None)

        if inventory is None:
            notify.warning("grantLevelRewards: air.inventoryManager is missing")
            return

        # TODO: every gift lands in the ingredient pouch for now, regardless of
        # its real item type (the 22xxx-range ids are almost certainly badges/
        # wardrobe pieces, not pouch stackables) - refine once we sort out
        # what each id range in LEVEL_UPS actually is.
        for gift in rewards.get("gifts", []):

            granted = inventory.grantItem(
                avId,
                gift["itemId"],
                gift["count"],
                color1=gift.get("color1", -1),
                color2=gift.get("color2", -1),
            )

            if not granted:

                notify.warning(
                    f"Failed to grant XP gift: avId={avId}, level={level},"
                    f"gift={gift}"
                )

        if rewards.get("skill"):

            self.unlockSkill(avatar, level)


    def unlockSkill(self, avatar, level: int) -> None:

        # DistributedFairyPlayer.as recalculates the spell collection when it receives setLevel(level), so b_setLevel(newLevel) is the trigger

        talent_id = self._getTalent(avatar)
        spell_id = self.levels.getSpellUnlockedAtLevel(level, talent_id)

        notify.info(
            f"Skill level reached: avId={avatar.doId}, level={level}, "
            f"talent={talent_id}, spell={spell_id}"
        )

    def _publishExperience(self, avatar, xp: int) -> None:
        avatar.b_setExperiencePoints(xp)

    def _grantDustCapReward(self, avatar, level: int, dustCap: int) -> None:

        # xpConfig.xml calls this basicDust/memberDust, and it is the size of
        # the fairy's dust meter at this level rather than a payout:
        # PixieDustMeter draws the bar from this same number, while
        # setPixiePower is only ever how much they are currently carrying.
        # Levelling up fills them to the new maximum.

        avatar.addPixieDust(dustCap)

        notify.info(
            f"Dust cap reward reached: avId={avatar.doId}, "
            f"level={level}, dustCap={dustCap}"
        )

    def _isMember(self, avatar) -> bool:

        if hasattr(avatar, "isPaid"):
            return bool(avatar.isPaid())

        if hasattr(avatar, "isMember"):
            return bool(avatar.isMember())

        return False

    def _getGender(self, avatar):

        fairy_dna = getattr(avatar, "fairyDNA", None)

        return getattr(fairy_dna, "gender", None)

    def _getTalent(self, avatar) -> int:

        fairy_dna = getattr(avatar, "fairyDNA", None)

        return int(getattr(fairy_dna, "talent", 0) or 0)
