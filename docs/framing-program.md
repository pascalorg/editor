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
W4  DONE — "Framing only" view mode in Bones: a fourth view mode `framing` on the
    X-ray node; the level's shell is hidden, sheet layers skipped, every frame
    member solid. Panel button "Framing" beside Normal / X-ray / Subfloor.
W5  DONE — Lot drop-in: `@pascal-app/plugin-lot` (Lot panel + the address box the
    Generate panel embeds), `/api/parcel/roads` (OpenStreetMap streets in the lot's
    frame), the street-facing front edge, planning-default setbacks, ring cleanup,
    PlanCrafters' preset lots, and generate fitting the plan to the frontage
    (garage dropped, reface to the widest edge). Terrain from USGS elevation is
    NOT part of it yet (the datum rules in TERRAIN-DATUM-SPEC touch the
    foundation engine) — a later pass.
W6  DONE — Porch: PlanCrafters' entrance tool built from Pascal nodes
    (`plugin-generate/src/porch.ts`): the landing slab 4 in below the finish floor,
    posts, guards, the flight to grade, and a porch roof segment (gable / hip /
    flat canopy) on the beam line. Slab houses now stand 8 in above grade
    (`SLAB_ABOVE_GRADE_M`). Rear patio / deck, the porch beam and post footings in
    Bones, and a covered-under-the-main-roof porch are later.
W7  Styles and palettes applied: exterior assembly + siding colour + trim + door +
    roof material per style, palette rolled as a unit.
W8  Wall assemblies by role: plumbing 2x6 behind wet rooms, garage separation,
    porch pony walls, exterior by style; new cited presets; assemblies panel with
    "assign by role".
W9  Simpson hardware catalogue in Bones: H2.5A rafter/truss to plate, A35 at
    blocking, LUS hangers at ledger-hung joists, ABU post bases / AC caps at porch
    posts, HDU/HTT hold-downs, straps — labels with model and nailing; takeoff rows.


## Mandate additions (Steve, 2026-09-06, mid-session)

Verbatim intent, folded into the plan below:
- The front porch brings in the gable options and everything PlanCrafters has: all
  the rail options and styles (cable rail for modern), the rear entrances, the
  wood styles, colour / trim styles, window styles — "basically all the stuff
  PlanCrafters uses for procedural".
- Improve the algorithm to size by lot the way PlanCrafters does; face toward the
  street. Pascal has an API coming soon for lots.
- "Ensure it's all working, get eyes on it all, check all the sections"; bring over
  the structural sections and everything that works in PlanCrafters, with
  variables tied to framing the plans — "the whole enchilada".
- Houses have raised-floor options, slab, stepped footing on hills, floor framing
  when it is not a slab; porches front and rear can be slabs or decks, with
  correct framing.

W10 Porch options (PlanCrafters entrance tool, all of it): roofType gable / shed /
    hip / flat / trellis / none per style and per entrance; pillar styles square /
    round / tapered / craftsman / stucco with sizes; railing styles baluster / cable
    (modern) with post sizes and spacing; landing concrete or WOOD DECK with real
    deck framing (ledger, joists, beam on the porch posts, F.deck); the rear
    entrance at the slider (covered patio, raised deck on a hill, trellis for
    modern / ranch / craftsman); porch ceiling closed / cathedral; the Bones side:
    posts on pad footings, the porch beam, the ledger (done for sheds), hangers.
W11 Foundations: slab-on-grade (today), RAISED floor (stem walls + crawl space,
    floor framing: joists, girders, piers, rim, subfloor — Bones floor-framing
    engine), stepped footings on a hill from the terrain (TERRAIN-DATUM-SPEC: house
    datum = highest grade + 8 in, stem exposure on the low side), the garage as
    slab-on-stem regardless; Bones told the grade so footing depth is measured
    from the ground, not the floor line.
W12 Structural sections and details tied to framing variables (PlanCrafters
    details.js + section2d): eave, rake, ridge, foundation / stem / slab edge,
    porch ledger, deck ledger, stair — drawn from the SAME numbers Bones frames
    with (rafter size, plate height, stem height, footing), placed on the sheets;
    review every section the Sections plugin cuts today against the framed model.
W13 Finishes: PlanCrafters' style palettes applied — siding / roofing / trim /
    door colours per style rolled as a unit, window styles (grid, casing, sill),
    wood styles; the finish schedule on the sheets (part of W7, listed here so
    nothing is lost).

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

