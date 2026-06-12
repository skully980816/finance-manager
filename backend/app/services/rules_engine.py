"""Apply auto-categorisation rules to a transaction (in place, uncommitted)."""
from sqlalchemy.orm import Session

from .. import models


def apply_rules(db: Session, tx: models.Transaction) -> None:
    rules = db.query(models.Rule).order_by(models.Rule.priority.asc()).all()
    desc = (tx.description or "").lower()
    for r in rules:
        matched = False
        if r.match_field == "description":
            v = r.match_value.lower()
            if r.match_op == "contains":
                matched = v in desc
            elif r.match_op == "equals":
                matched = v == desc
        elif r.match_field == "amount":
            try:
                target = float(r.match_value)
            except ValueError:
                continue
            amt = tx.amount_cents / 100
            matched = (
                (r.match_op == "gt" and amt > target)
                or (r.match_op == "lt" and amt < target)
                or (r.match_op == "equals" and amt == target)
            )
        if matched:
            if r.set_category_id is not None:
                tx.category_id = r.set_category_id
            if r.set_entity_id is not None:
                tx.entity_id = r.set_entity_id
            if r.set_deductible is not None:
                tx.is_deductible = r.set_deductible
            return  # first match wins (lowest priority number)
