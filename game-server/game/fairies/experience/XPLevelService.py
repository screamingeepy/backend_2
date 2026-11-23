from game.fairies.experience import XPConfig

# All things math, for leveling and thresholds and stuff

class XPLevelService:

# Converts raw exp number into a level using the thresholds

    def getLevelForExp(self, totalXp: int) -> int:

        totalXp = max(0, int(totalXp or 0))

        for level in range(XPConfig.MAX_LEVEL, -1, -1):

            required = XPConfig.CUMULATIVE_XP_THRESHOLDS.get(level, 0)
            if totalXp >= required:
                return level

        return 0


    def getCumulativeExp(self, level: int) -> int:
        level = max(0, min(int(level or 0), XPConfig.MAX_LEVEL))
        return XPConfig.CUMULATIVE_XP_THRESHOLDS.get(level, 0)


    def getRequiredExpForLevel(self, level: int) -> int:
        level_up = XPConfig.LEVEL_UPS_BY_LEVEL.get(int(level or 0))
        if not level_up:
            return -1
        return int(level_up.get("xp", -1))

    def getProgress(self, totalXp: int) -> dict:
        totalXp = max(0, int(totalXp or 0))
        level = self.getLevelForExp(totalXp)
        current_level_threshold = self.getCumulativeExp(level)

        if level >= XPConfig.MAX_LEVEL:

            return {
                "level": level,
                "totalXp": totalXp,
                "currentLevelXp": 0,
                "requiredForNextLevel": 0,
                "nextLevelAt": current_level_threshold,
                "capped": True,
            }

        next_level_threshold = self.getCumulativeExp(level + 1)

        return {
            "level": level,
            "totalXp": totalXp,
            "currentLevelXp": totalXp - current_level_threshold,
            "requiredForNextLevel": next_level_threshold - current_level_threshold,
            "nextLevelAt": next_level_threshold,
            "capped": False,
        }

    def isSkillLevel(self, level: int) -> bool:

        return XPConfig.isSkillLevel(level)

    def getSkillCountAtLevel(self, level: int) -> int:

        return XPConfig.getSkillCountAtLevel(level)

    def getSpellUnlockedAtLevel(self, level: int, talent_id: int) -> int | None:

        return XPConfig.getSpellUnlockedAtLevel(level, talent_id)

    def getLevelCap(self, member:bool) -> int:

        if member:

            return XPConfig.LEVELUPS_MEMBER_CAP

        return XPConfig.LEVELUPS_BASIC_CAP
