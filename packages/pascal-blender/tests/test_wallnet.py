"""Plain-python tests for pascal_blender.core.wallnet (no bpy, no pytest).

Run: python3 tests/test_wallnet.py   (exits nonzero on failure)
"""
from __future__ import annotations

import json
import math
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pascal_blender.core.wallnet import wall_footprints  # noqa: E402

FIXTURE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "fixtures", "demo_1.json"
)
TOL = 1e-9


def assert_close(actual, expected, msg="", tol=TOL):
    if abs(actual - expected) > tol:
        raise AssertionError(
            "%s: %.15g != expected %.15g (diff %.3g)"
            % (msg, actual, expected, abs(actual - expected))
        )


def assert_polygon(actual, expected, msg="", tol=TOL):
    if len(actual) != len(expected):
        raise AssertionError(
            "%s: %d points, expected %d — %r" % (msg, len(actual), len(expected), actual)
        )
    for i, ((ax, az), (ex, ez)) in enumerate(zip(actual, expected)):
        assert_close(ax, ex, "%s: point %d x" % (msg, i), tol)
        assert_close(az, ez, "%s: point %d z" % (msg, i), tol)


def polygon_contains_point(polygon, point, tol=TOL):
    return any(
        abs(px - point[0]) <= tol and abs(pz - point[1]) <= tol
        for px, pz in polygon
    )


def signed_area(polygon):
    s = 0.0
    n = len(polygon)
    for i in range(n):
        x1, z1 = polygon[i]
        x2, z2 = polygon[(i + 1) % n]
        s += x1 * z2 - x2 * z1
    return s / 2.0


def world_to_local(point, start, end):
    """Rotate by -wallAngle around start (spec 8.2)."""
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    cos_a = math.cos(-angle)
    sin_a = math.sin(-angle)
    dx = point[0] - start[0]
    dy = point[1] - start[1]
    return (dx * cos_a - dy * sin_a, dx * sin_a + dy * cos_a)


def wall(start, end, thickness=None):
    node = {"start": list(start), "end": list(end)}
    if thickness is not None:
        node["thickness"] = thickness
    return node


def test_single_wall_rectangle():
    """1. Single isolated wall -> exact rectangle."""
    fps = wall_footprints({"w": wall((1.0, 2.0), (4.0, 2.0), thickness=0.2)})
    assert_polygon(
        fps["w"],
        [(0.0, -0.1), (3.0, -0.1), (3.0, 0.1), (0.0, 0.1)],
        "single wall",
    )
    if signed_area(fps["w"]) <= 0:
        raise AssertionError("single wall polygon is not CCW")

    # Default thickness 0.1 and non-axis-aligned direction.
    fps = wall_footprints({"w": wall((0.0, 0.0), (3.0, 4.0))})
    assert_polygon(
        fps["w"],
        [(0.0, -0.05), (5.0, -0.05), (5.0, 0.05), (0.0, 0.05)],
        "diagonal wall",
    )


def test_collinear_butt_joint():
    """2. Two collinear walls sharing an endpoint -> both plain rectangles."""
    walls = {
        "a": wall((0.0, 0.0), (3.0, 0.0)),
        "b": wall((3.0, 0.0), (7.0, 0.0)),
    }
    fps = wall_footprints(walls)
    assert_polygon(
        fps["a"], [(0.0, -0.05), (3.0, -0.05), (3.0, 0.05), (0.0, 0.05)], "collinear a"
    )
    assert_polygon(
        fps["b"], [(0.0, -0.05), (4.0, -0.05), (4.0, 0.05), (0.0, 0.05)], "collinear b"
    )


