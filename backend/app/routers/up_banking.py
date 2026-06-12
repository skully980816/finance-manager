"""UP Banking integration — personal access token flow."""
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..crypto import encrypt, decrypt, is_encrypted
from ..database import get_db

router = APIRouter(prefix="/api/up", tags=["up"])

UP_BASE = "https://api.up.com.au/api/v1"


def _up_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _get_token(entity_id: int, db: Session) -> str:
    entity = db.query(models.Entity).filter_by(id=entity_id).first()
    if not entity or not entity.up_api_token:
        raise HTTPException(400, "No UP Banking token saved for this entity.")
    raw = entity.up_api_token
    # Migrate plaintext tokens on first read
    if not is_encrypted(raw):
        return raw
    return decrypt(raw)


# ── Schemas ────────────────────────────────────────────────────────────────────

class ConnectIn(BaseModel):
    entity_id: int
    token: str


class LinkAccountIn(BaseModel):
    account_id: int       # local account ID
    up_account_id: str    # UP Banking account ID


class SyncIn(BaseModel):
    entity_id: int
    since: Optional[str] = None  # ISO-8601 date string, e.g. "2024-01-01"


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/connect")
def connect(body: ConnectIn, db: Session = Depends(get_db)):
    """Validate and save an UP personal access token to an entity."""
    try:
        resp = httpx.get(f"{UP_BASE}/util/ping", headers=_up_headers(body.token), timeout=10)
    except httpx.RequestError as e:
        raise HTTPException(502, f"Could not reach UP Banking API: {e}")

    if resp.status_code == 401:
        raise HTTPException(401, "Invalid UP Banking token.")
    if not resp.is_success:
        raise HTTPException(502, f"UP API returned {resp.status_code}.")

    entity = db.query(models.Entity).filter_by(id=body.entity_id).first()
    if not entity:
        raise HTTPException(404, "Entity not found.")

    entity.up_api_token = encrypt(body.token)
    db.commit()
    ping_data = resp.json()
    return {"status": "connected", "meta": ping_data.get("meta", {})}


@router.delete("/connect/{entity_id}")
def disconnect(entity_id: int, db: Session = Depends(get_db)):
    """Remove the saved UP token from an entity."""
    entity = db.query(models.Entity).filter_by(id=entity_id).first()
    if not entity:
        raise HTTPException(404, "Entity not found.")
    entity.up_api_token = None
    db.commit()
    return {"status": "disconnected"}


@router.get("/accounts/{entity_id}")
def list_up_accounts(entity_id: int, db: Session = Depends(get_db)):
    """Return all UP accounts for this entity's saved token."""
    token = _get_token(entity_id, db)
    try:
        resp = httpx.get(f"{UP_BASE}/accounts", headers=_up_headers(token), timeout=10)
    except httpx.RequestError as e:
        raise HTTPException(502, str(e))
    if not resp.is_success:
        raise HTTPException(resp.status_code, resp.text)

    up_accounts = resp.json().get("data", [])
    # Mark which are already linked to local accounts
    linked = {
        a.up_account_id: a.id
        for a in db.query(models.Account).filter_by(entity_id=entity_id).all()
        if a.up_account_id
    }
    result = []
    for a in up_accounts:
        attrs = a.get("attributes", {})
        bal = attrs.get("balance", {})
        result.append({
            "id": a["id"],
            "name": attrs.get("displayName", ""),
            "type": attrs.get("accountType", ""),
            "balance": bal.get("value", "0.00"),
            "currency": bal.get("currencyCode", "AUD"),
            "linked_local_account_id": linked.get(a["id"]),
        })
    return result


@router.post("/link")
def link_account(body: LinkAccountIn, db: Session = Depends(get_db)):
    """Link a local account to an UP Banking account ID."""
    account = db.query(models.Account).filter_by(id=body.account_id).first()
    if not account:
        raise HTTPException(404, "Local account not found.")
    account.up_account_id = body.up_account_id
    db.commit()
    return {"status": "linked", "account_id": body.account_id, "up_account_id": body.up_account_id}


@router.post("/unlink/{account_id}")
def unlink_account(account_id: int, db: Session = Depends(get_db)):
    """Remove the UP account link from a local account."""
    account = db.query(models.Account).filter_by(id=account_id).first()
    if not account:
        raise HTTPException(404, "Local account not found.")
    account.up_account_id = None
    db.commit()
    return {"status": "unlinked"}


