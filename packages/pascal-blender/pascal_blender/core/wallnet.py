"""Wall footprint computation with junction mitering.

Pure-python port (no bpy, stdlib ``math`` only) of the Pascal editor's
``wall-mitering.ts`` + ``wall-footprint.ts`` pipeline, per the normative spec
``docs/spec/02-walls.md``:

- junction detection by 1 mm grid-snap key matching (JS ``Math.round`` parity:
  halves toward +infinity) plus the T-junction ``pointOnWallSegment`` test
  (parametric-t exclusion, 1 mm absolute perpendicular distance);
- per-junction miter points via Cramer's-rule intersection of the angle-sorted
  adjacent walls' left x right edge lines (left edge of entry i vs right edge
  of entry i+1 around the ring);
- passthrough (T-junction through-wall) entries shape the sort ring but never
  receive miter points;
- collinear/parallel edge pairs (``abs(det) < 1e-9``) are skipped, so straight
  butt joints keep plain square caps;
- footprint assembly with the left/right SWAP at the end junction
  (``pEndLeft = endJunction.right``) and conditional apex (raw centerline
  endpoint) insertion, yielding 4/5/6-gons;
- footprints are computed in plan WORLD space first, then rotated into the
  wall-local frame (rotate by ``-wallAngle`` around ``start``).
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

# Constants (spec 02 section 2)
DEFAULT_WALL_THICKNESS = 0.1
TOLERANCE = 0.001  # endpoint snap grid + T-junction distance
EPS = 1e-9  # degenerate-length + parallel-lines epsilon
MITER_LIMIT_FACTOR = 50.0  # max miter distance, in wall thicknesses

Point = Tuple[float, float]


def _js_round(v: float) -> int:
    """JS ``Math.round``: halves round toward +infinity (not banker's)."""
    return int(math.floor(v + 0.5))


def _point_key(x: float, y: float, tolerance: float = TOLERANCE) -> str:
    """Snap a plan point to the 1 mm grid and return its string key."""
    snap = 1.0 / tolerance
    return "{},{}".format(_js_round(x * snap), _js_round(y * snap))


def _thickness(wall: dict) -> float:
    """``wall.thickness ?? 0.1`` (nullish coalescing: 0 is kept)."""
    t = wall.get("thickness")
    return DEFAULT_WALL_THICKNESS if t is None else float(t)


def _point_on_wall_segment(
    px: float,
    py: float,
    sx: float,
    sy: float,
    ex: float,
    ey: float,
    tolerance: float = TOLERANCE,
) -> bool:
    """T-junction membership test (spec 4.3).

    The point must not coincide with either endpoint (compared via the grid
    key); the parametric projection ``t`` must be inside
    ``[tolerance, 1 - tolerance]`` (PARAMETRIC units — scales with wall
    length); the perpendicular distance must be under ``tolerance`` meters.
    """
    pk = _point_key(px, py, tolerance)
    if pk == _point_key(sx, sy, tolerance) or pk == _point_key(ex, ey, tolerance):
        return False
    wx = ex - sx
    wy = ey - sy
    l2 = wx * wx + wy * wy
    if math.sqrt(l2) < EPS:
        return False
    vx = px - sx
    vy = py - sy
    t = (vx * wx + vy * wy) / l2
    if t < tolerance or t > 1.0 - tolerance:
        return False
    projx = sx + wx * t
    projy = sy + wy * t
    dist = math.hypot(px - projx, py - projy)
    return dist < tolerance


def _find_junctions(walls: Dict[str, dict]) -> Dict[str, dict]:
    """Spec 4.2: endpoint pass, T-junction pass, then >= 2 walls filter.

    Returns {key: {"point": (x, y), "connected": [(wall_id, end_type), ...]}}
    where ``point`` is the RAW (unsnapped) coordinate of the first endpoint
    that created the key and end_type is 'start' | 'end' | 'passthrough'.
    """
    junctions: Dict[str, dict] = {}

    # First pass: endpoint insertion under the snapped key.
    for wall_id, wall in walls.items():
        for end_type in ("start", "end"):
            pt = wall[end_type]
            key = _point_key(float(pt[0]), float(pt[1]))
            j = junctions.get(key)
            if j is None:
                j = {"point": (float(pt[0]), float(pt[1])), "connected": []}
                junctions[key] = j
            j["connected"].append((wall_id, end_type))

    # Second pass: passthrough (T-junction) membership.
    for j in junctions.values():
        mx, my = j["point"]
        member_ids = set(wid for wid, _ in j["connected"])
        for wall_id, wall in walls.items():
            if wall_id in member_ids:
                continue
            s = wall["start"]
            e = wall["end"]
            if _point_on_wall_segment(
                mx, my, float(s[0]), float(s[1]), float(e[0]), float(e[1])
            ):
                j["connected"].append((wall_id, "passthrough"))

    # Filter: keep only junctions with at least 2 connected walls.
    return {k: j for k, j in junctions.items() if len(j["connected"]) >= 2}


def _junction_intersections(
    junction: dict, walls: Dict[str, dict]
) -> Dict[str, Dict[str, Point]]:
    """Spec 5: miter points per wall at one junction.

    Returns {wall_id: {"left": (x, y)?, "right": (x, y)?}} in plan WORLD
    coordinates; left/right are relative to the wall's OUTGOING direction at
    the junction. Passthrough entries never receive assignments.
    """
    mx, my = junction["point"]

    processed = []
    for wall_id, end_type in junction["connected"]:
        wall = walls[wall_id]
        sx, sy = float(wall["start"][0]), float(wall["start"][1])
        ex, ey = float(wall["end"][0]), float(wall["end"][1])
        if end_type == "start":
            vectors = [((ex - sx, ey - sy), False)]
        elif end_type == "end":
            vectors = [((sx - ex, sy - ey), False)]
        else:  # passthrough: two directional entries
            v = (ex - sx, ey - sy)
            vectors = [(v, True), ((-v[0], -v[1]), True)]

        half_t = _thickness(wall) / 2.0
        for (vx, vy), is_passthrough in vectors:
            vlen = math.hypot(vx, vy)
            if vlen < EPS:
                continue
            nux = -vy / vlen
            nuy = vx / vlen
            # Edge lines a*x + b*y + c = 0 through the offset points,
            # direction v (raw, unnormalized coefficients — spec 5).
            a = -vy
            b = vx
            pax = mx + nux * half_t
            pay = my + nuy * half_t
            pbx = mx - nux * half_t
            pby = my - nuy * half_t
            processed.append(
                {
                    "id": wall_id,
                    "passthrough": is_passthrough,
                    "edge_a": (a, b, -(a * pax + b * pay)),  # left edge
                    "edge_b": (a, b, -(a * pbx + b * pby)),  # right edge
                    "angle": math.atan2(vy, vx),
                }
            )

    if len(processed) < 2:
        return {}

    processed.sort(key=lambda entry: entry["angle"])  # stable, ascending

    intersections: Dict[str, Dict[str, Point]] = {}
    n = len(processed)
    for i in range(n):
        w1 = processed[i]
        w2 = processed[(i + 1) % n]
        a1, b1, c1 = w1["edge_a"]  # wall1's LEFT edge
        a2, b2, c2 = w2["edge_b"]  # wall2's RIGHT edge
        det = a1 * b2 - a2 * b1
        if abs(det) < EPS:
            continue  # parallel => skip; walls fall back to square defaults
        px = (b1 * c2 - b2 * c1) / det
        py = (a2 * c1 - a1 * c2) / det
        # Miter limit: near-collinear walls (e.g. capture-merge slivers a few
        # cm long) make the edge lines almost parallel and the intersection
        # lands kilometers away. Beyond a sane multiple of the wall
        # thickness, fall back to square caps like the parallel case.
        limit = MITER_LIMIT_FACTOR * max(
            _thickness(walls[w1["id"]]), _thickness(walls[w2["id"]])
        )
        if math.hypot(px - mx, py - my) > limit:
            continue
        if not w1["passthrough"]:
            intersections.setdefault(w1["id"], {})["left"] = (px, py)
        if not w2["passthrough"]:
            intersections.setdefault(w2["id"], {})["right"] = (px, py)
    return intersections


def _calculate_level_miters(
    walls: Dict[str, dict],
) -> Dict[str, Dict[str, Dict[str, Point]]]:
    """Spec 5.2: {junction_key: {wall_id: {left?, right?}}} for one level."""
    junctions = _find_junctions(walls)
    return {
        key: _junction_intersections(junction, walls)
        for key, junction in junctions.items()
    }


def _wall_footprint_local(
    wall_id: str,
    wall: dict,
    junction_data: Dict[str, Dict[str, Dict[str, Point]]],
) -> List[Point]:
    """Spec 6 (plan-world footprint) + spec 8.2 (world -> wall-local)."""
    sx, sy = float(wall["start"][0]), float(wall["start"][1])
    ex, ey = float(wall["end"][0]), float(wall["end"][1])
    half_t = _thickness(wall) / 2.0

    vx = ex - sx
    vy = ey - sy
    length = math.hypot(vx, vy)
    if length < EPS:
        return []
    nux = -vy / length  # plan-left unit normal of start -> end
    nuy = vx / length

    start_junction: Optional[Dict[str, Point]] = junction_data.get(
        _point_key(sx, sy), {}
    ).get(wall_id)
    end_junction: Optional[Dict[str, Point]] = junction_data.get(
        _point_key(ex, ey), {}
    ).get(wall_id)

    def _pick(
        entry: Optional[Dict[str, Point]], side: str, default: Point
    ) -> Point:
        if entry is not None and entry.get(side) is not None:
            return entry[side]
        return default

    p_start_left = _pick(
        start_junction, "left", (sx + nux * half_t, sy + nuy * half_t)
    )
    p_start_right = _pick(
        start_junction, "right", (sx - nux * half_t, sy - nuy * half_t)
    )
    # IMPORTANT SWAP: at the end junction the outgoing direction was -v, so
    # its left/right are mirrored relative to the wall's own frame.
    p_end_left = _pick(
        end_junction, "right", (ex + nux * half_t, ey + nuy * half_t)
    )
    p_end_right = _pick(
        end_junction, "left", (ex - nux * half_t, ey - nuy * half_t)
    )

    polygon: List[Point] = [p_start_right, p_end_right]
    if end_junction is not None:
        polygon.append((ex, ey))  # apex: raw centerline endpoint
    polygon.append(p_end_left)
    polygon.append(p_start_left)
    if start_junction is not None:
        polygon.append((sx, sy))  # apex at start

    # World plan -> wall-local: rotate by -wallAngle around start.
    wall_angle = math.atan2(vy, vx)
    cos_a = math.cos(-wall_angle)
    sin_a = math.sin(-wall_angle)
    local: List[Point] = []
    for wx, wy in polygon:
        dx = wx - sx
        dy = wy - sy
        local.append((dx * cos_a - dy * sin_a, dx * sin_a + dy * cos_a))
    return local


def wall_footprints(walls: Dict[str, dict]) -> Dict[str, List[Point]]:
    """Compute the 2D footprint polygon for every wall on one level.

    walls: {wall_id: raw wall node dict} — same-level walls only. Uses
    start/end ([x, z] Pascal plan coords) and thickness (?? 0.1).
    Returns {wall_id: polygon} where polygon is a CCW list of (x, z) points
    in PASCAL WALL-LOCAL coordinates of that wall: origin at wall.start,
    +x along the wall toward end, +z toward the wall's LEFT edge (plan-left
    of the start->end direction; world point -> local via rotation by
    -wallAngle around start). Butt-ended walls yield the plain rectangle
    [(0, -t/2), (L, -t/2), (L, t/2), (0, t/2)] (4-gon); mitered ends insert
    the miter/apex points (5/6-gons) exactly as the editor does. Degenerate
    (zero-length) walls yield [].
    """
    junction_data = _calculate_level_miters(walls)
    return {
        wall_id: _wall_footprint_local(wall_id, wall, junction_data)
        for wall_id, wall in walls.items()
    }
