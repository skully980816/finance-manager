from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
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
    return q.order_by(models.Invoice.created_at.desc()).all()


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
