# Finance Manager — Project Spec

> Working product name: **Ledger** (rename anytime)
> Owner: Tristan · Created: 2026-06-11 · Region: Australia · FY: Jul–Jun

A self-hosted personal + business finance manager: tracks income across all
platforms, captures receipts for tax deductions, generates professional Stripe
invoices, and tells you **how much you've made** and **how much is actually
yours to spend after tax is set aside**.

---

## 1. Core principles

1. **Two entities, one app.** Every record belongs to an entity:
   - **Company** — GST-registered. Invoices add 10% GST; tracks GST collected &
     GST credits; BAS-aware.
   - **Personal (sole trader)** — *not* GST-registered. No GST on invoices, no
     GST credits. Also holds payroll, interest, and Raze investments.
2. **Honest "available to spend."** Sole-trader and business income arrives with
   *no tax withheld*. The app provisions an estimated tax set-aside so your
   spendable balance reflects money that's truly yours — not the ATO's.
3. **Tax-return ready.** Every deductible purchase is categorised, GST-split
   (where relevant), and exportable as an EOFY deduction report.
4. **Your data, your server.** Self-hosted, Postgres, encrypted secrets.

---

## 2. Income model (the heart of it)

| Source | Entity | Type | Tax withheld? | App treatment |
|---|---|---|---|---|
| Casual job | Personal | PAYG salary | Yes | Record gross + tax withheld from payslip |
| Company payroll | Personal | PAYG salary | Yes | Same |
| Sole-trader jobs | Personal | Business income | **No** | Provision income tax set-aside |
| Company jobs | Company | Business income (incl. GST) | **No** | Provision tax + GST collected |
| Interest | Personal | Investment | No | Declarable income |
| Raze (stocks) | Personal | Capital gains / dividends | No | Track CGT events + dividends |

**Tax set-aside engine:** configurable provisioning rate per income type.
Default: marginal-rate estimate on untaxed income (sole trader + interest +
company drawings). Company GST collected is held separately as a BAS liability.
The dashboard's headline number = balance − tax provision − GST owed.

---

## 3. Feature set

### Phase 1 — Foundations (MVP)
- Entities (Company / Personal) + accounts (bank, card, cash, Stripe, Raze).
- Manual transaction entry + **CSV import** (bank exports, payroll, Stripe).
  - Import mapper: remember column mappings per source.
  - Duplicate detection on re-import.
- Income & expense categorisation (rules engine: "if description contains X →
  category Y, entity Z").
- Dashboard v1: income this FY, expenses, net, **available-to-spend after tax
  set-aside**, by-source breakdown.

### Phase 2 — Receipts & deductions
- Receipt upload (image/PDF) with **OCR** → auto-extract vendor, date, total, GST.
- Attach receipt to a transaction; flag as deductible.
- Deduction fields: category (home office, tools, vehicle, travel, subscriptions,
  education…), business-use %, GST component.
- EOFY deduction report (PDF/CSV) grouped by ATO category, per entity.

### Phase 3 — Invoicing (Stripe)
- Invoice builder: client, line items, your branding, due date.
- GST logic per entity (Company adds 10%; Personal none).
- Push to Stripe → hosted payment link / Stripe-hosted invoice.
- Webhook reconciliation: invoice auto-marked paid + income transaction created.
- Statuses: draft / sent / viewed / paid / overdue; reminders.

### Phase 4 — Investments & intelligence
- Raze / stock tracking: holdings, dividends, realised CGT events (12-month
  discount aware).
- Interest income tracking per account.
- Cash-flow forecasting; "safe to spend this month".
- BAS helper for the company (GST collected − GST credits per quarter).
- EOFY tax pack: income by type, deductions, GST summary, CGT summary.

### Nice-to-haves / future
- Live bank feeds via **Basiq** (AU open banking) — replaces CSV grind.
- Recurring transactions & subscription detection.
- Multi-currency (if any overseas income).
- Mobile-friendly receipt capture (PWA).
- Budgets & savings goals.
- Accountant export (share read-only EOFY pack).

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind, dark theme | Matches your existing stack (Loopcraft) |
| Backend | FastAPI (Python) | Matches existing stack; great for Stripe/OCR SDKs |
| DB | **PostgreSQL** | Financial data needs relational integrity, transactions, decimals |
| ORM/migrations | SQLAlchemy + Alembic | Versioned schema for money data |
| Auth | Single-user JWT/session (it's just you) | Simple, secure |
| Money type | Integer cents + currency code | Never float for money |
| Payments | Stripe SDK + webhooks | Invoicing |
| OCR | Google Document AI *or* AWS Textract (receipt model) | Best receipt/GST extraction |
| Bank feed (later) | Basiq | AU open banking |
| Charts | Recharts / Tremor | Dashboards |
| Hosting | Self-hosted (Docker compose) | Data sovereignty |

---

## 5. Data model (initial)

```
Entity        (id, name, type[company|personal], gst_registered, abn, tax_rate_default)
Account       (id, entity_id, name, type[bank|card|cash|stripe|investment], balance_cents)
Transaction   (id, entity_id, account_id, date, amount_cents, direction[in|out],
               description, category_id, income_type, gst_cents, is_deductible,
               business_use_pct, source[manual|csv|stripe|basiq], external_id, receipt_id)
Category      (id, entity_id, name, kind[income|expense], ato_deduction_category)
Rule          (id, match_field, match_op, match_value, set_category_id, set_entity_id)
Receipt       (id, file_path, ocr_vendor, ocr_date, ocr_total_cents, ocr_gst_cents, ocr_raw)
Invoice       (id, entity_id, client_id, number, issue_date, due_date, status,
               subtotal_cents, gst_cents, total_cents, stripe_invoice_id)
InvoiceLine   (id, invoice_id, description, qty, unit_cents, gst_applicable)
Client        (id, entity_id, name, email, address)
Holding       (id, entity_id, symbol, qty, avg_cost_cents, platform)
CgtEvent      (id, holding_id, date, qty, proceeds_cents, cost_cents, gain_cents, discounted)
TaxProvision  (id, entity_id, period, rate, provisioned_cents)
```

Key rule: **all money stored as integer cents.** Decimal only at display.

---

## 6. Build roadmap

- **Phase 0** — Scaffold: repo, Docker (Postgres + API + web), auth, entities,
  base dark UI shell, health checks.
- **Phase 1** — Accounts, manual entry, CSV import + mapper, categories, rules,
  dashboard v1 with tax set-aside.
- **Phase 2** — Receipt upload + OCR, deduction tagging, EOFY deduction report.
- **Phase 3** — Stripe invoicing + webhook reconciliation.
- **Phase 4** — Investments/CGT, interest, BAS helper, forecasting, EOFY tax pack.
- **Later** — Basiq live feeds, recurring detection, PWA receipt capture.

---

## 7. Open questions / decisions to revisit
- Which banks do you use? (Determines CSV formats to support first; Up Bank has
  a clean API if you use it.)
- Does Raze offer any export/API, or is it manual entry for holdings?
- OCR provider preference (Google vs AWS) — affects cloud account setup.
- Do you want an accountant read-only export at EOFY?
- Confirm company structure (sole trader trading as, vs Pty Ltd) — affects how
  "company drawings" and tax are modelled.
