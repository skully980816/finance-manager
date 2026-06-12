"""Generic CSV importer with a column-mapping config and duplicate detection."""
import csv
import hashlib
import io
from datetime import datetime
from typing import Optional

from dateutil import parser as dateparser
from sqlalchemy.orm import Session

from .. import models
from .rules_engine import apply_rules


def _parse_amount(raw: str) -> int:
    """Return cents (always positive). Handles $, commas, parentheses, signs."""
    if raw is None:
        return 0
    s = str(raw).strip().replace("$", "").replace(",", "")
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if not s:
        return 0
    val = abs(float(s))
    return int(round(val * 100))


def _row_hash(entity_id: int, d: str, amount: int, desc: str) -> str:
    return hashlib.sha256(f"{entity_id}|{d}|{amount}|{desc}".encode()).hexdigest()[:32]


def import_csv(
    db: Session,
    entity_id: int,
    account_id: Optional[int],
    content: bytes,
    mapping: dict,
) -> dict:
    """mapping example:
    {
      "date": "Date", "description": "Description",
      "amount": "Amount",                 # single signed column, OR
      "debit": "Debit", "credit": "Credit",  # split columns
      "date_format": null                 # optional explicit strptime fmt
    }
    """
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    created, skipped = 0, 0
    date_fmt = mapping.get("date_format")

    for row in reader:
        raw_date = row.get(mapping.get("date", ""), "")
        desc = row.get(mapping.get("description", ""), "") or ""
        try:
            d = (datetime.strptime(raw_date, date_fmt).date() if date_fmt
                 else dateparser.parse(raw_date, dayfirst=True).date())
        except Exception:
            skipped += 1
            continue

        if mapping.get("amount"):
            raw_amt = row.get(mapping["amount"], "0") or "0"
            cents = _parse_amount(raw_amt)
            signed = str(raw_amt).strip()
            direction = "out" if (signed.startswith("-") or "(" in signed) else "in"
        else:
            debit = _parse_amount(row.get(mapping.get("debit", ""), "0"))
            credit = _parse_amount(row.get(mapping.get("credit", ""), "0"))
            if debit:
                cents, direction = debit, "out"
            else:
                cents, direction = credit, "in"

        if cents == 0:
            skipped += 1
            continue

        ext = _row_hash(entity_id, str(d), cents, desc)
        exists = db.query(models.Transaction).filter_by(external_id=ext).first()
        if exists:
            skipped += 1
            continue

        tx = models.Transaction(
            entity_id=entity_id,
            account_id=account_id,
            date=d,
            amount_cents=cents,
            direction=direction,
            description=desc.strip(),
            source="csv",
            external_id=ext,
        )
        apply_rules(db, tx)
        db.add(tx)
        created += 1

    db.commit()
    return {"created": created, "skipped": skipped}
