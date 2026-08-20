"""Scene-graph traversal, orphan detection, and level stacking math.

Pure python (no bpy). Level math transcribed from spec 05 §5 / spatial-grid:
a wall's base Y ("meshY") equals the max elevation of same-level slabs it
overlaps (sampled at t = 0, .25, .5, .75, 1 along the wall, hole-aware),
floored at 0; level height = max over children of ceiling height and wall
meshY + wall height, fallback 2.5.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Sequence, Set, Tuple

from . import schema


def iter_children_ids(node: Dict[str, Any]) -> List[str]:
    """Child ids from a node's children array; site nodes may embed full
    node objects instead of id strings."""
    out: List[str] = []
    for child in node.get("children") or []:
        if isinstance(child, str):
            out.append(child)
        elif isinstance(child, dict) and child.get("id"):
            out.append(str(child["id"]))
    return out


def embedded_children(node: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Full node objects embedded in children (site legacy form)."""
    return [c for c in node.get("children") or [] if isinstance(c, dict)]


def reachable_ids(nodes: Dict[str, Any], root_ids: Iterable[str]) -> Set[str]:
    seen: Set[str] = set()
    stack = [rid for rid in root_ids if rid in nodes]
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        node = nodes.get(nid)
        if isinstance(node, dict):
            for cid in iter_children_ids(node):
                if cid in nodes and cid not in seen:
                    stack.append(cid)
    return seen


def orphan_ids(nodes: Dict[str, Any], root_ids: Iterable[str]) -> Set[str]:
    return set(nodes.keys()) - reachable_ids(nodes, root_ids)


def _point_in_polygon(pt: Sequence[float], poly: Sequence[Sequence[float]]) -> bool:
    x, z = float(pt[0]), float(pt[1])
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, zi = float(poly[i][0]), float(poly[i][1])
        xj, zj = float(poly[j][0]), float(poly[j][1])
        if (zi > z) != (zj > z):
            x_cross = (xj - xi) * (z - zi) / (zj - zi) + xi
            if x < x_cross:
                inside = not inside
        j = i
    return inside


def slab_elevation_for_wall(wall: Dict[str, Any], level_children: List[Dict[str, Any]]) -> float:
    """Max elevation of overlapping same-level slabs under a wall (>= 0)."""
    try:
        (sx, sz), (ex, ez) = schema.wall_start_end(wall)
    except (KeyError, IndexError, TypeError):
        return 0.0
    samples = [(sx + (ex - sx) * t, sz + (ez - sz) * t) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
    elevation: float = 0.0
    found = False
    for slab in level_children:
        if slab.get("type") != "slab":
            continue
        poly = slab.get("polygon") or []
        if len(poly) < 3:
            continue
        holes = slab.get("holes") or []
        for pt in samples:
            if _point_in_polygon(pt, poly) and not any(
                len(h) >= 3 and _point_in_polygon(pt, h) for h in holes
            ):
                value = float(schema.get(slab, "elevation", schema.DEFAULT_SLAB_ELEVATION))
                elevation = value if not found else max(elevation, value)
                found = True
                break
    return elevation  # may be negative: wall then extends downward


def level_height(level: Dict[str, Any], nodes: Dict[str, Any]) -> float:
    children = [nodes[cid] for cid in iter_children_ids(level) if cid in nodes]
    max_top = 0.0
    for child in children:
        ctype = child.get("type")
        if ctype == "ceiling":
            top = float(schema.get(child, "height", schema.DEFAULT_CEILING_HEIGHT))
        elif ctype == "wall":
            mesh_y = max(slab_elevation_for_wall(child, children), 0.0)
            top = mesh_y + float(schema.get(child, "height", schema.DEFAULT_WALL_HEIGHT))
        else:
            continue
        max_top = max(max_top, top)
    return max_top if max_top > 0 else schema.DEFAULT_LEVEL_HEIGHT


def level_offsets(building: Dict[str, Any], nodes: Dict[str, Any]) -> Dict[str, float]:
    """Cumulative stacked Y offset per level id (sorted by 'level' index,
    ties in children order)."""
    levels = [
        (cid, nodes[cid])
        for cid in iter_children_ids(building)
        if cid in nodes and isinstance(nodes[cid], dict) and nodes[cid].get("type") == "level"
    ]
    levels.sort(key=lambda item: float(schema.get(item[1], "level", 0)))
    offsets: Dict[str, float] = {}
    y = 0.0
    for lid, level in levels:
        offsets[lid] = y
        y += level_height(level, nodes)
    return offsets