@router.post("/backfill-transfers")
def backfill_transfers(db: Session = Depends(get_db)):
    """Retroactively mark existing UP transactions that are internal transfers.

    UP internal transfers have descriptions like 'Transfer to Save', 'Round Up', etc.
    This endpoint categorises them as Internal Transfer / Transfer Income so they
    are excluded from income and expense totals.
    """
    TRANSFER_IN_PATTERNS = [
        "transfer from", "round up transfer", "quick save", "auto save",
        "cover from", "forward from",
    ]
    TRANSFER_OUT_PATTERNS = [
        "transfer to", "round up", "quick save", "auto save",
        "cover to", "forward to", "save now",
    ]

    def _get_or_create_cat(name: str) -> models.Category:
        cat = db.query(models.Category).filter_by(name=name).first()
        if not cat:
            cat = models.Category(name=name, kind="expense")
            db.add(cat); db.flush()
        return cat

    transfer_income_cat = _get_or_create_cat("Transfer Income")
    internal_transfer_cat = _get_or_create_cat("Internal Transfer")

    transfer_cat_ids = {transfer_income_cat.id, internal_transfer_cat.id}

    # Match any transaction that came from UP (external_id starts with "up:")
    # regardless of source field value or existing category, so older imports work too.
    up_txns = db.query(models.Transaction).filter(
        models.Transaction.external_id.like("up:%"),
    ).all()

    INTEREST_KEYWORDS = ("interest", "interest payment", "savings interest")

    marked = 0
    interest_tagged = 0
    for tx in up_txns:
        desc = (tx.description or "").lower()
        if tx.category_id not in transfer_cat_ids:
            if tx.direction == "in" and any(p in desc for p in TRANSFER_IN_PATTERNS):
                tx.category_id = transfer_income_cat.id
                marked += 1
            elif tx.direction == "out" and any(p in desc for p in TRANSFER_OUT_PATTERNS):
                tx.category_id = internal_transfer_cat.id
                marked += 1

        # Tag interest income regardless of transfer status
        if tx.direction == "in" and tx.income_type != "interest" and any(kw in desc for kw in INTEREST_KEYWORDS):
            tx.income_type = "interest"
            interest_tagged += 1

    db.commit()
    return {"marked": marked, "interest_tagged": interest_tagged}


@router.post("/sync")
def sync(body: SyncIn, db: Session = Depends(get_db)):
    """Fetch and import transactions for all UP-linked accounts under an entity."""
    token = _get_token(body.entity_id, db)

    linked_accounts = db.query(models.Account).filter(
        models.Account.entity_id == body.entity_id,
        models.Account.up_account_id.isnot(None),
    ).all()

    if not linked_accounts:
        raise HTTPException(400, "No UP-linked accounts found for this entity.")

    # Default to 90 days back so a first sync doesn't pull the entire history
    since_date = body.since or (date.today() - timedelta(days=90)).isoformat()
    params: dict = {"page[size]": "100", "filter[since]": f"{since_date}T00:00:00+00:00"}

    imported = 0
    skipped = 0
    pending = 0

    # Pre-create/fetch transfer categories once so we never flush inside the loop.
    def _get_or_create_cat(name: str) -> models.Category:
        cat = db.query(models.Category).filter_by(name=name).first()
        if not cat:
            cat = models.Category(name=name, kind="expense")
            db.add(cat)
            db.flush()
        return cat

    transfer_income_cat_id = _get_or_create_cat("Transfer Income").id
    internal_transfer_cat_id = _get_or_create_cat("Internal Transfer").id
    db.commit()

    for local_account in linked_accounts:
        url: Optional[str] = f"{UP_BASE}/accounts/{local_account.up_account_id}/transactions"
        while url:
            try:
                resp = httpx.get(url, headers=_up_headers(token), params=params if "?" not in url else None, timeout=15)
            except httpx.RequestError as e:
                raise HTTPException(502, str(e))
            if not resp.is_success:
                raise HTTPException(resp.status_code, resp.text)

            payload = resp.json()
            for txn in payload.get("data", []):
                attrs = txn.get("attributes", {})
                # Only import settled transactions
                if attrs.get("status") != "SETTLED":
                    pending += 1
                    continue

                external_id = f"up:{txn['id']}"
                exists = db.query(models.Transaction).filter_by(external_id=external_id).first()
                if exists:
                    skipped += 1
                    continue

                amount_cents = abs(attrs["amount"]["valueInBaseUnits"])
                direction = "in" if attrs["amount"]["valueInBaseUnits"] > 0 else "out"

                settled_at = attrs.get("settledAt") or attrs.get("createdAt", "")
                try:
                    txn_date = datetime.fromisoformat(settled_at).date()
                except Exception:
                    txn_date = date.today()

                description = attrs.get("description", "")
                msg = attrs.get("message") or ""
                if msg and msg != description:
                    description = f"{description} — {msg}"

                # Detect UP internal transfers via the transferAccount relationship
                transfer_acct = txn.get("relationships", {}).get("transferAccount", {}).get("data")
                is_internal = transfer_acct is not None

                if is_internal:
                    transfer_cat_id = transfer_income_cat_id if direction == "in" else internal_transfer_cat_id
                else:
                    transfer_cat_id = None

                desc_lower = (attrs.get("description", "") or "").lower()
                is_interest = direction == "in" and not is_internal and any(
                    kw in desc_lower for kw in ("interest", "interest payment", "savings interest")
                )

                db.add(models.Transaction(
                    entity_id=body.entity_id,
                    account_id=local_account.id,
                    date=txn_date,
                    amount_cents=amount_cents,
                    direction=direction,
                    description=description,
                    source="up",
                    external_id=external_id,
                    category_id=transfer_cat_id,
                    income_type="interest" if is_interest else None,
                ))
                imported += 1

            # Pagination
            next_link = payload.get("links", {}).get("next")
            url = next_link if next_link else None
            params = {}  # params already in the next URL

        db.commit()

    # Refresh account balances from UP
    try:
        bal_resp = httpx.get(f"{UP_BASE}/accounts", headers=_up_headers(token), timeout=10)
        if bal_resp.is_success:
            for ua in bal_resp.json().get("data", []):
                up_id = ua["id"]
                raw = ua.get("attributes", {}).get("balance", {}).get("valueInBaseUnits", None)
                if raw is not None:
                    acct = db.query(models.Account).filter_by(up_account_id=up_id).first()
                    if acct:
                        acct.balance_cents = raw
            db.commit()
    except Exception:
        pass  # balance refresh is best-effort; don't fail the sync

    return {
        "imported": imported,
        "skipped": skipped,
        "pending": pending,
    }
