import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from datetime import date, timedelta

from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from .config import get_settings
from .database import Base, engine, SessionLocal
from . import models
from .routers import (
    entities, accounts, transactions, categories, imports,
    receipts, clients, invoices, investments, dashboard, up_banking, commitments,
    networth,
)

logger = logging.getLogger(__name__)

settings = get_settings()

# Create tables on startup (dev). For prod use Alembic migrations.
Base.metadata.create_all(bind=engine)


def _lightweight_migrate():
    """Add new columns to existing SQLite tables without dropping data."""
    if not engine.url.drivername.startswith("sqlite"):
        return
    insp = inspect(engine)
    existing_entities = {c["name"] for c in insp.get_columns("entities")}
    entity_additions = {
        "kind": "VARCHAR DEFAULT 'business'",
        "email": "VARCHAR", "phone": "VARCHAR", "address": "TEXT",
        "bank_name": "VARCHAR", "bsb": "VARCHAR", "bank_account_name": "VARCHAR",
        "bank_account_number": "VARCHAR", "payment_terms_days": "INTEGER DEFAULT 30",
        "invoice_footer": "TEXT", "up_api_token": "VARCHAR",
    }
    existing_accounts = {c["name"] for c in insp.get_columns("accounts")}
    account_additions = {
        "up_account_id": "VARCHAR",
    }
    existing_txns = {c["name"] for c in insp.get_columns("transactions")}
    txn_additions = {
        "is_recurring": "BOOLEAN DEFAULT 0",
        "recurrence_freq": "VARCHAR",
        "recurring_override": "BOOLEAN DEFAULT 0",
    }
    existing_clients = {c["name"] for c in insp.get_columns("clients")}
    client_additions = {
        "phone": "VARCHAR",
    }
    existing_invoices = {c["name"] for c in insp.get_columns("invoices")}
    invoice_additions = {
        "deposit_cents": "INTEGER",
        "deposit_pct": "FLOAT",
        "reminder_freq": "VARCHAR",
    }
    with engine.begin() as conn:
        for col, ddl in entity_additions.items():
            if col not in existing_entities:
                conn.execute(text(f"ALTER TABLE entities ADD COLUMN {col} {ddl}"))
        for col, ddl in account_additions.items():
            if col not in existing_accounts:
                conn.execute(text(f"ALTER TABLE accounts ADD COLUMN {col} {ddl}"))
        for col, ddl in txn_additions.items():
            if col not in existing_txns:
                conn.execute(text(f"ALTER TABLE transactions ADD COLUMN {col} {ddl}"))
        for col, ddl in client_additions.items():
            if col not in existing_clients:
                conn.execute(text(f"ALTER TABLE clients ADD COLUMN {col} {ddl}"))
        for col, ddl in invoice_additions.items():
            if col not in existing_invoices:
                conn.execute(text(f"ALTER TABLE invoices ADD COLUMN {col} {ddl}"))


_lightweight_migrate()


async def _hourly_up_sync():
    """Background task: sync all UP-connected entities once per hour."""
    from .routers.up_banking import sync as _sync, SyncIn

    INTERVAL = 3600  # seconds
    await asyncio.sleep(60)  # short initial delay so the server is fully up

    while True:
        try:
            db = SessionLocal()
            try:
                entities_with_token = db.query(models.Entity).filter(
                    models.Entity.up_api_token.isnot(None)
                ).all()
                since = (date.today() - timedelta(days=2)).isoformat()
                for entity in entities_with_token:
                    try:
                        _sync(SyncIn(entity_id=entity.id, since=since), db)
                        logger.info("Auto-synced UP for entity %s", entity.id)
                    except Exception as exc:
                        logger.warning("Auto-sync failed for entity %s: %s", entity.id, exc)
            finally:
                db.close()
        except Exception as exc:
            logger.warning("Hourly UP sync error: %s", exc)

        await asyncio.sleep(INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_hourly_up_sync())
    yield
    task.cancel()


if settings.is_using_defaults():
    logger.warning(
        "\n\n  ⚠  Running with default credentials (app_password='changeme').\n"
        "     Set APP_PASSWORD and SECRET_KEY in your .env file before exposing\n"
        "     this app outside localhost.\n"
    )

app = FastAPI(title="Ledger — Finance Manager API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "stripe": bool(settings.stripe_secret_key)}


@app.post("/api/login")
def login(payload: dict):
    """Trivial single-user auth: returns a token if the password matches.
    Swap for real session/JWT before exposing beyond localhost."""
    if payload.get("password") != settings.app_password:
        raise HTTPException(401, "Invalid password")
    return {"token": settings.secret_key}


for r in (entities, accounts, transactions, categories, imports,
          receipts, clients, invoices, investments, dashboard, up_banking, commitments,
          networth):
    app.include_router(r.router)
