"""Parametric door and window geometry for the Pascal Blender importer.

Pure-python port of the Pascal editor's ``updateDoorMesh`` /
``updateWindowMesh`` builders (spec: ``docs/spec/04-openings-and-items.md``
sections 2.x and 3.x; schema defaults in ``docs/spec/01-schema-census.md``
sections 6.13 / 6.14). No ``bpy`` — runs under plain python3 (3.9+).

Coordinate convention
=====================
The spec describes geometry in *Pascal wall-local* coordinates (Three.js,
Y-up): +X along the wall from start to end, +Y up, +Z the horizontal wall
normal ("front" face — where the handle, panel details and sill live).

The importer parents these meshes to a Blender wall object whose local
frame is: X along the wall, Y = wall normal, Z up. The mapping applied
uniformly to every emitted vertex is::

    Pascal wall-local (x, y, z)  ->  Blender local (x, -z, y)

i.e. Blender X = Pascal X, Blender Y = -(Pascal Z) (the spec's +Z "front"
face points toward Blender local -Y), Blender Z = Pascal Y (up). This is a
proper rotation (determinant +1), so outward face winding is preserved.

The origin of the returned geometry is the node's anchor point: the
door/window *center* (mesh spans -width/2..+width/2 in X and
-height/2..+height/2 in Z; depth is centered on the wall plane in Y).
A door node stores ``position[1] = height/2`` so the anchor at that height
puts the door base on the floor.

Mesh buffer format
==================
``MeshData = (vertices, faces, face_material_indices)`` where every
sub-part is an axis-aligned box appended as 8 vertices + 6 quad faces
(no vertex dedup). Material index 0 = base (opaque), 1 = glass.
"""

from __future__ import annotations

from typing import Any, Dict, List, Sequence, Tuple

MeshData = Tuple[
    List[Tuple[float, float, float]],  # vertices (Blender wall-local)
    List[Tuple[int, ...]],             # quad faces (vertex index tuples)
    List[int],                         # per-face material index: 0=base, 1=glass
]

# Material indices.
MAT_BASE = 0
MAT_GLASS = 1

# Fixed door-leaf depth (spec 2.2: leafDepth = 0.04).
LEAF_DEPTH = 0.04

# ---------------------------------------------------------------------------
# Defaults (spec 01-schema-census 6.13 / 6.14, 04-openings 2.1 / 3.1)
# ---------------------------------------------------------------------------

_DOOR_DEFAULTS = {
    "width": 0.9,
    "height": 2.1,
    "frameThickness": 0.05,
    "frameDepth": 0.07,
    "threshold": True,
    "thresholdHeight": 0.02,
    "hingesSide": "left",
    "handle": True,
    "handleHeight": 1.05,
    "handleSide": "right",
    "contentPadding": (0.04, 0.04),
    "doorCloser": False,
    "panicBar": False,
    "panicBarHeight": 1.0,
}

_SEGMENT_DEFAULTS = {
    "columnRatios": (1.0,),
    "dividerThickness": 0.03,
    "panelDepth": 0.01,
    "panelInset": 0.04,
}


def _default_door_segments() -> List[Dict[str, Any]]:
    """Classic two-panel door (spec 2.1 default ``segments``)."""
    return [
        {"type": "panel", "heightRatio": 0.4, "columnRatios": [1],
         "dividerThickness": 0.03, "panelDepth": 0.01, "panelInset": 0.04},
        {"type": "panel", "heightRatio": 0.6, "columnRatios": [1],
         "dividerThickness": 0.03, "panelDepth": 0.01, "panelInset": 0.04},
    ]


_WINDOW_DEFAULTS = {
    "width": 1.5,
    "height": 1.5,
    "frameThickness": 0.05,
    "frameDepth": 0.07,
    "columnRatios": (1.0,),
    "rowRatios": (1.0,),
    "columnDividerThickness": 0.03,
    "rowDividerThickness": 0.03,
    "sill": True,
    "sillDepth": 0.08,
    "sillThickness": 0.03,
}


def _get(params: Dict[str, Any], key: str, default: Any) -> Any:
    """Zod-default rule: missing key (or explicit null) -> default."""
    value = params.get(key)
    return default if value is None else value


