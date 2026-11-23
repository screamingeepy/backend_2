# from game.fairies.magicwords.registry import CATEGORY_MODERATION, SCOPE_GLOBAL, command
# from game.fairies.ai.StaffTiers import ADMINISTRATOR, MODERATOR
# from game.fairies.uberdog import HolidayManagerUD


# @command("holidays", "holidays", tier=MODERATOR, scope=SCOPE_GLOBAL, category=CATEGORY_MODERATION,
#          description="List every holiday and whether it is on.")
# def holidays(ctx) -> str:
#     state = HolidayManagerUD.getHolidayState()
#     lines = [f"{'ON ' if holiday['id'] in state['enabled'] else 'off'} {holiday['id']} ({holiday['label']})"
#              for holiday in HolidayManagerUD.getCatalog()]

#     if state["extra"]:
#         lines.append("extra tags: " + ", ".join(state["extra"]))

#     return "\n".join(lines)


# @command("holiday-on", "holiday-on <holiday or tag>", tier=ADMINISTRATOR, scope=SCOPE_GLOBAL,
#          category=CATEGORY_MODERATION,
#          description="Turn a holiday on, by its name from the holidays list. Anything else is added as a single tag. Players see it at their next meadow.")
# def holidayOn(ctx) -> str:
#     return _change(ctx, True)


# @command("holiday-off", "holiday-off <holiday or tag>", tier=ADMINISTRATOR, scope=SCOPE_GLOBAL,
#          category=CATEGORY_MODERATION,
#          description="Turn a holiday, or an extra tag, back off.")
# def holidayOff(ctx) -> str:
#     return _change(ctx, False)


# def _change(ctx, on: bool) -> str:
#     if len(ctx.args) != 1:
#         ctx.fail(f"name one holiday or tag -- usage: {ctx.usage}")

#     name = ctx.args[0]

#     if not name.replace("_", "").isalnum():
#         ctx.fail("that isn't a holiday or tag name")

#     entry = HolidayManagerUD.setHoliday(name, on)
#     return f"{entry} is now {'on' if on else 'off'}, players see it at their next meadow"
