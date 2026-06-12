"""Seed demo data so the dashboard isn't empty. Run: python -m app.seed"""
from datetime import date, timedelta

from .database import Base, SessionLocal, engine
from . import models
from .tax import fy_bounds


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    if db.query(models.Entity).count() > 0:
        print("Data already exists; skipping seed.")
        return

    personal = models.Entity(name="Personal", type="personal", kind="personal", gst_registered=False)
    sole = models.Entity(name="Tristan (Sole Trader)", type="sole_trader", kind="business", gst_registered=False)
    db.add_all([personal, sole]); db.commit()
    for e in (personal, sole):
        db.refresh(e)

    bank = models.Account(entity_id=personal.id, name="Everyday Bank", type="bank")
    raze = models.Account(entity_id=personal.id, name="Raze", type="investment")
    sbank = models.Account(entity_id=sole.id, name="Sole Trader Bank", type="bank")
    db.add_all([bank, raze, sbank]); db.commit()

    cat_tools = models.Category(entity_id=sole.id, name="Tools & Equipment", kind="expense", ato_deduction_category="D5 Work-related tools")
    cat_office = models.Category(entity_id=sole.id, name="Home Office", kind="expense", ato_deduction_category="D5 Home office")
    cat_income = models.Category(entity_id=sole.id, name="Sole Trader Income", kind="income")
    db.add_all([cat_tools, cat_office, cat_income]); db.commit()

    start, _ = fy_bounds()
    d = start + timedelta(days=15)

    txs = [
        # Payroll (taxed) — casual + company payroll with PAYG withheld
        dict(entity_id=personal.id, account_id=bank.id, date=d, amount_cents=320000,
             direction="in", description="Casual job pay", income_type="payroll", tax_withheld_cents=72000),
        dict(entity_id=personal.id, account_id=bank.id, date=d + timedelta(days=30), amount_cents=550000,
             direction="in", description="Company payroll", income_type="payroll", tax_withheld_cents=150000),
        # Sole trader business income (gross — NOT personal until drawn)
        dict(entity_id=sole.id, account_id=sbank.id, date=d + timedelta(days=20), amount_cents=180000,
             direction="in", description="Freelance gig — client A", income_type="business"),
        dict(entity_id=sole.id, account_id=sbank.id, date=d + timedelta(days=50), amount_cents=240000,
             direction="in", description="Freelance gig — client B", income_type="business"),
        # Interest + dividends (personal, untaxed)
        dict(entity_id=personal.id, account_id=bank.id, date=d + timedelta(days=40), amount_cents=4200,
             direction="in", description="Savings interest", income_type="interest"),
        dict(entity_id=personal.id, account_id=raze.id, date=d + timedelta(days=45), amount_cents=8800,
             direction="in", description="Raze dividend", income_type="dividend"),
        # Sole trader drawing — money paid to your personal account (this IS personal income)
        dict(entity_id=sole.id, account_id=sbank.id, date=d + timedelta(days=55), amount_cents=150000,
             direction="out", description="Owner drawing → Personal", income_type="drawing"),
        dict(entity_id=personal.id, account_id=bank.id, date=d + timedelta(days=55), amount_cents=150000,
             direction="in", description="Owner drawing from Tristan (Sole Trader)", income_type="drawing"),
        # Sole trader deductible expenses
        dict(entity_id=sole.id, account_id=sbank.id, date=d + timedelta(days=10), amount_cents=49500,
             direction="out", description="Laptop stand + monitor", category_id=cat_tools.id,
             is_deductible=True, business_use_pct=100, gst_cents=4500),
        dict(entity_id=sole.id, account_id=sbank.id, date=d + timedelta(days=12), amount_cents=12000,
             direction="out", description="Internet (home office 60%)", category_id=cat_office.id,
             is_deductible=True, business_use_pct=60, gst_cents=1091),
        # Personal living expense
        dict(entity_id=personal.id, account_id=bank.id, date=d + timedelta(days=14), amount_cents=8500,
             direction="out", description="Groceries"),
    ]
    db.add_all([models.Transaction(**t) for t in txs]); db.commit()

    db.add(models.CgtEvent(entity_id=personal.id, symbol="VAS", date=d + timedelta(days=60),
                           qty=10, proceeds_cents=120000, cost_cents=90000, gain_cents=30000, discounted=True))
    db.commit()
    print("Seeded demo data: Personal + Sole Trader, with an example drawing.")


if __name__ == "__main__":
    run()
