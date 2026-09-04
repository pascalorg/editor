"""Plain-python tests for pascal_blender.core.openings (no pytest).

Run with:  python3 tests/test_openings.py
Exits nonzero on failure. No bpy required.

Axis convention under test (module docstring): Pascal wall-local
(x, y, z) -> Blender local (x, -z, y). So Blender X = width axis,
Blender Y = depth axis (front face toward -Y), Blender Z = height axis.
"""

from __future__ import annotations

import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pascal_blender.core.openings import (  # noqa: E402
    MAT_BASE,
    MAT_GLASS,
    build_door_geometry,
    build_window_geometry,
    door_cutout_size,
    window_cutout_size,
)

BBOX_TOL = 1e-9
PART_TOL = 1e-6


def approx(a, b, tol):
    return abs(a - b) <= tol


def bbox(verts):
    """((minx, miny, minz), (maxx, maxy, maxz)) of a vertex list."""
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    zs = [v[2] for v in verts]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def box_info(mesh, i):
    """Center, size and material of the i-th emitted box (8 verts / 6 faces)."""
    verts, _faces, mats = mesh
    assert len(verts) >= 8 * (i + 1), "box index %d out of range" % i
    (mn, mx) = bbox(verts[8 * i:8 * i + 8])
    center = tuple((mn[k] + mx[k]) / 2.0 for k in range(3))
    size = tuple(mx[k] - mn[k] for k in range(3))
    return center, size, mats[6 * i]


