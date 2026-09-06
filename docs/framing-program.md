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
W7  Styles and palettes applied — DONE 2026-09-06 (see W13 log): exterior assembly + siding colour + trim + door +
    roof material per style, palette rolled as a unit.
W8  Wall assemblies by role — DONE 2026-09-06 (see log; the assign-by-role panel is open): plumbing 2x6 behind wet rooms, garage separation,
    porch pony walls, exterior by style; new cited presets; assemblies panel with
    "assign by role".
W9  Simpson hardware catalogue in Bones — DONE 2026-09-06 (see log; A35 / CS16 members open): H2.5A rafter/truss to plate, A35 at
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

W10 Porch options — DONE 2026-09-06 (see log; trellis covers, the porch ceiling and post-to-beam details still open): roofType gable / shed /
    hip / flat / trellis / none per style and per entrance; pillar styles square /
    round / tapered / craftsman / stucco with sizes; railing styles baluster / cable
    (modern) with post sizes and spacing; landing concrete or WOOD DECK with real
    deck framing (ledger, joists, beam on the porch posts, F.deck); the rear
    entrance at the slider (covered patio, raised deck on a hill, trellis for
    modern / ranch / craftsman); porch ceiling closed / cathedral; the Bones side:
    posts on pad footings, the porch beam, the ledger (done for sheds), hangers.
W11 Foundations — flat ground DONE; hills DONE 2026-09-06 as W14 (see log; the daylight basement builder is open): slab-on-grade or a RAISED floor (crawl space)
    chosen PlanCrafters' way, the building datum above grade, Bones framing the
    platform, mudsill, stem from the frost line below GRADE, pads at grade, ground
    cover, and the garage slab at grade with its walls standing on it. Still to do:
    stepped footings and the taller stem / basement from sampled terrain
    (TERRAIN-DATUM-SPEC), Bones reading a wall's `supportSlabId` so the garage
    walls frame down to their slab, dropped girders with piers in the crawl space.
W12 Structural sections and details tied to framing variables — details sheet DONE 2026-09-06, section annotations DONE 2026-09-06 (see log W12b) (PlanCrafters
    details.js + section2d): eave, rake, ridge, foundation / stem / slab edge,
    porch ledger, deck ledger, stair — drawn from the SAME numbers Bones frames
    with (rafter size, plate height, stem height, footing), placed on the sheets;
    review every section the Sections plugin cuts today against the framed model.
W13 Finishes — DONE 2026-09-06 (see log; muntin grids recorded not drawn, no finish schedule sheet yet): PlanCrafters' style palettes applied — siding / roofing / trim /
    door colours per style rolled as a unit, window styles (grid, casing, sill),
    wood styles; the finish schedule on the sheets (part of W7, listed here so
    nothing is lost).
W15 Ceiling joists as a framer laps them — DONE 2026-09-06 (see log; the open great-room
    span and the no-storage attic table are open): every joist line planned against the
    interior partitions that run with the ridge, lapped 12 in over as many of them as the
    stock needs (R802.5.2.1), each piece sized from Table R802.5.1(2) on its own span,
    12 in o.c. when that clears a flag, the honest flag only past the deepest row; the
    partitions named as bearing walls in the level warnings; the details sheet reads the
    spacing off the members.

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

- 2026-09-06 morning: **W11 landed (flat ground) — foundations.** Generate picks
  the foundation the way PlanCrafters' `applyFoundation` does off terrain
  (`foundation.ts`): the long-low ranch, an ADU or a footprint ≤ 34 ft is a
  SLAB house with the top of slab 8 in above grade; everything else is RAISED
  with the finish floor 18 in up (three risers at the door). The record rides
  the building node (`metadata.foundation = { type, ffAboveGradeIn, source }`)
  and the building's y is that height. A raised house's floor node is its
  3/4 in subfloor ("Floor platform"); the GARAGE always gets its own slab with
  its top at grade (`garageDefaultDrop` on flat ground) and its exterior
  walls carry `supportSlabId` so they stand on it — the house floor and the
  garage slab together cover exactly the rooms. Bones (`foundationOf` in
  compute, `gradeY` / `raised` options on `buildFoundation`): the footing
  bottom sits the frost depth below GRADE, not below the plate line (a slab
  house 8 in up gets 8 in more stemwall, labelled "exposed above grade");
  a raised floor is framed as a platform (joists, rim, flush girders on 4x4
  posts down to the crawl grade, pads poured with their tops at grade), a PT
  mudsill on the stemwall with the anchor bolts, hold-downs and plate washers
  moved to it, no slab field but a Class I ground cover at grade (R408),
  untreated sole plates on the platform, no interior thickened footings; a
  level whose slabs sit at different heights pours each field at its own
  surface (the garage pad). Nothing changes for a scene without the record
  (2,001 pins held; `compute.raised.test.ts` 8 cases, `foundation.test.ts`,
  build +2). Honest gaps: Bones does not yet read a wall's `supportSlabId`
  (the garage walls frame from the plate line, 8–18 in above their slab),
  crawl-space girders are flush on hangers rather than dropped on piers, and
  the terrain branches (Δ ≥ 12 in → taller stem, Δ > 30 in → basement, stepped
  footings) wait for sampled grade under the footprint.

