# Framing program — correct roofs, walls and lots, end to end

Working notes, started 2026-09-05 evening. This is the living file for the push
Steve asked for: houses that come out of Pascal framed to IRC, roofs seated on the
top plate, complete walls under every roof form, PlanCrafters-grade auto roof, porch,
styles and lot import, with the framing logic living on the items themselves so it is
correct and adjustable. Kept current as work lands; read it first when resuming.

## The mandate (Steve, 2026-09-05)

- Auto roof plugin built on PlanCrafters' roof geometry (their `roof.js`), so the
  roof is derived from the walls, not hand-placed.
- Every roof form gets its walls: gable ends, shed high/low walls, the "front wall"
  a shed roof is currently missing in the procedural houses.
- Rafters sit ON the top plate. No stud cripple wall stacked between plate and roof.
  Rafters and ceiling joists sized per IRC span tables, adjustable per item.
- Framing logic baked into each item (roof knows its rafters, wall knows its studs and
  plates) rather than one wide engine that guesses. Combine plugins if that is what it
  takes.
- Porch and rails from PlanCrafters, derived from the elevation.
- Lot by address: a GIS lot plugin that drops the parcel in and talks to generate,
  sheets, site plan.
- "Show all framing only" button.
- Correct Simpson hardware (hurricane ties, straps, hangers) where the IRC calls for it.
- Wall assembly plugin based on PlanCrafters: every wall carries a real assembly.
- All PlanCrafters design styles.
- Do the work directly, no subagents. No corner cutting. Keep this file current.

## Where the defects come from

Read on 2026-09-05 against the code, not from memory.

1. **The roof segment carries its own knee wall.** `roof-segment.wallHeight`
   (default 0.5 m) is a rectangular wall band the segment renders under its roof,
   and every consumer treats `origin.y + wallHeight` as the plate line: the viewer
   CSG (`getRoofSegmentBrushes`), sections (`plateY = originY + wallHeight`), Bones
   (`eaveY = roof.wallHeight`). Nothing frames that band. It is a picture of a wall.
2. **The editor's Roof tool drops the roof at y = 0 of the level it is drawn on, with
   the 0.5 m knee wall.** So a roof drawn on the wall level sits on the floor, and the
   working habit became "add a level above, draw the roof there": the knee wall then
   stacks on top of the storey below as a 0.5 m pony wall band. That is Steve's
   "stud cripple wall above, then the roof". Bones even special-cases a walls-free
   "roof storey".
3. **Generate (and the PlanCrafters interchange) compensate** by putting the segment
   origin at `ceiling − 0.5` with `wallHeight 0.5`, so the eave lands on the plate but
   the segment's wall box overlaps the top 0.5 m of the real walls in a second material.
   The cottage scene is built exactly this way (`roof pos y 2.2432`, level 2.7432).
4. **Real walls are flat-topped at the storey plane** (`resolveWallTop`): no rake
   tops. The gable triangle and the shed pediment exist only as the segment's own
   wall faces (`getRoofSegmentWallFaces`). Visually they render; structurally there is
   nothing: Bones frames no gable studs, no pediment studs, no rake-side studs. In the
   X-ray the shed's high side and every gable end are empty above the plate — the
   "missing front wall".
5. **Bones seats rafters by their centreline.** The rafter centre line lies on the
   eave-to-ridge plane whose eave is the plate, so at the wall line the rafter is
   buried half its depth into the top plate. PlanCrafters lifts each rafter by
   `(d/2)·√(1+s²)` so the BOTTOM face lies in the plane (bears on the plate, seat cut
   implied). Bones' own flat-roof framer already does the right thing
   (`centerY = wallHeight + rd/2`, "resting on the plates").
6. **No auto roof.** Generate emits one box segment over the house bbox plus one per
   garage wing. No pop-out continuation, no massing policy, no hip-by-default on
   popped massing, no coverage gate. Overlapping segments union by CSG with the larger
   area owning the overlap. Bones detects gable–gable valleys only.