def num_boxes(mesh):
    verts, faces, mats = mesh
    assert len(verts) % 8 == 0 and len(faces) % 6 == 0
    assert len(mats) == len(faces)
    assert len(faces) == 6 * (len(verts) // 8)
    return len(verts) // 8


def glass_box_count(mesh):
    _verts, _faces, mats = mesh
    n = sum(1 for m in mats if m == MAT_GLASS)
    assert n % 6 == 0, "glass faces should come in whole boxes"
    return n // 6


def check(cond, msg):
    assert cond, msg


# ---------------------------------------------------------------------------
# 1. Bounding boxes
# ---------------------------------------------------------------------------

def test_default_door_bbox():
    width, height, frame_d, leaf_depth = 0.9, 2.1, 0.07, 0.04
    mesh = build_door_geometry({})
    mn, mx = bbox(mesh[0])
    # Frame outer bounds: X = width, Z = height.
    check(approx(mn[0], -width / 2.0, BBOX_TOL), "door min X")
    check(approx(mx[0], width / 2.0, BBOX_TOL), "door max X")
    check(approx(mn[2], -height / 2.0, BBOX_TOL), "door min Z")
    check(approx(mx[2], height / 2.0, BBOX_TOL), "door max Z")
    # Depth: back bound = frameDepth/2; the default handle grip protrudes on
    # the front (-Y) face past the frame: leafDepth/2 + 0.025 + 0.035/2.
    handle_front = leaf_depth / 2.0 + 0.025 + 0.035 / 2.0
    check(approx(mx[1], frame_d / 2.0, BBOX_TOL), "door max Y (back of frame)")
    check(approx(mn[1], -handle_front, BBOX_TOL), "door min Y (handle grip front)")
    # Without the handle nothing passes the frame: exact width x depth x height.
    plain = build_door_geometry({"handle": False})
    mn, mx = bbox(plain[0])
    for got, want, name in (
        (mx[0] - mn[0], width, "width"),
        (mx[1] - mn[1], frame_d, "depth"),
        (mx[2] - mn[2], height, "height"),
    ):
        check(approx(got, want, BBOX_TOL), "handleless door bbox %s" % name)
    check(approx(mn[1], -frame_d / 2.0, BBOX_TOL), "handleless door Y centered")
    check(approx(mx[1], frame_d / 2.0, BBOX_TOL), "handleless door Y centered")


def test_default_window_bbox():
    width, height, frame_d = 1.5, 1.5, 0.07
    sill_depth, sill_t = 0.08, 0.03
    mesh = build_window_geometry({})
    mn, mx = bbox(mesh[0])
    # Sill extends per spec: sillW = width + sillDepth*0.4 (X), hangs
    # sillThickness below (-Z) and protrudes sillDepth off the front (-Y).
    sill_w = width + sill_depth * 0.4
    check(approx(mn[0], -sill_w / 2.0, BBOX_TOL), "window min X (sill)")
    check(approx(mx[0], sill_w / 2.0, BBOX_TOL), "window max X (sill)")
    check(approx(mx[2], height / 2.0, BBOX_TOL), "window max Z")
    check(approx(mn[2], -height / 2.0 - sill_t, BBOX_TOL), "window min Z (sill)")
    check(approx(mx[1], frame_d / 2.0, BBOX_TOL), "window max Y")
    check(approx(mn[1], -(frame_d / 2.0 + sill_depth), BBOX_TOL),
          "window min Y (sill front)")
    # Without the sill: exact width x depth x height, centered.
    plain = build_window_geometry({"sill": False})
    mn, mx = bbox(plain[0])
    for got, want, name in (
        (mx[0] - mn[0], width, "width"),
        (mx[1] - mn[1], frame_d, "depth"),
        (mx[2] - mn[2], height, "height"),
    ):
        check(approx(got, want, BBOX_TOL), "sill-less window bbox %s" % name)
    for k in range(3):
        check(approx(mn[k], -mx[k], BBOX_TOL), "sill-less window centered axis %d" % k)


# ---------------------------------------------------------------------------
# 2. Sub-part dimensions (spec constants)
# ---------------------------------------------------------------------------

def test_door_subparts():
    width, height = 0.9, 2.1
    frame_t, frame_d, leaf_depth = 0.05, 0.07, 0.04
    mesh = build_door_geometry({})
    # Build order: 0 left post, 1 right post, 2 head, 3 threshold,
    # 4 top strip, 5 bottom strip, 6 left strip, 7 right strip,
    # 8 seg1 backing, 9 seg1 panel, 10 seg2 backing, 11 seg2 panel,
    # 12 handle backplate, 13 handle grip, 14-16 hinges.
    check(num_boxes(mesh) == 17, "default door box count")

    # Frame post: frameThickness x height x frameDepth -> Blender (X, Y, Z) =
    # (frameThickness, frameDepth, height).
    c, s, m = box_info(mesh, 0)
    check(all(approx(a, b, PART_TOL) for a, b in zip(s, (frame_t, frame_d, height))),
          "left frame post size %r" % (s,))
    check(approx(c[0], -width / 2.0 + frame_t / 2.0, PART_TOL) and
          approx(c[1], 0.0, PART_TOL) and approx(c[2], 0.0, PART_TOL),
          "left frame post center %r" % (c,))
    check(m == MAT_BASE, "frame post material")

    # Leaf: height = height - frameThickness, center Z = -frameThickness/2.
    leaf_h = height - frame_t
    leaf_cz = -frame_t / 2.0
    top_c, top_s, _ = box_info(mesh, 4)
    bot_c, bot_s, _ = box_info(mesh, 5)
    leaf_top = top_c[2] + top_s[2] / 2.0
    leaf_bottom = bot_c[2] - bot_s[2] / 2.0
    check(approx(leaf_top - leaf_bottom, leaf_h, PART_TOL),
          "leaf height %f" % (leaf_top - leaf_bottom))
    check(approx((leaf_top + leaf_bottom) / 2.0, leaf_cz, PART_TOL), "leaf center Z")
    check(approx(leaf_bottom, -height / 2.0, PART_TOL), "leaf reaches the floor")
    check(approx(top_s[1], leaf_depth, PART_TOL), "leaf strip depth")

    # Threshold: leafW x thresholdHeight x frameDepth at the floor.
    leaf_w = width - 2.0 * frame_t
    c, s, m = box_info(mesh, 3)
    check(all(approx(a, b, PART_TOL) for a, b in zip(s, (leaf_w, frame_d, 0.02))),
          "threshold size %r" % (s,))
    check(approx(c[2], -height / 2.0 + 0.01, PART_TOL), "threshold center Z")
    check(m == MAT_BASE, "threshold material")

    # Handle: backplate + grip on the front (-Y) face, right side,
    # centered at handleHeight above the floor (1.05 = height/2 -> Z 0).
    c, s, _ = box_info(mesh, 12)
    check(all(approx(a, b, PART_TOL) for a, b in zip(s, (0.028, 0.01, 0.14))),
          "handle backplate size %r" % (s,))
    check(approx(c[0], leaf_w / 2.0 - 0.045, PART_TOL), "handle X (right side)")
    check(approx(c[2], 1.05 - height / 2.0, PART_TOL), "handle Z (height 1.05)")
    check(approx(c[1], -(leaf_depth / 2.0 + 0.005), PART_TOL), "backplate Y (front)")
    c, s, _ = box_info(mesh, 13)
    check(all(approx(a, b, PART_TOL) for a, b in zip(s, (0.022, 0.035, 0.10))),
          "handle grip size %r" % (s,))
    check(approx(c[1], -(leaf_depth / 2.0 + 0.025), PART_TOL), "grip Y (front)")

    # Left-handle variant mirrors X.
    lmesh = build_door_geometry({"handleSide": "left"})
    c, _, _ = box_info(lmesh, 12)
    check(approx(c[0], -leaf_w / 2.0 + 0.045, PART_TOL), "handle X (left side)")


def test_window_subparts():
    width, height, frame_t, frame_d = 1.5, 1.5, 0.05, 0.07
    mesh = build_window_geometry({})
    # Build order: 0 top bar, 1 bottom bar, 2 left post, 3 right post,
    # 4 glass, 5 sill.
    check(num_boxes(mesh) == 6, "default window box count")
    inner_w = width - 2.0 * frame_t
    inner_h = height - 2.0 * frame_t

    # Frame post: frameThickness x innerH x frameDepth.
    c, s, m = box_info(mesh, 2)
    check(all(approx(a, b, PART_TOL) for a, b in zip(s, (frame_t, frame_d, inner_h))),
          "window left post size %r" % (s,))
    check(approx(c[0], -width / 2.0 + frame_t / 2.0, PART_TOL) and
          approx(c[2], 0.0, PART_TOL), "window left post center")
    check(m == MAT_BASE, "window post material")
    # Top bar spans the full width.
    _, s, _ = box_info(mesh, 0)
    check(all(approx(a, b, PART_TOL) for a, b in zip(s, (width, frame_d, frame_t))),
          "window top bar size %r" % (s,))

    # Single default pane: innerW x innerH x max(0.004, frameDepth*0.08).
    c, s, m = box_info(mesh, 4)
    glass_depth = max(0.004, frame_d * 0.08)
    check(all(approx(a, b, PART_TOL) for a, b in zip(s, (inner_w, glass_depth, inner_h))),
          "default pane size %r" % (s,))
    check(m == MAT_GLASS, "pane material")

    # Sill: (width + sillDepth*0.4) x sillThickness x sillDepth, below the
    # frame, protruding off the front (-Y) face.
    c, s, m = box_info(mesh, 5)
    check(all(approx(a, b, PART_TOL) for a, b in zip(s, (width + 0.08 * 0.4, 0.08, 0.03))),
          "sill size %r" % (s,))
    check(approx(c[2], -height / 2.0 - 0.015, PART_TOL), "sill hangs below frame")
    check(approx(c[1], -(frame_d / 2.0 + 0.08 / 2.0), PART_TOL), "sill front of frame")
    check(m == MAT_BASE, "sill material")


def test_window_grid_2x2():
    # columnRatios [0.6, 0.4], rowRatios [1, 1] -> 4 panes, 1 column divider,
    # 2 row-divider boxes (one per column).
    params = {"columnRatios": [0.6, 0.4], "rowRatios": [1, 1]}
    mesh = build_window_geometry(params)
    check(glass_box_count(mesh) == 4, "2x2 window should have 4 glass panes")
    check(num_boxes(mesh) == 4 + 1 + 2 + 4 + 1, "2x2 window box count")
    # Pane widths honour the 0.6/0.4 split of the usable width.
    inner_w = 1.5 - 2 * 0.05
    inner_h = 1.5 - 2 * 0.05
    usable_w = inner_w - 0.03
    usable_h = inner_h - 0.03
    # Boxes: 0-3 frame, 4 column divider, 5-6 row dividers, 7-10 glass, 11 sill.
    c, s, m = box_info(mesh, 7)  # first pane = top-left
    check(m == MAT_GLASS, "pane 0 material")
    check(approx(s[0], 0.6 * usable_w, PART_TOL), "pane 0 width")
    check(approx(s[2], 0.5 * usable_h, PART_TOL), "pane 0 height")
    check(approx(c[2], inner_h / 2.0 - 0.5 * usable_h / 2.0, PART_TOL),
          "first row is the TOP row")
    # Column divider runs the full inner height.
    _, s, m = box_info(mesh, 4)
    check(m == MAT_BASE and approx(s[0], 0.03, PART_TOL)
          and approx(s[2], inner_h, PART_TOL), "column divider dims")
    # Row divider boxes are per-column wide.
    _, s, _ = box_info(mesh, 5)
    check(approx(s[0], 0.6 * usable_w, PART_TOL)
          and approx(s[2], 0.03, PART_TOL), "row divider (col 0) dims")


def test_door_glass_segment():
    params = {"segments": [
        {"type": "glass", "heightRatio": 0.3},
        {"type": "panel", "heightRatio": 0.7},
    ]}
    mesh = build_door_geometry(params)
    check(glass_box_count(mesh) == 1, "door glass segment -> 1 glass box")
    # Glass depth = max(0.004, leafDepth*0.15) = 0.006; glass box is the one
    # right after the 8 frame/threshold/strip boxes (segment 1, single column).
    _, s, m = box_info(mesh, 8)
    check(m == MAT_GLASS, "glass segment material")
    check(approx(s[1], 0.006, PART_TOL), "door glass depth 0.006")
    # Ratio normalization: 0.3/(0.3+0.7) of the content height.
    leaf_h = 2.1 - 0.05
    content_h = leaf_h - 2 * 0.04
    check(approx(s[2], 0.3 * content_h, PART_TOL), "glass segment height")


# ---------------------------------------------------------------------------
# 3. Material indices
# ---------------------------------------------------------------------------

def test_material_indices():
    window = build_window_geometry({})
    w_mats = set(window[2])
    check(w_mats == {MAT_BASE, MAT_GLASS}, "window must use both materials")
    door = build_door_geometry({})  # default segments are all 'panel'
    check(set(door[2]) == {MAT_BASE}, "all-panel door must have no glass")
    check(MAT_GLASS not in door[2], "all-panel door: no material index 1")


# ---------------------------------------------------------------------------
# 4. Cutouts
# ---------------------------------------------------------------------------

def test_cutout_sizes():
    check(door_cutout_size({}) == (0.9, 2.1), "default door cutout")
    check(window_cutout_size({}) == (1.5, 1.5), "default window cutout")
    check(door_cutout_size({"width": 1.2, "height": 2.4}) == (1.2, 2.4),
          "custom door cutout")
    check(window_cutout_size({"width": 0.8, "height": 1.0}) == (0.8, 1.0),
          "custom window cutout")


# ---------------------------------------------------------------------------

def main():
    tests = [
        test_default_door_bbox,
        test_default_window_bbox,
        test_door_subparts,
        test_window_subparts,
        test_window_grid_2x2,
        test_door_glass_segment,
        test_material_indices,
        test_cutout_sizes,
    ]
    failures = 0
    for t in tests:
        try:
            t()
            print("PASS %s" % t.__name__)
        except Exception:
            failures += 1
            print("FAIL %s" % t.__name__)
            traceback.print_exc()
    if failures:
        print("%d/%d tests failed" % (failures, len(tests)))
        sys.exit(1)
    print("All %d tests passed" % len(tests))


if __name__ == "__main__":
    main()