def _ratios(values: Sequence[float]) -> List[float]:
    """Return ratios as floats; a non-positive sum falls back to equal split.

    (The spec normalizes by the plain sum and does not define zero-sum
    input; equal split is the defensive resolution.)
    """
    out = [float(v) for v in values] if values else [1.0]
    if sum(out) <= 0.0:
        out = [1.0] * len(out)
    return out


# ---------------------------------------------------------------------------
# Box emission
# ---------------------------------------------------------------------------

def _add_box(
    verts: List[Tuple[float, float, float]],
    faces: List[Tuple[int, ...]],
    mats: List[int],
    center: Tuple[float, float, float],
    size: Tuple[float, float, float],
    material: int = MAT_BASE,
) -> None:
    """Emit one axis-aligned box given *Pascal wall-local* center and size.

    ``center = (cx, cy, cz)`` and ``size = (sx, sy, sz)`` follow the spec's
    Three.js wall-local axes; the vertices are written in Blender wall-local
    coordinates via (x, y, z)_pascal -> (x, -z, y)_blender.
    """
    cx, cy, cz = center
    sx, sy, sz = size
    # Map to Blender local: X = x, Y = -z, Z = y (sizes: sx, sz, sy).
    bcx, bcy, bcz = cx, -cz, cy
    hx, hy, hz = sx / 2.0, sz / 2.0, sy / 2.0

    x0, x1 = bcx - hx, bcx + hx
    y0, y1 = bcy - hy, bcy + hy
    z0, z1 = bcz - hz, bcz + hz

    base = len(verts)
    verts.extend([
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ])
    # Outward-facing quads (CCW seen from outside).
    for quad in (
        (0, 3, 2, 1),  # -Z bottom
        (4, 5, 6, 7),  # +Z top
        (0, 1, 5, 4),  # -Y front (Pascal +Z feature face)
        (2, 3, 7, 6),  # +Y back
        (0, 4, 7, 3),  # -X
        (1, 2, 6, 5),  # +X
    ):
        faces.append(tuple(base + i for i in quad))
        mats.append(material)


# ---------------------------------------------------------------------------
# Door (spec 04 section 2.2, updateDoorMesh)
# ---------------------------------------------------------------------------

