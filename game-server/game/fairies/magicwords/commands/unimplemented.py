from direct.directnotify.DirectNotifyGlobal import directNotify

from game.fairies.magicwords.registry import SCOPE_GLOBAL, command

notify = directNotify.newCategory("MagicWords")

# console spellings for systems this server doesn't have yet, so they answer with what's missing instead of "unknown magic word"
# when one lands, delete its entry here and write the handler next to its siblings
# system -> the commands that wait on it, with the arguments LiveMod sends
UNIMPLEMENTED = {
    "quests": [
        ("unlock-quest", "unlock-quest <questId>"),
        ("set-quest-accumulate", "set-quest-accumulate <questId> <amount>"),
        ("complete-quest", "complete-quest <questId>"),
        ("complete-step", "complete-step <stepId>"),
    ],

    "the wilderness": [
        ("create-wilderness", "create-wilderness <wildernessId> <zoneId>"),
        ("set-wilderness-id", "set-wilderness-id <wildernessId>"),
        ("set-challenge-level", "set-challenge-level [level]"),
        ("set-challenge-spells", "set-challenge-spells [spells]"),
        ("set-microgames", "set-microgames [microgames]"),
        ("defeat-all-enemies", "defeat-all-enemies"),
        ("complete-all-crafts", "complete-all-crafts"),
    ],

    "pets": [
        ("get-pet", "get-pet <itemId> <color1> <color2> <color3> <name>"),
    ],

    "animal friend gifts": [
        ("make-gift", "make-gift <itemId> <x> <y>"),
        ("clear-gifts", "clear-gifts"),
    ],

    # HolidayManagerUD serves a fixed tag list and keeps no per-fairy state to clear
    "holiday flags": [
        ("clear-holiday-flags", "clear-holiday-flags"),
    ],

    # show-ad and targeted-ad are client-only and still work for testing the popups
    "advertising eligibility": [
        ("set-ad-eligible", "set-ad-eligible <adId> <eligible>"),
    ],
}


def _register(name: str, usage: str, system: str) -> None:
    # global, so the GM portal queue answers it instead of leaving it pending
    @command(name, usage, scope=SCOPE_GLOBAL)
    def handler(ctx, _system=system) -> str:
        notify.info(f"{ctx.name} from account {ctx.avatar.getDISLid()}: {_system} is not implemented")

        return f"{ctx.name}: {_system} is not implemented on this server"


for _system, _commands in UNIMPLEMENTED.items():
    for _name, _usage in _commands:
        _register(_name, _usage, _system)