- 2026-09-06 midday: **W10 landed — porch options, rear entrances, decks with
  framing.** `porch.ts` rewritten around PlanCrafters' entrance policies: the
  policy is `full` / `entry` / `patio` / `landing` / `deck` / `none`, the
  cover picks its form from the wall's roof ROLE (`porchRoofForm`: a gable
  dies into an eave wall as a valley; a shed hangs on a ledger under a
  gable end or a rake; flat for the modern; none for a landing / deck on a
  modern), the floor is a concrete landing 4 in below the finish floor on a
  slab house or a WOOD DECK 1 in below it on a raised house
  (`metadata.floor: 'deck'`, 1-1/2 in decking), the guard is a baluster
  rail or a CABLE rail (horizontal fence style, 3 in gaps, 2 in posts at
  48 in) for the moderns, the pillars are tapered craftsman piers or 13 in
  stucco piers for the stucco + hip styles, and the flight's risers come
  from the real rise. The REAR entrance (`build.ts`): a 6-0 slider from a
  living / dining / kitchen room on the back wall, else on a side wall of
  those rooms ("Side slider" — the roll's parti puts the primary suite and
  the laundry across the back), else a 3-0 door from the laundry / mud room
  or a hall; the rear gets a deck on a raised house, a covered patio on a
  slab house with a porch style, a bare landing otherwise. Front + rear
  summaries ride the run and the Generate panel. Bones (W10b): slab nodes
  carry a KIND from the generator's tag (`SlabKind` 'floor' | 'slab' |
  'deck' — `slabKindOf`), and `compute` frames / pours each by what it is:
  the floor kind is the platform on a raised house or the slab-on-grade,
  the slab kind (garage pad at grade, porch pad) is poured by the
  foundation at its own surface even beside a raised platform (before this
  the raised branch put a ground cover under the garage pad and framed
  joists across it), the deck kind goes to the new DECK ENGINE
  (`engines/deck-framing.ts`, PlanCrafters `F.deck`): a PT ledger on the
  house edge (the deck edge lying on an exterior wall, LUS hangers per
  joist, R507.9 cited), PT joists from the span table square to the ledger,
  rims on the free edges, a BEAM carrying the free end — dropped 4x8 16 in
  in from the edge on 4x4 posts when a ≥ 6 in post fits, else FLUSH (a
  second joist-size board doubled with the rim, the joists hung on it: the
  low-deck detail the 18 in raised house actually gets, 10 in posts) — and
  a pad footing under every post at grade through the same `girderPosts`
  path as the platform; a deck whose frame reaches below grade (a deck
  drawn off an 8 in slab house) gets no posts and a flag on every member
  instead of negative-height stubs. Freestanding decks get beams at both
  ends. **Defect found and fixed on the way:** an outdoor slab outside a
  wall (a deck, a porch pad — since W6) made the layer engine's exterior-
  side probe read the wall as covered on both sides, so the wall under the
  porch lost its sheathing, WRB and siding; slabs now carry `outdoor` and
  `probeSlabsFor` keeps them out of the coverage on this level and the one
  below. Verified headless (roll 1499472249 farmhouse, a craftsman, the
  Poppy: platform + garage pad at grade + two flush-beam decks on pads,
  walls behind the entrances keep their layers; the Poppy pours its porch
  and landing pads and frames nothing) and live on the Land Park scene
  (seed 325877780 farmhouse: the rear deck's ledger, joists, doubled rim
  and three posts on pads in Framing view). Tests: deck engine 10,
  compute.deck 8, porch 22, build 12 — Bones 2,028, generate 51, editor
  typecheck clean. Honest gaps: the porch roof's own posts still bear on
  the deck with no blocking / post-to-beam detail; a deck's guard posts and
  the deck stair are Pascal nodes, not framed; Bones still ignores a wall's
  `supportSlabId` (garage walls frame from the plate line); the roll's
  parti puts the rear slider on a side wall more often than the back.

