from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.recurring_detector import detect_and_mark

# Monthly multiplier for each frequency
FREQ_TO_MONTHLY = {
    "weekly":      52 / 12,
    "fortnightly": 26 / 12,
    "monthly":     1.0,
    "quarterly":   1 / 3,
    "annual":      1 / 12,
}

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


@router.get("", response_model=list[schemas.TransactionOut])
def list_transactions(
    entity_id: int | None = None,
    direction: str | None = None,
    deductible: bool | None = None,
    start: date | None = None,
    end: date | None = None,
    limit: int = 500,
    db: Session = Depends(get_db),
):
    q = db.query(models.Transaction)
    if entity_id:
        q = q.filter_by(entity_id=entity_id)
    if direction:
        q = q.filter_by(direction=direction)
    if deductible is not None:
        q = q.filter_by(is_deductible=deductible)
    if start:
        q = q.filter(models.Transaction.date >= start)
    if end:
        q = q.filter(models.Transaction.date <= end)
    return q.order_by(models.Transaction.date.desc()).limit(limit).all()


@router.post("", response_model=schemas.TransactionOut)
def create_transaction(body: schemas.TransactionIn, db: Session = Depends(get_db)):
    tx = models.Transaction(**body.model_dump())
    db.add(tx); db.commit(); db.refresh(tx)
    return tx


@router.post("/drawing")
def pay_yourself(body: dict, db: Session = Depends(get_db)):
    """Record a drawing: money paid from a business to your personal account.

    Body: {from_entity_id, to_entity_id, amount_cents, date?, description?}
    Creates an outflow on the business and a matching personal `drawing` inflow.
    Only the drawing counts toward personal income / available-to-spend.
    """
    from_id = int(body["from_entity_id"])
    to_id = int(body["to_entity_id"])
    cents = int(body["amount_cents"])
    when = body.get("date") or str(date.today())
    when = date.fromisoformat(when) if isinstance(when, str) else when
    label = body.get("description") or "Owner drawing"

    biz = db.get(models.Entity, from_id)
    personal = db.get(models.Entity, to_id)
    if not biz or not personal:
        raise HTTPException(404, "Entity not found")
    if cents <= 0:
        raise HTTPException(400, "Amount must be positive")

    out_tx = models.Transaction(
        entity_id=from_id, date=when, amount_cents=cents, direction="out",
        description=f"{label} → {personal.name}", income_type="drawing", source="manual",
    )
    in_tx = models.Transaction(
        entity_id=to_id, date=when, amount_cents=cents, direction="in",
        description=f"{label} from {biz.name}", income_type="drawing", source="manual",
    )
    db.add_all([out_tx, in_tx]); db.commit()
    return {"ok": True, "drawn_cents": cents}


@router.patch("/{tx_id}", response_model=schemas.TransactionOut)
def update_transaction(tx_id: int, body: schemas.TransactionIn, db: Session = Depends(get_db)):
    tx = db.get(models.Transaction, tx_id)
    if not tx:
        raise HTTPException(404, "Transaction not found")
    for k, v in body.model_dump().items():
        setattr(tx, k, v)
    db.commit(); db.refresh(tx)
    return tx


class RecurringPatch(BaseModel):
    is_recurring: bool
    recurrence_freq: Optional[str] = None


@router.patch("/{tx_id}/category")
def set_category(tx_id: int, body: dict, db: Session = Depends(get_db)):
    tx = db.get(models.Transaction, tx_id)
    if not tx:
        raise HTTPException(404, "Transaction not found")
    tx.category_id = body.get("category_id") or None
    db.commit()
    return {"id": tx.id, "category_id": tx.category_id}


@router.patch("/{tx_id}/deductible")
def set_deductible(tx_id: int, body: dict, db: Session = Depends(get_db)):
    tx = db.get(models.Transaction, tx_id)
    if not tx:
        raise HTTPException(404, "Transaction not found")
    tx.is_deductible = bool(body.get("is_deductible"))
    db.commit()
    return {"id": tx.id, "is_deductible": tx.is_deductible}


