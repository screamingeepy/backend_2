# This is a class that handles communication with mongo
# There are fields in DC (SetExperiencePoints, setLevel) but we keep mongo in sync explicitly
class XPProgressService:

    def __init__(self, air):
        self.air = air

    def getExp(self, avId: int) -> int:

        docs = self.air.mongoInterface.retrieveDocs("fairies", avId, queryField="_id")

        if not docs:
            return 0

        return int(docs[0].get("xp", 0) or 0)

    def getLevel(self, avId: int) -> int:

        docs = self.air.mongoInterface.retrieveDocs("fairies", avId, queryField="_id")

        if not docs:
            return 0

        return int(docs[0].get("level", 0) or 0)

    def setExp(self, avId: int, xp: int) -> None:

        self.air.mongoInterface.updateField("fairies", "xp", avId, int(xp or 0))

    def setLevel(self, avId: int, level: int) -> None:

        self.air.mongoInterface.updateField("fairies", "level", avId, int(level or 0))
