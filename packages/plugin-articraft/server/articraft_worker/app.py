from __future__ import annotations

import asyncio
import hmac
import threading
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
    status,
)

from .config import Settings, load_settings
from .generation import generate_item
from .models import GenerationConfiguration, GenerationResponse, Job
from .storage import SupabaseStorage
from .store import JobStore

MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or load_settings()
    store = JobStore(resolved.jobs_dir)
    storage = SupabaseStorage(
        url=resolved.storage_url,
        service_key=resolved.storage_service_key,
        bucket=resolved.storage_bucket,
    )
    capacity = asyncio.Semaphore(resolved.max_concurrent_jobs)
    tasks: set[asyncio.Task[None]] = set()
    cancellations: dict[str, threading.Event] = {}

    async def execute(job: Job) -> None:
        cancellation = cancellations.setdefault(job.id, threading.Event())
        try:
            image = _job_image(job, resolved.runs_dir)
            if job.reference_image is not None and image is None:
                store.put(
                    job.model_copy(
                        update={
                            "status": "failed",
                            "message": "Reference image is unavailable after worker restart",
                        }
                    )
                )
                return
            async with capacity:
                if cancellation.is_set():
                    if image is not None:
                        image.unlink(missing_ok=True)
                    return
                await _run_job(
                    job=job,
                    image=image,
                    settings=resolved,
                    store=store,
                    storage=storage,
                    cancellation=cancellation,
                )
        finally:
            cancellations.pop(job.id, None)

    def schedule(job: Job) -> None:
        task = asyncio.create_task(execute(job))
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        for job in store.active():
            recovered = job.model_copy(
                update={"status": "queued", "message": "Recovered after worker restart"}
            )
            store.put(recovered)
            schedule(recovered)
        yield
        pending = tuple(tasks)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    app = FastAPI(title="Pascal Articraft worker", version="0.1.0", lifespan=lifespan)

    async def authorize(authorization: str | None = Header(default=None)) -> None:
        expected = f"Bearer {resolved.api_key}"
        if authorization is None or not hmac.compare_digest(authorization, expected):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized"
            )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post(
        "/v1/generations",
        response_model=GenerationResponse,
        dependencies=[Depends(authorize)],
    )
    async def create_generation(
        prompt: str = Form(min_length=1, max_length=2_000),
        provider: str | None = Form(default=None, max_length=32),
        model: str | None = Form(default=None, max_length=160),
        image: UploadFile | None = File(default=None),
    ) -> GenerationResponse:
        selected_provider = (provider or resolved.default_provider).strip()
        selected_model = (model or resolved.default_model or "").strip() or None
        if selected_provider not in resolved.allowed_providers:
            raise HTTPException(status_code=400, detail="Provider is not allowed")
        if image is not None and selected_provider == "openrouter":
            raise HTTPException(
                status_code=400, detail="OpenRouter image generation is not supported"
            )

        job_id = uuid.uuid4().hex
        image_path = await _save_image(image, resolved.runs_dir / job_id)
        job = Job(
            id=job_id,
            status="queued",
            provider=selected_provider,
            model=selected_model,
            prompt=prompt.strip(),
            reference_image=image_path.name if image_path is not None else None,
        )
        store.put(job)
        schedule(job)
        return GenerationResponse.model_validate(job, from_attributes=True)

    @app.get(
        "/v1/configuration",
        response_model=GenerationConfiguration,
        dependencies=[Depends(authorize)],
    )
    async def get_configuration() -> GenerationConfiguration:
        return GenerationConfiguration(
            provider=resolved.default_provider,
            model=resolved.default_model or "",
            models=resolved.generation_models(),
        )

    @app.get(
        "/v1/generations/{job_id}",
        response_model=GenerationResponse,
        dependencies=[Depends(authorize)],
    )
    async def get_generation(job_id: str) -> GenerationResponse:
        if not job_id.isalnum():
            raise HTTPException(status_code=404, detail="Generation not found")
        job = store.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Generation not found")
        return GenerationResponse.model_validate(job, from_attributes=True)

    @app.post(
        "/v1/generations/{job_id}/cancel",
        response_model=GenerationResponse,
        dependencies=[Depends(authorize)],
    )
    async def cancel_generation(job_id: str) -> GenerationResponse:
        if not job_id.isalnum():
            raise HTTPException(status_code=404, detail="Generation not found")
        job = store.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Generation not found")
        if job.status in {"queued", "running"}:
            cancellations.setdefault(job.id, threading.Event()).set()
            job = job.model_copy(
                update={"status": "canceled", "message": "Generation canceled"}
            )
            store.put(job)
        return GenerationResponse.model_validate(job, from_attributes=True)

    return app


async def _save_image(image: UploadFile | None, directory: Path) -> Path | None:
    if image is None:
        return None
    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Image must be JPEG, PNG, or WebP")
    content = await image.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 10 MB or smaller")
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[
        image.content_type
    ]
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"reference{extension}"
    path.write_bytes(content)
    return path


async def _run_job(
    *,
    job: Job,
    image: Path | None,
    settings: Settings,
    store: JobStore,
    storage: SupabaseStorage,
    cancellation: threading.Event,
) -> None:
    running = job.model_copy(
        update={"status": "running", "message": "Generating object"}
    )
    store.put(running)
    terminal = False
    try:
        # mini-articraft performs synchronous setup and CAD compilation between
        # awaits, so isolate its event loop from FastAPI's request-serving loop.
        item = await asyncio.to_thread(
            _generate_cancellable,
            job,
            image,
            settings,
            storage,
            cancellation,
        )
        if cancellation.is_set():
            store.put(
                running.model_copy(
                    update={"status": "canceled", "message": "Generation canceled"}
                )
            )
            terminal = True
            return
        store.put(
            running.model_copy(
                update={
                    "status": "succeeded",
                    "message": "Generation complete",
                    "item": item,
                }
            )
        )
        terminal = True
    except asyncio.CancelledError:
        if cancellation.is_set():
            store.put(
                running.model_copy(
                    update={"status": "canceled", "message": "Generation canceled"}
                )
            )
            terminal = True
            return
        raise
    except Exception as error:
        store.put(
            running.model_copy(
                update={"status": "failed", "message": _safe_error(error)}
            )
        )
        terminal = True
    finally:
        if terminal and image is not None:
            image.unlink(missing_ok=True)


def _generate_cancellable(
    job: Job,
    image: Path | None,
    settings: Settings,
    storage: SupabaseStorage,
    cancellation: threading.Event,
):
    async def run():
        task = asyncio.create_task(
            generate_item(
                job_id=job.id,
                prompt=job.prompt,
                provider=job.provider,
                model=job.model,
                image=image,
                runs_dir=settings.runs_dir,
                storage=storage,
            )
        )
        while not task.done():
            if cancellation.is_set():
                task.cancel()
            await asyncio.wait({task}, timeout=0.1)
        return await task

    return asyncio.run(run())


def _job_image(job: Job, runs_dir: Path) -> Path | None:
    if job.reference_image is None:
        return None
    if Path(job.reference_image).name != job.reference_image:
        return None
    path = runs_dir / job.id / job.reference_image
    return path if path.is_file() else None


def _safe_error(error: Exception) -> str:
    message = str(error).strip()
    return (message or "Generation failed")[:500]
