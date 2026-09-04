from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Artifact(BaseModel):
    format: Literal["usdz"] = "usdz"
    url: str
    sha256: str


class Attribution(BaseModel):
    creator: str = "Generated with mini-articraft"
    license: str = "User-generated; host policy applies"
    sourceUrl: str = "https://github.com/articraftresearch/Articraft"


class Part(BaseModel):
    name: str
    objectName: str | None = None


class Origin(BaseModel):
    xyz: tuple[float, float, float]
    rpy: tuple[float, float, float]


class Limits(BaseModel):
    lower: float
    upper: float


class Joint(BaseModel):
    name: str
    type: Literal["fixed", "revolute", "continuous", "prismatic"]
    parent: str
    child: str
    axis: tuple[float, float, float]
    origin: Origin
    limits: Limits | None


class CatalogItem(BaseModel):
    id: str
    title: str
    description: str | None = None
    source: Literal["generated"] = "generated"
    artifact: Artifact
    dimensions: tuple[float, float, float]
    parts: list[Part]
    joints: list[Joint]
    defaultJointValues: dict[str, float]
    attribution: Attribution = Field(default_factory=Attribution)
    prompt: str
    tags: list[str] = Field(default_factory=lambda: ["generated"])


class Job(BaseModel):
    id: str
    status: Literal["queued", "running", "succeeded", "failed", "canceled"]
    message: str | None = None
    item: CatalogItem | None = None
    provider: str
    model: str | None = None
    prompt: str
    reference_image: str | None = None


class GenerationResponse(BaseModel):
    id: str
    status: Literal["queued", "running", "succeeded", "failed", "canceled"]
    message: str | None = None
    item: CatalogItem | None = None


class GenerationModel(BaseModel):
    provider: Literal["openai", "anthropic", "gemini", "openrouter"]
    model: str
    label: str


class GenerationConfiguration(BaseModel):
    provider: Literal["openai", "anthropic", "gemini", "openrouter"]
    model: str
    models: list[GenerationModel]


JsonObject = dict[str, Any]