- 2026-09-06 afternoon: **W11b — walls the host's way: level-height walls,
  garage walls down to their pad.** Two defects found while checking the
  raised farmhouse's framing. (1) Bones framed every generated wall 2.5 m
  tall (its default for a wall with no explicit `height`) while Pascal
  draws such a wall to the level's wall plane (core `resolveWallTop` /
  `getWallPlaneTop`: the floor-to-floor line, or the underside of a
  covering slab of the storey above) — a 9 ft house had 24 cm of air
  between its top plates and the rafters. `extractWalls` now takes a
  `WallDatum` from compute (plane top per wall run, support-slab base) and
  resolves the extent the host's way; explicit heights are untouched
  (2,034 pins held). (2) The garage walls on a raised house carry
  `supportSlabId` = the pad at grade, but Bones framed them from the plate
  line, 18 in above the pad. The wall slice now carries `baseY` (the pad's
  surface in the framing datum) with the body grown down to it; compute
  frames them slab-bearing (PT sole plate on the pad, `slabBearingIds`)
  and moves everything framed on them — skeleton, layers, devices — down
  by `baseY`; the foundation runs a per-wall datum (`plateW` / `raisedW`):
  stemwall to the pad, no mudsill, bolts / washers / hold-downs seated at
  the pad, the house walls keep the raised mudsill. The generator's
  collinear-run merge now stops at the garage boundary (`mergeRuns` group)
  so the garage's front wall is its own run and all three garage walls
  drop whole (before, the merged house+garage front wall stayed on the
  platform). Tests: `compute.wall-base.test.ts` 6 (plane top with and
  without a covering slab, explicit heights, the pad walls' plates / studs /
  stemwall / bolts / layers, the house unchanged), generate 51, Bones
  2,034, both typecheck. Headless: farmhouse + craftsman rolls report
  "3 walls on the garage pad at grade". Open: the roll's garage door wall
  and the house/garage separation wall on a slab house with a 4 in drop
  (same mechanism, untested live); a wall on a slab ABOVE the plate line
  (a deck-borne wall) lifts whole but the foundation ignores it.