@router.patch("/{tx_id}/recurring", response_model=schemas.TransactionOut)
def set_recurring(tx_id: int, body: RecurringPatch, db: Session = Depends(get_db)):
    tx = db.get(models.Transaction, tx_id)
    if not tx:
        raise HTTPException(404, "Transaction not found")
    tx.is_recurring = body.is_recurring
    tx.recurrence_freq = body.recurrence_freq if body.is_recurring else None

    if not body.is_recurring:
        # User explicitly removed this — lock the whole description group so
        # the auto-detector never re-adds it
        desc = (tx.description or "").strip().lower()
        if desc:
            siblings = db.query(models.Transaction).filter(
                models.Transaction.description.ilike(desc)
            ).all()
            for s in siblings:
                s.is_recurring = False
                s.recurrence_freq = None
                s.recurring_override = True
    else:
        # User manually re-enabled — clear the override
        tx.recurring_override = False

    db.commit(); db.refresh(tx)
    return tx


class CategoriseIn(BaseModel):
    description: str
    category_id: int
    entity_id: Optional[int] = None


@router.post("/categorise")
def categorise_by_description(body: CategoriseIn, db: Session = Depends(get_db)):
    """Assign a category to every transaction (past + future) matching a description.

    Also upserts a Rule so future syncs apply the same category automatically.
    """
    cat = db.get(models.Category, body.category_id)
    if not cat:
        raise HTTPException(404, "Category not found")

    desc_lower = body.description.strip().lower()
    q = db.query(models.Transaction).filter(
        models.Transaction.description.ilike(f"%{desc_lower}%")
    )
    if body.entity_id:
        q = q.filter_by(entity_id=body.entity_id)

    updated = 0
    for tx in q.all():
        if tx.category_id != body.category_id:
            tx.category_id = body.category_id
            updated += 1

    # Upsert a rule so future imports are categorised automatically
    existing_rule = db.query(models.Rule).filter_by(
        match_field="description", match_op="contains", match_value=desc_lower
    ).first()
    if existing_rule:
        existing_rule.set_category_id = body.category_id
    else:
        db.add(models.Rule(
            match_field="description",
            match_op="contains",
            match_value=desc_lower,
            set_category_id=body.category_id,
            priority=5,  # high priority — user-defined rules run before auto rules
        ))

    db.commit()
    return {"updated": updated, "category": cat.name, "rule_created": existing_rule is None}


@router.post("/detect-recurring")
def detect_recurring(entity_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Scan transaction history and auto-mark recurring patterns."""
    result = detect_and_mark(db, entity_id=entity_id)
    return result


@router.get("/recurring")
def list_recurring(entity_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Return all recurring expenses grouped by description with projected monthly cost."""
    q = db.query(models.Transaction).filter(
        models.Transaction.is_recurring == True,  # noqa: E712
        models.Transaction.direction == "out",
    )
    if entity_id:
        q = q.filter_by(entity_id=entity_id)
    txns = q.order_by(models.Transaction.date.desc()).all()

    cat_names = {c.id: c.name for c in db.query(models.Category).all()}

    # Group by description — keep the latest occurrence as representative
    seen: dict[str, dict] = {}
    for tx in txns:
        key = (tx.description or "").strip().lower()
        if key not in seen:
            freq = tx.recurrence_freq or "monthly"
            monthly = tx.amount_cents * FREQ_TO_MONTHLY.get(freq, 1.0)
            seen[key] = {
                "id": tx.id,
                "description": tx.description,
                "amount_cents": tx.amount_cents,
                "recurrence_freq": tx.recurrence_freq,
                "monthly_cents": int(round(monthly)),
                "category": cat_names.get(tx.category_id, "Uncategorised"),
                "last_date": str(tx.date),
                "entity_id": tx.entity_id,
                "source": tx.source,
            }

    items = sorted(seen.values(), key=lambda x: -x["monthly_cents"])
    total_monthly = sum(i["monthly_cents"] for i in items)
    return {
        "items": items,
        "total_monthly_cents": total_monthly,
        "total_annual_cents": int(round(total_monthly * 12)),
    }


@router.delete("/{tx_id}")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    tx = db.get(models.Transaction, tx_id)
    if not tx:
        raise HTTPException(404, "Transaction not found")
    db.delete(tx); db.commit()
    return {"ok": True}
