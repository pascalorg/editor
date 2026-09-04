"""Load-time migrations, transcribed verbatim from the editor's migrateNodes()
(docs/spec/01-schema-census.md §9). Pure python (no bpy).

The returned dict contains NEW node objects for migrated entries; the caller's
verbatim originals must be kept separately for lossless re-export.
"""
from __future__ import annotations

import random
import string
from typing import Any, Dict, Set, Tuple


def migrate_nodes(nodes: Dict[str, Any]) -> Tuple[Dict[str, Any], Set[str]]:
    """Return (migrated nodes dict, set of node ids added or rewritten)."""
    patched: Dict[str, Any] = dict(nodes)
    touched: Set[str] = set()

    for nid, node in nodes.items():
        if not isinstance(node, dict):
            continue

        # 1. Item scale backfill (key-presence test, not null test — verbatim).
        if node.get("type") == "item" and "scale" not in node:
            patched[nid] = {**node, "scale": [1, 1, 1]}
            touched.add(nid)

        # 2. Legacy roof (no 'children' key) -> roof + synthetic gable segment.
        if node.get("type") == "roof" and "children" not in node:
            suffix = (
                nid.split("_", 1)[1]
                if "_" in nid
                else "".join(random.choice(string.digits + string.ascii_lowercase) for _ in range(12))
            )
            segment_id = f"rseg_{suffix}"
            visible = node.get("visible")
            segment = {
                "object": "node",
                "id": segment_id,
                "type": "roof-segment",
                "parentId": nid,
                "visible": True if visible is None else visible,
                "metadata": {},
                "position": [0, 0, 0],
                "rotation": 0,
                "roofType": "gable",
                # Verbatim odd fallback constants (differ from legacy defaults).
                "width": node.get("length") if node.get("length") is not None else 8,
                "depth": (node.get("leftWidth") if node.get("leftWidth") is not None else 2.2)
                + (node.get("rightWidth") if node.get("rightWidth") is not None else 2.2),
                "wallHeight": 0,
                "roofHeight": node.get("height") if node.get("height") is not None else 2.5,
                "wallThickness": 0.1,
                "deckThickness": 0.1,
                "overhang": 0.3,
                "shingleThickness": 0.05,
            }
            patched[segment_id] = segment
            patched[nid] = {**node, "children": [segment_id]}
            touched.add(nid)
            touched.add(segment_id)

    return patched, touched
