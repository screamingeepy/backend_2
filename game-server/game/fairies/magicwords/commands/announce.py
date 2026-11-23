from game.fairies.ai.StaffTiers import MODERATOR
from game.fairies.magicwords.registry import CATEGORY_MODERATION, SCOPE_GLOBAL, command


@command("announce", "announce <message>", tier=MODERATOR, scope=SCOPE_GLOBAL,
         category=CATEGORY_MODERATION, description="Show a system alert to every connected player.")
def announce(ctx) -> str:
    message = " ".join(ctx.args).strip()
    if not message:
        ctx.fail(f"say what to announce -- usage: {ctx.usage}")

    ctx.air.holidayManager.announce(message)
    return f"announced: {message}"


@command("clear-announcement", "clear-announcement", tier=MODERATOR, scope=SCOPE_GLOBAL,
         category=CATEGORY_MODERATION,
         description="Stop an announcement from showing at login; new logins see the welcome message again. "
                     "Players online get the welcome message as an alert.")
def clearAnnouncement(ctx) -> str:
    if not ctx.air.holidayManager.clearAnnouncement():
        return "no announcement is active"
    return f"announcement cleared, new logins see: {ctx.air.holidayManager.getTimeSpanMessage()}"


# the same cap as the admin page's form
MAX_WELCOME = 300


@command("set-welcome", "set-welcome <message, or default>", tier=MODERATOR, scope=SCOPE_GLOBAL,
         category=CATEGORY_MODERATION,
         description="Change the welcome message new logins see. Nobody already in the game is alerted, unless an announcement is active: that is replaced, and online players see the welcome message as an alert. \"default\" puts the standard one back.")
def setWelcome(ctx) -> str:
    message = " ".join(ctx.args).strip()
    if not message:
        ctx.fail(f"say what the welcome message should be -- usage: {ctx.usage}")
    if len(message) > MAX_WELCOME:
        ctx.fail(f"keep it under {MAX_WELCOME} characters")

    ctx.air.holidayManager.saveWelcome("" if message.lower() == "default" else message)
    return f"welcome message is now: {ctx.air.holidayManager.getTimeSpanMessage()}"
