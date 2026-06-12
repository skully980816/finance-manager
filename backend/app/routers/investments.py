from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api", tags=["investments"])


@router.get("/holdings", response_model=list[schemas.HoldingOut])
def list_holdings(entity_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.Holding)
    if entity_id:
        q = q.filter_by(entity_id=entity_id)
    return q.all()


@router.post("/holdings", response_model=schemas.HoldingOut)
def create_holding(body: schemas.HoldingIn, db: Session = Depends(get_db)):
    h = models.Holding(**body.model_dump())
    db.add(h); db.commit(); db.refresh(h)
    return h


@router.delete("/holdings/{hid}")
def delete_holding(hid: int, db: Session = Depends(get_db)):
    h = db.get(models.Holding, hid)
    if not h:
        raise HTTPException(404, "Not found")
    db.delete(h); db.commit()
    return {"ok": True}


@router.get("/cgt-events", response_model=list[schemas.CgtEventOut])
def list_cgt(entity_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.CgtEvent)
    if entity_id:
        q = q.filter_by(entity_id=entity_id)
    return q.order_by(models.CgtEvent.date.desc()).all()


@router.post("/cgt-events", response_model=schemas.CgtEventOut)
def create_cgt(body: schemas.CgtEventIn, db: Session = Depends(get_db)):
    gain = body.proceeds_cents - body.cost_cents
    ev = models.CgtEvent(**body.model_dump(), gain_cents=gain)
    db.add(ev); db.commit(); db.refresh(ev)
    return ev
