from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.get("", response_model=list[schemas.ClientOut])
def list_clients(entity_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.Client)
    if entity_id:
        q = q.filter_by(entity_id=entity_id)
    return q.all()


@router.post("", response_model=schemas.ClientOut)
def create_client(body: schemas.ClientIn, db: Session = Depends(get_db)):
    c = models.Client(**body.model_dump())
    db.add(c); db.commit(); db.refresh(c)
    return c


@router.delete("/{cid}")
def delete_client(cid: int, db: Session = Depends(get_db)):
    c = db.get(models.Client, cid)
    if not c:
        raise HTTPException(404, "Not found")
    db.delete(c); db.commit()
    return {"ok": True}