def build_door_geometry(params: dict) -> MeshData:
    """Build a parametric door from a raw DoorNode dict (defaults applied)."""
    width = float(_get(params, "width", _DOOR_DEFAULTS["width"]))
    height = float(_get(params, "height", _DOOR_DEFAULTS["height"]))
    frame_t = float(_get(params, "frameThickness", _DOOR_DEFAULTS["frameThickness"]))
    frame_d = float(_get(params, "frameDepth", _DOOR_DEFAULTS["frameDepth"]))
    threshold = bool(_get(params, "threshold", _DOOR_DEFAULTS["threshold"]))
    threshold_h = float(_get(params, "thresholdHeight", _DOOR_DEFAULTS["thresholdHeight"]))
    hinges_side = _get(params, "hingesSide", _DOOR_DEFAULTS["hingesSide"])
    handle = bool(_get(params, "handle", _DOOR_DEFAULTS["handle"]))
    handle_h = float(_get(params, "handleHeight", _DOOR_DEFAULTS["handleHeight"]))
    handle_side = _get(params, "handleSide", _DOOR_DEFAULTS["handleSide"])
    padding = _get(params, "contentPadding", _DOOR_DEFAULTS["contentPadding"])
    door_closer = bool(_get(params, "doorCloser", _DOOR_DEFAULTS["doorCloser"]))
    panic_bar = bool(_get(params, "panicBar", _DOOR_DEFAULTS["panicBar"]))
    panic_bar_h = float(_get(params, "panicBarHeight", _DOOR_DEFAULTS["panicBarHeight"]))
    segments = _get(params, "segments", None)
    if not segments:
        segments = _default_door_segments()

    cp_x, cp_y = float(padding[0]), float(padding[1])

    verts: List[Tuple[float, float, float]] = []
    faces: List[Tuple[int, ...]] = []
    mats: List[int] = []

    # Derived constants (spec 2.2).
    leaf_w = width - 2.0 * frame_t          # leaf spans full opening width
    leaf_h = height - frame_t               # no bottom frame bar
    leaf_depth = LEAF_DEPTH
    leaf_cy = -frame_t / 2.0                # leaf shifted down by half top bar

    # 1-2. Frame posts (full height).
    _add_box(verts, faces, mats,
             (-width / 2.0 + frame_t / 2.0, 0.0, 0.0), (frame_t, height, frame_d))
    _add_box(verts, faces, mats,
             (width / 2.0 - frame_t / 2.0, 0.0, 0.0), (frame_t, height, frame_d))
    # 3. Head (top bar). No bottom frame bar.
    _add_box(verts, faces, mats,
             (0.0, height / 2.0 - frame_t / 2.0, 0.0), (width, frame_t, frame_d))
    # 4. Threshold.
    if threshold:
        _add_box(verts, faces, mats,
                 (0.0, -height / 2.0 + threshold_h / 2.0, 0.0),
                 (leaf_w, threshold_h, frame_d))

    # 5. Leaf border strips (contentPadding), depth leafDepth, centered z=0.
    if cp_y > 0.0:
        _add_box(verts, faces, mats,
                 (0.0, leaf_cy + leaf_h / 2.0 - cp_y / 2.0, 0.0),
                 (leaf_w, cp_y, leaf_depth))
        _add_box(verts, faces, mats,
                 (0.0, leaf_cy - leaf_h / 2.0 + cp_y / 2.0, 0.0),
                 (leaf_w, cp_y, leaf_depth))
    if cp_x > 0.0:
        inner_h = leaf_h - 2.0 * cp_y
        _add_box(verts, faces, mats,
                 (-leaf_w / 2.0 + cp_x / 2.0, leaf_cy, 0.0),
                 (cp_x, inner_h, leaf_depth))
        _add_box(verts, faces, mats,
                 (leaf_w / 2.0 - cp_x / 2.0, leaf_cy, 0.0),
                 (cp_x, inner_h, leaf_depth))

    # 6. Content area.
    content_w = leaf_w - 2.0 * cp_x
    content_h = leaf_h - 2.0 * cp_y

    # 7. Segments — stacked top -> bottom; first entry is the top row.
    height_ratios = _ratios([float(_get(s, "heightRatio", 1.0)) for s in segments])
    total_ratio = sum(height_ratios)
    content_top = leaf_cy + content_h / 2.0
    seg_y = content_top
    for seg, h_ratio in zip(segments, height_ratios):
        seg_type = _get(seg, "type", "panel")
        col_ratios = _ratios(_get(seg, "columnRatios", _SEGMENT_DEFAULTS["columnRatios"]))
        divider_t = float(_get(seg, "dividerThickness", _SEGMENT_DEFAULTS["dividerThickness"]))
        panel_depth = float(_get(seg, "panelDepth", _SEGMENT_DEFAULTS["panelDepth"]))
        panel_inset = float(_get(seg, "panelInset", _SEGMENT_DEFAULTS["panelInset"]))

        seg_h = (h_ratio / total_ratio) * content_h
        seg_cy = seg_y - seg_h / 2.0

        num_cols = len(col_ratios)
        col_sum = sum(col_ratios)
        usable_w = content_w - (num_cols - 1) * divider_t
        col_widths = [(r / col_sum) * usable_w for r in col_ratios]

        # Column centers left (-X) -> right (+X); vertical dividers between
        # columns of THIS segment only.
        col_x: List[float] = []
        cursor = -content_w / 2.0
        for c in range(num_cols):
            col_x.append(cursor + col_widths[c] / 2.0)
            cursor += col_widths[c]
            if c < num_cols - 1:
                _add_box(verts, faces, mats,
                         (cursor + divider_t / 2.0, seg_cy, 0.0),
                         (divider_t, seg_h, leaf_depth + 0.001))
                cursor += divider_t

        # Per-column fill.
        for c in range(num_cols):
            col_w = col_widths[c]
            if seg_type == "glass":
                glass_depth = max(0.004, leaf_depth * 0.15)  # = 0.006 default
                _add_box(verts, faces, mats,
                         (col_x[c], seg_cy, 0.0), (col_w, seg_h, glass_depth),
                         MAT_GLASS)
                # NO opaque backing — see-through.
            elif seg_type == "panel":
                _add_box(verts, faces, mats,
                         (col_x[c], seg_cy, 0.0), (col_w, seg_h, leaf_depth))
                panel_w = col_w - 2.0 * panel_inset
                panel_h = seg_h - 2.0 * panel_inset
                if panel_w > 0.01 and panel_h > 0.01:
                    eff_depth = 0.005 if abs(panel_depth) < 0.002 else abs(panel_depth)
                    panel_z = leaf_depth / 2.0 + eff_depth / 2.0  # +front face only
                    _add_box(verts, faces, mats,
                             (col_x[c], seg_cy, panel_z),
                             (panel_w, panel_h, eff_depth))
            else:  # 'empty' — flush flat fill
                _add_box(verts, faces, mats,
                         (col_x[c], seg_cy, 0.0), (col_w, seg_h, leaf_depth))

        seg_y -= seg_h  # no horizontal divider between segments

    # 8. Handle — front (+Z in Pascal, -Y in Blender) face only.
    if handle:
        handle_y = handle_h - height / 2.0  # floor-based -> center-based
        face_z = leaf_depth / 2.0
        handle_x = (leaf_w / 2.0 - 0.045) if handle_side == "right" \
            else (-leaf_w / 2.0 + 0.045)
        _add_box(verts, faces, mats,
                 (handle_x, handle_y, face_z + 0.005), (0.028, 0.14, 0.01))
        _add_box(verts, faces, mats,
                 (handle_x, handle_y, face_z + 0.025), (0.022, 0.10, 0.035))

    # 9. Door closer — front face, near top of leaf.
    if door_closer:
        closer_y = leaf_cy + leaf_h / 2.0 - 0.04
        _add_box(verts, faces, mats,
                 (0.0, closer_y, leaf_depth / 2.0 + 0.03), (0.28, 0.055, 0.055))
        _add_box(verts, faces, mats,
                 (leaf_w / 4.0, closer_y + 0.025, leaf_depth / 2.0 + 0.015),
                 (0.14, 0.015, 0.015))

    # 10. Panic bar.
    if panic_bar:
        bar_y = panic_bar_h - height / 2.0
        _add_box(verts, faces, mats,
                 (0.0, bar_y, leaf_depth / 2.0 + 0.03),
                 (leaf_w * 0.72, 0.04, 0.055))

    # 11. Hinges — always drawn, 3 of them, centered in leaf depth (z = 0).
    hinge_x = (leaf_w / 2.0 - 0.012) if hinges_side == "right" \
        else (-leaf_w / 2.0 + 0.012)
    leaf_bottom = leaf_cy - leaf_h / 2.0
    leaf_top = leaf_cy + leaf_h / 2.0
    for hinge_y in (leaf_bottom + 0.25, (leaf_bottom + leaf_top) / 2.0,
                    leaf_top - 0.25):
        _add_box(verts, faces, mats,
                 (hinge_x, hinge_y, 0.0), (0.024, 0.1, leaf_depth + 0.016))

    return verts, faces, mats


