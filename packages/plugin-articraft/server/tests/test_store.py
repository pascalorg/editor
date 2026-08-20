from pathlib import Path

from articraft_worker.models import Job
from articraft_worker.store import JobStore


def test_job_store_round_trip(tmp_path: Path) -> None:
    store = JobStore(tmp_path)
    job = Job(
        id="abc123",
        status="queued",
        provider="openai",
        prompt="an articulated lamp",
    )

    store.put(job)

    assert store.get("abc123") == job
    assert store.get("missing") is None


def test_job_store_lists_only_active_jobs(tmp_path: Path) -> None:
    store = JobStore(tmp_path)
    queued = Job(
        id="queued123",
        status="queued",
        provider="openai",
        prompt="an articulated lamp",
    )
    store.put(queued)
    store.put(queued.model_copy(update={"id": "done123", "status": "succeeded"}))

    assert store.active() == [queued]
