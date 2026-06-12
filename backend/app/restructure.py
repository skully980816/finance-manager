"""One-off: migrate the existing single-personal-entity DB into the
Personal + Sole Trader + Company (cash-basis) model. Idempotent.

Run: python -m app.restructure
"""
from .database import SessionLocal
from . import models


def run():
    db = SessionLocal()

    # Already restructured? (a personal-kind entity exists)
    if db.query(models.Entity).filter_by(kind="personal").first():
        print("Already restructured — nothing to do.")
        return

    # 1) Clean up test junk created during development.
    for junk in db.query(models.Entity).filter(models.Entity.name.like("Temp Test%")).all():
        db.query(models.Transaction).filter_by(entity_id=junk.id).delete()
        db.delete(junk)
    db.query(models.Invoice).filter(models.Invoice.number == "INV-01-0001").delete()

    # 2) Mark the company as a business.
    company = db.query(models.Entity).filter(models.Entity.type == "company").first()
    if company:
        company.kind = "business"
        company.gst_registered = True

    # 3) The existing "personal"-type entity is actually the sole-trader business.
    sole = db.query(models.Entity).filter(models.Entity.type == "personal").first()
    if not sole:
        print("No personal-type entity found; nothing to convert.")
        db.commit()
        return
    sole.type = "sole_trader"
    sole.kind = "business"
    sole.gst_registered = False
    if sole.name in ("Tristan (Sole Trader)", "Tristan Clements"):
        sole.name = "Tristan (Sole Trader)"

    # 4) Create the Personal (non-business) entity that holds your take-home money.
    personal = models.Entity(name="Personal", type="personal", kind="personal", gst_registered=False)
    db.add(personal)
    db.flush()  # get personal.id

    # 5) Move personally-received income + personal living expenses to Personal.
    moved = 0
    for t in db.query(models.Transaction).filter_by(entity_id=sole.id).all():
        personal_income = t.direction == "in" and t.income_type in ("payroll", "interest", "dividend")
        personal_expense = t.direction == "out" and not t.is_deductible
        if personal_income or personal_expense:
            t.entity_id = personal.id
            moved += 1

    # 6) Move investment/CGT to Personal.
    for ev in db.query(models.CgtEvent).filter_by(entity_id=sole.id).all():
        ev.entity_id = personal.id
    for h in db.query(models.Holding).filter_by(entity_id=sole.id).all():
        h.entity_id = personal.id

    db.commit()
    print(f"Restructured. Sole trader: '{sole.name}' (business). "
          f"Created 'Personal'. Moved {moved} transactions to Personal.")


if __name__ == "__main__":
    run()
