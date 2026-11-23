
from game.fairies.ai.StaffTiers import MODERATOR
from game.fairies.badges import badge_events
from game.fairies.magicwords.commands.puppets import meadowNames
from game.fairies.magicwords.registry import CATEGORY_PUPPETS, SCOPE_GLOBAL, command, splitOn
from game.fairies.show import ShowManagerAI as shows


def zoneFor(ctx, tokens: list[str]) -> int:
    if not tokens:
        return 0

    token = "".join(tokens).lower()

    if token.isdigit():
        return int(token)

    zoneId = next((zone for zone, name in meadowNames().items() if name.lower().replace(" ", "") == token), 0)

    if not zoneId:
        ctx.fail(f"{' '.join(tokens)!r} isn't a meadow -- try list-meadows")

    return zoneId


def districtFor(args: list[str]) -> tuple[list[str], str | None]:
    split = splitOn(args, "on")

    if split is None:
        return args, None

    return split[0], " ".join(split[1]) or None


@command("show-start", "show-start <play|comedy|unicorn|script name> [in <meadow>] [on <district>]",
         tier=MODERATOR, scope=SCOPE_GLOBAL, category=CATEGORY_PUPPETS,
         description="Open a show. Anyone in the meadow while it runs counts as attending. A script name runs that script's puppets too.")
def showStart(ctx) -> str:
    args, district = districtFor(ctx.args)
    split = splitOn(args, "in")
    what = " ".join(split[0] if split else args).strip()

    if not what:
        ctx.fail(f"usage: {ctx.usage}")

    zoneId = zoneFor(ctx, split[1] if split else [])
    request = {"action": "start", "zoneId": zoneId, "district": district}

    if what.lower() in badge_events.SHOW_KIND_EVENTS:
        request["kind"] = what.lower()
    elif what in shows.scriptNames():
        request["script"] = what
    else:
        ctx.fail(f"{what!r} isn't a show kind or a script -- try show-list")

    ctx.air.mongoInterface.mongodb.showRequests.insert_one(request)
    return f"asked a district to start {what}; show-list shows what happened"


@command("show-end", "show-end [meadow] [on <district>]", tier=MODERATOR, scope=SCOPE_GLOBAL,
         category=CATEGORY_PUPPETS, description="End the running show, or the one in a given meadow. Attendees are credited and the puppets go home.")
def showEnd(ctx) -> str:
    args, district = districtFor(ctx.args)
    zoneId = zoneFor(ctx, args)
    ctx.air.mongoInterface.mongodb.showRequests.insert_one({"action": "end", "zoneId": zoneId, "district": district})
    return "asked the district running it to end the show; show-list shows what happened"


@command("show-list", "show-list", tier=MODERATOR, scope=SCOPE_GLOBAL, category=CATEGORY_PUPPETS,
         description="Running shows, the scripts available, the schedule and the last few results.")
def showList(ctx) -> str:
    mongodb = ctx.air.mongoInterface.mongodb
    lines = ["running:"]
    running = list(mongodb.shows.find())
    lines += [f"  {row['title']} ({row['kind']}) in zone {row['zoneId']} on {row['districtName']}" for row in running] or ["  none"]
    lines.append("kinds: " + ", ".join(badge_events.SHOW_KIND_EVENTS))
    lines.append("scripts: " + (", ".join(shows.scriptNames()) or "none"))
    lines.append("recent:")
    recent = list(mongodb.showResults.find().sort("at", -1).limit(5))
    lines += [f"  {row['at']:%H:%M:%S} {row['districtName']}: {row['text']}" for row in recent] or ["  nothing yet"]
    return "\n".join(lines)
