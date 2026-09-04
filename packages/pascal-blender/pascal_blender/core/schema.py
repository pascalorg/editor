"""Defaults tables and small schema helpers. Pure python (no bpy).

All values transcribed from docs/spec/01-schema-census.md — these are the
runtime fallbacks the editor applies when a field is absent from saved JSON
(the editor does not run Zod on load, so absent fields are the norm).
"""
from __future__ import annotations

import random
import string
from typing import Any, Dict, List, Tuple

DEFAULT_WALL_THICKNESS = 0.1
DEFAULT_WALL_HEIGHT = 2.5
DEFAULT_LEVEL_HEIGHT = 2.5
DEFAULT_SLAB_ELEVATION = 0.05
SLAB_OUTSET = 0.05
DEFAULT_CEILING_HEIGHT = 2.5
CEILING_Z_FIGHT_OFFSET = 0.01
DEFAULT_ZONE_COLOR = "#3b82f6"
DEFAULT_SCAN_OPACITY = 100.0
DEFAULT_GUIDE_OPACITY = 50.0
GUIDE_BASE_WIDTH = 10.0
DEFAULT_SITE_POLYGON = [[-15.0, -15.0], [15.0, -15.0], [15.0, 15.0], [-15.0, 15.0]]

ROOF_SEGMENT_DEFAULTS: Dict[str, Any] = {
    "roofType": "gable",
    "width": 8.0,
    "depth": 6.0,
    "wallHeight": 0.5,
    "roofHeight": 2.5,
    "wallThickness": 0.1,
    "deckThickness": 0.1,
    "overhang": 0.3,
    "shingleThickness": 0.05,
}

WINDOW_DEFAULTS: Dict[str, Any] = {
    "width": 1.5,
    "height": 1.5,
    "frameThickness": 0.05,
    "frameDepth": 0.07,
    "columnRatios": [1],
    "rowRatios": [1],
    "columnDividerThickness": 0.03,
    "rowDividerThickness": 0.03,
    "sill": True,
    "sillDepth": 0.08,
    "sillThickness": 0.03,
}

DOOR_DEFAULTS: Dict[str, Any] = {
    "width": 0.9,
    "height": 2.1,
    "frameThickness": 0.05,
    "frameDepth": 0.07,
    "threshold": True,
    "thresholdHeight": 0.02,
    "hingesSide": "left",
    "swingDirection": "inward",
    "handle": True,
    "handleHeight": 1.05,
    "handleSide": "right",
    "contentPadding": [0.04, 0.04],
    "doorCloser": False,
    "panicBar": False,
    "panicBarHeight": 1.0,
}

DEFAULT_DOOR_SEGMENTS: List[Dict[str, Any]] = [
    {"type": "panel", "heightRatio": 0.4, "columnRatios": [1],
     "dividerThickness": 0.03, "panelDepth": 0.01, "panelInset": 0.04},
    {"type": "panel", "heightRatio": 0.6, "columnRatios": [1],
     "dividerThickness": 0.03, "panelDepth": 0.01, "panelInset": 0.04},
]

# Node types the importer knows how to build natively. Namespaced kinds
# (plugin nodes like trees:*) from plugins we don't know stay warnings, never
# errors — matching the editor's own policy for unloaded plugins.
KNOWN_NODE_TYPES = {
    "site", "building", "level", "wall", "item", "zone", "slab", "ceiling",
    "roof", "roof-segment", "scan", "guide", "window", "door",
    "column", "fence", "shelf", "spawn", "trees:tree", "trees:grass",
}

_ID_ALPHABET = string.digits + string.ascii_lowercase


def generate_id(prefix: str) -> str:
    """Pascal-style node id: ``<prefix>_<16 chars of [0-9a-z]>``."""
    suffix = "".join(random.choice(_ID_ALPHABET) for _ in range(16))
    return f"{prefix}_{suffix}"


def id_prefix_for_type(node_type: str) -> str:
    return "rseg" if node_type == "roof-segment" else node_type


def get(node: Dict[str, Any], key: str, default: Any) -> Any:
    """Editor-style ``??`` fallback: absent OR null -> default."""
    value = node.get(key)
    return default if value is None else value


def node_label(node: Dict[str, Any]) -> str:
    """Human display name: user name, else capitalized type."""
    name = node.get("name")
    if name:
        return str(name)
    t = str(node.get("type", "node"))
    return t.replace("-", " ").title()


def wall_start_end(node: Dict[str, Any]) -> Tuple[Tuple[float, float], Tuple[float, float]]:
    start = node["start"]
    end = node["end"]
    return (float(start[0]), float(start[1])), (float(end[0]), float(end[1]))
