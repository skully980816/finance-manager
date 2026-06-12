# Ledger — Finance Manager

Self-hosted personal + business finance manager. Tracks income across all
sources, captures receipts for tax deductions, generates Stripe invoices, and
tells you **how much you've made** and **how much is actually yours to spend
after tax & GST are set aside**.

Built for an AU two-entity setup: a **GST-registered company** and a
**sole trader (not GST-registered)** — plus payroll, interest, and stock
investments. Full spec in [`docs/PROJECT-SPEC.md`](docs/PROJECT-SPEC.md).

## What's built (all phases scaffolded)

- **Phase 1** — Entities, accounts, manual entry, **CSV import** (with column
  mapping + dedupe), categories, auto-categorisation **rules engine**, and a
  dashboard with the **tax set-aside engine** + GST tracking.
- **Phase 2** — Receipt upload + **OCR** (local heuristic, or Google Document AI
  when configured), deduction tagging with business-use %, EOFY **deduction
  report** grouped by ATO category.
- **Phase 3** — Invoice builder with per-entity GST logic, **Stripe** send +
  webhook reconciliation (falls back to local-only when no Stripe key).
- **Phase 4** — Holdings, **CGT events** (50% discount aware), interest/dividend
  income, and an EOFY **tax pack**.

## Quick start (local, zero-config SQLite)

### Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
copy .env.example .env          # then edit secrets
python -m app.seed              # demo data (optional)
uvicorn app.main:app --port 8077 --reload
```
API docs: http://127.0.0.1:8077/docs

### Frontend
```bash
cd frontend
npm install
npm run dev
```
App: http://localhost:3000

### Or everything via Docker (Postgres)
```bash
docker compose up --build
```

## Configuration (`backend/.env`)
- `DATABASE_URL` — SQLite by default; point at Postgres for prod.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — enables real Stripe invoicing.
- `OCR_PROVIDER=docai` + `DOC_AI_PROCESSOR` — enables cloud receipt OCR.
- `DEFAULT_TAX_RATE` — fallback flat set-aside rate.

## Tax notes
Set-aside uses an **incremental marginal** estimate (resident brackets +
Medicare levy) on untaxed income, or a flat rate if you pass `?flat_rate=`.
Brackets live in [`backend/app/tax.py`](backend/app/tax.py) — **update each FY**.
Estimates only; confirm with your accountant before lodging.

## Next up (not yet wired)
- Live bank feeds via **Basiq** (replaces CSV).
- PDF export of invoices & EOFY pack.
- Recurring-transaction detection, budgets, PWA receipt capture.
- Real auth/sessions before exposing beyond localhost.