- 2026-09-06 early: **W4 landed** — the "show all framing only" button. Bones'
  `ViewMode` gains `framing` (schema, `effectiveViewMode`, panel segmented
  control: Normal / X-ray / Subfloor / Framing). In that mode the framing
  renderer hides the level's SHELL — every non-`bones:*` node under the level
  (walls with their openings, roofs and segments, slabs, ceilings, stairs,
  zones, furniture; `framing/shell.ts` walks the tree, so a plugin's nodes are
  shell too) — by writing the host Object3Ds' `.visible` each frame through
  the scene registry, the same imperative channel as the dollhouse cut; nothing
  is written to the scene, no undo entries, and leaving the mode (or unmounting)
  hands every object back its node's own `visible`. Members draw exactly as in
  X-ray except the SURFACE roles are skipped (`SURFACE_ROLES`: drywall,
  sheathing — wall and roof deck —, WRB, cladding, insulation, subfloor, vapor
  retarder, drip edge), so studs, plates, headers, rafters, ridges, joists,
  hardware, foundation concrete and the MEP runs the panel's toggles allow read
  unobstructed; with no face-carrying buckets the dollhouse cut has nothing to
  open. Wall-mode contract unchanged: off → framing imposes low walls like off →
  xray, framing ↔ xray ↔ basement never touch wall mode, framing → off releases
  under the same other-X-ray-live rule (activation tests extended). Roof
  rebuilds keep running while hidden — the roof system gates on the merged
  mesh's own flag, which stays true under a hidden parent. Tests: `shell.test.ts`
  (tree walk, bones exclusion, cycles, role filter) + activation; Bones 1,994
  green, typecheck clean. Verified live on the rolled farmhouse (scene
  b13c13b54a7a, Bones installed for it): Framing shows rafters, ridge, ceiling
  joists, gable studs, wall studs and headers, the garage wing's frame, the
  condenser and the duct/wire runs, on the bare site; the roof deck, walls and
  slab are gone. Known: the hidden walls still catch pointer events (their
  collision meshes are not visible-gated), so clicking a stud selects the wall
  behind it — harmless, noted for a later pass.

