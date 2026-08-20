import asyncio
import threading
import time
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from articraft_worker.app import create_app
from articraft_worker.config import Settings
from articraft_worker.models import Job
from articraft_worker.store import JobStore


def settings(tmp_path: Path) -> Settings:
    return Settings(
        api_key="test-worker-key",
        allowed_providers=frozenset({"openai"}),
        storage_url="http://storage.invalid",
        storage_service_key="test-service-key",
        storage_bucket="articraft-catalog",
        jobs_dir=tmp_path / "jobs",
        runs_dir=tmp_path / "runs",
    )


def test_generation_requires_bearer_auth(tmp_path: Path) -> None:
    client = TestClient(create_app(settings(tmp_path)))

    response = client.post(
        "/v1/generations",
        data={"prompt": "a folding lamp", "provider": "openai"},
    )

    assert response.status_code == 401


def test_generation_rejects_disallowed_provider(tmp_path: Path) -> None:
    client = TestClient(create_app(settings(tmp_path)))

    response = client.post(
        "/v1/generations",
        headers={"authorization": "Bearer test-worker-key"},
        data={"prompt": "a folding lamp", "provider": "anthropic"},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Provider is not allowed"}


def test_configuration_returns_default_and_selectable_models(tmp_path: Path) -> None:
    resolved = settings(tmp_path)
    resolved = replace(resolved, allowed_providers=frozenset({"openai", "anthropic"}))
    client = TestClient(create_app(resolved))

    response = client.get(
        "/v1/configuration",
        headers={"authorization": "Bearer test-worker-key"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "provider": "openai",
        "model": "gpt-5.6",
        "models": [
            {"provider": "openai", "model": "gpt-5.6", "label": "GPT-5.6"},
            {
                "provider": "anthropic",
                "model": "claude-sonnet-5",
                "label": "Claude Sonnet 5",
            },
        ],
    }


def test_generation_uses_worker_default_provider_and_model(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    generation_started = threading.Event()
    selected: dict[str, object] = {}

    async def capture_generation(**values: object) -> None:
        selected.update(values)
        generation_started.set()
        raise RuntimeError("expected test failure")

    monkeypatch.setattr("articraft_worker.app.generate_item", capture_generation)
    with TestClient(create_app(settings(tmp_path))) as client:
        created = client.post(
            "/v1/generations",
            headers={"authorization": "Bearer test-worker-key"},
            data={"prompt": "a folding lamp"},
        )
        assert created.status_code == 200
        assert generation_started.wait(0.5)
        assert selected["provider"] == "openai"
        assert selected["model"] == "gpt-5.6"


def test_generation_keeps_status_endpoint_responsive(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    generation_started = threading.Event()

    async def slow_generation(**_: object) -> None:
        generation_started.set()
        time.sleep(0.25)
        raise RuntimeError("expected test failure")

    monkeypatch.setattr("articraft_worker.app.generate_item", slow_generation)
    with TestClient(create_app(settings(tmp_path))) as client:
        created = client.post(
            "/v1/generations",
            headers={"authorization": "Bearer test-worker-key"},
            data={"prompt": "a folding lamp", "provider": "openai"},
        )
        job_id = created.json()["id"]
        assert generation_started.wait(0.2)
        started = time.perf_counter()
        response = client.get(
            f"/v1/generations/{job_id}",
            headers={"authorization": "Bearer test-worker-key"},
        )
        elapsed = time.perf_counter() - started
        assert response.status_code == 200
        assert response.json()["status"] == "running"
        assert elapsed < 0.1
        assert (
            _wait_for_status(client, job_id, "failed")["message"]
            == "expected test failure"
        )


def test_worker_recovers_interrupted_job(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    resolved = settings(tmp_path)
    store = JobStore(resolved.jobs_dir)
    store.put(
        Job(
            id="interrupted123",
            status="running",
            provider="openai",
            prompt="an articulated lamp",
        )
    )
    generation_started = threading.Event()

    async def recovered_generation(**_: object) -> None:
        generation_started.set()
        raise RuntimeError("expected recovery failure")

    monkeypatch.setattr("articraft_worker.app.generate_item", recovered_generation)
    with TestClient(create_app(resolved)) as client:
        assert generation_started.wait(0.5)
        response = _wait_for_status(client, "interrupted123", "failed")
        assert response["message"] == "expected recovery failure"


def test_worker_limits_concurrent_generations(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    active = 0
    peak = 0
    lock = threading.Lock()

    async def slow_generation(**_: object) -> None:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.1)
        with lock:
            active -= 1
        raise RuntimeError("expected test failure")

    monkeypatch.setattr("articraft_worker.app.generate_item", slow_generation)
    with TestClient(create_app(settings(tmp_path))) as client:
        job_ids = []
        for prompt in ("a folding lamp", "a hinged box"):
            response = client.post(
                "/v1/generations",
                headers={"authorization": "Bearer test-worker-key"},
                data={"prompt": prompt, "provider": "openai"},
            )
            job_ids.append(response.json()["id"])
        for job_id in job_ids:
            _wait_for_status(client, job_id, "failed")
    assert peak == 1


def test_running_generation_can_be_canceled(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    generation_started = threading.Event()
    generation_canceled = threading.Event()

    async def cancellable_generation(**_: object) -> None:
        generation_started.set()
        try:
            while True:
                await asyncio.sleep(0.05)
        finally:
            generation_canceled.set()

    monkeypatch.setattr("articraft_worker.app.generate_item", cancellable_generation)
    with TestClient(create_app(settings(tmp_path))) as client:
        created = client.post(
            "/v1/generations",
            headers={"authorization": "Bearer test-worker-key"},
            data={"prompt": "a folding lamp"},
        )
        job_id = created.json()["id"]
        assert generation_started.wait(0.5)

        canceled = client.post(
            f"/v1/generations/{job_id}/cancel",
            headers={"authorization": "Bearer test-worker-key"},
        )

        assert canceled.status_code == 200
        assert canceled.json()["status"] == "canceled"
        assert generation_canceled.wait(0.5)
        assert _wait_for_status(client, job_id, "canceled")["message"] == "Generation canceled"


def _wait_for_status(
    client: TestClient,
    job_id: str,
    expected: str,
    timeout: float = 2.0,
) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(
            f"/v1/generations/{job_id}",
            headers={"authorization": "Bearer test-worker-key"},
        )
        if response.json()["status"] == expected:
            return response.json()
        time.sleep(0.01)
    raise AssertionError(f"Job {job_id} did not reach {expected}")