- 2026-09-06 evening: **W14 landed — hills: USGS terrain on the lot,
  hillside foundations, stepped footings.** Three layers. (1) The lot
  drop-in (`packages/editor/src/lib/lot/terrain.ts`, PlanCrafters
  terrain.js `sampleGrid`) sends a 9 × 9 grid over the padded lot bbox to
  the existing `/api/parcel/elevation` route (USGS EPQS, keyless, feet),
  takes the ground at the lot centre as the datum (the site plane y = 0)
  and writes a bilinear heightfield into `site.terrain` — the same field
  the sculpt tool edits and every placement / raycast / drape already
  reads — with the read's provenance on `site.metadata.terrainSample`
  (source, grid, holes, datum, relief). A lot flatter than 6 in writes
  nothing (and clears a previous lot's hill); every failure says why and
  writes nothing; the status line says "terrain: 117.4' of fall across the
  lot (USGS, 79 pts, 2 unread)". (2) The generator (`build.ts`) now places
  the building FIRST (x, z, yaw), samples the site's heightfield under the
  outline (corners, every 2 m along the edges, the centre — `gradeAt` from
  `terrainFieldOf` + `heightAt` in run.ts), and `foundationFor` takes the
  PlanCrafters `applyFoundation` hillside branches: > 30 in of fall is
  basement territory — a 36 in stem with an honest "daylight basement not
  modelled yet" note — and ≥ 12 in raises the house on a stem sized to the
  fall (24–36 in, to the half foot); the building's y is the finish floor
  above the HIGHEST grade under the footprint (TERRAIN-DATUM-SPEC A:
  nothing wood below grade anywhere), the garage pad drops to ITS local
  grade (`garageDefaultDrop`: stem − rise, 2–48 in), and each entrance's
  flight rises from the ground where it lands (a porch on the downhill
  side of a steep lot gets the flight it really needs — 21 risers on the
  Placerville run, which is the honest answer and also the cue that the
  entrance wants the uphill side or a terrace: open). (3) Bones
  (`groundGradeOf` in compute — the site heightfield read through the
  building's position / yaw, level-local; flat ground = the constant
  grade, every scene without terrain byte-identical): the foundation's
  footing run is sampled every 0.3 m and split into LEVEL segments holding
  the ground within one 24 in step, each bottoming at the deepest frost
  line under it, with a vertical step block between neighbours (IRC
  R403.1.5; a sliver segment folds into its deeper neighbour; a step over
  24 in flags); the stemwall pours per segment and says how much shows;
  the girder and deck posts run to their OWN grade (`seatPostsOnGrade`)
  and their pads pour there; the crawl-space ground cover drapes strip by
  strip. Tests: `terrain.test.ts` 6, `foundation.test.ts` +3 hillside
  branches, `build.test.ts` +4 (flat-from-heightfield parity, gentle /
  downhill / steep slopes), `compute.hillside.test.ts` 6 (stepped and
  level footings, stem growth, posts and pads at their own grade, draped
  cover, the flat control) — editor lot 21, generate 58, Bones 2,040,
  every package typechecks. Live on the Land Park scene: the Placerville
  foothill preset dropped in with 117 ft of fall across the 2.4-acre lot,
  136 in under the footprint → 36 in stem, garage pad at its own grade,
  the hillside note in the run. Honest gaps: no daylight basement builder
  yet (PlanCrafters' `basement` type: 8 ft walls, 24 in stem); the house is
  still placed at the front setback square to the street — on a steep lot
  PlanCrafters would also weigh the slope (and a 21-riser porch says the
  entrance belongs uphill); the stem height is not yet fed back into the
  entrance policy (a deck on a 36 in stem reads fine, a slab landing does
  not arise); the USGS read is ~12 s and holes interpolate (2 of 81
  unread on the Placerville run). Live Bones on that run: "Hillside: the ground
  under this level falls 136.09\" — footings stepped down the hill", "3 walls
  on the garage pad at grade (48\" below the platform)", the porch deck's posts
  stepping down the slope in Framing view. Note: the editor saves the scene
  to the DB only through the Save button (autosave is localStorage), so a
  dev-server HMR reload mid-run drops the in-memory scene — do the live
  checks with no source edits in flight.

- 2026-09-06 night: **W12 landed — typical details sheet, drawn from the
  framed model.** PlanCrafters' `details.js` (the automated draftsman —
  parametric construction details drawn live from model variables) is
  ported into the Bones plan set as `plans/details.ts`: a registry of six
  details — TYPICAL EXTERIOR WALL, FOUNDATION @ EXT. WALL (slab or raised),
  TYPICAL EAVE, WINDOW HEAD & SILL, DECK LEDGER @ RIM, PORCH ROOF LEDGER @
  WALL — each `applies(v)` gated and drawn in world inches from
  `DetailVariables`, and every variable READ FROM WHAT WAS FRAMED
  (`detailVariables(members, spec, foundation)`): the deepest stud in use
  and the spec spacing, the sheathing / cladding / gyp thicknesses the
  layer engine laid, the most common header the wall engine sized, the
  rafter and ceiling joist the roof engine placed and the pitch from their
  rotation, H2.5A ties and fascia when emitted, the footing width × height
  and stem thickness the foundation poured, the stem exposure from its own
  label, slab vs raised and the floor height from the foundation record
  that now rides `ComputeResult.foundation`, stepped footings flagged in
  red when the hill stepped them, the deck joist the deck engine hung on
  its ledger, the porch rafter on the roof ledger. `detailsSheetBodies`
  lays the applicable details on 3 × 2 panels, fits each drawing to its
  panel (the caption prints the scale the fit produced, to the nearest
  1/8" = 1'-0"), packs the callouts into a leader column, numbers the
  hex bubbles, and the footer line says which variables were read. The
  sheet lands after Section A-A ("Typical details"); the panel passes the
  resolved spec and the foundation record. Tests: `details.test.ts` 10
  (variables from a framed fixture, slab fallback, stepped flag, label
  parsing, sheet composition, panel containment, scale labels); plan-set
  116 (title list + the metre-bar check skipped for the details sheet);
  Bones 2,050, typecheck clean. Rendered headless for the rolled farmhouse
  (CA: 8" stem, 16 × 8 footing, 5/8" A.B. @ 48" with plate washers, #4
  verticals @ 24", 2x6 rafters @ 24" at 8:12, 2x6 ceiling joists, 2x8 PT
  deck joists) and eyeballed in the dev server. Open: the eave overhang
  prints "PER PLAN" (16 in drawn — the rafter tail length is not read
  back yet); the eave dimension text can brush a leader; no SIP variants;
  the section sheet is still the member cut, not PlanCrafters' section2d
  with poché + labels — that's the next sheet to bring over.

- 2026-09-06 late: **W7 / W13 landed — finishes as one unit.** `finishes.ts`
  ports PlanCrafters' curated theme palettes (gen.js PALETTES, 4–5 per
  style, siding surface + trim + door + shutter that go together), its
  siding and roofing material table (model.js), the products and paint
  codes (STYLES sidingProduct / roofProduct / paintSW / trimSW) and the
  per-style fenestration (STYLE_WINDOWS + stampWindowStyle). The roll draws
  the palette index as its LAST draw (every earlier outcome holds);
  `finishesFor(style, palette)` resolves one `Finishes` unit and
  `applyFinishes` puts it on the nodes: the siding on every exterior
  wall's `slots.exterior` (lap and board-and-batten as the library's
  `siding-*` textures; stucco colours as flat colour presets on the stucco
  assembly), the roofing on the roof node (`topMaterialPreset` for the
  comp-shingle / tile textures, a metal `topMaterial` for standing seam),
  the trim on the fascia (`edgeMaterialPreset`), the window frames, the
  painted porch posts and the garage door, the door colour on the entrance
  doors, the wood style on deck rails (cedar / walnut / natural hex, or the
  trim colour when painted) and the plank texture on decks and wood
  stairs; window operation types follow the style (double-hung / sliders /
  fixed picture glass, a wide low light becomes a picture window, a small
  privacy light a slider). Colours that must be library references snap
  to the NEAREST flat colour preset read from `MATERIAL_CATALOG` — never a
  hand-typed id. The unit is recorded on the building
  (`metadata.finishes`) and printed on the run / panel line ("sage / cream
  / walnut door: lap siding — sage · comp shingle — charcoal · trim … ·
  windows double-hung, colonial grid (recorded, not drawn) · rails painted
  trim · James Hardie HardiePlank / CertainTeed Landmark · paint SW 7005,
  trim SW 6258"). **Defect found and fixed:** the porch / deck slab, stair
  and stucco pier presets were bare ids (`wood-floorplank1`) — Pascal's
  renderers resolve `library:<id>` only, so every deck and landing had
  been drawing in the default material; prefixed now. Tests:
  `finishes.test.ts` 9 (tables against the catalog, snapping, wrap,
  per-style units, applied to a rolled farmhouse and the Poppy), porch /
  build expectations updated (the Poppy's egress windows are sliders now,
  by style) — generate 68, typecheck clean. Honest gaps: no muntin grids
  in Pascal windows (recorded, not drawn); board-and-batten white uses the
  cream texture, batten black the charcoal one, shingle green / slate the
  classic shingle texture (the library has no closer textures — labelled);
  shutters are recorded, not modelled; no finish schedule sheet in the
  Bones plan set yet (the schedule rides the building metadata).

- 2026-09-06 night: **W9 landed — Simpson hardware named on the members and
  booked by model.** `engines/hardware.ts` is the catalogue: face-mount
  hangers by joist size (LUS24 / LUS26 / LUS28 / LUS210, HUS212 for 2x12,
  the -2 doubles), H2.5A ties, ABU44Z / ABU66Z post bases (ZMAX on PT),
  AC4Z / AC6Z post caps, HDU2-SDS2.5 hold-downs, BPS 5/8-3 bearing plates,
  CS16 portal strap, A35 framing angle — each with the catalogue fastening
  and "or equal"; a size off a table says VERIFY. Every engine prints the
  part through `partLabel`: floor hangers by the joist they hang, deck
  hangers at the ledger and flush beam, porch rafters on the roof ledger,
  hold-downs and plate washers in the foundation; the deck engine adds an
  ABU base at every post and an AC cap under a dropped beam; the foundation
  seats an ABU base on every pad it pours (crawl-space girder posts, deck
  posts). New roles `post-base` / `post-cap`; the takeoff books hangers,
  post bases, post caps, ties and hold-downs by model most-common-first
  (`modelsSummary`: "Simpson LUS28 ×12, LUS210 ×4 (or equal)"); the
  details sheet prints the same parts (LUS by the deck joist, H2.5A at the
  eave, ABU bases + HDU hold-downs in the foundation detail). The volume
  gate allows the base / cap contacts the way it allows hangers (symbolic
  solid hardware around the member). Tests: `hardware.test.ts` 6
  (catalogue, labels round-trip, deck bases / caps, takeoff rows),
  foundation / plan-set legend expectations follow the new labels — Bones
  2,056, typecheck clean. Honest gaps: A35 angles at the eave blocking and
  the CS16 strap ride the labels / details only (no members yet); ledger
  bolts (R507.9.1.3(1)) and the garage-door portal hardware are still
  generic notes.

- 2026-09-06 late night: **W8 landed — wall assemblies by what the wall
  is.** The generator classifies every wall run (`WallRole`: exterior /
  partition / plumbing / garage-separation — PlanCrafters WALL_TYPES +
  applyGarageProtection): exterior by style as before; a partition
  bounding a bath or laundry is the 2x6 plumbing wall
  (`interior-2x6-plumbing`, `wallType int2x6`) so the 3 in DWV stack fits
  inside it; the walls between the garage and the house are tagged the
  Table R302.6 separation; everything else stays a 2x4 partition. The
  door from the garage into the house is named and tagged the 20-minute
  rated, solid-core, self-closing self-latching door (R302.5.1). Bones'
  layer engine now applies its own researched `garageSeparation` data
  (`wall-assemblies.json` — 1/2 in gypsum "applied to the garage side",
  Table R302.6; Type X is a ceiling-below-habitable-rooms matter and a
  local amendment on walls, so it is NOT drawn): `garageSideOf(wall,
  rooms)` finds the face toward the garage when the other face is the
  dwelling, that face's gypsum is labelled the separation with the cite,
  and compute tells the reader which walls carry it and what the door must
  be. Tests: build.test +2 (roles, presets, thickness, the rated door),
  wall-layers.test +2 (garageSideOf gating, the R302.6 layer on the
  garage face only) — generate 70, Bones 2,058, both typecheck. Honest
  gaps: the plumbing wall is every bath / laundry partition, not the one
  wall the stack actually rises in (Bones picks its wet wall from the
  boundary walls; making them all 2x6 guarantees the fit at the cost of a
  few thicker partitions); porch pony walls are not generated; the "assign
  by role" assemblies panel is not built (the generator assigns, the
  inspector still edits per wall).

