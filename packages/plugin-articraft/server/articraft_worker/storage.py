from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.parse import quote

import httpx


class SupabaseStorage:
    def __init__(self, *, url: str, service_key: str, bucket: str):
        self.url = url
        self.service_key = service_key
        self.bucket = bucket

    async def upload_artifact(self, path: str, source: Path) -> tuple[str, str]:
        content = source.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        await self._upload(path, content, "model/vnd.usdz+zip")
        return self.public_url(path), digest

    async def upload_manifest(self, path: str, value: dict[str, object]) -> None:
        content = json.dumps(value, indent=2, sort_keys=True).encode("utf-8")
        await self._upload(path, content, "application/json")

    async def _upload(self, path: str, content: bytes, content_type: str) -> None:
        endpoint = f"{self.url}/storage/v1/object/{quote(self.bucket, safe='')}/{quote(path, safe='/')}"
        headers = {
            "apikey": self.service_key,
            "authorization": f"Bearer {self.service_key}",
            "content-type": content_type,
            "x-upsert": "true",
        }
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(endpoint, headers=headers, content=content)
        response.raise_for_status()

    def public_url(self, path: str) -> str:
        return (
            f"{self.url}/storage/v1/object/public/"
            f"{quote(self.bucket, safe='')}/{quote(path, safe='/')}"
        )