7. **No porch.** Available parts: slab, column (square/round, height), fence (rail
   style), stair (straight, stepCount, width, totalRise). No beam kind.
8. **Hardware is generic.** Bones books "hurricane tie" steel blocks only where the
   jurisdiction sets `hurricaneTies` (FL: `highWindUplift`); labels carry no part.
   Wall uplift straps are "H2.5-class" in comments only.
9. **Lot import works** (`POST /api/parcel/resolve` — keyless Census/ArcGIS geocoders
   plus state parcel layers; Tampa resolves on the FL statewide layer) but the site
   panel's Find parcel writes only polygon/address/parcel/zone and clears
   `frontEdge`. No setbacks, no road-based front edge (most-north-facing guess), no
   north. PlanCrafters uses Overpass roads for the front edge and a preset-lot list.
10. **Styles are half-ported.** `plugin-generate/styles.ts` has the six presets with
    roof form/pitch/overhang/assembly; palettes and roof materials are carried as
    PlanCrafters ids and never applied. Pascal materials accept a hex `color`, and the
    library has lap siding (white, greige), stucco, brick, shingle, tile, metal.
11. **Assemblies:** core presets exist (2x4/2x6 siding, stucco, brick, interior 2x4,
    2x6 plumbing, CMU) with Bones-cited thicknesses. Generate assigns exterior by
    style and interior 2x4 everywhere: no plumbing walls behind wet rooms, no garage
    separation (R302.6 ½" gypsum garage side), no porch pony walls. Bones data has
    vinyl / fiber-cement / stucco / brick / wood / EIFS claddings with citations and a
    default cladding per state.
12. **View modes:** Bones has off / xray / basement; X-ray forces the viewer wall
    mode to `down`. No framing-only mode.

## Findings

### PlanCrafters (repo `Steven-Tibbs/plancrafters-com`; copies in `docs/reference/plancrafters/`)

Fetched 2026-09-05: `roof.js`, `framing.js`, `assemblies.js`, `parcel.js`, `site.js`,
`model.js`, `products.js`, `presetlots.js`, `details.js`, `terrain.js`, `takeoff.js`,
`codecheck.js`, `osmroads.js`, plus the specs `ROOF-POLICY-SPEC.md`,
`ROOF-CONTINUATION-SPEC.md`, `ROOF-POLISH-TODO.md`, `WALL-ASSEMBLY.md`,
`TERRAIN-DATUM-SPEC.md`, `GARAGE-SITE-SPEC.md`.

- Roof = straight-skeleton wavefront over the exterior wall loop offset by the
  overhang (`buildOn`); per-wall `gable` flags; plane `z = plate + slope·(inward
  distance)`; gable walls get a vertical infill polygon from plate to underside.
  `buildShed` is a single analytic plane whose high side faces AWAY from the street
  (front lot edge), anchored so it clears every plate and bears on the governing one,
  with tall-wall infill on every wall the plane rises above. `buildLowerRoofs` for
  wings dying into upper walls (ledger). `HA.roofStyle` sets gable flags: gable = end
  walls of the long axis; mixed = short runs; hip = none; safety un-gables the longest
  run per axis if everything ended gabled.
- Policy (ROOF-POLICY-SPEC): classify massing FLUSH BOX vs POPPED (`popSide > 24"` on
  the street side); popped → hip everything; flush → the style vocabulary. Coverage
  gate: sample 18" grid inside the loop, > 2 % uncovered → hip-everything and retry.
  `hipBadGables`: a gable only on a true end wall (both corners convex); two main-axis
  ends at different widths keep only the narrowest gable.
- Continuation (ROOF-CONTINUATION-SPEC / `continueRoofPopouts`): a rectangular bump
  ≤ 8 ft deep and ≤ 40 % of the mass, at a gable end, same plates, no directive → the
  roof loop runs straight across it; bump walls become covered infill.
- Framing (`F.roof`): 2x10 rafters lifted so the bottom face lies in the plane;
  ridge/hip/valley 2x12 with tops flush to the rafter tops; plumb cuts at boards,
  plumb + level tail cut at the eave; ledger + blocking where a plane dies into a
  taller wall; gable studs 16" o.c. plate → underside; barge + outlookers on rakes;
  ceiling joists 2x6 (2x8 over 12') bearing ON the plate, rim on the plates, lapped
  over interior bearing walls. `F.porchWall`: open span = 6x8 beam under a single
  top plate on 6x6 posts ≤ 8' o.c. with tributary pad footings. Rails: 2x6 cap at
  36", 4x4 posts ≤ 72", balusters at 5".
- Wall types (`model.js`): ext2x6 t 6.5 / ext2x4 4.5 / int2x4 4.5 / int2x6 6.5 /
  porch pony 5.5 (36" tall) / SIP. Cladding added OUTSIDE the stud reference (0.75").
  `assemblies.js` derives the layer stack from the type; garage fire-separation tag.
- Entrance (`HA.makeEntrance`): width 48 / depth 48 (full porch 14' × 7'), landing
  concrete or wood, steps to grade, `ceilingH` 96, roof gable/hip/shed/flat/none,
  pillar square 5.5" (7" full porch; craftsman tapered), railing on full porches and
  wood decks, rail 36", posts 4x4 ≤ 72", 42" door gap, stair 60" wide.
- Site: `parcel.js` rings → plan; `site.js` classifyEdges / setbacks / envelope /
  coverage; `osmroads.js` Overpass roads (radius 220 m) for street geometry;
  `presetlots.js` curated real addresses for testing.
- Styles: `STYLES` (farmhouse gable 8/12 14" closed lap white full porch; craftsman
  gable 6/12 24" exposed lap sage entry porch; ranch hip 4/12 16" stucco sage
  long-low; modern hip 3/12 20" lap black big glass no porch; modern-mono shed 2.5/12
  22" stucco gray clerestory; cottage mixed 6/12 12" lap yellow entry) and `PALETTES`
  rolled as a unit (siding id + trim + door + shutter hex).

### Pascal today

- `roof-segment`: box footprint (width × depth) centred on `position`, `rotation`,
  `roofType` hip/gable/shed/gambrel/dutch/mansard/flat, `pitch` degrees, `overhang`
  along the slope, `wallHeight`, `wallThickness` 0.1, `deckThickness` 0.1,
  `shingleThickness` 0.05, trims, shed options. `getSegmentSlopeFrame` gives run /
  rise / trig / peak. Gable end faces are pentagons; shed back face is the full-height
  rect, sides right trapezoids. `autoDrop = (wallThickness/2)·tanθ` lowers the eave at
  the outer face so the plane passes through the plate at the wall centre line.
- Roof group (`roof`) is a container with position/rotation and materials.
- Walls: `height` absent = plane-bound to the storey height (clamped by covering
  slabs); explicit height = half wall / parapet. Assembly owns thickness.
- Bones: `frameRoofs(roofs, walls, spec)` per segment shape; deck + underlayment
  layers, fascia pair, drip edge, barge + outlookers, ceiling joists as rafter ties,
  collar ties, purlin + struts when the span table runs out, hurricane ties at each
  bearing (jurisdiction), valleys between crossing gables. Spec: 2x6 rafters @ 24",
  2x6 ceiling joists @ 16", double top plate, IRC 2021 span tables in
  `data/framing-tables.json`. Per-wall overrides exist (`wallOverrides`), none per roof.
- Editor: Roof tool creates `roof` at `[cx, 0, cz]` + segment `wallHeight 0.5`,
  `pitch 40°`.
- Generate: `roofFor` → one gable/hip/shed/flat segment over the non-garage bbox at
  `y = ceiling − 0.5`, `wallHeight 0.5`, plus one per garage wing.
- Site: `SiteNode` polygon (metres, x east, z south, origin = geocoded point),
  address, parcel, setbacks (metres), setbacksSource, zone, frontEdge, northRotation.
  `setbackEnvelope(lot, setbacks, frontEdge)`, `resolveFrontEdge` (explicit or most
  north-facing). Generate already places the house on the envelope front edge.
- Tests: generate 16 (3 files), Bones 1,981 (73 files), editor 805 — all green at start.

## Plan

Ordered. Each workstream lands with tests and a local commit, then this file is
updated. Convention adopted everywhere: **a roof lives on the level whose walls carry
it, its origin is the top of the plate (`level.height`), and `wallHeight` is 0.** A
non-zero `wallHeight` is an explicit knee wall the user asked for, nothing else.

W1  DONE 2026-09-05 — Roof seated on the plate (Bones + tool + generate + viewer).
    - Bones: rafters, hips, jacks, barges bear with the BOTTOM face on the plane
      (`eaveY = plate + d/(2cosθ)` for the centre line); ridge/hip boards flush with
      rafter tops; ceiling joists, ties, struts, cripple math stay on the plate.
    - Bones: gable studs, shed pediment studs and rake-side studs on the plate up to
      the rafter underside, 16" o.c., stud size = exterior stud.
    - Bones: hurricane tie labels name the part (Simpson H2.5A or equal, nailing).
    - Roof tool: sit on the plate when the level has walls, `wallHeight 0`.
    - Generate: origin `ceiling`, `wallHeight 0`.
    - Byte pins recaptured with the intended-change note.
W2  DONE 2026-09-05 — Auto roof engine `packages/plugin-roof`: exterior loop → collinear merge →
    pop-out continuation → rectangle masses → massing class → style gable policy +
    sanity rules → segments (plate-seated) → coverage gate → hip fallback.
    Rail panel + commands. Generate calls it.
W3  DONE with W1 + W2 — Walls under every roof form: per-wall roof role metadata (eave / gable-end /
    shed-high / rake) written by the engine; framing from W1; elevations unchanged.
W4  "Framing only" view mode in Bones (shell hidden, members for every system) +
    panel button + command.
W5  Lot drop-in: Generate panel address box → parcel → site polygon/address/parcel →
    setbacks default (PlanCrafters planning defaults front 20 / side 5 / rear 15 ft,
    `setbacksSource` says so) → front edge from the nearest OSM road (server route
    to Overpass, fallback north-facing) → house placed on the envelope. Preset lots
    for testing.
W6  Porch: from the plan's front door + style policy → dropped slab, posts, beam,
    porch roof segment (gable / hip / shed), rails, steps. Rear patio later.
W7  Styles and palettes applied: exterior assembly + siding colour + trim + door +
    roof material per style, palette rolled as a unit.
W8  Wall assemblies by role: plumbing 2x6 behind wet rooms, garage separation,
    porch pony walls, exterior by style; new cited presets; assemblies panel with
    "assign by role".
W9  Simpson hardware catalogue in Bones: H2.5A rafter/truss to plate, A35 at
    blocking, LUS hangers at ledger-hung joists, ABU post bases / AC caps at porch
    posts, HDU/HTT hold-downs, straps — labels with model and nailing; takeoff rows.

## Log

- 2026-09-05 evening: program started. PlanCrafters sources fetched into the
  reference folder; Pascal roof node, Bones roof/wall framing, generate build, site
  and parcel code read. Diagnosis above. Starting W1.

- 2026-09-05 late: **W1 landed.** Bones `roof-framing.ts`: every sloped member
  (rafters, hips, jacks, barges, valleys, valley jacks) bears with its BOTTOM
  face on the eave plane — centre lines lifted one plumb half-depth `d/(2cosθ)`,
  hips and valleys by their own; ridge, hip-ridge and gambrel purlin boards ride
  flush with the rafter tops; ceiling joists, hurricane ties, purlin struts and
  the truss bottom chord stay on the plate (the truss top chord heels on the
  bottom chord); the roof deck clears the lifted ridge body (`ridgeDeckGap`);
  collar ties skip the gable-end pair. New `infillStuds`: gable studs, shed
  pediment studs (bearing) and rake studs, plus gambrel end profiles and
  gable-end truss verticals, at the wall module on the plate, depth fitted to
  the segment's `wallThickness` (new slice field), inboard for the dutch gablet;
  heights past Table R602.3(5) flag. Ceiling-joist and purlin end bands stop
  inside the stud zone. Tie label names Simpson H2.5A + nailing
  (`HURRICANE_TIE_LABEL`, still prefixed `hurricane tie` for the matchers).
  Viewer `roof-system.tsx`: the eave clamp that lifted a zero-knee-wall deck
  off the plate is gone. Roof tool: roof origin at the level's plate when the
  level has walls, `wallHeight 0`, ghost drawn at the plate; a segment added to
  an existing roof matches its siblings' knee wall. Generate: roof at
  `ceiling`, `wallHeight 0`, segments to the wall centre lines carrying the
  exterior thickness, overhang converted plan → slope. Tests: eleven byte pins
  recaptured (flat held), numeric expectations moved to the seated convention,
  new `roof-framing.seat.test.ts` states the contract. Bones 1,988 / editor 805
  / generate 16 green. Not yet verified visually in the browser — next.

- 2026-09-05 night: **W2 landed** — `packages/plugin-roof`. Pure engine
  (`geometry.ts`, `derive.ts`): trace the exterior wall loop (every corner joins
  exactly two exterior walls, else fall back to the walls' box with a warning),
  merge collinear runs, work in the building's own frame (u along the longest
  edge), decompose the rectilinear footprint into the largest rectangles (main
  first, wings after), absorb a shallow pop-out on a gable end (≤ 8 ft, ≥ 60 %
  of the end) under the continued main roof, classify POPPED massing with
  PlanCrafters' `popSide` (> 24" toward the street → hip everything), apply the
  style vocabulary (farmhouse all gable, craftsman main + street-facing caps,
  cottage main only, ranch/modern hip, explicit plan-document gables override
  and fix the ridge axis), run each wing's ridge OUT from its shared wall and
  reach it into the neighbour by its run so the planes meet (the perpendicular
  gable pair Bones frames as a valley), sheds rise away from the street with a
  knee wall only where a mass sits inboard of the governing low eave, coverage
  gate (< 98 % → one hip over the box, warned), and a role for every exterior
  wall (eave / gable-end / hip-end / shed-high / rake / flat). Segments are
  plate-seated (`wallHeight 0`, `wallThickness` = the exterior wall). Scene glue
  (`run.ts`): rebuild replaces only roofs tagged `pascal:roof`, writes
  `metadata.roof.role` on the walls, reads the street direction from the site's
  front edge turned by the building yaw. Rail panel (form / style / pitch /
  overhang / Rebuild + last run) and `roof.auto` command. Generate now builds
  its roof through the engine (`roofFor` → `deriveRoof`) and stamps wall roles;
  its `roofFor` box roof is gone. 19 engine tests; generate 16; editor app
  typechecks. Verified live: a rolled farmhouse with a garage (main gable +
  perpendicular garage gable reaching into the main, 100 % coverage) and the
  same house rebuilt as a ranch through the panel (two hips). One observation
  for the roller, not the roof: a 45 × 44 ft two-column parti gives a 22 ft run
  and a 14.7 ft rise at 8:12 — PlanCrafters' policy A5 says very wide boxes may
  prefer a hip per style; no threshold is written there, so none was invented.
- W3 is covered: roles come from W2, the framing above the plate from W1.
