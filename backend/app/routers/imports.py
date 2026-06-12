import json
from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.csv_import import import_csv

router = APIRouter(prefix="/api/import", tags=["import"])


@router.post("/csv")
async def import_csv_endpoint(
    entity_id: int = Form(...),
    account_id: int | None = Form(None),
    mapping: str = Form(...),  # JSON string
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    content = await file.read()
    mapping_dict = json.loads(mapping)
    return import_csv(db, entity_id, account_id, content, mapping_dict)
