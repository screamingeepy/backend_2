from dataclasses import dataclass, field
from game.fairies.fairy.structs.FairyDNA import FairyDNA

@dataclass
class Questgiver:
    name: str
    questGiverId: int
    famousFairyId: int
    position: tuple = (0, 0)
    rotation: int = 0
    fairyDNA: FairyDNA = field(default_factory=FairyDNA)
    gender: int = 1

    def __post_init__(self):
        self.fairyDNA.gender = self.gender

    def toTuple(self) -> tuple:
        return (self.name, self.fairyDNA.asTuple(), self.position, self.famousFairyId)

@dataclass
class QuestZone():
    zone: int
    questgiver: Questgiver

    def generateQuestZone(self, DFQ_NPCAI):
        qzone = DFQ_NPCAI
        qzone.setName(self.questgiver.name)
        qzone.setFairyDNA(self.questgiver.fairyDNA.asTuple())
        # setPosition and setRotation are required, skipping them stacks every giver at 0, 0
        qzone.setPosition(*self.questgiver.position)
        qzone.setRotation(self.questgiver.rotation)
        qzone.setFamousFairyId(self.questgiver.famousFairyId)
        qzone.setQuestGiverId(self.questgiver.questGiverId)
        qzone.setRoomID(1)
        qzone.generateWithRequired(self.zone)

