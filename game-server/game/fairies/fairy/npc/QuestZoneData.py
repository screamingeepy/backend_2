# Probably move this file dk
from game.fairies.fairy.npc.NPCQuestGiverData import Questgiver, QuestZone
from game.fairies.ai import ZoneConstants
from game.fairies.fairy import FamousFairyData

QUEST_ZONES = [
    QuestZone(
        zone=ZoneConstants.FAWNS_HIDEOUT,
        questgiver=Questgiver(
            name=str(FamousFairyData.FAWN_DO_ID),
            questGiverId=FamousFairyData.FAWN_DO_ID,
            famousFairyId=FamousFairyData.FAMOUS_FAIRY_FAWN,
            position=(443, 250),  # meadows/zone800 "default" location
        )
    ),
    QuestZone(
        zone=ZoneConstants.IRIDESSAS_GLADE,
        questgiver=Questgiver(
            name=str(FamousFairyData.IRIDESSA_DO_ID),
            questGiverId=FamousFairyData.IRIDESSA_DO_ID,
            famousFairyId=FamousFairyData.FAMOUS_FAIRY_IRIDESSA,
            position=(443, 250),  # meadows/zone801 "default" location
        )
    ),
    QuestZone(
        zone=ZoneConstants.ROSETTAS_GARDEN,
        questgiver=Questgiver(
            name=str(FamousFairyData.ROSETTA_DO_ID),
            questGiverId=FamousFairyData.ROSETTA_DO_ID,
            famousFairyId=FamousFairyData.FAMOUS_FAIRY_ROSETTA,
            position=(443, 250),  # meadows/zone802 "default" location
        )
    ),
    QuestZone(
        zone=ZoneConstants.SILVERMISTS_GROTTO,
        questgiver=Questgiver(
            name=str(FamousFairyData.SILVERMIST_DO_ID),
            questGiverId=FamousFairyData.SILVERMIST_DO_ID,
            famousFairyId=FamousFairyData.FAMOUS_FAIRY_SILVERMIST,
            position=(443, 250),  # meadows/zone803 "default" location
        )
    ),
    QuestZone(
        zone=ZoneConstants.TINKERS_NOOK,
        questgiver=Questgiver(
            name=str(FamousFairyData.TINKERBELL_DO_ID),
            questGiverId=FamousFairyData.TINKERBELL_DO_ID,
            famousFairyId=FamousFairyData.FAMOUS_FAIRY_TINKERBELL,
            position=(443, 250),  # meadows/zone804 "default" location
        )
    ),
    QuestZone(
        zone=ZoneConstants.KITS_PLACE,
        questgiver=Questgiver(
            name=str(FamousFairyData.KIT_DO_ID),
            questGiverId=FamousFairyData.KIT_DO_ID,
            famousFairyId=FamousFairyData.FAMOUS_FAIRY_KIT,
            position=(895, 50),  # meadows/zone805 "default" location
        )
    ),
    QuestZone(
        zone=ZoneConstants.ELIXAS_HOSPITAL,
        questgiver=Questgiver(
            name=str(FamousFairyData.ELIXA_DO_ID),
            questGiverId=FamousFairyData.ELIXA_DO_ID,
            famousFairyId=FamousFairyData.FAMOUS_FAIRY_ELIXA,
            position=(600, 300),  # meadows/zone806 "default" location
        )
    ),
    QuestZone(
        zone=ZoneConstants.PIXIE_DUST_MILL,
        questgiver=Questgiver(
            name=str(FamousFairyData.TERENCE_DO_ID),
            questGiverId=FamousFairyData.TERENCE_DO_ID,
            famousFairyId=FamousFairyData.FAMOUS_FAIRY_TERENCE,
            position=(600, 300),  # meadows/zone807 "default" location
            gender=2
        )
    ),
    QuestZone(
        zone=ZoneConstants.MARINAS_PLACE,
        questgiver=Questgiver(
            name=str(FamousFairyData.MARINA_DO_ID),
            questGiverId=FamousFairyData.MARINA_DO_ID,
            famousFairyId=FamousFairyData.FAMOUS_FAIRY_MARINA,
            position=(400, 295),  # meadows/zone808 "default" location
        )
    ),
]