def test_l_corner_miter():
    """3. L-corner -> miter points match hand-computed values.

    Same geometry as the demo (13,0) corner: A (9,0)->(13,0) meets
    B (13,0)->(13,6). Verified world miter points (12.95,0.05)/(13.05,-0.05).
    """
    a_start, a_end = (9.0, 0.0), (13.0, 0.0)
    b_start, b_end = (13.0, 0.0), (13.0, 6.0)
    fps = wall_footprints({"a": wall(a_start, a_end), "b": wall(b_start, b_end)})

    m1 = (12.95, 0.05)
    m2 = (13.05, -0.05)

    # A: end junction -> 5-gon [startRight, endRight, apex, endLeft, startLeft]
    expected_a = [
        (0.0, -0.05),
        world_to_local(m2, a_start, a_end),  # endRight = junction.left
        world_to_local((13.0, 0.0), a_start, a_end),  # apex = raw end
        world_to_local(m1, a_start, a_end),  # endLeft = junction.right (SWAP)
        (0.0, 0.05),
    ]
    assert_polygon(fps["a"], expected_a, "L-corner wall a")
    assert_polygon(
        fps["a"],
        [(0.0, -0.05), (4.05, -0.05), (4.0, 0.0), (3.95, 0.05), (0.0, 0.05)],
        "L-corner wall a (hand values)",
    )

    # B: start junction -> 5-gon [startRight, endRight, endLeft, startLeft, apex]
    expected_b = [
        world_to_local(m2, b_start, b_end),  # startRight = junction.right
        (6.0, -0.05),
        (6.0, 0.05),
        world_to_local(m1, b_start, b_end),  # startLeft = junction.left
        world_to_local((13.0, 0.0), b_start, b_end),  # apex = raw start
    ]
    assert_polygon(fps["b"], expected_b, "L-corner wall b")
    assert_polygon(
        fps["b"],
        [(-0.05, -0.05), (6.0, -0.05), (6.0, 0.05), (0.05, 0.05), (0.0, 0.0)],
        "L-corner wall b (hand values)",
    )


def test_t_junction():
    """4. T-junction: through-wall unchanged; abutting wall miters flush
    against the through-wall's near side edge, plus the centerline apex."""
    walls = {
        "through": wall((0.0, 0.0), (10.0, 0.0)),
        "abut": wall((5.0, 0.0), (5.0, 3.0)),
    }
    fps = wall_footprints(walls)

    # Passthrough wall never receives miter points -> plain rectangle.
    assert_polygon(
        fps["through"],
        [(0.0, -0.05), (10.0, -0.05), (10.0, 0.05), (0.0, 0.05)],
        "T through-wall",
    )

    # Abutting wall (start at the junction). Hand computation per spec 5:
    # sorted ring [through(+x), abut(+y), through(-x)];
    # abut.right = through(+x).left x abut.right edges -> (5.05, 0.05)
    # abut.left  = abut.left x through(-x).right edges -> (4.95, 0.05)
    # + apex (5, 0). Local frame (start (5,0), dir +y): world (x,y) ->
    # local (y, 5 - x).
    assert_polygon(
        fps["abut"],
        [(0.05, -0.05), (3.0, -0.05), (3.0, 0.05), (0.05, 0.05), (0.0, 0.0)],
        "T abutting wall",
    )


