# GARAGE SITE INTEGRATION (Steve, Jul 3)

## A. DRIVEWAYS (bug + routing) — can ship independently
1. STACKING BUG: every 🏠 Generate / 🎲 Random adds ANOTHER driveway; old ones are
   never removed → "driveways on hella sides." Fix: generated driveways are tagged
   (feature._gen = true or similar); generate() removes ALL prior _gen driveways
   (and any orphaned generated site features aimed at walls that no longer exist)
   before adding the new one. Manual user-drawn driveways are NEVER touched.
2. ROUTING: the driveway must run from the garage door apron to the FRONT lot
   line, meeting the property line edge roughly PERPENDICULAR to it (curb-cut
   style) — on angled/rotated lots today "some turn toward the property line,
   some don't." Route: short straight apron out of the door (≥ 8-10 ft, aligned
   with the door normal), then a gentle bend (1-2 segment dogleg or arc) to hit
   the front lot edge at ~90° ± 20°, clipped INSIDE the lot. Width follows the
   door (door width + ~2 ft). If the garage faces a side lot line, route to the
   FRONT edge anyway (L-shaped drive) unless distance is absurd → fall back to
   the nearest street edge.

## B. GARAGE FLOOR ELEVATION TRUTH (model + render + docs)
Real construction: the garage slab sits BELOW the house finish floor —
  - slab-on-grade house: garage slab ≥ 8" below house FF (stem/curb between).
  - raised-floor house: more like ~18" below FF — the garage sits INTO the
    terrain/grade while the house floor rides on the crawl space.
Implement: garage room carries floorDrop (default 8" slab / 18" raised;
editable). The garage SLAB + its curb/foundation model + render at that lower
elevation (foundation plan + sections must show the step — the foundation
engine already handles stem steps; wire the garage pad into it). The garage
door threshold sits at garage-slab level.

## C. STEPS HOUSE → GARAGE
At the man-door: step(s) down from house FF to the garage slab. Material
CONCRETE or WOOD (user pick, per-entrance-like props) + a rough landing
direction option (straight out / turn left / turn right) exactly like the
entrance tool's vocabulary — REUSE the entrance/stair solving machinery
(HA.entranceFlight-style) rather than new code. Risers to code (≤7.75"),
1-3 risers typical. Renders in 3D + 2D plan symbol + section.

## D. TERRAIN + DRIVEWAY MEET THE GARAGE
The terrain adjusts UNDER the garage (a graded pad at garage-slab elevation,
like the existing house pad logic) so the DRIVEWAY BUTTS the garage door apron
PERFECTLY (driveway surface = garage slab elevation at the door, then follows
terrain down toward the street with per-vertex draping like _street3d).
Everything is derived from the garage geometry: if the house/garage MOVES,
the pad + driveway re-derive and follow (no baked world coords — recompute in
the site/terrain build path).

## Ownership / sequencing
- A (driveways) → gen.js + sitefeatures/siteplus: no view3d conflict, ship first.
- B+C+D (garage pit, steps, terrain pad) → model.js/foundation + view3d +
  terrain.js: MUST WAIT for the roof agent to release view3d.js.
- Tests: regen ×10 → exactly 1 generated driveway; driveway meets front lot
  edge within angle tolerance + fully inside lot; garage slab z == FF −8/−18
  per foundation type; step count/riser math to code; terrain pad under garage
  == slab elev; driveway first-vertex z == garage slab z.
