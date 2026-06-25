# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Ledger** is a self-hosted personal + business finance manager for an Australian two-entity setup (GST-registered company + sole trader). Full spec: `docs/PROJECT-SPEC.md`.

- Backend: FastAPI (Python) + SQLAlchemy, defaults to SQLite, supports Postgres
- Frontend: Next.js 15 App Router + TypeScript + Tailwind + Recharts + SWR

## Commands

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
cp .env.example .env  # edit secrets
python -m app.seed    # optional demo data
uvicorn app.main:app --port 8077 --reload
```
API docs: http://127.0.0.1:8077/docs

### Frontend
```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
npm run build
```

### Docker (Postgres)
```bash
docker compose up --build
```

## Architecture

### Backend (`backend/app/`)
- `main.py` — FastAPI app setup: CORS, auth (`/api/login`), router registration, SQLite lightweight migration, hourly UP Banking background sync
- `models.py` — SQLAlchemy ORM. **All money is stored as integer cents.**
- `schemas.py` — Pydantic request/response schemas
- `database.py` — engine + `SessionLocal` + `Base`
- `config.py` — settings via env vars (`get_settings()`)
- `tax.py` — AU marginal tax brackets + Medicare levy for set-aside calculations. **Update each FY.**
- `routers/` — one file per resource: `entities`, `accounts`, `transactions`, `categories`, `imports`, `receipts`, `clients`, `invoices`, `investments`, `dashboard`, `up_banking`, `commitments`, `networth`
- `services/` — `csv_import.py`, `ocr.py`, `rules_engine.py`, `recurring_detector.py`, `stripe_service.py`

Auth is a trivial single-password check returning a static token (set `APP_PASSWORD` and `SECRET_KEY` in `.env`). Not suitable for multi-user or public exposure.

Schema migrations for SQLite are handled inline in `main.py` via `_lightweight_migrate()` (ALTER TABLE). For Postgres, use Alembic.

### Frontend (`frontend/`)
- `app/` — Next.js App Router pages (one page per feature area)
- `components/` — shared UI components
- `lib/api.ts` — API client helpers
- `lib/entity-context.tsx` — global entity filter context. `useEntity()` returns `selected` (a business `id` or `"all"`). Use `withEntity(path, selected)` to append `?entity_id=` to API calls. Entity selection is **session-only** (never persisted to localStorage).

### Key domain concepts
- **Entity** — a legal entity (personal, sole_trader, company). `gst_registered` controls GST logic on invoices.
- **Account** — belongs to an entity; types: `bank | card | cash | stripe | investment`
- **Transaction** — all money in/out, linked to entity + account + optional category
- **Category** — `income | expense`; optional `ato_deduction_category` for EOFY reports
- **Rule** — auto-categorisation rule applied on import (field/op/value → category/entity/deductible)
- **Invoice** — generated per entity with GST-aware line items; optional Stripe send
- **Receipt** — uploaded image/PDF, OCR-extracted, linked to transactions for deduction tracking

### Optional integrations (env-configured)
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — real Stripe invoicing
- `OCR_PROVIDER=docai` + `DOC_AI_PROCESSOR` — Google Document AI for receipts (falls back to local heuristic)
- **UP Banking** — token stored per entity in `up_api_token`; syncs automatically every hour
