from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./ledger.db"
    secret_key: str = "dev-secret-change-me"
    app_password: str = "changeme"

    # Comma-separated list of allowed CORS origins, e.g.:
    # ALLOWED_ORIGINS=http://localhost:3000,https://myapp.example.com
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    ocr_provider: str = ""
    doc_ai_processor: str = ""

    upload_dir: str = "./uploads"
    default_tax_rate: float = 0.30

    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    def is_using_defaults(self) -> bool:
        return self.app_password == "changeme" or self.secret_key == "dev-secret-change-me"


@lru_cache
def get_settings() -> Settings:
    return Settings()