- 2026-09-06 small hours: **W15 landed — ceiling joists lapped over the
  interior bearing partitions and sized from the table.** Until now every
  ceiling joist was one stick eave to eave at the spec size, so every
  generated house wore 70-odd "over prescriptive span" flags on its main
  roof (13 m deep; the 2x6 @ 16" row stops at 3.90 m). `roof-framing.ts`
  now plans the joists the way a framer buys them (`planCeilingJoists`):
  the interior partitions running WITH the ridge (±10°, ≥ 1.5 m, full
  height, 0.65 m clear of the eave lines) are found in the segment's
  frame (`ceilingJoistBearingsFor`, level → segment-local, the inverse of
  the emitter yaw); per station the partitions covering it break the line
  into pieces — walking from the −eave, the fewest laps that keep each
  piece within the spec stock's row, breaking at the next partition
  anyway when the row is already passed; each piece is sized on its own
  support-to-support span up the 2x ladder (`ceilingJoistSizeFor`: 2x6 →
  2x8 → 2x10, the table's deepest row; a hip ridge overhead caps the
  depth); when a piece still flags at the spec spacing and the 12" column
  clears flags the whole segment's stations go 12" o.c.; only past all of
  that does the over-span flag ride the member, naming the partitions it
  is lapped over (or saying none runs under it). Pieces lap 12 in
  (R802.5.2.1, nailed per Table R802.5.2(1)), odd pieces set beside their
  mates one thickness over (toward the roof centre, off the rafter
  planes, inside the station band); labels carry the lap, the sizing and
  the spacing story; purlin struts land on the piece under their purlin
  line; gable, hip, gambrel and the mansard / dutch skirts all use it (the
  crown / gablet joists at the skirt top see no partitions). `compute`
  warns which partitions carry laps — frame them as BEARING (double top
  plate, studs over the girder / thickened slab). The details sheet reads
  the joist spacing off the members (`stationSpacingIn`) so a tightened
  wing prints 12". LOD 200 keeps the schematic one-piece joist. Headless
  on the generated houses: farmhouse main roof 70 flagged joists → 20
  pieces (the great-room side: 10.97 m from the eave to the kitchen
  wall), craftsman 68 → 15, ranch 84 → 18; the 22-ft wings go 2x10 @ 12"
  (they keep the 20-ft one-piece stock note); every strut foot on wood;
  the volume gate clean across the family with partitions. Tests:
  roof-framing.test +11 (sizing ladder, partition gating, the yawed
  frame, lap geometry, half-cover, three-piece lines, the skipped lap,
  the 12" fallback, struts, warnings), interpenetration +1, details +1,
  multistorey / spans / seat expectations updated, six B7 hash pins
  recaptured (INTENDED-CHANGE noted) — Bones 2,073, typecheck clean.
  Honest gaps: an open great room with no partition for 11 m stays
  flagged (a real plan carries a flush beam or trusses there — no beam
  engine yet); the no-storage attic table R802.5.1(1) is not in the data,
  so garage wings read the limited-storage row; the partitions are named
  bearing but the wall engine still frames them like any partition (no
  double plate / stacked stud check); flat-roof joists are not lapped.

- 2026-09-06 small hours: **W16a — valleys for the porch gable and for hip
  wings / hip mains.** `detectValleys` was gable×gable, same eave height,
  only; every generated porch gable (its plate 25 cm under the main's)
  and every hip join warned "valley detail required" and framed nothing.
  Now a gable or hip WING joins a gable or hip MAIN at right angles on the
  main's long plane: a wing eave BELOW the main eave moves the valley feet
  inboard of the wing eave by drop/tan(wing pitch) along the main eave
  line and lowers the apex by the drop (the plane intersection, the jacks
  still on the wing's pitch); a hip wing must carry its ridge to the
  pierce point (a shorter ridge would sit its hip end on the main — that
  still warns); a hip main joins only within its ridge portion (a wing
  into a hip end plane warns). The warning text names the modeled class.
  Headless: the farmhouse and craftsman porch gables now carry their two
  valleys + jacks; still open: the parallel-offset garage wing (its rear
  plane coplanar with the main's, its buried west end still framed — the
  next round), the ranch's hip wings into the near-square main's hip end
  planes, and a porch grazing the garage wing by 0.6 m. Tests: valley
  describe +2 (the lowered wing's feet / apex / jacks, the eave-above
  refusal, hip wing long / short, hip main long plane / end plane) —
  Bones 2,075, typecheck clean.

- 2026-09-06 small hours: **W16b — the hip purlin fix.** Hip commons,
  kings and long jacks over the rafter table only flagged (the gable had
  purlins + struts since B-round; the hip did not): the ranch's 13 m hip
  wore 38 "over prescriptive span" rafters. `frameHip` now hoists its
  ceiling-joist planning above the commons and, when the halved run fits
  the table, joists exist and the struts have height, frames a purlin
  under each of the four planes at half the run (rafter stock on edge,
  set back off the hip lines) with 2x4 struts ≤ 4 ft o.c. to the joists:
  the long-plane purlins cross the joist stations (a strut per joist
  line, on the lapped piece under the purlin line); an end-plane purlin
  runs WITH the joists, so it sits over the joist line nearest half the
  end run — its height taken at that line — and every strut of it bears
  on that one joist (the label says so, verify it). Commons / kings /
  jacks crossing a purlin are checked on the longer piece either side of
  it, labelled purlin-supported (+ the splice-over-purlin note past 20
  ft), no longer flagged; corner jacks short of the purlin are untouched;
  a hip whose halved run still exceeds the table (20 × 18) keeps its
  honest flags; LOD 200 stays schematic. Headless ranch: 38 rafter / jack
  flags → 0, 30 struts all on wood, the family SAT-clean. Tests: W16b
  describe +4 (four purlins placed and sized, struts on joists reaching
  the purlin undersides, the end purlins' one-joist struts, the halved
  flags, the no-fix and 200 cases), spans matrix updated (20 × 18 flags,
  14 × 12 fixed), the square-hip test reads past the purlins — Bones
  2,079, typecheck clean.

- 2026-09-06 small hours: **W16c — the parallel garage wing no longer
  frames inside the house.** The generator's garage wing sits beside and
  behind the main, ridge parallel, same pitch and plate, its rear eave on
  the main's rear eave line and its west 3.35 m inside the house: its
  rear plane IS the main's rear plane there and its front plane sits in
  the main's attic — 40-odd fake rafters, joists, studs and a ridge
  running into the house, and the main's rear rake ladder hanging inside
  the merged plane. `detectBuriedWings` finds parallel pairs whose wing
  lies at or under the main across their whole overlap (both surfaces
  sampled on a 0.2 m grid, the vertical envelopes interleaving — a cupola
  floating above the ridge is stacking); `buryWings` then drops the
  wing's members inside the main's footprint + eave zone and cuts the
  straddlers (ridge, purlins, fascia, drip edge, deck courses) at the
  gable line with a label note, and cuts the main's rake trim past its
  gable line wherever the wing's plane carries on (the rear barge stops
  at the wing's ridge line, the outlookers and fascia ends at the gable
  line). `clipMemberBy` samples along a member's axis (0.1 m, bisected
  boundaries) — usable by any engine. The reporter names the junction:
  flashing where the wing's planes die into the main roof, a ledger or
  bearing at the main's end wall, the garage separation carried to the
  deck (R302.6). Wings that rise above the main anywhere (the taller,
  steeper, or the ranch's hip wing through the main's hip end plane)
  are real intersections and keep the unframed warning. Headless: the
  farmhouse and craftsman wings keep zero members west of the gable line,
  the ridge starts on it, 18–20 cut members, the main's east rear barge
  cut at the wing ridge line. Tests: W16c describe +3 (detection and its
  refusals incl. the hip pair, the cut census against the wing / main
  framed alone, the clipper and plane helpers) — Bones 2,082, typecheck
  clean. Honest gaps: the porch grazing the garage wing by 0.6 m still
  warns (perpendicular, not a join); the wing's remaining west gable
  studs are gone but no attic separation wall is framed in their place.

- 2026-09-06 small hours: **W12b — the section reads like a section
  (the PlanCrafters section2d port).** Section A-A was a cut band of
  members with a grade line at the level plane and no numbers. Now
  `sectionAnnotations` measures the FRAMED members the plane slices —
  the eave walls' plates (outer faces, plate tops), the ridge board, the
  fascias nearest each wall (outer face), the continuous footing — and
  prints: FF above grade (the foundation's finish-floor height — the
  grade line now sits there, 18 in under a raised floor, not at the
  level plane), FF to top of plate, plate to ridge, footing below grade,
  out-to-out of studs and both overhangs, to the nearest half inch; and
  callouts with leaders for the rafters + pitch, the roof deck, ceiling
  joists, studs + plates + batt + gypsum, the floor (joists on the PT
  mudsill or the slab on its vapor retarder) and the stem on its footing
  with the anchor bolts — the same `detailVariables` the typical details
  print, so the two sheets can never disagree. The fit steps one ratio
  coarser while the drawing leaves under 250 px for the strings and
  slides left so the callout column has room; short vertical strings
  label horizontally beside the line. A porch roof's fascia in the band
  no longer reads as this section's eave (each side's tip is the fascia
  nearest the wall beyond it). Verified on the rendered farmhouse and
  ranch sheets. Tests: plan-set +3 (a synthetic transverse slice — every
  string and callout with the numbers off the members; the slab variant;
  a lone joist prints nothing) — Bones 2,085, typecheck clean. Honest
  gaps: no wall poché fill (the cut plates / studs print as the dark cut
  rects the band already drew); no interior-wall strings; the longitudinal
  section is still not cut.

- 2026-09-06 early morning: **W12c — Section B-B, the longitudinal cut.**
  The section machinery took an axis: `sectionCut(members, axis)` slides
  the plane off along-plane members on either plan axis (`zExtentOf`
  mirrors `xExtentOf`), the sheet projects the other axis across (B-B
  looks north like the south elevation), the poché slices along the
  plane normal, and the annotations read the across coordinate — on B-B
  the gable-end plates give the out-to-out, the rake's barge rafters the
  overhangs, the ridge its height. The tall strings' labels always run
  along their lines (a small-scale horizontal label collided with the
  inner column). The B-B sheet follows A-A in every set; the cover index
  picks it up. Verified on the rendered farmhouse (1:200, the long house
  with its wing) and ranch (1:250). Tests: plan-set +1 (a synthetic
  gable-end pair with a ridge: out-to-out 26'-8.5", plate and ridge
  strings, ordering after A-A), the title-list expectation gains the
  sheet — Bones 2,086, typecheck clean. Honest gaps: no section marker
  lines on the plan sheets yet (A-A never had one either); the rafters
  seen end-on read as ticks, not a roof outline.

- 2026-09-06 early morning: **W12d — the B-B cut mark.** The wall framing
  plan already printed the A-A cut mark (a dashed line at the section's
  slid cut, lettered bubbles at both ends); the longitudinal B-B mark now
  prints beside it the same way, at `sectionCut(2)` running along x. The
  wall plan stays the one sheet with cut marks (the foundation sheet is
  the pure-transform witness; the MEP sheets stay clear). Test: plan-set
  +1 — Bones 2,087, typecheck clean.
