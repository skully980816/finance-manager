from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import stripe_service

router = APIRouter(prefix="/api/invoices", tags=["invoices"])

GST_RATE = 0.10


def _next_number(db: Session, entity_id: int) -> str:
    count = db.query(models.Invoice).filter_by(entity_id=entity_id).count()
    return f"INV-{entity_id:02d}-{count + 1:04d}"


def _recalc(invoice: models.Invoice, entity: models.Entity):
    subtotal = sum(int(round(l.unit_cents * l.qty)) for l in invoice.lines)
    gst = 0
    if entity.gst_registered:
        gst = sum(
            int(round(l.unit_cents * l.qty * GST_RATE))
            for l in invoice.lines if l.gst_applicable
        )
    invoice.subtotal_cents = subtotal
    invoice.gst_cents = gst
    invoice.total_cents = subtotal + gst


@router.get("", response_model=list[schemas.InvoiceOut])
def list_invoices(entity_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.Invoice)
    if entity_id:
        q = q.filter_by(entity_id=entity_id)
    invs = q.order_by(models.Invoice.created_at.desc()).all()
    # Auto-mark overdue
    today = date.today()
    changed = False
    for inv in invs:
        if inv.status not in ("paid", "overdue") and inv.due_date and inv.due_date < today:
            inv.status = "overdue"
            changed = True
    if changed:
        db.commit()
    return invs


@router.get("/{inv_id}", response_model=schemas.InvoiceOut)
def get_invoice(inv_id: int, db: Session = Depends(get_db)):
    inv = db.get(models.Invoice, inv_id)
    if not inv:
        raise HTTPException(404, "Not found")
    return inv


@router.post("", response_model=schemas.InvoiceOut)
def create_invoice(body: schemas.InvoiceIn, db: Session = Depends(get_db)):
    entity = db.get(models.Entity, body.entity_id)
    if not entity:
        raise HTTPException(404, "Entity not found")
    inv = models.Invoice(
        entity_id=body.entity_id,
        client_id=body.client_id,
        number=body.number or _next_number(db, body.entity_id),
        issue_date=body.issue_date or date.today(),
        due_date=body.due_date or (date.today() + timedelta(days=entity.payment_terms_days or 30)),
        notes=body.notes,
        deposit_cents=body.deposit_cents,
        deposit_pct=body.deposit_pct,
        reminder_freq=body.reminder_freq,
    )
    inv.lines = [models.InvoiceLine(**l.model_dump()) for l in body.lines]
    _recalc(inv, entity)
    db.add(inv); db.commit(); db.refresh(inv)
    return inv


@router.post("/{inv_id}/send", response_model=schemas.InvoiceOut)
def send_invoice(inv_id: int, db: Session = Depends(get_db)):
    inv = db.get(models.Invoice, inv_id)
    if not inv:
        raise HTTPException(404, "Not found")
    client = db.get(models.Client, inv.client_id) if inv.client_id else None
    entity = db.get(models.Entity, inv.entity_id)
    result = stripe_service.create_and_send_invoice(inv, client, entity)
    inv.stripe_invoice_id = result.get("stripe_invoice_id")
    inv.hosted_url = result.get("hosted_url")
    inv.status = result.get("status", "sent")
    db.commit(); db.refresh(inv)
    return inv


@router.post("/{inv_id}/mark-paid", response_model=schemas.InvoiceOut)
def mark_paid(inv_id: int, db: Session = Depends(get_db)):
    inv = db.get(models.Invoice, inv_id)
    if not inv:
        raise HTTPException(404, "Not found")
    _mark_invoice_paid(db, inv)
    db.commit(); db.refresh(inv)
    return inv


def _mark_invoice_paid(db: Session, inv: models.Invoice):
    """Mark paid and create the income transaction (reconciliation)."""
    if inv.status == "paid":
        return
    inv.status = "paid"
    db.add(models.Transaction(
        entity_id=inv.entity_id,
        date=date.today(),
        amount_cents=inv.total_cents,
        direction="in",
        description=f"Invoice {inv.number} paid",
        income_type="business",
        gst_cents=inv.gst_cents,
        source="stripe" if inv.stripe_invoice_id else "manual",
        external_id=f"invoice-{inv.id}",
    ))