- 2026-09-06 small hours: **W5 landed — the lot drops in.** One engine in the
  editor package, `dropInLot` (`packages/editor/src/lib/lot`): address or a
  picked suggestion's coordinates → `/api/parcel/resolve` (the recorded parcel
  ring, APN, county, zoning) → `/api/parcel/roads` (new route: every OSM
  highway way within ~720 ft, projected into the site frame in metres with
  the parcel's own origin; Overpass mirrors asked two at a time, first good
  answer wins, fail-soft; `overpass.osm.ch` is a Swiss extract and was dropped
  after it answered a Sacramento query with nothing) → `sitePatchFromParcel`
  (pure, tested): the ring cleaned, the front edge from the streets, north
  up, PlanCrafters' planning-default setbacks (20 / 5 / 15 ft, `setbacksSource`
  says so; never overwriting existing ones), every decision written into
  `parcel.notes` → the site node updated (created at the root when a scene
  has none) → a building outside the new ring re-centred. Three callers, one
  path: the new Lot rail panel, the Generate panel's "Drop in lot & generate"
  (drop in, then `generateHouse`), and the Site inspector's Find parcel
  (`packages/nodes`, rebuilt). Preset lots are PlanCrafters' 28 real
  addresses, verbatim. Front edge: `detectFrontEdgeFromRoads` ports
  `SITE.detectFrontEdge` — parallel within 30°, road on the outward side,
  nearest wins, the addressed street beats a closer cross street on a corner
  lot; only street classes count (an alley behind the lot never claims the
  frontage); within 1.5 m of distance the LONGER edge wins.
  **What the first live run taught:** the Land Park registry ring came back
  with 13 vertices — a nine-segment curb-return arc of ~1 m edges. The
  detector picked a 1 m sliver of the arc as "the" front edge, the sliver
  took the 20 ft setback while the real 30 ft frontage beside it took 5 ft,
  the offset lines crossed, `setbackEnvelope` returned nothing, and the house
  landed at the origin unplaced ("no parcel in the scene"). Fixes, all
  tested on that ring as a fixture (`clean-ring.test.ts`): `cleanLotRing`
  drops duplicates, merges collinear vertices and squares corner arcs and
  small chamfers (runs of edges ≤ 3.5 m, ≤ 12 m long, between long edges
  meeting at ≥ 20°) to the corner the long edges make — 13 → 4 vertices,
  said so in the notes, the recorded lot area untouched; `setbackEnvelope`
  no longer refuses a ring over one parallel neighbour pair (the vertex
  moves inward along its own offset instead). **Second live run:** placed and
  facing Castro Way, but the rolled farmhouse was 58.5' wide on a 39'
  frontage (the two-column parti's floor with a garage). PlanCrafters'
  `generateFit` ported (`fit.ts`): the roll now drops a garage the seed
  rolled before squeezing rooms to their floors on a narrow frontage (a
  garage the user asked for stays and warns), and when the street frontage
  still cannot take the plan the house is refaced to the widest envelope
  edge that can, with a note — never a reface that still crosses a setback.
  Yard dimensions on the site plan are now cast square to the house's own
  faces (`castYardDimensionsOriented`, the building's yaw): the axis-aligned
  bbox cast read 19'-9" on a 20 ft front yard for a house square to a
  diagonal lot. **Third live run (scene 021cd5337dd3, Land Park preset):**
  "Lot set — APN 013-0044-001-0000 · 5,422 sq ft · Sacramento · fronts Castro
  Way (edge 1)", a 2 bd / 1 ba modern rolled without the garage ("the
  buildable frontage (39.0') cannot take an attached garage beside the
  house"), no setback crossing, the house inside the lot at the front
  setback, autosaved (version 4). Tests: roads parser 5, front edge 8,
  lot patch 7, ring cleanup 8, yards 4, fit 6, roll +2; editor 832 / app 49 /
  generate 24 green; every package typechecks. Not done: terrain from USGS
  elevation (TERRAIN-DATUM-SPEC), roads laid as Streetscape nodes (that
  plugin is external to the repo), a narrow-lot single-column parti for 24 ft
  city lots (the roller warns honestly instead).

- 2026-09-06 early morning: **W6 landed — the porch.** `porch.ts` ports
  PlanCrafters' entrance tool (gen.js `applyPorch` / `addEntrance`, model.js
  `makeEntrance` / `entranceGeom` / `entranceFlight`) onto Pascal's own kinds,
  pure and tested (15 cases): the entrance centres on the PLACED front door and
  never cantilevers past a house corner (it shrinks to the door wall's own span
  with 6 in to spare — with a garage the facade is the short wall beside it);
  'full' spans the living + entry bay clamped 10–20 ft × 7 ft deep, 'entry' is
  8 × 6 ft, and the no-porch styles still get a 4–7 ft covered stoop, 5 ft deep,
  two slim posts, flat canopy. Nodes: a `slab` landing stepped 4 in below the
  finish floor (PORCH_FLOOR_DROP, concrete); `column` posts at the outer corners
  and ≤ 8 ft apart (7 in full / 5½ in entry / 6 in stoop, craftsman tapered),
  standing on the landing through `supportSlabId`; `fence` guards at 36 in
  (R312) on a full porch or wherever the landing is > 30 in above grade, the
  outer rail split at the steps; a `stair` flight to grade centred on the door
  (`deckSlabId` = the landing, so the rise is the landing's elevation over the
  flight's base), risers solved as PlanCrafters does (ceil(rise / 7¾ in) then
  relaxed while the riser still passes R311.7.5.1), 11 in treads, ≥ 36 in wide,
  rails on the flight only when it climbs > 30 in; a porch roof as a
  `roof-segment` on the beam line 96 in above the finish floor (entrance.ceilingH)
  — gable for gable styles and hip for hip styles, ridge square to the wall and
  the box reaching INTO the house by its run so the planes meet at a valley (the
  auto roof's wing convention; the CSG union hides the part inside the main roof),
  pitch capped at 6:12; a flat canopy for the shed / no-porch styles whose back
  overhang meets the wall face. **How the roof meets the house** is decided by
  the door wall's roof role from the auto roof: an eave or hip-end wall carries
  a slope, so a gable / hip porch ridge dies into it (the wing convention, a
  valley); a gable end, rake, shed high wall or flat roof has nothing to die
  into, so the porch roof is a SHED on a LEDGER at the wall face, never steeper
  than 4:12 — PlanCrafters' "no die-in" case. Bones frames that shed for real:
  `metadata.roof.attach: 'high'` = the rafters stop at the wall and hang on a
  ledger (new `ledger` role, the rafter size, top flush with the rafter tops)
  with a Simpson LUS-series hanger per rafter and ties at the beam only;
  `metadata.roof.open` = no rake studs across an open side; no pediment inside
  the house wall (`roof-framing.porch.test.ts`, 7 cases; the plain shed is
  byte-identical, pins held). Verified headlessly on the live scene: the
  gable-front farmhouse's porch is 11 rafters on a ledger, 11 hangers, deck,
  zero studs, zero roof-intersection warnings — the first cut had put a gable
  porch INTO a gable end and Bones framed 96 phantom members inside the attic.
  **Datum:** the generated building now stands with
  its top of slab 8 in above the site plane (`SLAB_ABOVE_GRADE_M`, IRC R404.1.6 /
  R317.1, TERRAIN-DATUM-SPEC) — carried on the building node so every level-local
  number is unchanged; the porch flight's base sits at −8 in level-local, on the
  ground. Bones still reads grade at the level plane (its footing depth is
  measured from the floor line — the TERRAIN-DATUM work is to teach it the
  site). The run summary and the Generate panel report the porch. Verified live
  on the Land Park scene: a farmhouse rolled with a 20 × 7 ft full porch — gable
  dying into the main roof, four posts, guards, one 5.97 in riser at the door.
  Not done: the rear entrance (covered patio / deck / trellis at the slider), the
  porch beam + post pad footings in Bones (columns are not framed today), the
  under-the-main-roof porch, wood-framed porch floors on raised foundations.
