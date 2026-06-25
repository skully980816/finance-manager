from datetime import date
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- Entity ----
class EntityIn(BaseModel):
    name: str
    type: str
    kind: str = "business"
    gst_registered: bool = False
    abn: Optional[str] = None
    tax_rate_default: Optional[float] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    bank_name: Optional[str] = None
    bsb: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    payment_terms_days: int = 30
    invoice_footer: Optional[str] = None


class EntityOut(ORM, EntityIn):
    id: int
    up_connected: bool = False  # derived from Entity.up_connected property; token never serialised



# ---- Account ----
class AccountIn(BaseModel):
    entity_id: int
    name: str
    type: str
    balance_cents: int = 0


class AccountOut(ORM, AccountIn):
    id: int
    up_account_id: Optional[str] = None


# ---- Category ----
class CategoryIn(BaseModel):
    entity_id: Optional[int] = None
    name: str
    kind: str
    ato_deduction_category: Optional[str] = None


class CategoryOut(ORM, CategoryIn):
    id: int


# ---- Rule ----
class RuleIn(BaseModel):
    match_field: str = "description"
    match_op: str = "contains"
    match_value: str
    set_category_id: Optional[int] = None
    set_entity_id: Optional[int] = None
    set_deductible: Optional[bool] = None
    priority: int = 100


class RuleOut(ORM, RuleIn):
    id: int


# ---- Transaction ----
class TransactionIn(BaseModel):
    entity_id: int
    account_id: Optional[int] = None
    date: date
    amount_cents: int
    direction: str
    description: Optional[str] = None
    category_id: Optional[int] = None
    income_type: Optional[str] = None
    tax_withheld_cents: int = 0
    gst_cents: int = 0
    is_deductible: bool = False
    business_use_pct: int = 100
    source: str = "manual"
    external_id: Optional[str] = None
    receipt_id: Optional[int] = None
    is_recurring: bool = False
    recurrence_freq: Optional[str] = None  # weekly|fortnightly|monthly|quarterly|annual


class TransactionOut(ORM, TransactionIn):
    id: int


# ---- Receipt ----
class ReceiptOut(ORM):
    id: int
    file_path: str
    ocr_vendor: Optional[str] = None
    ocr_date: Optional[date] = None
    ocr_total_cents: Optional[int] = None
    ocr_gst_cents: Optional[int] = None


# ---- Client ----
class ClientIn(BaseModel):
    entity_id: int
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class ClientOut(ORM, ClientIn):
    id: int


# ---- Invoice ----
class InvoiceLineIn(BaseModel):
    description: str
    qty: float = 1
    unit_cents: int = 0
    gst_applicable: bool = True


class InvoiceLineOut(ORM, InvoiceLineIn):
    id: int


class InvoiceIn(BaseModel):
    entity_id: int
    client_id: Optional[int] = None
    number: Optional[str] = None
    issue_date: Optional[date] = None
    due_date: Optional[date] = None
    notes: Optional[str] = None
    deposit_cents: Optional[int] = None
    deposit_pct: Optional[float] = None
    reminder_freq: Optional[str] = None
    lines: List[InvoiceLineIn] = []


class InvoiceOut(ORM):
    id: int
    entity_id: int
    client_id: Optional[int] = None
    number: str
    issue_date: Optional[date] = None
    due_date: Optional[date] = None
    status: str
    subtotal_cents: int
    gst_cents: int
    total_cents: int
    deposit_cents: Optional[int] = None
    deposit_pct: Optional[float] = None
    deposit_due_cents: int = 0
    reminder_freq: Optional[str] = None
    stripe_invoice_id: Optional[str] = None
    hosted_url: Optional[str] = None
    notes: Optional[str] = None
    lines: List[InvoiceLineOut] = []


# ---- Commitments ----
class CommitmentIn(BaseModel):
    name: str
    amount_cents: int = 0
    entity_id: Optional[int] = None
    active: bool = True


class CommitmentOut(ORM, CommitmentIn):
    id: int


# ---- Holdings / CGT ----
class HoldingIn(BaseModel):
    entity_id: int
    symbol: str
    qty: float = 0
    avg_cost_cents: int = 0
    platform: Optional[str] = None


class HoldingOut(ORM, HoldingIn):
    id: int


class CgtEventIn(BaseModel):
    entity_id: int
    holding_id: Optional[int] = None
    symbol: Optional[str] = None
    date: date
    qty: float = 0
    proceeds_cents: int = 0
    cost_cents: int = 0
    discounted: bool = False


class CgtEventOut(ORM, CgtEventIn):
    id: int
    gain_cents: int


# ---- Net worth ----
class NetWorthItemIn(BaseModel):
    name: str
    category: str
    value_cents: int = 0
    notes: Optional[str] = None


class NetWorthItemOut(ORM, NetWorthItemIn):
    id: int
    kind: str = "asset"  # asset | liability (derived in the router)


class NetWorthGroup(BaseModel):
    category: str
    label: str
    kind: str
    total_cents: int
    items: List[NetWorthItemOut] = []


class NetWorthSummary(BaseModel):
    assets_cents: int
    liabilities_cents: int
    net_worth_cents: int
    bank_live_cents: int
    groups: List[NetWorthGroup] = []
