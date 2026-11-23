from game.fairies.ai import AccountControl
from game.fairies.ai.StaffTiers import MODERATOR
from game.fairies.magicwords.registry import CATEGORY_MODERATION, SCOPE_GLOBAL, command


@command("whois", "whois <fairy or Account ID>", tier=MODERATOR, scope=SCOPE_GLOBAL,
         category=CATEGORY_MODERATION, description="Look up a fairy's account, level and ban/mute status.")
def whois(ctx) -> str:
    token = " ".join(ctx.args).strip()
    try:
        account = AccountControl.findAccount(ctx.air, token)
    except AccountControl.AmbiguousName as exc:
        ctx.fail(str(exc))
    if account is None:
        ctx.fail(f"no fairy or account called {token!r}")

    owned = [f for f in AccountControl.fairiesForAccount(ctx.air, account) if not f.get("deleted")]
    parts = [
        f"Account ID {account.get('username')} (account {account['_id']})",
        f"tier {account.get('accountType', 'Player')}",
    ]
    if account.get("banned"):
        parts.append("BANNED" + (f" until {account['banUntil']:%b %d %Y}" if account.get("banUntil") else "") +
                     (f" ({account['banReason']})" if account.get("banReason") else ""))
    if account.get("muted"):
        parts.append("MUTED" + (f" until {account['mutedUntil']:%b %d %H:%M} UTC" if account.get("mutedUntil") else ""))
    if account.get("email"):
        parts.append(f"e-mail {account['email']}")
    lines = [" · ".join(parts)]
    if not owned:
        lines.append("no fairies")
    for fairy in owned:
        lines.append(
            f"{fairy.get('name', '?')} (fairy {fairy['_id']}) · talent {fairy.get('talent', '?')}, "
            f"level {fairy.get('level', '?')}, gold {fairy.get('gold', 0)}")
    return "\n".join(lines)