@router.post("/{inv_id}/convert-to-invoice", response_model=schemas.InvoiceOut)
def convert_to_invoice(inv_id: int, db: Session = Depends(get_db)):
    """Convert a quote to an invoice."""
    inv = db.get(models.Invoice, inv_id)
    if not inv:
        raise HTTPException(404, "Not found")
    if inv.document_type != "quote":
        raise HTTPException(400, "Already an invoice")
    inv.document_type = "invoice"
    inv.status = "draft"
    # Assign a proper invoice number
    entity = db.get(models.Entity, inv.entity_id)
    count = db.query(models.Invoice).filter_by(entity_id=inv.entity_id, document_type="invoice").count()
    inv.number = f"INV-{inv.entity_id:02d}-{count:04d}"
    db.commit(); db.refresh(inv)
    return inv


class PaymentIn(BaseModel):
    amount_cents: int


@router.post("/{inv_id}/payment", response_model=schemas.InvoiceOut)
def record_payment(inv_id: int, body: PaymentIn, db: Session = Depends(get_db)):
    """Record a (partial) payment against an invoice."""
    inv = db.get(models.Invoice, inv_id)
    if not inv:
        raise HTTPException(404, "Not found")
    inv.amount_paid_cents = (inv.amount_paid_cents or 0) + body.amount_cents
    if inv.amount_paid_cents >= inv.total_cents:
        inv.amount_paid_cents = inv.total_cents
        _mark_invoice_paid(db, inv)
    else:
        inv.status = "partial"
    db.commit(); db.refresh(inv)
    return inv


@router.delete("/{inv_id}", response_model=dict)
def delete_invoice(inv_id: int, db: Session = Depends(get_db)):
    inv = db.get(models.Invoice, inv_id)
    if not inv:
        raise HTTPException(404, "Not found")
    db.delete(inv); db.commit()
    return {"ok": True}


