# Coordinate-conventions demo

Companion scene for the **Coordinate conventions** section of
[`../README.md`](../README.md). Stress-tests every claim that section
makes against real Pascal-generated geometry, built entirely through the
MCP API.

## Load it

```bash
pascal-mcp --stdio --scene examples/coordinate-conventions-demo.json
```

The scene fits in a 50 m × 50 m ground-plane footprint at `level: 0`.

## What's in the scene

A flat ground level with four demos, plus a labelled compass at the
origin so the world axes are unambiguous regardless of which viewport
you're in.

| Section | What | Why |
|---|---|---|
| Reference compass at the origin | 12 m `+X` and `+Z` axis bars with arrowhead tips, short `-X` / `-Z` stubs, an origin marker, plus zone labels naming each component of `[x, z]`. | Establishes which way `+X` and `+Z` actually point in world space, independent of viewport rotation. |
| **Demo A** at world `(18, 0)` | Axis-aligned 6 m × 4 m rectangle. | Baseline that matches the only example currently in `examples/generate-apartment.md` style (`[0,0] → [10,0]`). |
| **Demo B** at world `(18, 10)` | The proposed README example, **verbatim**: `polygon: [[0,0],[5.196,3.0],[3.196,6.464],[-2.0,3.464]]` at this offset. | Programmatically verified to be a 6 m × 4 m rectangle whose first edge is heading 30° CCW from `+X` (side lengths 6/4/6/4 m to 4 dp, `AB · AD = 0`, heading = 30.0007°). Confirms the README's worked example produces the geometry it claims. |
| **Demo C** at world `(0, 22)` and `(10, 22)` | An **L** authored on a north-up page (page-+x right, page-+y up) drawn at half scale and faded; alongside it, the same L pasted into `[x, z]` **uncorrected**, drawn at full scale and vivid. | Makes the external-coordinate gotcha visual: the author's page-+y direction lands on world +Z, which does not correspond to "screen-up" in any of Pascal's viewports. |
| **Demo D** at world `(22, 22)` and `(32, 22)` | Same pairing for the L with its second coordinate reflected (`z → 5 − z`) before paste. | Makes plain that z-reflection only "corrects" a true mirror; Pascal's viewports apply a *rotation*, so the reflection produces a mirror-image of Demo C rather than a page-correct L. |
| Takeaway band on the south edge | Short labels summarising the convention. | Self-documenting; readable in any viewport without an external README. |

## What it confirms

Open the scene in Pascal (or render it from the JSON) and you can read
each claim directly off the geometry:

1. **`[x, z] → world (x, 0, z)` is exact, no sign flip.** Demo A and
   Demo B both sit flat on the floor at Y = 0; their polygon vertices
   round-trip through `save_scene` / `get_scene` byte-identical to what
   was authored (graph hash matches, see `validate_scene` output).

2. **Demo B is the rectangle the README says it is.** A simple analytic
   check on its 4 vertices yields side lengths 6, 4, 6, 4 m (to 4 dp)
   with the first edge at 30.0007° from +X and perpendicular adjacent
   edges. No rendering required.

3. **External page coordinates *rotate* (not mirror) when pasted as
   `[x, z]` and viewed in Pascal.** Inspecting Demo C in the 2-D plan
   panel: the page-up L lands rotated 90° clockwise, so the author's
   "stem-up, foot-bottom-right" reads as "stem-on-right, foot-along-top"
   on screen. Inspecting Demo D right next to it: the z-reflected
   variant lands as the *mirror* of Demo C — neither matches a
   page-correct L. That demonstrates why "reflect across the axis" is
   the wrong corrective for an issue that is, in this viewport, a
   rotation.

4. **The 3-D "top-down" snap is offset 45° from world axes by default.**
   Viewing the scene in 3-D and snapping to top-down from the default
   iso camera shows the rectangular site polygon as a *diamond* (its
   long edges are diagonals on screen, not axis-aligned). That's the
   camera's "up" vector being inherited from the iso start; once you
   orbit to a true axis-aligned top-down it goes away. The label
   inviting reviewers to "verify against a guide image" exists for this
   reason.

## Reproducibility

The canonical demo is the JSON file in this directory; load that file to compare
the geometry against the notes above.
