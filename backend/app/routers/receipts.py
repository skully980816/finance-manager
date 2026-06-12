import os
import uuid
from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import get_settings
from ..database import get_db
from ..services.ocr import ocr_image

router = APIRouter(prefix="/api/receipts", tags=["receipts"])
settings = get_settings()


@router.get("", response_model=list[schemas.ReceiptOut])
def list_receipts(db: Session = Depends(get_db)):
    return db.query(models.Receipt).order_by(models.Receipt.created_at.desc()).all()


@router.post("", response_model=schemas.ReceiptOut)
async def upload_receipt(file: UploadFile = File(...), db: Session = Depends(get_db)):
    os.makedirs(settings.upload_dir, exist_ok=True)
    content = await file.read()
    ext = os.path.splitext(file.filename or "")[1] or ".bin"
    name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(settings.upload_dir, name)
    with open(path, "wb") as f:
        f.write(content)

    parsed = ocr_image(content, file.content_type or "application/octet-stream")
    receipt = models.Receipt(file_path=path, **parsed)
    db.add(receipt); db.commit(); db.refresh(receipt)
    return receipt
