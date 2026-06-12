from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/entities", tags=["entities"])


@router.get("", response_model=list[schemas.EntityOut])
def list_entities(db: Session = Depends(get_db)):
    return db.query(models.Entity).all()


@router.post("", response_model=schemas.EntityOut)
def create_entity(body: schemas.EntityIn, db: Session = Depends(get_db)):
    e = models.Entity(**body.model_dump())
    db.add(e); db.commit(); db.refresh(e)
    return e


@router.patch("/{entity_id}", response_model=schemas.EntityOut)
def update_entity(entity_id: int, body: schemas.EntityIn, db: Session = Depends(get_db)):
    e = db.get(models.Entity, entity_id)
    if not e:
        raise HTTPException(404, "Entity not found")
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    db.commit(); db.refresh(e)
    return e


@router.delete("/{entity_id}")
def delete_entity(entity_id: int, db: Session = Depends(get_db)):
    e = db.get(models.Entity, entity_id)
    if not e:
        raise HTTPException(404, "Entity not found")
    db.delete(e); db.commit()
    return {"ok": True}
