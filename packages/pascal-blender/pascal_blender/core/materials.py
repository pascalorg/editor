"""Material resolution, transcribed from the editor (spec 05 §8). Pure python."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Optional, Tuple

# preset -> (color, roughness, metalness, opacity, transparent, side)
DEFAULT_MATERIALS: Dict[str, Dict[str, Any]] = {
    "white":    {"color": "#ffffff", "roughness": 0.9,  "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},
    "brick":    {"color": "#8b4513", "roughness": 0.85, "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},
    "concrete": {"color": "#808080", "roughness": 0.8,  "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},
    "wood":     {"color": "#deb887", "roughness": 0.7,  "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},
    "glass":    {"color": "#87ceeb", "roughness": 0.1,  "metalness": 0.1, "opacity": 0.3, "transparent": True,  "side": "double"},
    "metal":    {"color": "#c0c0c0", "roughness": 0.3,  "metalness": 0.9, "opacity": 1.0, "transparent": False, "side": "front"},
    "plaster":  {"color": "#f5f5dc", "roughness": 0.95, "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},
    "tile":     {"color": "#d3d3d3", "roughness": 0.4,  "metalness": 0.1, "opacity": 1.0, "transparent": False, "side": "front"},
    "marble":   {"color": "#fafafa", "roughness": 0.2,  "metalness": 0.1, "opacity": 1.0, "transparent": False, "side": "front"},
    "custom":   {"color": "#ffffff", "roughness": 0.5,  "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},
}

# Fallbacks applied when node.material is entirely absent (spec 05 §8.4).
NODE_TYPE_FALLBACKS: Dict[str, Dict[str, Any]] = {
    "wall":    {"color": "#ffffff", "roughness": 0.9,  "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},
    "slab":    {"color": "#e5e5e5", "roughness": 0.8,  "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},
    "door":    {"color": "#8b4513", "roughness": 0.7,  "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},
    "window":  {"color": "#87ceeb", "roughness": 0.1,  "metalness": 0.1, "opacity": 0.3, "transparent": True,  "side": "double"},
    "ceiling": {"color": "#f5f5dc", "roughness": 0.95, "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},
}

# The editor's 4-slot roof face-group set (spec 05 §8.4).
ROOF_SLOT_MATERIALS = [
    {"color": "#ffffff", "roughness": 1.0, "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "double"},  # 0 wall/trim
    {"color": "#e5e5e5", "roughness": 1.0, "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},   # 1 deck
    {"color": "#ffffff", "roughness": 1.0, "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "double"},  # 2 interior
    {"color": "#e5e5e5", "roughness": 0.9, "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"},   # 3 shingle
]

# Shared door/window sub-part materials (spec 04 / design §5.4).
OPENING_BASE = {"color": "#f2f0ed", "roughness": 0.5, "metalness": 0.0, "opacity": 1.0, "transparent": False, "side": "front"}
OPENING_GLASS = {"color": "#add8e6", "roughness": 0.05, "metalness": 0.1, "opacity": 0.35, "transparent": True, "side": "double"}

Resolved = Tuple[str, float, float, float, bool, str]


def resolve_material(material: Optional[Dict[str, Any]], node_type: str = "") -> Dict[str, Any]:
    """Exact editor precedence (spec 05 §8.3), plus per-node-type fallback."""
    if not material:
        return dict(NODE_TYPE_FALLBACKS.get(node_type) or DEFAULT_MATERIALS["white"])
    preset = material.get("preset")
    props = material.get("properties") or {}
    if preset and preset != "custom":
        base = DEFAULT_MATERIALS.get(preset, DEFAULT_MATERIALS["custom"])
    else:
        base = DEFAULT_MATERIALS["custom"]
    return {**base, **props}


def resolved_tuple(resolved: Dict[str, Any]) -> Resolved:
    return (
        str(resolved.get("color", "#ffffff")).lower(),
        float(resolved.get("roughness", 0.5)),
        float(resolved.get("metalness", 0.0)),
        float(resolved.get("opacity", 1.0)),
        bool(resolved.get("transparent", False)),
        str(resolved.get("side", "front")),
    )


def material_hash(resolved: Dict[str, Any]) -> str:
    payload = json.dumps(resolved_tuple(resolved), separators=(",", ":"))
    return hashlib.sha1(payload.encode()).hexdigest()[:6]


def material_name(material: Optional[Dict[str, Any]], resolved: Dict[str, Any]) -> str:
    preset = (material or {}).get("preset")
    props = (material or {}).get("properties")
    if preset and not props:
        return f"Pascal/{preset}"
    if preset:
        return f"Pascal/{preset}+{material_hash(resolved)}"
    return f"Pascal/custom-{material_hash(resolved)}"


def hex_to_linear_rgb(hex_color: str) -> Tuple[float, float, float]:
    """CSS sRGB hex -> linear RGB floats (IEC 61966-2-1 EOTF)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        r = g = b = 1.0

    def srgb_to_linear(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))
