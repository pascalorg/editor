"""Scene JSON loading. Pure python (no bpy).

The persisted Pascal scene is ``{"nodes": {id: node}, "rootNodeIds": [id], ...}``.
Unknown top-level keys and unknown node fields are preserved verbatim — the
loaded ``nodes`` dicts are the raw parsed JSON objects, never normalized.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class SceneData:
    raw_bytes: bytes
    raw: Dict[str, Any]                    # full parsed document
    nodes: Dict[str, Any]                  # verbatim node dicts, keyed by id
    root_ids: List[str]
    extra_toplevel: Dict[str, Any]         # top-level keys other than nodes/rootNodeIds
    sha256: str
    filename: str = ""
    problems: List[str] = field(default_factory=list)


def load_scene(source: "str | bytes", filename: str = "") -> SceneData:
    """Parse scene JSON from a file path, JSON string, or bytes."""
    if isinstance(source, bytes):
        raw_bytes = source
    elif source.lstrip().startswith("{"):
        raw_bytes = source.encode("utf-8")
    else:
        with open(source, "rb") as f:
            raw_bytes = f.read()
        if not filename:
            filename = str(source)

    raw = json.loads(raw_bytes)
    if not isinstance(raw, dict):
        raise ValueError("scene JSON must be an object")

    problems: List[str] = []
    nodes = raw.get("nodes")
    if nodes is None:
        nodes = {}
        problems.append("missing 'nodes' key")
    if not isinstance(nodes, dict):
        raise ValueError("'nodes' must be an object")

    root_ids = raw.get("rootNodeIds")
    if root_ids is None:
        root_ids = []
        problems.append("missing 'rootNodeIds' key")
    if not isinstance(root_ids, list):
        raise ValueError("'rootNodeIds' must be an array")

    for nid, node in nodes.items():
        if not isinstance(node, dict):
            problems.append(f"node {nid!r} is not an object")
        elif node.get("id") != nid:
            problems.append(f"node key {nid!r} != node.id {node.get('id')!r}")

    extra = {k: v for k, v in raw.items() if k not in ("nodes", "rootNodeIds")}
    return SceneData(
        raw_bytes=raw_bytes,
        raw=raw,
        nodes=nodes,
        root_ids=list(root_ids),
        extra_toplevel=extra,
        sha256=hashlib.sha256(raw_bytes).hexdigest(),
        filename=filename,
        problems=problems,
    )
