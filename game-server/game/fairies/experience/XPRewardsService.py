from game.fairies.experience import XPConfig

# This is filling the role of just a fetcher from the config so the manager can call this

class XPRewardsService:

    def __init__(self):
        pass

    def getLevelRewards(self, level: int) -> dict:

        return XPConfig.LEVEL_UPS_BY_LEVEL.get(int(level or 0), {})

    def getGifts(self, level: int, gender=None) -> list[dict]:

        level_up = self.getLevelRewards(level)

        if not level_up:
            return []

        gifts = [self.normalizeGift(gift) for gift in level_up.get("gifts", [])]

        if gender is None:
            return gifts

        # In the original ActionScript there is a filter for gifts when the XML gift has a gender restriction

        filtered = []
        for gift in gifts:
            gift_gender = gift.get("gender")
            if gift_gender is None or int(gift_gender) == int(gender):

                filtered.append(gift)

        return filtered


    # So the original AS script has the fields for gender and color too so i added them,
    # in the xpconfig.xml the commented example also includes them without using them
    # That probably means the original xml gifts probably had color and gender locks
    # but they were dropped at some point??
    # in any case for preservation reasons i kept them
    # they will default to None, -1, -1
    def normalizeGift(self, gift) -> dict:

        if isinstance(gift, dict):

            return {
                "itemId": int(gift.get("itemId", gift.get("id", 0))),
                "count": int(gift.get("count", gift.get("amount", 1))),
                "gender": gift.get("gender"),
                "color1": int(gift.get("color1", -1)),
                "color2": int(gift.get("color2", -1)),
            }

        if isinstance(gift, (tuple, list)):
            item_id = int(gift[0])
            count = int(gift[1]) if len(gift) > 1 else 1
            color1 = int(gift[2]) if len(gift) > 2 else -1
            color2 = int(gift[3]) if len(gift) > 3 else -1

            return {
                "itemId": item_id,
                "count": count,
                "gender": None,
                "color1": color1,
                "color2": color2,
            }

        raise TypeError(f"Unsupported XP gift format: {gift!r}")

    def getDustCap(self, level: int, member: bool) -> int:

        level = int(level or 0)

        if level == 0:
            return (
                XPConfig.LEVEL0_DUST_CAP_MEMBER
                if member
                else XPConfig.LEVEL0_DUST_CAP_BASIC
            )

        level_up = self.getLevelRewards(level)

        if not level_up:
            return 0

        return int(level_up.get("memberDust" if member else "basicDust", 0))

    def isSkillLevel(self, level: int) -> bool:

        return XPConfig.isSkillLevel(level)

    def getRewards(self, level: int, member: bool, gender = None) -> dict:

        level = int(level or 0)

        return {

            "level": level,
            "gifts": self.getGifts(level, gender),
            "dustCap": self.getDustCap(level, member),
            "skill": self.isSkillLevel(level),
        }