# ---------------------------------------------------------------------------
# Window (spec 04 section 3.2, updateWindowMesh)
# ---------------------------------------------------------------------------

def build_window_geometry(params: dict) -> MeshData:
    """Build a parametric window from a raw WindowNode dict (defaults applied)."""
    width = float(_get(params, "width", _WINDOW_DEFAULTS["width"]))
    height = float(_get(params, "height", _WINDOW_DEFAULTS["height"]))
    frame_t = float(_get(params, "frameThickness", _WINDOW_DEFAULTS["frameThickness"]))
    frame_d = float(_get(params, "frameDepth", _WINDOW_DEFAULTS["frameDepth"]))
    col_ratios = _ratios(_get(params, "columnRatios", _WINDOW_DEFAULTS["columnRatios"]))
    row_ratios = _ratios(_get(params, "rowRatios", _WINDOW_DEFAULTS["rowRatios"]))
    col_div = float(_get(params, "columnDividerThickness",
                         _WINDOW_DEFAULTS["columnDividerThickness"]))
    row_div = float(_get(params, "rowDividerThickness",
                         _WINDOW_DEFAULTS["rowDividerThickness"]))
    sill = bool(_get(params, "sill", _WINDOW_DEFAULTS["sill"]))
    sill_depth = float(_get(params, "sillDepth", _WINDOW_DEFAULTS["sillDepth"]))
    sill_t = float(_get(params, "sillThickness", _WINDOW_DEFAULTS["sillThickness"]))

    verts: List[Tuple[float, float, float]] = []
    faces: List[Tuple[int, ...]] = []
    mats: List[int] = []

    inner_w = width - 2.0 * frame_t
    inner_h = height - 2.0 * frame_t

    # 1. Frame (all frameDepth deep, centered z=0). Posts use inner height so
    # they don't overlap the bars at corners.
    _add_box(verts, faces, mats,
             (0.0, height / 2.0 - frame_t / 2.0, 0.0), (width, frame_t, frame_d))
    _add_box(verts, faces, mats,
             (0.0, -height / 2.0 + frame_t / 2.0, 0.0), (width, frame_t, frame_d))
    _add_box(verts, faces, mats,
             (-width / 2.0 + frame_t / 2.0, 0.0, 0.0), (frame_t, inner_h, frame_d))
    _add_box(verts, faces, mats,
             (width / 2.0 - frame_t / 2.0, 0.0, 0.0), (frame_t, inner_h, frame_d))

    # 2. Pane grid — ratios normalized by their sum.
    num_cols = len(col_ratios)
    num_rows = len(row_ratios)
    usable_w = inner_w - (num_cols - 1) * col_div
    usable_h = inner_h - (num_rows - 1) * row_div
    col_sum = sum(col_ratios)
    row_sum = sum(row_ratios)
    col_widths = [(r / col_sum) * usable_w for r in col_ratios]
    row_heights = [(r / row_sum) * usable_h for r in row_ratios]

    # Column centers left -> right; row centers TOP -> BOTTOM (first
    # rowRatio = top row).
    col_x: List[float] = []
    cursor = -inner_w / 2.0
    for c in range(num_cols):
        col_x.append(cursor + col_widths[c] / 2.0)
        cursor += col_widths[c] + col_div
    row_y: List[float] = []
    cursor = inner_h / 2.0
    for r in range(num_rows):
        row_y.append(cursor - row_heights[r] / 2.0)
        cursor -= row_heights[r] + row_div

    # 3. Column dividers — full inner height.
    for c in range(num_cols - 1):
        div_x = col_x[c] + col_widths[c] / 2.0 + col_div / 2.0
        _add_box(verts, faces, mats,
                 (div_x, 0.0, 0.0), (col_div, inner_h, frame_d))

    # 4. Row dividers — one box PER COLUMN so they don't overlap the column
    # dividers.
    for r in range(num_rows - 1):
        div_y = row_y[r] - row_heights[r] / 2.0 - row_div / 2.0
        for c in range(num_cols):
            _add_box(verts, faces, mats,
                     (col_x[c], div_y, 0.0), (col_widths[c], row_div, frame_d))

    # 5. Glass panes.
    glass_depth = max(0.004, frame_d * 0.08)  # = 0.0056 at default
    for r in range(num_rows):
        for c in range(num_cols):
            _add_box(verts, faces, mats,
                     (col_x[c], row_y[r], 0.0),
                     (col_widths[c], row_heights[r], glass_depth),
                     MAT_GLASS)

    # 6. Sill — front (+Z) face only, hangs BELOW the window rectangle.
    if sill:
        sill_w = width + sill_depth * 0.4  # slightly wider than frame
        sill_z = frame_d / 2.0 + sill_depth / 2.0
        _add_box(verts, faces, mats,
                 (0.0, -height / 2.0 - sill_t / 2.0, sill_z),
                 (sill_w, sill_t, sill_depth))

    return verts, faces, mats


# ---------------------------------------------------------------------------
# Wall cutouts (spec 04 section 1.6: hole exactly matches the outer rectangle)
# ---------------------------------------------------------------------------

def door_cutout_size(params: dict) -> Tuple[float, float]:
    """(width, height) of the wall hole for a door node."""
    return (float(_get(params, "width", _DOOR_DEFAULTS["width"])),
            float(_get(params, "height", _DOOR_DEFAULTS["height"])))


def window_cutout_size(params: dict) -> Tuple[float, float]:
    """(width, height) of the wall hole for a window node."""
    return (float(_get(params, "width", _WINDOW_DEFAULTS["width"])),
            float(_get(params, "height", _WINDOW_DEFAULTS["height"])))
