"""Detect recurring subscription transactions from history and mark them automatically."""
import statistics
from collections import defaultdict
from typing import Optional

from sqlalchemy.orm import Session

from .. import models

# (frequency_name, min_days, max_days)
FREQ_RANGES = [
    ("weekly",      4,   10),
    ("fortnightly", 11,  20),
    ("monthly",     21,  50),
    ("quarterly",   60,  120),
    ("annual",      300, 400),
]

AMOUNT_CV_THRESHOLD = 0.10  # coefficient of variation ≤ 10%

# Only auto-mark transactions whose description contains one of these keywords.
# Pure frequency (groceries, fuel) is NOT enough on its own.
SUBSCRIPTION_KEYWORDS = {
    # Streaming & media
    "netflix", "spotify", "apple", "itunes", "apple.com", "youtube",
    "disney", "stan", "binge", "foxtel", "paramount", "prime video",
    "amazon prime", "tidal", "deezer", "audible",
    # Design & creative
    "canva", "adobe", "figma", "sketch", "invision",
    # Software & SaaS
    "xero", "myob", "quickbooks", "freshbooks",
    "microsoft", "office 365", "google", "gsuite", "dropbox",
    "notion", "slack", "zoom", "atlassian", "github", "linear",
    "1password", "lastpass", "nordvpn", "expressvpn",
    "cloudflare", "namecheap", "godaddy",
    # Fitness & wellness
    "myfitnesspal", "strava", "headspace", "calm",
    # News & reading
    "the age", "herald", "news.com", "crikey", "substack",
    "kindle", "scribd",
    # Finance & insurance
    "medibank", "bupa", "ahm", "nib health",
    "afterpay", "zip", "humm",
    # Telco (plans — not one-off payments)
    "optus", "telstra", "vodafone", "belong",
    # Games
    "playstation", "xbox", "nintendo", "steam", "epic games",
    # Other common Aus subscriptions
    "iselect", "youi", "racv",
}


def _infer_frequency(gaps: list[int]) -> Optional[str]:
    if not gaps:
        return None
    med = statistics.median(gaps)
    for name, low, high in FREQ_RANGES:
        if low <= med <= high:
            return name
    return None


def _is_fixed_amount(amounts: list[int]) -> bool:
    if len(amounts) < 2:
        return True
    mean = statistics.mean(amounts)
    if mean == 0:
        return False
    stdev = statistics.stdev(amounts)
    return (stdev / mean) <= AMOUNT_CV_THRESHOLD


def _looks_like_subscription(description: str) -> bool:
    desc = description.lower()
    return any(kw in desc for kw in SUBSCRIPTION_KEYWORDS)


def detect_and_mark(db: Session, entity_id: Optional[int] = None) -> dict:
    """Scan expense history, mark subscription-like recurring transactions.

    Only transactions whose description matches a known subscription keyword
    are eligible. Everything else (groceries, fuel, etc.) is left alone even
    if it repeats regularly.
    """
    transfer_cat_ids = {
        c.id for c in db.query(models.Category).filter(
            models.Category.name.in_(["Internal Transfer", "Transfer Income"])
        ).all()
    }
    sub_cat = db.query(models.Category).filter_by(name="Subscriptions").first()
    sub_cat_id = sub_cat.id if sub_cat else None

    q = db.query(models.Transaction).filter(models.Transaction.direction == "out")
    if entity_id:
        q = q.filter(models.Transaction.entity_id == entity_id)
    txns = q.order_by(models.Transaction.date).all()

    # Split into subscription-eligible and everything else
    groups: dict[str, list[models.Transaction]] = defaultdict(list)
    non_sub_auto: list[models.Transaction] = []

    for tx in txns:
        if tx.category_id in transfer_cat_ids:
            continue
        key = (tx.description or "").strip().lower()
        if not key:
            continue
        if _looks_like_subscription(tx.description or ""):
            groups[key].append(tx)
        elif tx.is_recurring and tx.source != "manual":
            # Was previously auto-marked but doesn't match subscription keywords —
            # clear it so non-subscription repeating merchants don't stay flagged
            non_sub_auto.append(tx)

    # Clear incorrectly auto-marked transactions
    cleared = 0
    for tx in non_sub_auto:
        tx.is_recurring = False
        tx.recurrence_freq = None
        cleared += 1

    marked = 0
    groups_detected = 0

    for key, group in groups.items():
        group.sort(key=lambda t: t.date)

        if len(group) < 2:
            continue

        # Skip entire group if user has manually opted this description out
        if any(tx.recurring_override for tx in group):
            continue

        dates = [t.date for t in group]
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        freq = _infer_frequency(gaps)

        if freq is None:
            continue

        groups_detected += 1
        amounts = [t.amount_cents for t in group]
        fixed = _is_fixed_amount(amounts)

        for tx in group:
            changed = False
            if not tx.is_recurring:
                tx.is_recurring = True
                changed = True
            if tx.recurrence_freq != freq:
                tx.recurrence_freq = freq
                changed = True
            if sub_cat_id and fixed and tx.category_id is None:
                tx.category_id = sub_cat_id
                changed = True
            if changed:
                marked += 1

    db.commit()
    return {"marked": marked, "cleared": cleared, "groups_detected": groups_detected}
