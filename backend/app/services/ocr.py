"""Receipt OCR.

If OCR_PROVIDER is configured (e.g. 'docai'), wire the cloud call here.
Otherwise a lightweight heuristic parser extracts vendor/date/total/GST from
plain text — useful for testing and for already-digital receipts.
"""
import re
from datetime import date
from typing import Optional

from dateutil import parser as dateparser

from ..config import get_settings

settings = get_settings()

_AMOUNT_RE = re.compile(r"(\d{1,3}(?:[,\d]{0,12})(?:\.\d{2}))")
_TOTAL_RE = re.compile(r"(?:total|amount due|grand total)\s*[:$]*\s*\$?([\d,]+\.\d{2})", re.I)
_GST_RE = re.compile(r"(?:gst|tax)\s*[:$]*\s*\$?([\d,]+\.\d{2})", re.I)


def _to_cents(s: str) -> int:
    return int(round(float(s.replace(",", "")) * 100))


def parse_text(text: str) -> dict:
    """Heuristic extraction from receipt text."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    vendor = lines[0] if lines else None

    total = None
    m = _TOTAL_RE.search(text)
    if m:
        total = _to_cents(m.group(1))
    else:
        amounts = [_to_cents(a) for a in _AMOUNT_RE.findall(text)]
        if amounts:
            total = max(amounts)

    gst = None
    g = _GST_RE.search(text)
    if g:
        gst = _to_cents(g.group(1))
    elif total:
        # AU GST is 1/11 of a GST-inclusive total
        gst = round(total / 11)

    parsed_date: Optional[date] = None
    for l in lines:
        try:
            parsed_date = dateparser.parse(l, dayfirst=True, fuzzy=True).date()
            break
        except Exception:
            continue

    return {
        "ocr_vendor": vendor,
        "ocr_date": parsed_date,
        "ocr_total_cents": total,
        "ocr_gst_cents": gst,
        "ocr_raw": text[:5000],
    }


def ocr_image(file_bytes: bytes, content_type: str) -> dict:
    """Run OCR on an uploaded receipt. Returns the same dict as parse_text."""
    provider = settings.ocr_provider.lower()
    if provider == "docai":
        return _docai(file_bytes, content_type)
    # No cloud OCR configured: try to treat upload as text, else return empty.
    try:
        text = file_bytes.decode("utf-8")
        return parse_text(text)
    except UnicodeDecodeError:
        return {
            "ocr_vendor": None, "ocr_date": None,
            "ocr_total_cents": None, "ocr_gst_cents": None,
            "ocr_raw": "(no OCR provider configured — set OCR_PROVIDER=docai and "
                       "DOC_AI_PROCESSOR to auto-extract from images/PDFs)",
        }


def _docai(file_bytes: bytes, content_type: str) -> dict:  # pragma: no cover
    """Google Document AI receipt processor. Requires google-cloud-documentai."""
    from google.cloud import documentai  # type: ignore

    client = documentai.DocumentProcessorServiceClient()
    raw = documentai.RawDocument(content=file_bytes, mime_type=content_type)
    req = documentai.ProcessRequest(name=settings.doc_ai_processor, raw_document=raw)
    result = client.process_document(request=req)
    return parse_text(result.document.text)
