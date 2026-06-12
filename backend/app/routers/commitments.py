from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/commitments", tags=["commitments"])


@router.get("", response_model=list[schemas.CommitmentOut])
def list_commitments(db: Session = Depends(get_db)):
    return db.query(models.Commitment).order_by(models.Commitment.amount_cents.desc()).all()


@router.post("", response_model=schemas.CommitmentOut)
def create_commitment(body: schemas.CommitmentIn, db: Session = Depends(get_db)):
    c = models.Commitment(**body.model_dump())
    db.add(c); db.commit(); db.refresh(c)
    return c


@router.patch("/{cid}", response_model=schemas.CommitmentOut)
def update_commitment(cid: int, body: schemas.CommitmentIn, db: Session = Depends(get_db)):
    c = db.get(models.Commitment, cid)
    if not c:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit(); db.refresh(c)
    return c


@router.delete("/{cid}")
def delete_commitment(cid: int, db: Session = Depends(get_db)):
    c = db.get(models.Commitment, cid)
    if not c:
        raise HTTPException(404, "Not found")
    db.delete(c); db.commit()
    return {"ok": True}
