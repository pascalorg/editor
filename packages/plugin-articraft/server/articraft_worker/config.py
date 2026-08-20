from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


DEFAULT_PROVIDER_MODELS = {
    "openai": ("gpt-5.6", "GPT-5.6"),
    "anthropic": ("claude-sonnet-5", "Claude Sonnet 5"),
    "gemini": ("gemini-3.6-flash", "Gemini 3.6 Flash"),
    "openrouter": (
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "Nemotron 3 Ultra",
    ),
}


@dataclass(frozen=True, slots=True)
class Settings:
    api_key: str
    allowed_providers: frozenset[str]
    storage_url: str
    storage_service_key: str
    storage_bucket: str
    jobs_dir: Path
    runs_dir: Path
    default_provider: str = "openai"
    default_model: str | None = "gpt-5.6"
    max_concurrent_jobs: int = 1

    def generation_models(self) -> list[dict[str, str]]:
        providers = [
            self.default_provider,
            *sorted(self.allowed_providers - {self.default_provider}),
        ]
        models: list[dict[str, str]] = []
        for provider in providers:
            fallback_model, label = DEFAULT_PROVIDER_MODELS[provider]
            model = (
                self.default_model
                if provider == self.default_provider and self.default_model
                else fallback_model
            )
            models.append(
                {
                    "provider": provider,
                    "model": model,
                    "label": label if model == fallback_model else model,
                }
            )
        return models


def load_settings() -> Settings:
    allowed_providers = frozenset(
        value.strip()
        for value in os.getenv(
            "ARTICRAFT_ALLOWED_PROVIDERS",
            "openai,anthropic,gemini,openrouter",
        ).split(",")
        if value.strip()
    )
    default_provider = os.getenv("ARTICRAFT_DEFAULT_PROVIDER", "openai").strip()
    if default_provider not in allowed_providers:
        raise RuntimeError("ARTICRAFT_DEFAULT_PROVIDER must be allowed")
    return Settings(
        api_key=_required("ARTICRAFT_WORKER_API_KEY"),
        allowed_providers=allowed_providers,
        storage_url=_required("SUPABASE_URL").rstrip("/"),
        storage_service_key=_required("SUPABASE_SERVICE_ROLE_KEY"),
        storage_bucket=os.getenv("ARTICRAFT_STORAGE_BUCKET", "articraft-catalog"),
        jobs_dir=Path(os.getenv("ARTICRAFT_JOBS_DIR", ".articraft/jobs")),
        runs_dir=Path(os.getenv("ARTICRAFT_RUNS_DIR", ".articraft/runs")),
        default_provider=default_provider,
        default_model=os.getenv("ARTICRAFT_DEFAULT_MODEL", "gpt-5.6").strip() or None,
        max_concurrent_jobs=_bounded_integer(
            "ARTICRAFT_MAX_CONCURRENT_JOBS", default=1, minimum=1, maximum=4
        ),
    )


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _bounded_integer(name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value
