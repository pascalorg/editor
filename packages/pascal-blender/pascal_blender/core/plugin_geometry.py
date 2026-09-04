"""Geometry for the newer editor node kinds (fence, shelf, spawn) and the
pascal:trees plugin kinds (trees:tree, trees:grass). Pure python (no bpy).

Ported from docs/research/new-node-types.md — verbatim schemas/geometry
extracted from the editor repo and github.com/pascalorg/plugin-trees.
All output is in PASCAL local coordinates (Y-up); the bpy builders convert.

Box-list contract: [(center(x,y,z), size(sx,sy,sz), mat_index), ...]
MeshData contract: (verts, faces, per-face mat_index)
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

Box = Tuple[Tuple[float, float, float], Tuple[float, float, float], int]
MeshData = Tuple[List[Tuple[float, float, float]], List[Tuple[int, ...]], List[int]]


def _get(node: Dict[str, Any], key: str, default: Any) -> Any:
    value = node.get(key)
    return default if value is None else value


# --------------------------------------------------------------------------
# trees:grass — mulberry32-seeded tuft of flattened 3-sided cones
# --------------------------------------------------------------------------

GRASS_PRESETS = {
    "meadow": {"bladeColor": "#5a8f3c", "blades": 10, "h": 0.4},
    "fescue": {"bladeColor": "#7fae55", "blades": 8, "h": 0.7},
    "reed": {"bladeColor": "#4a7d63", "blades": 6, "h": 1.1},
}


def mulberry32(seed: int):
    """The exact JS PRNG the plugin uses; deterministic across ports."""
    state = seed & 0xFFFFFFFF

    def rng() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return rng


def _cone_blade(bh: float) -> Tuple[List[List[float]], List[Tuple[int, ...]]]:
    """three.js ConeGeometry(0.02, bh, 3): radius .02, height bh, 3 sides,
    centered on origin (Y spans -bh/2..bh/2), apex up."""
    r = 0.02
    ring = []
    # three.js cone rings start at theta=0 around +Y
    for i in range(3):
        theta = i / 3 * math.tau
        ring.append([r * math.sin(theta), -bh / 2, r * math.cos(theta)])
    apex = [0.0, bh / 2, 0.0]
    verts = ring + [apex]
    faces = [(0, 1, 3), (1, 2, 3), (2, 0, 3), (0, 2, 1)]
    return verts, faces


def grass_tuft(node: Dict[str, Any]) -> MeshData:
    preset = GRASS_PRESETS.get(str(_get(node, "preset", "meadow")), GRASS_PRESETS["meadow"])
    seed = int(_get(node, "seed", 1))
    natural_h = preset["h"]
    target_h = float(_get(node, "height", 0.4))
    scale = target_h / natural_h if natural_h > 0 else 1.0

    rng = mulberry32(seed)
    verts: List[Tuple[float, float, float]] = []
    faces: List[Tuple[int, ...]] = []
    mats: List[int] = []

    for _ in range(preset["blades"]):
        bh = natural_h * (0.6 + rng() * 0.6)
        bverts, bfaces = _cone_blade(bh)
        # blade.scale(1, 1, 0.3)
        for v in bverts:
            v[2] *= 0.3
        # blade.translate(0, bh/2, 0)
        for v in bverts:
            v[1] += bh / 2
        # blade.rotateZ((rng()-0.5)*0.7)
        lean = (rng() - 0.5) * 0.7
        c, s = math.cos(lean), math.sin(lean)
        for v in bverts:
            x, y = v[0], v[1]
            v[0], v[1] = x * c - y * s, x * s + y * c
        # blade.rotateY(angle)
        angle = rng() * math.tau
        c, s = math.cos(angle), math.sin(angle)
        for v in bverts:
            x, z = v[0], v[2]
            v[0], v[2] = x * c + z * s, -x * s + z * c
        # blade.translate(cos(angle)*r, 0, sin(angle)*r)
        r = rng() * 0.07
        dx, dz = math.cos(angle) * r, math.sin(angle) * r
        base = len(verts)
        for v in bverts:
            verts.append(((v[0] + dx) * scale, v[1] * scale, (v[2] + dz) * scale))
        for f in bfaces:
            faces.append(tuple(base + i for i in f))
            mats.append(0)

    return verts, faces, mats


# --------------------------------------------------------------------------
# trees:tree — low-poly proxy (trunk + canopy); exact ez-tree stays JS-side
# --------------------------------------------------------------------------

TREE_PRESETS = {
    # preset -> (default type, leaf hex, bark hex, heights small/medium/large)
    "oak": ("deciduous", "#4f7a3a", "#6b5138", (5, 7, 11)),
    "pine": ("evergreen", "#2f5d3e", "#5d4a33", (6, 9, 14)),
    "aspen": ("deciduous", "#7aa74a", "#d8d3c5", (5, 8, 12)),
    "ash": ("deciduous", "#5b8a44", "#7a6a55", (5, 8, 12)),
    "bush": ("deciduous", "#4c803c", "#6b5138", (1.2, 1.5, 1.8)),
    "trellis": ("deciduous", "#5a8f3c", "#8a7a5f", (3, 3, 3)),
}
SIZE_INDEX = {"small": 0, "medium": 1, "large": 2}


def tree_proxy(node: Dict[str, Any]) -> MeshData:
    """Trunk cylinder + canopy (icosphere-ish for deciduous, cone for
    evergreen), total height = node.height. Proxy only — full params live in
    pascal_json for a future exact ez-tree port."""
    preset_name = str(_get(node, "preset", "oak"))
    preset = TREE_PRESETS.get(preset_name, TREE_PRESETS["oak"])
    default_type = preset[0]
    tree_type = str(_get(node, "treeType", default_type))
    sizes = preset[3]
    size = SIZE_INDEX.get(str(_get(node, "size", "medium")), 1)
    height = float(_get(node, "height", sizes[size]))
    leafless = bool(_get(node, "leafless", False))
    trunk_mult = float(_get(node, "trunkThickness", 1.0))

    verts: List[Tuple[float, float, float]] = []
    faces: List[Tuple[int, ...]] = []
    mats: List[int] = []

    def cylinder(r_bot, r_top, y0, y1, sides, mat):
        base = len(verts)
        for i in range(sides):
            a = i / sides * math.tau
            verts.append((r_bot * math.cos(a), y0, r_bot * math.sin(a)))
        for i in range(sides):
            a = i / sides * math.tau
            verts.append((r_top * math.cos(a), y1, r_top * math.sin(a)))
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((base + i, base + j, base + sides + j, base + sides + i))
            mats.append(mat)
        faces.append(tuple(base + i for i in range(sides - 1, -1, -1)))
        mats.append(mat)
        faces.append(tuple(base + sides + i for i in range(sides)))
        mats.append(mat)

    def cone(r, y0, y1, sides, mat):
        base = len(verts)
        for i in range(sides):
            a = i / sides * math.tau
            verts.append((r * math.cos(a), y0, r * math.sin(a)))
        verts.append((0.0, y1, 0.0))
        apex = base + sides
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((base + i, apex, base + j))
            mats.append(mat)
        faces.append(tuple(base + i for i in range(sides - 1, -1, -1)))
        mats.append(mat)

    def blob(cx, cy, cz, r, mat):
        # octahedron-subdivided-once look-alike: use a UV sphere 6x4 (cheap)
        rings, segs = 4, 6
        base = len(verts)
        verts.append((cx, cy + r, cz))
        for ri in range(1, rings):
            phi = ri / rings * math.pi
            for si in range(segs):
                theta = si / segs * math.tau
                verts.append((
                    cx + r * math.sin(phi) * math.cos(theta),
                    cy + r * math.cos(phi),
                    cz + r * math.sin(phi) * math.sin(theta),
                ))
        verts.append((cx, cy - r, cz))
        bottom = len(verts) - 1
        for si in range(segs):
            sj = (si + 1) % segs
            faces.append((base, base + 1 + si, base + 1 + sj))
            mats.append(mat)
        for ri in range(rings - 2):
            row0 = base + 1 + ri * segs
            row1 = row0 + segs
            for si in range(segs):
                sj = (si + 1) % segs
                faces.append((row0 + si, row1 + si, row1 + sj, row0 + sj))
                mats.append(mat)
        last = base + 1 + (rings - 2) * segs
        for si in range(segs):
            sj = (si + 1) % segs
            faces.append((last + si, bottom, last + sj))
            mats.append(mat)

    if leafless:
        trunk_top = height
        cylinder(0.06 * trunk_mult * height / 7 + 0.04, 0.02, 0.0, trunk_top, 8, 0)
        # a few bare branches
        cone(0.015, trunk_top * 0.55, trunk_top * 0.85, 4, 0)
    elif tree_type == "evergreen":
        trunk_top = height * 0.25
        r_trunk = max(0.05, 0.05 * trunk_mult * height / 9)
        cylinder(r_trunk * 1.3, r_trunk, 0.0, trunk_top, 8, 0)
        cone(height * 0.28, trunk_top, height, 8, 1)
    else:
        trunk_top = height * 0.45
        r_trunk = max(0.05, 0.06 * trunk_mult * height / 7)
        cylinder(r_trunk * 1.3, r_trunk * 0.8, 0.0, trunk_top, 8, 0)
        canopy_r = height * 0.3
        blob(0.0, trunk_top + canopy_r * 0.8, 0.0, canopy_r, 1)

    return verts, faces, mats


def tree_colors(node: Dict[str, Any]) -> Tuple[str, str]:
    """(bark hex, leaf hex) honoring overrides."""
    preset = TREE_PRESETS.get(str(_get(node, "preset", "oak")), TREE_PRESETS["oak"])
    leaf = str(_get(node, "leafColor", preset[1]))
    bark = str(_get(node, "branchColor", preset[2]))
    return bark, leaf


# --------------------------------------------------------------------------
# fence — posts/infill/base/rail boxes along the (straight) centerline
# --------------------------------------------------------------------------

FENCE_STYLE_FACTORS = {
    # style -> (spacing, post, base, top)
    "privacy": (0.42, 1.35, 1.2, 1.2),
    "rail": (0.68, 0.8, 0.85, 0.85),
    "slat": (0.3, 0.55, 1.0, 0.75),
    "horizontal": (1.0, 1.0, 1.0, 1.0),
}
# material slots: 0 posts, 1 infill, 2 base, 3 rail
FENCE_SLOTS = {"posts": 0, "infill": 1, "base": 2, "rail": 3}


def fence_parts(node: Dict[str, Any]) -> List[Box]:
    """Boxes in fence-local Pascal coords: X along the run from start,
    Y up, Z across the thickness. Straight centerline only (path/curveOffset
    fall back to the chord; noted in pascal_params)."""
    start, end = node["start"], node["end"]
    length = math.hypot(float(end[0]) - float(start[0]), float(end[1]) - float(start[1]))
    if length < 1e-6:
        return []

    height = float(_get(node, "height", 1.8))
    thickness = float(_get(node, "thickness", 0.08))
    base_height = float(_get(node, "baseHeight", 0.22))
    post_spacing = float(_get(node, "postSpacing", 2.0))
    post_size = float(_get(node, "postSize", 0.1))
    top_rail_h = float(_get(node, "topRailHeight", 0.04))
    clearance = float(_get(node, "groundClearance", 0.0))
    edge_inset = float(_get(node, "edgeInset", 0.015))
    slat_gap = float(_get(node, "slatGap", 0.01))
    style = str(_get(node, "style", "slat"))
    base_style = str(_get(node, "baseStyle", "grounded"))
    post_cap = str(_get(node, "postCap", "pyramid"))
    show_infill = bool(_get(node, "showInfill", True))

    boxes: List[Box] = []

    if style == "horizontal":
        # square posts at postSpacing + stacked full-length boards
        count = max(2, int((length - 2 * edge_inset) // post_spacing) + 1)
        for i in range(count):
            x = edge_inset + (length - 2 * edge_inset) * (i / (count - 1)) if count > 1 else length / 2
            boxes.append(((x, height / 2 + clearance, 0.0), (post_size, height, post_size), 0))
            if post_cap == "pyramid":
                boxes.append(((x, height + clearance + 0.03, 0.0), (post_size * 1.2, 0.06, post_size * 1.2), 0))
            elif post_cap == "flat":
                boxes.append(((x, height + clearance + 0.01, 0.0), (post_size * 1.3, 0.02, post_size * 1.3), 0))
        if show_infill:
            board_h = 0.145
            y = clearance + board_h / 2
            while y + board_h / 2 <= height + clearance:
                boxes.append(((length / 2, y, 0.0), (length, board_h, thickness * 0.6), 1))
                y += board_h + slat_gap
        return boxes

    spacing_f, post_f, base_f, top_f = FENCE_STYLE_FACTORS.get(style, FENCE_STYLE_FACTORS["slat"])
    base_h = max(base_height * base_f, 0.04)
    top_h = max(top_rail_h * top_f, 0.01)
    vertical_h = max(height - base_h - top_h, 0.08)
    post_w = max(post_size * post_f, 0.01)
    spacing = max(post_spacing * spacing_f, post_w * 1.2)
    count = max(2, int((length - 2 * edge_inset) // spacing) + 1) if show_infill else 2

    y0 = clearance
    # verticals: ends -> posts slot, intermediates -> infill slot
    for i in range(count):
        x = edge_inset + (length - 2 * edge_inset) * (i / (count - 1)) if count > 1 else length / 2
        slot = 0 if i in (0, count - 1) else 1
        boxes.append(((x, y0 + base_h + vertical_h / 2, 0.0), (post_w, vertical_h, thickness), slot))

    # base: grounded = kickboard + mid stringer; floating = bottom rail
    if base_style == "grounded":
        boxes.append(((length / 2, y0 + base_h / 2, 0.0), (length, base_h, thickness * 1.05), 2))
        boxes.append(((length / 2, y0 + base_h + vertical_h * 0.5, 0.0), (length, 0.03, thickness * 0.8), 2))
    else:
        boxes.append(((length / 2, y0 + base_h / 2, 0.0), (length, top_h, thickness * 1.1), 3))

    # top rail
    boxes.append(((length / 2, y0 + base_h + vertical_h + top_h / 2, 0.0), (length, top_h, thickness * 1.1), 3))
    return boxes


# --------------------------------------------------------------------------
# shelf — pure boxes, 4 styles (buildShelfGeometry port)
# --------------------------------------------------------------------------

# material slots: 0 shelves (boards), 1 frame, 2 back
def shelf_parts(node: Dict[str, Any]) -> List[Box]:
    width = float(_get(node, "width", 1.2))
    depth = float(_get(node, "depth", 0.3))
    t = float(_get(node, "thickness", 0.04))
    height = float(_get(node, "height", 0.9))
    style = str(_get(node, "style", "wall-shelf"))
    rows = int(_get(node, "rows", 1))
    columns = int(_get(node, "columns", 1))
    with_back = bool(_get(node, "withBack", False))
    with_sides = bool(_get(node, "withSides", True))
    with_bottom = bool(_get(node, "withBottom", False))
    bracket = str(_get(node, "bracketStyle", "minimal"))

    boxes: List[Box] = []
    board_ys = [r * (height / rows) + t / 2 for r in range(1, rows + 1)]
    unit_h = height + t
    inner_w = width - 2 * t if with_sides else width

    if style == "wall-shelf":
        for y in board_ys:
            boxes.append(((0.0, y, 0.0), (width, t, depth), 0))
        if bracket != "hidden":
            bx = width / 2 - min(0.12, width / 6)
            bw = max(0.04, depth * 0.2) if bracket == "industrial" else max(0.02, depth * 0.12)
            bd = depth * 0.95 if bracket == "industrial" else depth * 0.7
            for sx in (-bx, bx):
                boxes.append(((sx, height / 2, 0.0), (bw, height, bd), 1))
        return boxes

    if style == "bookshelf":
        for y in board_ys:
            boxes.append(((0.0, y, 0.0), (inner_w - 0.002, t, depth - 0.002), 0))
        if with_bottom:
            boxes.append(((0.0, t / 2, 0.0), (inner_w - 0.002, t, depth - 0.002), 0))
        if with_sides:
            for sx in (-(width / 2 - t / 2), width / 2 - t / 2):
                boxes.append(((sx, unit_h / 2, 0.0), (t, unit_h, depth), 1))
        else:
            post = max(0.025, t * 1.5)
            for sx in (-(width / 2 - post / 2), width / 2 - post / 2):
                for sz in (-(depth / 2 - post / 2), depth / 2 - post / 2):
                    boxes.append(((sx, unit_h / 2, sz), (post, unit_h, post), 1))
        if with_back:
            boxes.append(((0.0, unit_h / 2, -(depth / 2 - t / 2)), (inner_w, unit_h, t), 2))
        for c in range(1, columns):
            dx = -inner_w / 2 + c * inner_w / columns
            boxes.append(((dx, unit_h / 2, 0.0), (t, unit_h, depth - 0.002), 1))
        return boxes

    if style == "open-rack":
        board_t = max(0.02, t * 0.8)
        post = max(0.025, t * 1.5)
        for y in board_ys:
            boxes.append(((0.0, y, 0.0), (width - 2 * post - 0.002, board_t, depth - 0.002), 0))
        for sx in (-(width / 2 - post / 2), width / 2 - post / 2):
            for sz in (-(depth / 2 - post / 2), depth / 2 - post / 2):
                boxes.append(((sx, unit_h / 2, sz), (post, unit_h, post), 1))
        if with_back:
            for y in (unit_h * 0.25, unit_h * 0.75):
                boxes.append(((0.0, y, -(depth / 2 - 0.01)), (width - 2 * post, 0.04, 0.02), 2))
        return boxes

    # cubby: boards + always sides + always back + per-cell dividers
    for y in board_ys:
        boxes.append(((0.0, y, 0.0), (inner_w := width - 2 * t, t, depth - 0.002), 0))
    if with_bottom:
        boxes.append(((0.0, t / 2, 0.0), (inner_w, t, depth - 0.002), 0))
    for sx in (-(width / 2 - t / 2), width / 2 - t / 2):
        boxes.append(((sx, unit_h / 2, 0.0), (t, unit_h, depth), 1))
    boxes.append(((0.0, unit_h / 2, -(depth / 2 - t / 2)), (inner_w, unit_h, t), 2))
    for c in range(1, columns):
        dx = -inner_w / 2 + c * inner_w / columns
        boxes.append(((dx, unit_h / 2, 0.0), (t, unit_h, depth - 0.002), 1))
    return boxes