@router.get("/{inv_id}/print", response_class=HTMLResponse)
def print_invoice(inv_id: int, db: Session = Depends(get_db)):
    """Return a print-ready HTML page for the invoice/quote."""
    inv = db.get(models.Invoice, inv_id)
    if not inv:
        raise HTTPException(404, "Not found")
    entity = db.get(models.Entity, inv.entity_id)
    client = db.get(models.Client, inv.client_id) if inv.client_id else None

    doc_label = "QUOTE" if inv.document_type == "quote" else "INVOICE"
    lines_html = "".join(
        f"""<tr>
            <td style="padding:8px 0;border-bottom:1px solid #eee">{l.description}</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center">{l.qty}</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${l.unit_cents/100:,.2f}</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${l.unit_cents*l.qty/100:,.2f}</td>
        </tr>"""
        for l in inv.lines
    )
    gst_row = f'<tr><td colspan="3" style="text-align:right;padding:6px 0;color:#666">GST (10%)</td><td style="text-align:right;padding:6px 0">${inv.gst_cents/100:,.2f}</td></tr>' if inv.gst_cents else ""
    balance = inv.total_cents - (inv.amount_paid_cents or 0)

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{doc_label} {inv.number}</title>
<style>
  body{{font-family:Arial,sans-serif;color:#222;margin:0;padding:40px;max-width:800px;margin:auto}}
  h1{{font-size:2.5rem;font-weight:700;color:#111;margin:0}}
  .meta{{color:#666;font-size:0.9rem}}
  table{{width:100%;border-collapse:collapse;margin-top:24px}}
  th{{text-align:left;padding:8px 0;border-bottom:2px solid #222;font-size:0.85rem;text-transform:uppercase;letter-spacing:.05em}}
  .totals td{{padding:4px 0}}
  @media print{{body{{padding:20px}}button{{display:none}}}}
</style>
</head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px">
  <div>
    <h1>{doc_label}</h1>
    <div class="meta" style="margin-top:8px">
      <strong>{entity.name if entity else ""}</strong><br>
      {f"ABN: {entity.abn}<br>" if entity and entity.abn else ""}
      {(entity.address or "").replace(chr(10),"<br>") if entity else ""}<br>
      {entity.email or "" if entity else ""}
      {f" · {entity.phone}" if entity and entity.phone else ""}
    </div>
  </div>
  <div style="text-align:right">
    <div style="font-size:1.1rem;font-weight:600">{inv.number}</div>
    <div class="meta">Issued: {inv.issue_date}</div>
    {f'<div class="meta">Due: {inv.due_date}</div>' if inv.due_date else ""}
    <div style="margin-top:8px;padding:4px 12px;background:#f5f5f5;border-radius:4px;display:inline-block;text-transform:uppercase;font-size:0.8rem;font-weight:600">{inv.status}</div>
  </div>
</div>

{f'''<div style="margin-bottom:24px">
  <div class="meta" style="font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Bill To</div>
  <strong>{client.name}</strong><br>
  {client.address or ""}<br>{client.email or ""}{f" · {client.phone}" if client.phone else ""}
</div>''' if client else ""}

<table>
  <thead><tr>
    <th style="width:55%">Description</th>
    <th style="width:10%;text-align:center">Qty</th>
    <th style="width:17%;text-align:right">Unit Price</th>
    <th style="width:18%;text-align:right">Amount</th>
  </tr></thead>
  <tbody>{lines_html}</tbody>
</table>

<div style="display:flex;justify-content:flex-end;margin-top:16px">
  <table class="totals" style="width:260px">
    <tr><td style="color:#666">Subtotal</td><td style="text-align:right">${inv.subtotal_cents/100:,.2f}</td></tr>
    {gst_row}
    <tr><td style="font-weight:700;font-size:1.1rem;padding-top:8px;border-top:2px solid #222">Total</td>
        <td style="font-weight:700;font-size:1.1rem;text-align:right;padding-top:8px;border-top:2px solid #222">${inv.total_cents/100:,.2f}</td></tr>
    {f'<tr><td style="color:#666">Paid</td><td style="text-align:right;color:green">-${inv.amount_paid_cents/100:,.2f}</td></tr><tr><td style="font-weight:700">Balance Due</td><td style="text-align:right;font-weight:700">${balance/100:,.2f}</td></tr>' if inv.amount_paid_cents else ""}
  </table>
</div>

{f'<div style="margin-top:32px;padding:16px;background:#f9f9f9;border-radius:6px"><strong>Payment Details</strong><br>{entity.bank_name or ""} · BSB {entity.bsb or ""} · Account {entity.bank_account_number or ""}<br>Account name: {entity.bank_account_name or ""}</div>' if entity and entity.bank_account_number else ""}
{f'<div style="margin-top:16px;color:#666;font-size:0.9rem">{inv.notes}</div>' if inv.notes else ""}
{f'<div style="margin-top:16px;color:#888;font-size:0.8rem;border-top:1px solid #eee;padding-top:12px">{entity.invoice_footer}</div>' if entity and entity.invoice_footer else ""}

<div style="margin-top:32px;text-align:center">
  <button onclick="window.print()" style="padding:10px 24px;background:#222;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:1rem">Print / Save as PDF</button>
</div>
</body></html>"""
    return HTMLResponse(content=html)


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe_service.parse_webhook(payload, sig)
    except Exception as e:
        raise HTTPException(400, f"Invalid webhook: {e}")

    if event["type"] in ("invoice.paid", "invoice.payment_succeeded"):
        sid = event["data"]["object"]["id"]
        inv = db.query(models.Invoice).filter_by(stripe_invoice_id=sid).first()
        if inv:
            _mark_invoice_paid(db, inv)
            db.commit()
    return {"received": True}
