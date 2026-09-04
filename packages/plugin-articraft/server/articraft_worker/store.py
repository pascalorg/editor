from __future__ import annotations

import json
from pathlib import Path

from .models import Job


class JobStore:
    def __init__(self, directory: Path):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    def put(self, job: Job) -> None:
        target = self.directory / f"{job.id}.json"
        temporary = target.with_suffix(".tmp")
        temporary.write_text(job.model_dump_json(indent=2), encoding="utf-8")
        temporary.replace(target)

    def get(self, job_id: str) -> Job | None:
        target = self.directory / f"{job_id}.json"
        try:
            return Job.model_validate_json(target.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError, json.JSONDecodeError):
            return None

    def active(self) -> list[Job]:
        jobs: list[Job] = []
        for target in sorted(self.directory.glob("*.json")):
            job = self.get(target.stem)
            if job is not None and job.status in {"queued", "running"}:
                jobs.append(job)
        return jobs