def test_demo_fixture():
    """5. Real demo_1.json: L-corner miters, collinear joint, extents."""
    with open(FIXTURE) as fh:
        scene = json.load(fh)
    walls = {
        node_id: node
        for node_id, node in scene["nodes"].items()
        if node.get("type") == "wall"
    }
    if len(walls) != 6:
        raise AssertionError("expected 6 walls in demo_1, got %d" % len(walls))

    fps = wall_footprints(walls)

    # L-corner world miter points (12.95, 0.05) / (13.05, -0.05) present in
    # both corner walls, converted to each wall's local frame.
    m1, m2 = (12.95, 0.05), (13.05, -0.05)
    for wid in ("wall_0j28n7nskm2sst7m", "wall_3wwt9bjqrdc5w09s"):
        w = walls[wid]
        start, end = tuple(w["start"]), tuple(w["end"])
        for m in (m1, m2):
            local = world_to_local(m, start, end)
            if not polygon_contains_point(fps[wid], local):
                raise AssertionError(
                    "%s missing miter point %r (local %r) in %r"
                    % (wid, m, local, fps[wid])
                )
        if len(fps[wid]) != 5:
            raise AssertionError("%s: expected 5-gon, got %r" % (wid, fps[wid]))

    # Exact footprints for the two corner walls (spec 02 section 12).
    assert_polygon(
        fps["wall_0j28n7nskm2sst7m"],
        [(0.0, -0.05), (4.05, -0.05), (4.0, 0.0), (3.95, 0.05), (0.0, 0.05)],
        "demo wall_0j28",
    )
    assert_polygon(
        fps["wall_3wwt9bjqrdc5w09s"],
        [(-0.05, -0.05), (6.0, -0.05), (6.0, 0.05), (0.05, 0.05), (0.0, 0.0)],
        "demo wall_3wwt",
    )

    # Collinear butt joint at (6,0): both walls square rectangles.
    assert_polygon(
        fps["wall_785y11hb3nztn1ua"],
        [(0.0, -0.05), (2.5, -0.05), (2.5, 0.05), (0.0, 0.05)],
        "demo wall_785 (collinear)",
    )
    assert_polygon(
        fps["wall_g4h1v4vm9ou0wryc"],
        [(0.0, -0.05), (6.0, -0.05), (6.0, 0.05), (0.0, 0.05)],
        "demo wall_g4h (collinear)",
    )

    # All six: >= 4 points, CCW, thickness extent exactly [-0.05, 0.05],
    # length extent [0, L] (+0.05 overshoot only at mitered ends).
    overshoot = {
        "wall_0j28n7nskm2sst7m": (0.0, 0.05),   # end mitered
        "wall_3wwt9bjqrdc5w09s": (-0.05, 0.0),  # start mitered
    }
    for wid, w in walls.items():
        poly = fps[wid]
        if len(poly) < 4:
            raise AssertionError("%s: fewer than 4 points: %r" % (wid, poly))
        if signed_area(poly) <= 0:
            raise AssertionError("%s: polygon not CCW: %r" % (wid, poly))
        length = math.hypot(
            w["end"][0] - w["start"][0], w["end"][1] - w["start"][1]
        )
        xs = [p[0] for p in poly]
        zs = [p[1] for p in poly]
        lo, hi = overshoot.get(wid, (0.0, 0.0))
        assert_close(min(xs), 0.0 + lo, "%s min x" % wid)
        assert_close(max(xs), length + hi, "%s max x" % wid)
        assert_close(min(zs), -0.05, "%s min z" % wid)
        assert_close(max(zs), 0.05, "%s max z" % wid)


def test_js_round_parity():
    """6. Grid snap uses JS Math.round (half toward +inf), not banker's.

    y = 0.0005 snaps to key cell 1 under JS rounding (0.5 -> 1) but to cell 0
    under Python banker's rounding (round(0.5) == 0). With a second wall at
    y = 0.001 (cell 1), JS-parity rounding produces a junction (5-gons);
    banker's would leave both walls as plain rectangles.
    """
    walls = {
        "a": wall((0.0, 0.0005), (2.0, 0.0005)),
        "b": wall((2.0, 0.001), (2.0, 3.0)),
    }
    fps = wall_footprints(walls)
    if len(fps["a"]) != 5 or len(fps["b"]) != 5:
        raise AssertionError(
            "JS-round parity broken: expected mitered 5-gons, got %d and %d points"
            % (len(fps["a"]), len(fps["b"]))
        )


def main():
    tests = [
        test_single_wall_rectangle,
        test_collinear_butt_joint,
        test_l_corner_miter,
        test_t_junction,
        test_demo_fixture,
        test_js_round_parity,
    ]
    failures = 0
    for test in tests:
        try:
            test()
            print("PASS %s" % test.__name__)
        except Exception:
            failures += 1
            print("FAIL %s" % test.__name__)
            traceback.print_exc()
    if failures:
        print("%d/%d tests failed" % (failures, len(tests)))
        sys.exit(1)
    print("all %d tests passed" % len(tests))


if __name__ == "__main__":
    main()


def test_miter_limit_slivers():
    """Near-collinear capture-merge slivers must not produce km-long miters."""
    import json, os
    fx = os.path.join(os.path.dirname(__file__), "fixtures", "sliver_walls.json")
    walls = {k: v for k, v in json.load(open(fx))["nodes"].items() if v.get("type") == "wall"}
    fps = wall_footprints(walls)
    for wid, poly in fps.items():
        for x, z in poly:
            assert abs(x) < 20 and abs(z) < 20, f"{wid} vertex ({x}, {z}) exploded"
    print("PASS test_miter_limit_slivers")


test_miter_limit_slivers()
