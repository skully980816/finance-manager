"""SQLAlchemy models. All money is stored as integer cents."""
from datetime import date, datetime

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text,
)
from sqlalchemy.orm import relationship

from .database import Base


class Entity(Base):
    __tablename__ = "entities"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)          # personal | sole_trader | company
    kind = Column(String, default="business")      # personal | business
    gst_registered = Column(Boolean, default=False)
    abn = Column(String, nullable=True)
    tax_rate_default = Column(Float, nullable=True)  # override global default
    # Business profile (entered once, auto-added to invoices)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    bank_name = Column(String, nullable=True)
    bsb = Column(String, nullable=True)
    bank_account_name = Column(String, nullable=True)
    bank_account_number = Column(String, nullable=True)
    payment_terms_days = Column(Integer, default=30)
    invoice_footer = Column(Text, nullable=True)
    up_api_token = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    accounts = relationship("Account", back_populates="entity")
    transactions = relationship("Transaction", back_populates="entity")

    @property
    def up_connected(self) -> bool:
        return bool(self.up_api_token)


class Account(Base):
    __tablename__ = "accounts"
    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id"), nullable=False)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)   # bank | card | cash | stripe | investment
    balance_cents = Column(Integer, default=0)
    up_account_id = Column(String, nullable=True)  # UP Banking account ID
    created_at = Column(DateTime, default=datetime.utcnow)

    entity = relationship("Entity", back_populates="accounts")
    transactions = relationship("Transaction", back_populates="account")


class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id"), nullable=True)  # null = global
    name = Column(String, nullable=False)
    kind = Column(String, nullable=False)   # income | expense
    ato_deduction_category = Column(String, nullable=True)


class Rule(Base):
    """Auto-categorisation: if <field> <op> <value> then set category/entity."""
    __tablename__ = "rules"
    id = Column(Integer, primary_key=True)
    match_field = Column(String, default="description")  # description | amount
    match_op = Column(String, default="contains")        # contains | equals | gt | lt
    match_value = Column(String, nullable=False)
    set_category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    set_entity_id = Column(Integer, ForeignKey("entities.id"), nullable=True)
    set_deductible = Column(Boolean, nullable=True)
    priority = Column(Integer, default=100)


class Receipt(Base):
    __tablename__ = "receipts"
    id = Column(Integer, primary_key=True)
    file_path = Column(String, nullable=False)
    ocr_vendor = Column(String, nullable=True)
    ocr_date = Column(Date, nullable=True)
    ocr_total_cents = Column(Integer, nullable=True)
    ocr_gst_cents = Column(Integer, nullable=True)
    ocr_raw = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    date = Column(Date, nullable=False, default=date.today)
    amount_cents = Column(Integer, nullable=False)   # always positive
    direction = Column(String, nullable=False)       # in | out
    description = Column(String, nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    # income classification for tax engine:
    income_type = Column(String, nullable=True)      # payroll | business | interest | dividend | capital_gain
    tax_withheld_cents = Column(Integer, default=0)  # from payslips
    gst_cents = Column(Integer, default=0)
    is_deductible = Column(Boolean, default=False)
    business_use_pct = Column(Integer, default=100)
    source = Column(String, default="manual")        # manual | csv | stripe | basiq
    external_id = Column(String, nullable=True)      # dedupe key
    is_recurring = Column(Boolean, default=False)
    recurrence_freq = Column(String, nullable=True)  # weekly|fortnightly|monthly|quarterly|annual
    recurring_override = Column(Boolean, default=False)  # user explicitly said not recurring — detector won't touch
    receipt_id = Column(Integer, ForeignKey("receipts.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    entity = relationship("Entity", back_populates="transactions")
    account = relationship("Account", back_populates="transactions")
    category = relationship("Category")
    receipt = relationship("Receipt")


class Client(Base):
    __tablename__ = "clients"
    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id"), nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    address = Column(Text, nullable=True)


class Invoice(Base):
    __tablename__ = "invoices"
    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id"), nullable=False)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    number = Column(String, nullable=False)
    issue_date = Column(Date, default=date.today)
    due_date = Column(Date, nullable=True)
    status = Column(String, default="draft")  # draft|sent|viewed|paid|overdue
    subtotal_cents = Column(Integer, default=0)
    gst_cents = Column(Integer, default=0)
    total_cents = Column(Integer, default=0)
    stripe_invoice_id = Column(String, nullable=True)
    hosted_url = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    # Deposit: a fixed amount (deposit_cents) OR a percentage of the total
    # (deposit_pct, 0–100). UI enforces one or the other; deposit_due_cents
    # resolves whichever is set.
    deposit_cents = Column(Integer, nullable=True)
    deposit_pct = Column(Float, nullable=True)
    # How often to remind the client while unpaid: none|weekly|fortnightly|monthly
    reminder_freq = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    client = relationship("Client")
    lines = relationship("InvoiceLine", back_populates="invoice", cascade="all, delete-orphan")

    @property
    def deposit_due_cents(self) -> int:
        if self.deposit_cents:
            return min(self.deposit_cents, self.total_cents or 0)
        if self.deposit_pct:
            return int(round((self.total_cents or 0) * self.deposit_pct / 100))
        return 0


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"
    id = Column(Integer, primary_key=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    description = Column(String, nullable=False)
    qty = Column(Float, default=1)
    unit_cents = Column(Integer, default=0)
    gst_applicable = Column(Boolean, default=True)

    invoice = relationship("Invoice", back_populates="lines")


class Commitment(Base):
    """A recurring monthly fixed cost (rent, loan, subscription)."""
    __tablename__ = "commitments"
    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id"), nullable=True)  # null = personal/global
    name = Column(String, nullable=False)
    amount_cents = Column(Integer, default=0)   # per month
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Holding(Base):
    __tablename__ = "holdings"
    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("entities.id"), nullable=False)
    symbol = Column(String, nullable=False)
    qty = Column(Float, default=0)
    avg_cost_cents = Column(Integer, default=0)
    platform = Column(String, nullable=True)  # e.g. Raze


class CgtEvent(Base):
    __tablename__ = "cgt_events"
    id = Column(Integer, primary_key=True)
    holding_id = Column(Integer, ForeignKey("holdings.id"), nullable=True)
    entity_id = Column(Integer, ForeignKey("entities.id"), nullable=False)
    symbol = Column(String, nullable=True)
    date = Column(Date, default=date.today)
    qty = Column(Float, default=0)
    proceeds_cents = Column(Integer, default=0)
    cost_cents = Column(Integer, default=0)
    gain_cents = Column(Integer, default=0)
    discounted = Column(Boolean, default=False)  # held >12mo => 50% CGT discount


class NetWorthItem(Base):
    """A manually-tracked asset or liability for net-worth calculation.

    category drives whether it's an asset or a liability (see ASSET_CATEGORIES /
    LIABILITY_CATEGORIES in the networth router). Live bank balances are pulled
    separately from the accounts table, so they don't need entries here.
    """
    __tablename__ = "net_worth_items"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)  # bank|shares|crypto|vehicle|property|equipment|loan|credit_card|mortgage
    value_cents = Column(Integer, default=0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
