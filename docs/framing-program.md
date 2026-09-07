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
W13 Finishes — DONE 2026-09-06, finish schedule sheet DONE 2026-09-06 (see log W13b; muntin grids recorded not drawn): PlanCrafters' style palettes applied — siding / roofing / trim /
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

W16 Roof intersections and the hip — DONE 2026-09-06 in six parts (see log W16a–f;
    the intersection LINE itself landed as W19): valleys for a wing on a lower plate and for hip wings / hip mains; mid-run
    purlins + struts on all four hip planes; a parallel wing running under the main
    buried, its straddlers cut, the main's rake trim cut where the wing's plane carries
    on; stub joists in the hip end strips; the valley join trimmed with the knife (the
    wing's rafters inside the main replaced by the jacks, its deck cut at the line, the
    main's eave trim cut under the wing); every other overlapping pair trimmed where the
    smaller roof runs under the larger. The attic separation over the garage is W17.

W17 Attic separation over the garage — DONE 2026-09-06 (see log): the dwelling–garage
    separation carried above the ceiling to the roof deck (Table R302.6) where the
    attics connect — a flat plate on the ceiling joists, studs to the roof underside,
    stations under the roof's own members left open; a separation on a gable end rides
    the gable-end studs (said), one under a hip end has no attic (said).

W18 Shed rafters on interior bearing walls — DONE 2026-09-06 (see log): the mono-pitch
    house's rafters bear on the partitions running with the eaves (span checked between
    supports), those partitions framed up to the underside as bearing walls; the shed's
    pediment studs inscribed under the plane; the shed plane known to the burial test.

W19 Roof joins framed as overframes — DONE 2026-09-06 (see log W19a / W19b; open: a
    hip porch too low to pierce its house slope ends its jacks over the eave with no
    sleeper on the plate; a porch on a hip END wall overframes onto the end plane with
    real valleys rather than the classic join): every pair of crossing roofs the model reads — a wing on
    the long plane, a wing through a hip end plane, a porch hip at the eave, a
    user-drawn crossing — is framed the California way from the roofs' facets: the
    larger roof runs through, the smaller roof's members are cut by their own bottoms
    against the larger roof's deck-and-sleeper stack, its rafters end as valley jacks
    on 2x sleepers laid flat on that deck along the level set, the larger roof's eave
    tails, deck and trim are cut where the smaller roof rides clear over them; a crease
    without fall is a DEAD VALLEY and a gable that stops short of the slope is named;
    the auto roof carries a hip wing two runs in and the porch cover is pitched and
    reached to pierce the house slope 0.9 m inside the wall (a shed cover's ledger held
    under the eave); the valley pair passes the volume gate at last.

## Mandate additions (Steve, 2026-09-06 evening — after the W19 backup)

Verbatim intent from the generated-house review, folded into G1–G11 below:
- "bones is missing on this scene i created, wanted to check framing"
- Mono roof: "i still cant see the front wall in the shed roofs … like there's a
  setting hiding the wall … i saw the framing working in the wall above the wall";
  "the side walls … show like the inside of the shed roof wall not the outside lined
  up and normal like gable roofs has"; "shed roofs need ceiling joist option that goes
  across or no ceiling joist"
- "on procedural house generation the material in the gable area isnt updating"
- Porches: "some posts are in the entrance of the porches in the middle, they should
  have a post to each side of the stair and if the person adjusts the stair it moves
  the posts"; "i cant see the deck framing below and should have a fascia board";
  "the stairs are rotated 90 … they need to rotate -90"
- "make sure the exterior sliding glass doors are not the closet slabs, should be glazing"
- "we have a sheet generation tool, the structural details are to be in that"
- "i dont see any furniture in the procedural generation or kitchen layouts using their
  tooling, make sure sinks and cabinets are facing the correct directions, bathroom have
  standard layout, typically vanity, toilet shower or tub, auto fixtures, auto schedules"
- "some of the interior walls on procedural are 2x6 and jump from 2x4 and leave jogs in
  the wall, like master bath has 2x6 for some reason, shared wall from garage should be
  2x6 so it aligns with exterior wall"

G1  Bones missing on a created scene — find why the panel / rail is absent there.
G2  Shed roof walls in the shell: the high wall above the plate, the raked side walls
    clad on the OUTSIDE like a gable end.
G3  Shed ceiling: a Bones option — joists across at the low plate, or none (vaulted).
G4  The gable / shed pediment takes the palette siding (roof segment `wallMaterialPreset`).
G5  Porch posts flank the stair (one each side), corners + ≤ 8 ft bays; posts follow a
    moved stair.
G6  Deck: a visible rim / fascia band, the framing inside it; Bones joists under the decking.
G7  Porch and deck stairs run the stair node's own way (+Z ascends) — the −90° fix.
G8  Exterior sliders are glazed patio doors, not painted slabs.
G9  Structural details, sections and the finish schedule in the Sheets tool.
G10 Furniture, kitchen and bath layouts from the item catalog, facing the right way;
    auto fixtures; schedules.
G11 Partitions are 2x4 everywhere (no plumbing 2x6 jogs); the garage separation is
    2x6 on the exterior wall's line.

Added later the same evening (Steve, verbatim): "the garage door rails go out from the
garage doors still"; "the gable on porches doesnt show up, and the posts should go down
to the grade wherever that might be, and stairs need rails that go down, look at plan
crafters system for how rails work, we use nice 6x6 posts typically on these entrances,
not 4x4, but users can change that on auto porch entrance, not sure how the auto porch
entrance tool works / plug in if we have one, also dont see the siding go down to grade
and the raised floor if its up should be standard stemwall and floor joist sit over the
stemwall and details reflect those for foundation, the rail shown here not sure why but
its like boxes, the posts for rails go between and the stair goes through the width of
the first two posts typically".

G12 Garage overhead door faces the street so its tracks run inside.
G13 Porch gable pediment renders; porch posts run to grade (6x6 by default, user-set);
    stair rails down the flight; rail posts between the columns, the flight through
    the first bay; the guard infill drawn as balusters / cable, not boxes.
G14 Raised floor: a concrete stemwall from footing to mudsill visible in the shell,
    siding carried down over the rim, floor joists over the stemwall, the foundation
    details on the sheets reflecting it.
G15 An "auto porch entrance" tool / panel: the porch's post size, rail style and roof
    form editable after generation.

Later still (Steve, verbatim): "also make sure there are slab porches on slab houses,
and make the ceiling raise a bit larger than the house ceiling height for entrances in
front like 8'6 ceiling on 8' house or maybe 9' ceiling on porches then some where
ceiling height top plate matches, porches drop down 1" from inside finish floor so its
a bit different but they always step down out of the house, front or back works this
way, 1.5" max, think that covers it all for now".

G16 Slab houses get concrete porches front and rear; the porch ceiling is 9 ft (never
    under the house plate — a 9 ft house matches plates); every porch floor steps DOWN
    out of the house, front or back, by 1 in (wood) to 1½ in (concrete), never more.

## Log

- 2026-09-06 evening: **Batch A — the generated houses reviewed (G4–G8, G11).**
  Stairs turned the stair node's own way (its run ascends along +Z; the porch
  had assumed +X); exterior sliders glazed (76 % glass in two columns over a
  24 % panel) instead of the closet slab; posts one each side of the flight
  and at the corners, bays ≤ 8 ft, nothing in the entrance; the deck slab is
  the decking plus its joist band so the rim reads as a fascia (Bones frames
  under the decking it is told, `metadata.decking`); every partition 2x4 (no
  2x6 plumbing wall jogs), the garage separation the 2x6 on the exterior
  wall's line. Tests: porch and build expectations — plugin-generate 74,
  Bones 2,107.

- 2026-09-06 evening: **Batch B — the shed roof's walls, the pediment's siding,
  the garage tracks, Bones on every scene, the porch rule (G1, G2, G4, G12,
  G13 part, G16).** The viewer skipped the hollow wall band for EVERY shed
  segment (upstream's lean-to work: a lean-to's high side is its host wall,
  its ends the inset infill panels) — so a house's mono-pitch roof floated
  over plate-height walls and its ends showed the infill's inside face.
  `isLeanToShedSegment` (the lean-to assembly's side-infill fields) now gates
  that: a plain shed carries the same hollow wall band a gable does — the
  high wall and the raked side walls, on the wall faces, in the wall/trim
  slot — and no inset panels; its deck edges are fascia (the deck slot) like
  a gable's. The roof material slots read: 0 = the wall band above the plate
  (`edgeMaterialPreset`), 1/2 = deck edge + soffit (`wallMaterialPreset`),
  3 = shingle top; the generator had them crossed (trim on the band, siding
  on the fascia and soffit) — the band takes the palette siding, fascia and
  soffit the trim, so the gable AND the porch pediment now render sided (the
  porch pediment was the same crossed slot). The garage overhead door is
  flipped to face the street so its tracks run inside (`side: 'back'` +
  rotation π). Bones is `defaultInstalled` so it is on a fresh scene. Porch
  rule (G16): PORCH_FLOOR_DROP 1½ in (was PlanCrafters' 4 in), PORCH_COVER_HEIGHT
  9 ft and the gable / hip beam never under the house plate (`coverGeometry`
  takes the higher of the two; the shed cover stays the one that must hang
  under the plate); slab houses already pour concrete porches front and rear
  (`porch-slab`). Seen in the editor: the modern-mono's high wall and raked
  ends in siding from both sides; the farmhouse porch gable sided with its
  beam at the plate; the ranch garage door's tracks inside, its face clean.
  Tests: viewer roof shed test rewritten (band faces on the wall planes, no
  inset panels), finishes slot test, porch / build expectations for the drop
  and the 9 ft beam — viewer roof 12, plugin-generate 74, Bones 2,107,
  sheets 235, sections 21, roof 20, editor typecheck clean. Open from Steve's
  list: G3 shed ceiling joists, G5b posts following a moved stair, G6 (why
  the deck framing is not seen below), G9 sheets details, G10 furnishing,
  G13 posts to grade / 6x6 / stair rails / rail infill, G14 stemwall, G15
  the porch panel.

- 2026-09-06 evening: **Batch C — the porch the way Steve builds it (G13).**
  Every entrance post is a 6x6 (`ENTRANCE_POST`, 5.5 in; the stucco ranch
  keeps its 13 in piers, craftsman its taper); on a deck each post is ONE
  member from the grade under it (`PorchInput.gradeAt`, the build's
  `localGrade`) up through the deck edge to the beam — no `supportSlabId`,
  its height the beam over that grade — while a concrete porch's posts stand
  on the slab, which is on grade itself. The flight gets handrails at three
  or more risers (PlanCrafters' rule; IRC asks at four) as well as over a
  guarded landing. The guard's "boxes": the viewer's 'slat' fence draws a
  picket every 0.3 × postSpacing between its two end posts, so 72 in gave
  21 in open rectangles — 18 in now reads as balusters 5.4 in on centre (a
  3.5 in clear gap); and the outer rail runs in one section per bay between
  the porch posts, so its end posts land at the columns and the flight takes
  the first bay. Seen in the editor on the farmhouse (seed 1308856731):
  balusters, wood handrails down the steps, the posts passing the deck rim
  to the ground. Tests: porch +1 (posts to grade / on the slab), the 6x6 and
  bay-section expectations — plugin-generate 75, Bones 2,107, editor
  typecheck clean. Note: the roller's 50-seed test sits at bun's 5 s default
  timeout on this box (5.07 s once, 4.x s on rerun) — environmental, not a
  regression.

- 2026-09-06 evening: **Batch D — the wall carries its underpinning (G14, the
  shell and the drawings).** A generated house's walls stopped at the floor
  and the raised platform floated over the ground. Pascal's wall node had
  only `fillToTerrain` (the wall's own faces to the terrain, one material,
  nothing without a terrain field). New on the wall: `underpinning: { rim,
  stem }` — the exterior finish carried `rim` m below the base over the
  platform's edge (subfloor, rim joist, mudsill), then the concrete stemwall
  `stem` m more to the ground (to the terrain wherever that is lower, with
  `fillToTerrain`), painted through a new `foundation` wall slot (default
  concrete-raw, material index 11, paintable). The viewer builds two skirts
  under the body, split at the rim depth, so the material groups paint the
  rim in the wall's finish and the stem in concrete; the sections plugin's
  elevation carries the cladding and its hatch down to the rim and draws the
  stem band below in slab poché, the cut shows the cladding layer down over
  the rim and the stem across the wall. The generator: every exterior wall
  on the house floor gets `fillToTerrain` and its underpinning — raised
  house rim = `PLATFORM_RIM_M` (3/4 in subfloor + 2x10 + 2x mudsill under
  the wall base, 0.24 m; Bones sizes its own joists so its stem top can
  differ by a joist size), stem = the rest of the way to the grade under
  the wall's midpoint; slab house rim 0, stem = 8 in to grade in concrete;
  the garage's walls on the pad carry nothing. Bones already pours the
  raised stemwall to the mudsill with the joists over it (compute's
  `raised.stemTop`), so the framing view and the shell agree to a joist
  size. Seen in the editor on the farmhouse: siding down over the rim, a
  grey stem to the ground under every wall. Tests: sections +1 (elevation
  face to the rim, stem band, the cut's stem), build +1 and the raised
  farmhouse's walls — sections 22, generate 76, Bones 2,107, sheets 235,
  core wall 11, viewer wall 45, nodes wall 125, editor typecheck clean.
  Open on G14: the foundation DETAIL drawing for a raised floor (stem +
  mudsill + rim + joist) — check what Bones' details already draw.
  (Checked: `plans/details.ts` already draws the raised foundation detail —
  mudsill + anchor bolt + rim + joist bay + subfloor + wall stub — from
  `detailVariables`, so G14's detail is covered.)

- 2026-09-06 evening: **Batch E — the shed's ceiling joists (G3).** A
  mono-pitch segment framed vaulted only. New Bones level option
  `shedCeiling: 'none' | 'joists'` (schema, spec, compute — absent means
  none, the roofSystem byte-parity rule): with 'joists', `frameShed` plans
  ceiling joists across the depth on the LOW plate with the W15 planner
  (sized per station from the table, lapped over the partitions under
  them, stations snapped beside a rafter), the low-eave end clipped d/tanθ
  where the rafter's bottom face leaves the plate, the high end square under
  the pediment; a porch shed on a ledger frames none. The panel's Roof
  block gets a "Shed ceiling — Vaulted / Joists" control (Vaulted removes
  the key). Tests: roof-framing +2 (vaulted by default; joists on the plate,
  along Z, ends where they should be, none on a ledger), panel-framing +2 —
  Bones 2,111, editor typecheck clean. Found while checking G6: in the
  Framing view the deck's slab, fence and stair stay drawn (the studs show,
  the decking still covers the joists) — the shell hider only reaches
  objects in the scene registry; next.
  (Resolved: on a clean mount the Framing view hides all 103 shell nodes
  (none missing from the registry) and the deck's joists, rim and posts
  show with the decking, rails and stair gone — the miss was hot-reload
  state from mid-session edits plus clicking the "Framing" row label
  instead of the view-mode button. G6 is the shell view: the decking
  covers the joists there by design; the rim now shows.)

- 2026-09-06 night: **Batch F — the house is furnished (G10: fixtures,
  furniture, the plumbing follows).** New `plugin-generate/src/furnish.ts`:
  a pure pass over the rooms — each a plan-inch rectangle with four edges
  (wall half thickness, exterior or not, the openings seated in it, which
  the build pass now records as it seats doors and windows) — placing
  catalog items by room kind. An item stands AGAINST an edge with its back
  to the wall, turned so its front (+z, the catalog convention the editor's
  wall placement uses) faces the room's inward normal, or free-standing
  facing a target (chairs their table, the sofa the TV); nothing in the
  36 in clear zone before a door or cased opening, nothing tall with its
  back on a window it would block, nothing overlapping (2 in breathing
  room; a kitchen run is continuous). Recipes: bed (double under 10 ft,
  else single) heading the wall without door or window, nightstands
  beside, dresser on another wall; bath — the wet wall is the longest
  door-free wall, the tub across the end wall when it takes 92 in, else
  the shower in the corner at the wet wall (or on the wet wall's low end
  when both end walls have doors), the toilet 18 in on, the vanity next
  toward the door; kitchen — the run under the window with the sink unit
  centred on it (or slid off a doorway), the range then a counter one way,
  the fridge then a counter the other, the fridge and range moving to the
  wall square to the run when the run cannot take them; dining table
  centred (shifted off a door swing, turned when only that fits) with four
  chairs; TV on a blank interior wall, sofa facing it from 9 ft down to
  5 ft, coffee table between; desk under the office window, bookshelf;
  washer in the laundry. What does not fit is left out and said so — the
  catalog's only vanity is a 72 in double, so most baths get toilet and
  shower and a warning; a 7 x 8 dining room cannot take the 85 in table.
  The build pass takes `BuildOptions.catalog` (run.ts passes the editor's
  `CATALOG_ITEMS`), emits the items on the level (`metadata.furnish`
  room / kind / role) and counts them in `stats.items` (the panel prints
  it); a probe can read the pass's decisions through `furnishTrace`. Bones
  reads the sanitary items straight off the level (`extractPlacedFixtures`)
  so the plumbing follows the placed toilets, showers, tubs, washer and
  kitchen sink. Seen in the editor's floor plan on the farmhouse (seed
  1308856731): beds with their heads to the walls, the baths' toilet and
  shower, the dining set, the great room's sofa and TV, the kitchen run
  with the range at the corner, the washer. Tests: furnish.test (facing,
  bedroom, baths 5 x 8 / 13 x 9, kitchen under the window, fridge clear
  of the glass, living, dining, office, laundry, the item nodes, a missing
  catalog entry) +13, build +1 (Poppy furnished from the fixture catalog,
  every item on the level inside the footprint; none without a catalog) —
  plugin-generate 90, editor typecheck clean. Open: a narrower vanity and a
  60 in tub in the catalog would furnish the small baths the way they are
  built; a fixture / furniture schedule on the sheets (G9).

- 2026-09-06 night: **Batch G — the typical details on the Sheets tool
  (G9).** The Sheets tool already drew the S-series live from Bones (S1.0
  foundation, S2.x floor framing, S3.0 roof framing, S4.0 bracing, SN1
  notes, their schedules) and carries a fixture schedule that the placed
  items now feed; what it lacked was Bones' typical details, which only the
  Bones panel's own plan set printed. New `providers/structural/details.ts`:
  the `details` system (and `details-2` … for the next page) renders Bones'
  `DETAILS` — typical exterior wall, foundation at the exterior wall, eave,
  window head and sill, the deck and porch ledgers where they apply — from
  `detailVariables(members, spec, foundation)` (the stud, rafter and joist
  sizes and spacings the engines used, the assembly layers, the footing and
  stem poured, the finish floor above grade from the building's foundation
  record) into plate geometry: each detail fitted to a 3 × 2 panel at the
  largest scale that fits (printed under the caption — never a nominal),
  its notes packed down a right column with elbow leaders to their anchors,
  a numbered hexagon caption, the provenance line as the plate's subtitle.
  `structural-set.ts` plans S5.0 (S5.1 … when more than six apply). Looked
  at as SVG in the browser pane: four panels on the cottage — wall section
  with its batt and layers, foundation with slab and stem, eave with
  rafter, tie and blocking, window head and sill. Tests: structural +2
  (the plate's titles, scale line and the framed stud callout; the set
  plans S5.0) — plugin-sheets 237, editor typecheck clean. Open on G9:
  Bones' framing sections (the cut through the framed model) as a Sheets
  drawing; the Bones panel's own plan set keeps printing its details too.

- 2026-09-06 night: **Batch H — the porch posts follow the stair (G5b).**
  The generator tags the pair of posts each side of the flight
  (`metadata.post.flank`); new `porch-follow.ts` (`stairFollowPatches`)
  reads a generated entrance's stair after a move, takes the component of
  the move ALONG the porch edge (the stair's local +x, square to its run)
  and slides the two flanking posts of that entrance by it — a move square
  to the edge moves nothing, a nudge under 2 mm nothing, a hand-made stair
  nothing. `registerGenerateCommands` (bootstrap) adds one scene-store
  subscription that diffs stair positions and writes the column patches
  (columns only, so it cannot feed itself). Tests: porch-follow +4 —
  plugin-generate 94, editor typecheck clean. NOT yet exercised in the
  editor by dragging a stair (the pane cannot drag; the pure function is
  tested, the subscription is a dozen lines).

  Status at the end of 2026-09-06 (Steve's evening list): done G1, G2, G3,
  G4, G5 (both parts), G6 (it was the shell view), G7, G8, G9 (details; the
  fixture schedule already existed and now has fixtures to list), G10, G11,
  G12, G13, G14, G16. Open: G15 (an "auto porch entrance" panel — post size,
  rail style, roof form editable after generation; today the generator's
  6x6 / balusters / cover form are fixed at generation and editable only
  node by node), the catalog's vanity width for small baths, Bones'
  framing sections on the Sheets tool. Commits since the backup push
  (f58bb085): 4ef9816a, 4a10589a, 25c611a3, a8a486d6, ec01f13e, e81367fb,
  c2985f2a and this one — not pushed (Steve: local is fine).

## Mandate additions (Steve, 2026-09-06 late — the entrances)

Verbatim: "i see your gable is still missing on the porch also porch beams should
be sized correctly, girder, and the gable wall on it look at plan crafters works,
also your stair rails are not framing correctly, they do posts typically every
4' so if the stair length is less than 4' then you have two posts, the rail for
auto porch stair should die into the 6x6 posts, the rail style on the stair from
pascal isnt good it goes to each tread not how rails work typically, has bottom
rail top rail and pickets infill, post 4x4 every 4' is how it works, also add
footings below any post, should be standard footing size make it so it can be
changed easily and is smart with the plans, lets get more into this area now on
entrances, foundations were looking great, elevations looking good but missing
fascia boards from roof, show rails and all features and the roofing material
isnt in color and matching its still black and white, ensure elevations are
projecting trees and anything else in the scene correctly, also saw these
errors :: THREE.WebGPURenderer: Uncaptured WebGPU GPUValidationError: Vertex
buffer slot 0 required by [RenderPipeline "renderPipeline_MeshBasicMaterial_157"]
was not set."

G17 The porch gable pediment (3D) — checked on the cottage and the farmhouse
    (seeds 1308856731, 777): it renders; the open gable in Steve's shot is a
    tab that had not reloaded the rebuilt viewer. Watch it.
G18 Bones frames the porch cover the way PlanCrafters' porchWall does: a 6x8
    beam and a plate along each open bearing line on 6x6 posts to grade, pad
    footings under the posts (a standard size in the spec, changeable, on the
    foundation plan), the pediment studs on the beam at the open gable end.
G19 Stair guards: 4x4 posts every ≤ 4 ft (two on a short flight), top and
    bottom rails, pickets; the porch stair's rail dies into the 6x6 posts.
G20 Footings below every post, standard size, easy to change, on the plans.
G21 Elevations: fascia boards, rails and every feature, the roofing in colour,
    trees and everything else in the scene projected.
G22 The WebGPU "Vertex buffer slot 0 … was not set" error.

**Steve, 2026-09-06 (night), verbatim:** "okay i noticed in presentation view
the posts still dont go to end of beam, literally bring the framing in just
major posts, not studs, into the view and use those, the presentation view
can add like gingerbread on it and change the colors and things as it wants,
also i noticed when houses are generated and this was before where walls
connect it has these white things on top of the wall and they poke out, thats
not how it should look and looks terrible, not sure if those things over the
walls come from bones or the base software but it sucks lol! nice work btw! i
dont see interior ceiling being generated, also should be seattle grey walls
on the inside not unfinished like this on generation, keep cleaning up, also
add a procedural house mode, where someone can draw or generate a house,
modify it, and save it into the procedural algorithm, that way this is
expandable with more designs, also include a procedural mode where it opens a
page and lets me see all the options and settings for procedural so its not a
black box … ohh yeah and your rear deck posts are not at the right elevation
and poking through the roof, the posts on all auto porches look rounded edges,
not true wood framing and they have notches like looks like tube and weird,
not wood … and then maybe reset the dev server and toss onto a new port for
the next tests, so we ensure errors are gone"

G23 The presentation posts ARE the framing's posts: the beam band ends at the
    posts (centred on the post lines the way Bones' girder is), the posts
    square, sharp-cornered, one piece — sizes from Bones' lumber table.
G24 The white blocks on wall tops where walls connect — the editor's ceiling
    corner grab-brackets, one per ceiling corner on the level (Batch N).
G28 Rails by style, and the flight's guard matching the landing's: cable on
    the moderns, balusters on a bottom rail everywhere else, one colour.
G29 A real railing system (Steve: "go hard on railing systems … look up the
    national wood association"): guard posts 4x4 or the rail dies into the
    6x6 — never a 4x4 beside it; a 2x6 flat cap over a 2x4 top rail, the
    bottom rail; the guard's style carried down the flight; cables straight,
    never bent mid-air; the post through the cap with a cap as an option;
    the rear porch's rotated top rail.
G25 Interior: a flat ceiling in every room; the walls painted inside (the
    library's light grey — no "Seattle grey" in the catalog; one line adds it).
G26 Rear deck posts at the right elevation (they were being lifted onto the
    deck by the viewer's floor stacking).
G27 Procedural house mode: draw or generate, modify, save the house INTO the
    procedural algorithm as a new design; and a procedural settings page that
    shows every option — no black box. Design in
    docs/procedural-generation.md §7; building it is next.

## Mandate additions (Steve, 2026-09-06 late night — the submittal review)

Verbatim: "okay keep checking this and the plans, make sure the frmaing sheets
are correct, has correct footings for slabs, check irc / crc standards, ensure
it can work correctly and make the details looks great, check them all, and
look through the plans, each sheet each item, ensure they are all accurate and
would be ready for submittal, review the florida standard submission see if we
are misisng and submissions for florida, ensure the code sections change to
correct idenitfer by area as needed or if irc covers florida, if not make sure
florida works correctly, irc area are the priority, make sure hte energy calc
works correctly, and really go top to bottom, generate a design, review that
the guradrail details are accurate, ledge details with flashing, make the
window details better, look up architectural standards, ensure the sheets
adjust correctly if the floor plan is chaged, we dont need the window and
fixture and door scheudle son the floor plan sheet, we have a detaicated sheet
fo rhtat, ensure the wall assemblies are correct, top to bottom check get it
working correctly, thank you! check stud walls are to code, show fire blocking,
ensure our structural sheets show correct framing for beaintg wall, shear
transfer details for gable walls, include fire walls if under 5' to peroty
line, try a florida address ge thte lot in, then gerneate a hosue, cehck the
alg is workign correctly, get it all working thanks!"

G30 Every citation names the code the jurisdiction adopted — FBC-R in
    Florida, CRC in California, the IRC where the IRC is the code — and the
    IRC areas come first.
G31 Florida works: the county (HVHZ, zone 1A) read off the site when the
    parcel record has none, the HVHZ wind range on the structural notes,
    the energy rows for the resolved zone, the Florida submission checked.
G32 Slabs have their footings; the structural sheets show the bearing walls
    as framed (trusses or stick, bearing partitions only where the joists
    lap); stud walls to code; fireblocking shown.
G33 Details that read: guard @ post (DCA 6), stair guard & handrail, ledger
    with flashing, window jamb & flashing sequence, gable-end shear transfer
    & bracing, fireblocking.
G34 No window / fixture / door schedules on the floor plan sheet (A8.0 and
    P1.0 carry them); the wall assemblies as a schedule, correct.
G35 A wall under 5 ft from the lot line is a fire wall (R302.1): rated on
    the plan, in the assembly schedule, with the distances on the site plan.
G36 The sheets follow the plan: move the house or change the plan and every
    sheet re-reads it on the next draw.
G37 A Florida address, the lot in, a house generated on it, the algorithm
    checked end to end (scripts/demo/generate-and-print.ts).

## Mandate additions (Steve, 2026-09-07 — the printed set)

Verbatim: "looking at the hosue on the plans its crooked, the north arrow should
rotate not the house liek that, the hosue should stay 90, posts are going into
the roof on elevations, upper gable is miscolored, house is cut off, maybe one
elevation per sheet, ensure it always fits correctly or scales down if the house
is massive or super tall, but a whole sheet and center it should work and
schedules nicely done, building section s missing colros and framing and notes,
and framing call outs and things liek that, the set in general is still having
mistakes and very basic on elevations, ensure all the pascal systems come in
clearly on this vector sections and elevations and are whats actually there,
thanks!" — and of the 3D model: "fascia board is missing on this one i
generated front porch fascia board left side, right side is working" … "wait it
showed up on the fascia board on the rest, might have just been edge case!"

G38 The house stays square on every plan: the north-up turn is snapped to a
    quarter turn and the north arrow carries the residual; the site plan
    turns the lot, not the house; every plan of a level (floor, structural,
    electrical, plumbing) takes the same turn.
G39 Elevations: one per sheet (A4.0–A4.3), the whole building fitted to the
    frame and centred, scaled down only when the house is too long or tall;
    drawn square to the building's own faces and named by the world
    direction they look at; posts stop at the beam they carry; the gable
    end clad like the walls.
G40 Building sections show the structure: Bones' members cut by the section
    plane in the details' colours, with a leader and a note on every family
    the cut passes through (trusses/rafters, sheathing, ceiling insulation,
    plates, studs, joists, girder, mudsill, stemwall, footing, slab) — the
    member's own size, the spec's spacing, the code's R-value.
G41 Elevations show what the model carries: the grade under the building
    where it stands (a raised floor reads above its grade line), the
    cladding the assembly declares (Bones frames siding for a sided house,
    not the state's stucco default).

## Mandate additions (Steve, 2026-09-07 — after the printed set)

Verbatim: "i noticed the shed roof or moono roofs in elevations dont show the
upper wall above the top plate, those are not working correctly, also the
rails in front should center onthe two columns on each side on the porches and
connect into the post, woul dbe amazing, i also want some mroe procedural
designs and the ones we have now, better kitchen designs and layouts, its liek
the kitchen is in the middl eof the room, idk needs revamped on the floor plan
side, check all teh fixtures and layouts, add more, soend some time on taht so
the random generates more options, i want way more stucco options like stucco
pillars, and also on the porches with gables add some gingerbread to the gables
on porches, and gingerbread into the gables on the houses, style more front
door options, create them into our library if you need to, just enhance
gingerbead around the houses overall get creative, and also lets think through
how bons will work if someone draws something from scratch that those will
work, also the front porches, not sure if this is possible but if they adjust
it the frmaing should adjust, also on auto build roof, once its on, if they
change the wall or move it out make sure it updates the roof as they do it,
they can turn it off too, default on in the plug on, especially if
procedurally generated, keep workign throug hte plans cehck each hosue type
and looka th televations sheets themselves" — and: "also the stucco columns
or any built up columns, eed to be the correct frmaing orientation of 2x4s
bottom plat top plate, 2xs in teh corners, then spaced like at least 12" o.c.
maybe so its correct in frmaing view as well, and attached to deck or conrete
conrrectly usually gets some hold downs, i also wnat to add the holds donws,
feel free to keep going until we get it all done and tested".

G42 Shed / mono roofs show the wall above the plate in elevation (done, R1).
G43 Porch rails centred on the flanking posts and dying into them.
G44 More procedural designs; kitchens laid out against the walls with the
    fixtures a plan needs — more fixtures, more layouts, more options per roll.
G45 Stucco options: built-up stucco piers on every stucco house, framed the
    way they are built — 2x4 plates, 2x4s in the corners, studs at 12 in o.c.
    at most, sheathing, the 4x4 inside carrying the beam — anchored to the
    deck or the concrete with their hardware; hold-downs where they belong.
G46 Gingerbread: brackets and trim in porch and house gables; more front
    door styles; enhance the trim around the house.
G47 Bones from scratch: a hand-drawn house frames as well as a generated one.
G48 A porch the user adjusts re-frames; the auto roof follows wall edits
    live once on (on by default for a generated house, can be turned off).
G49 Every house type's elevation sheets reviewed.

## Log (continued)

- 2026-09-07: **Batch R2 — the built-up stucco pier, framed (G45).** The
  generator's `pillarFor` gives every stucco house the 13 in pier (only the
  hip ranch had it) and tags the column `metadata.post.pier`; Bones reads
  the tag (or a stucco material, or a section past 10 in) into
  `PorchPostSlice.pier`, and `framePier` (porch-framing.ts) frames it the
  way it is built: the 4x4 that carries the beam at the centre, a 2x4 box
  around it inside the stucco (7/8 in) and the sheathing (7/16 in) — a
  bottom and a top plate on each face, a stud in every corner with its wide
  face along the pier's face, studs between them at 12 in o.c. at most
  (none in a 13 in pier's 3⅜ in clear, one per face in a 24 in pier), the
  sheathing on the four faces with lath and three-coat stucco named as the
  finish. At the pad the post base now FITS the post (ABU44Z on the pier's
  4x4, ABU66Z on a 6x6 porch post — every porch post had been labelled a
  4x4's), and a pier's bottom plate gets two 5/8 in anchor bolts into the
  pad, one each side of the post (R403.1.6 / R407.3). Tests: porch-framing
  +2 (the 13 in and the 24 in pier) — Bones 2,125, generate 95, editor
  typecheck clean. Seen on the Miami Shores ranch: five piers, each 1 post
  + 8 plates + 4 studs + 4 sheets, ABU44Z bases, ten plate bolts.


- 2026-09-07: **Batch R1 — the shed roof's wall in elevation.** Steve: "the
  shed roof or mono roofs in elevations don't show the upper wall above the
  top plate". `projectRoof` drew only the deck (top envelope down to the
  lowest underside) and painted every slope-aligned view in the roofing
  colour — so a mono roof's high side was a roofing-coloured rectangle over
  nothing, and its side view a bare sloped line. Now: the silhouette runs
  to the deck's NEAR underside per bucket; wherever that rides above the
  plate the segment's own wall band is drawn under it (the shed's trapezoid
  from the side, the tall band of its high side, the gable end's triangle)
  clad like the walls — lap courses, brick, stone, and a stucco stipple
  clipped to the polygon (`stippleInPolygon`, which the gable end had been
  leaving blank); the roofing colour paints only a slope that faces the
  viewer (the far side rises above the near edge), a flat roof's edge is
  fascia. Tests: sections +2 (the shed's side and its two long sides) —
  plugin-sections 28, editor typecheck clean. Seen on the modern-mono
  farmhouse lot run: the north (high) side a 15 × 2.6 m stucco band under
  the roof edge, the east side the trapezoid up to the 17'-6" ridge.

- 2026-09-07: **Batch Q — the printed set: square plans, whole elevations,
  sections with their framing (G38–G41).** Investigated with a workflow
  (seven readers, adversarial verifiers; three finished before the credit
  ran out — the rotation and fit root causes came back verified with
  file:line evidence, the rest was read by hand). G38: `sheetPlanRotationDeg`
  (drawings.ts) snaps `resolveSheetRotationDeg` to the nearest 90° — the
  Florida house (yaw −177.8°) now draws at 180° instead of 177.8°, square,
  and `northOnPaperDeg` (whose yaw term had the wrong sign: world north is
  `(sin θ, −cos θ)` in the level frame, θ CLOCKWISE from up) puts the arrow
  at 2.2°; the structural, electrical and plumbing plans, which were drawn
  level-local at 0° while the floor plan turned 177.8°, take the same snapped
  turn; the site plan turns by `sheetSiteRotationDeg` = plan turn + yaw = the
  residual (2.2°), so the building stands square there and the GIS lot ring
  is the thing that tips — its corner-block needle turns with it. G39:
  A4.0–A4.3 carry one elevation each, the whole frame, fitted by
  `buildingEnvelope` (walls, slabs, posts, roof segments with their overhang,
  the ridge from the pitch, 1.5 m under the lowest level) plus the builder's
  label margins — the wall centre-line bbox × 1.1 by a fixed 6 m that sized
  the old 2×2 cells left the porch off the paper; the sections are fitted by
  the same envelope. The Sections model is BUILDING-LOCAL (walls, slabs, roofs
  are level-local; only the terrain sample was carried to the site), so a
  named elevation is now a WORLD direction brought into the model's frame
  (`localViewAngle` = angle + yaw, snapped to a quarter turn): the south
  elevation shows the face that looks south (it showed the rear before — the
  local +z face — and every view was 2.2° oblique), and the grade is sampled
  under the building where it stands, in its frame (`gradeAt` carries the
  point to the site and subtracts the building's stand): the raised floor
  now reads 18 in above the GRADE line, and the ground-hosted porch posts —
  whose base was the WORLD terrain height against level-local elevations,
  0.6 m too high, hence through the roof — end at the beam soffit. The
  elevations fill the frame at the largest scale that fits (3/8" for this
  house; the label says so). G40: `providers/section-framing.ts` reproduces
  the section's own projector from the marker (start/end/lookDirection, the
  right axis `(−f.z, f.x)`), cuts every structural Bones member's box
  (eight corners through the XYZ euler, the twelve edges against the plane,
  the crossings ordered round their centroid) and draws the cross-sections in
  the S5 palette (lumber, PT, engineered, concrete, steel) over the
  architecture; the wall's skin layers and the hardware are left to the
  assembly bands and the details. A leader and a wrapped note per family the
  cut meets — on the farmhouse: 2x4 pre-engineered trusses @ 24" o.c., R-30
  ceiling insulation, double 2x6 top plate, 2x10 floor joists @ 16" o.c.,
  2x6 PT mudsill with 5/8" A.B. @ 6'-0", 8" stemwall, 16" × 8" footing —
  each from the member's size, the spec's spacing or the prescriptive table.
  Section A cuts 276 members (the truss king posts marching, the joists, the
  studs at the walls it crosses, both footings), Section B the gable trusses
  over the porch shed. G41: `WallSlice.exteriorFinish` carries the assembly's
  `exterior.finish` and `layoutWallLayers` maps it to the data's family
  (siding → wood lap, fiber-cement, stucco, brick) ahead of the state
  default — the sided Florida house framed "3-coat cement plaster" before.
  Tests: sections +3 (square to the faces at 3°, the quarter and half
  turns, the grade under a raised building), wall-layers +3, generate (A4.x),
  fire-separation label turn — plugin-sections 25, plugin-sheets 258, Bones
  2,123, generate 95, editor typecheck clean. Honest gaps: the section's
  far gable wall beyond a longitudinal cut is a paper silhouette (no cladding
  in section); members beyond the cut are not drawn; the porch rake fascia
  Steve saw missing on one seed is not reproduced (he found it an edge case);
  elevations still draw guards as generic pickets and stairs as boxes; the
  finish key can overlap the GRADE label at the left; the section notes are
  a right-hand column, not placed leaders. Second pass, same day: the
  elevation draws a GUARD the way its fence node builds it (`GuardStyle` off
  guardInfill / postSpacing / postSize / topRailHeight / groundClearance /
  slatGap / startPost / endPost / color) — posts at even bays under the
  spacing, the cap over the top rail, the bottom rail at its clearance,
  balusters at their gap, cables at 3 in or horizontal boards, all in the
  guard's own colour (the farmhouse's #2d2d2d) — and a FLIGHT seen from the
  side as its riser-and-tread profile with a 2x12 stringer under the
  nosings and a rail over them (end posts, the rail at 36 in, the infill
  the porch guard uses — the stair rail matches the guard it lands on, as
  batch O built it); seen along its run it stays the box with a riser line
  a step. Tests: sections +1 (the flight profile and its cable rail), the
  guard assertions rewritten (four posts, balusters) — plugin-sections 26.


- 2026-09-07 small hours: **Batch P, second pass — the rest of the review
  (G31, G32, G35, G36).** The plan mark on a rated wall now runs along the
  wall (a group turned to the face's angle) and is turned to read
  left-to-right on the paper, or bottom-to-top when the wall stands
  vertical there — the sheet's own plan rotation is passed in, so the
  Florida farmhouse (turned 178° on its lot) reads upright. The energy
  sheet: the wall azimuths now include the building's yaw (EW1 358°, EW3
  178° on the turned farmhouse — they read 0°/180° before, as if the house
  sat square to the site), the "23 walls have no exterior face marked"
  caveat no longer counts partitions (a wall with the generator's partition
  role, or interior on both sides, is inside the envelope by definition),
  "north not set" prints only when the site carries no rotation at all (a
  geocoded site's 0 is a value), and the wind row carries the HVHZ range.
  The prescriptive table now carries the rest of 2021 IECC Table R402.1.2
  from mep-rules.json by zone — floor R, slab edge, fenestration and
  skylight U-factors, SHGC by zone with NR in 5–8 — the 0.30 the data
  called the "zones 1–3 maximum" was the 2009 IECC figure; the table now
  prints 0.25, and the Manual-J-lite load keeps 0.30 as a stated
  conservative assumption (its note says so; the sizing exhibits and the
  master baseline are pinned to it). SN1 gains the wind design data FBC-R
  R301.2.1.1.1 asks for beside Vult: Vasd = Vult × √0.6 (132–139 mph for
  the HVHZ range), the wind-borne debris region, the enclosure
  classification with GCpi ±0.18, and where the components-and-cladding
  pressures come from (ASCE 7 Ch. 30 / NOA in the HVHZ, Tables R301.2(2)
  and (3) elsewhere) — all "verify", none derived from the model. A0.1's
  foundation notes gain the flood determination (FEMA zone and BFE off the
  effective FIRM, R322 where the lot is in a flood hazard area). The
  footing schedule names what a pad carries — PAD FOOTING AT PORCH POST on
  the ranch, not "at girder post" for every pad. A3.0's venting calculation
  no longer counts an open porch or deck cover as attic (the farmhouse's
  three segments were the house plus two porch roofs); the water meter's
  panel-space note carried its own ⚠ inside the label, so it printed
  "⚠ ⚠" — the glyph is the warning band's to add. The ranch (slab) on the
  same lot: S1.0 draws the slab, the stem wall and its 16 × 8 footing 30 in
  below top of foundation (18 in of stem above grade + the 12 in Florida
  embedment), five porch-post pads, no interior thickened footings under
  the trussed roof; S5.0's FOUNDATION @ EXT. WALL is the stem-wall detail
  with the slab on it. Tests: fire-separation (the label's turn at four
  sheet rotations), energy (the R402.1.2 rows for zone 2) — plugin-sheets
  258, Bones full suite, editor typecheck clean. Gap: the structural
  plate's stacked schedules size themselves before they know their column
  width, so they cannot wrap — the new SN1 values are written short
  instead; wrapping them wants `scheduleBlock` handed its width.

- 2026-09-06 late night: **Batch P — the submittal review: code identifiers,
  Florida, structure, the assembly schedule, five details, fire separation
  (G30–G37).** The pipeline first: `scripts/demo/generate-and-print.ts`
  drops a preset lot in through the running dev server's parcel API (the
  Miami Shores preset — 1247 NE 104th St, a GIS parcel with no county on
  it), generates the farmhouse (seed 777, no garage) in process, lays the
  default set out, prints the PDF and keeps the scene graph;
  `scripts/demo/sheets-to-svg.tsx` renders any scene's sheets to SVG
  through the workspace's own React renderer, served from
  `apps/editor/public/tmp-sheets` for the Browser pane. G30: providers
  write "IRC R403.1.6"; `retagCode` (notes/jurisdiction.ts) renames every
  citation per sheet — FBC-R, CRC, NCRC, RCNYS — at the text-primitive
  level in drawings.ts, leaving "2021 IRC base" alone; `citation()` in
  general.ts prints the code name so the retag has something to find. G31:
  `resolveJurisdiction` infers the Florida county from `parcel.originLngLat`
  when the record has none (Miami-Dade / Broward → HVHZ, those and Monroe
  → zone 1A), prints the inference as a caveat, parses the HVHZ 170–180 mph
  range onto SN1 with exposure C on the coast, and the prescriptive rows
  follow the resolved zone (Miami: ceiling R-30, wall R-13 — the S5 wall
  section's batt and the eave's ceiling note read them); past 140 mph the
  model warns that R602.10 bracing does not apply (R301.2.1.1). G32: the
  generator writes `building.metadata.structure` — trusses past a 24 ft
  span (R802.10.1 deferred submittal), stick below — and both the sheets'
  framing model and the Bones X-ray node start from it; a trussed single
  storey's partitions are non-bearing (no thickened footings, the S2.0
  legend says so), a stick house's ceiling-joist lap partitions bear; S1.0
  says CRAWL SPACE — NO SLAB on a raised floor; a deck under a porch cover
  bears its beam on the 6x6 porch posts (no 4x4s beside them, no colliding
  pads); girder posts stand at even interior stations. G33: S5.x gains
  DECK / PORCH GUARD @ POST (DCA 6: through-bolts, DTT2Z, cap, rails,
  balusters, the 4 in sphere), STAIR GUARD & HANDRAIL, GABLE END — SHEAR
  TRANSFER & BRACING (blocking, straps, horizontal and diagonal braces),
  FIREBLOCKING @ SOFFIT & PENETRATIONS (R302.11), WINDOW JAMB & FLASHING
  SEQUENCE — eleven details over S5.0 and S5.1. G34: A2.x keeps the plan
  and the room schedule; A5.0 carries a WALL, ROOF & FLOOR ASSEMBLIES
  schedule (layers from each wall's assembly, framing from the Bones spec,
  insulation from the prescriptive data, a FIRE column); sections draw
  furniture without names. G35: `notes/fire-separation.ts` measures every
  exterior wall of the lowest level at a right angle from its outer face to
  the lot ring (R202 — the least along the face, rounded DOWN to the inch;
  a street face measured to the centreline is called a lower bound), the
  roof's projection toward it (the eave, or a porch roof hung off the
  wall), the openings in it, and applies Table R302.1(1): wall < 5 ft
  1-hr both sides; projection < 2 ft not permitted, 2–5 ft 1-hr underside;
  openings < 3 ft none, 3–5 ft 25% max. A1.0 now splits 60/40 with the
  FIRE SEPARATION DISTANCE table (walls, distance and lot edge, rating,
  projection, openings, the caveats — GIS parcel not a survey); the floor
  plan marks a rated wall with a heavy dashed line and "1-HR RATED WALL
  (R302.1) — 3'-8" TO LOT LINE"; the assembly schedule splits the rated
  wall into its own row (5/8" Type X each face, e.g. UL U305 — verify).
  `drawTable` gained wrapped cells (`wrap: true`, rows grow by LINE_H per
  line, `measureTable` for what sits under) — the assembly and fire tables
  are sentences, and an ellipsis in a schedule is a lie; a wrapped cell is
  retagged whole (a split "IRC / N1102.1.3" escaped the sheet-level pass).
  G36: the check — the generated Florida scene, then the same scene with
  the building slid west until its west face stands 3 ft off the lot line
  (`scratchpad/move-scene.py`), both rendered: the site plan's yard reads
  3'-9", the fire table rates the W wall at 3'-8" (right edge) with 2
  openings at 15% → 25% MAX and the rear deck roof (13'-0" past the face)
  OVER THE LINE by 9'-3" → NOT PERMITTED, printed as a warning; A2.0
  carries the mark; A5.0 gains the W2 EXTERIOR WALL — RATED row; the
  unmoved scene rates nothing. G37: the Florida farmhouse end to end —
  FBC-R citations, "County inferred from the site coordinates", HVHZ on
  SN1 (170–180 mph), trusses on S3.0 (12.5 m span flagged for the truss
  package), CRAWL SPACE on S1.0, the assembly table, S5.0 + S5.1. Tests:
  jurisdiction +4, fire-separation +12, draw-table +3, general-notes +1,
  generate (A1.0 / A5.0 viewports), deck-framing +1, details (11
  registered) — plugin-sheets 258, Bones 153/69/144 on the touched suites,
  generate 95, sections 23, editor typecheck clean. Honest gaps: the plan
  mark's text is horizontal (the text primitive rotates with the plan, not
  the wall); an uncovered deck is not treated as a projection (the caveat
  says so); R302.1's exceptions 2–5 (accessory structures, foundation
  vents) are not modelled; braced-wall panel lengths are still not verified
  by the engine; the cover reads "Untitled project" until the project
  record is filled in.


- 2026-09-06 night: **Batch M — the posts are the framing's posts, the deck
  posts on the ground, ceilings and paint inside (G23, G25, G26; G24 open).**
  G23: `shell-sync.ts` now also carries the porch sizes (`PORCH_BEAM_SIZE`
  6x8, `PORCH_PLATE_SIZE` 2x6, `PORCH_POST_SIZE` 6x6, `porchBeam()`,
  `porchPostSize()`); the porch engine frames from those names and the
  generator's `PORCH_BEAM_D/W`, `PORCH_BAND` and `ENTRANCE_POST` are read
  from them — one table. The cover's box now runs out to the front posts'
  OUTER face and across to the corner posts' outer faces (`beamOut`,
  `across` in porch.ts), so the beam band is centred on the post lines the
  way Bones' girder is and a post is flush with the beam's end, never proud
  of it; the eave overhangs from there (the 6 in inset less half a post is
  well inside every style's overhang). The posts: `shaftCornerRadius` 0,
  `edgeSoftness` 0, `shaftSegmentCount` 1, straight — the column renderer's
  rounded corners (default 1.4 in radius on a 5½ in post) and 24 overlapping
  taper segments were the "tube with notches"; the craftsman's taper is
  dropped (a tapered box column is a wrap around the same 6x6 — presentation
  gingerbread for later, not the post). G26: a deck's post had no
  `supportSlabId`, and the viewer's floor stacking ELECTED the deck it
  passes through as its host (the footprint overlaps the decking), lifting
  the whole post by the deck's height above grade — hence through the roof.
  Every deck post and the flight are now hosted on the ground
  (`supportSlabId: 'ground'`, core's GROUND_SUPPORT_ID); on a terrain site
  the viewer's ground lift IS the grade, so the node is authored at y = 0
  (`PorchInput.terrain`, set by build.ts when the site carries a
  heightfield), on a flat site it carries its grade itself. Bones'
  `extractPorchPosts` and the Sections plugin's column features resolve a
  ground-hosted post the same way (Bones through its `ground` function,
  Sections through the terrain sampler at the column's world point). G25:
  build.ts writes one `ceiling` node per zone (the zone's polygon, following
  the level top; a room pinned lower keeps its own height) — `stats.ceilings`;
  finishes.ts gains `interior` (the catalog's `preset-lightgrey`, read from
  the catalog so a rename fails loudly) and `applyFinishes` paints every wall
  not bounding only the garage: an exterior wall's `slots.interior`, both
  faces of a partition; the garage's own walls keep bare GWB as the zone
  schedule says. G24: NOT reproduced — the same seed (1034238772, craftsman)
  regenerated in the editor shows no blocks on the wall tops inside or on
  the gable wall outside, and a headless probe of Bones' output for that
  house finds only ceiling devices (lights, alarms, registers at the
  ceiling plane) and the electrical runs along the plates, none at wall
  junctions. Candidates ruled in for Steve to check by clicking one: the
  Bones fixtures a finished house shows (`SURFACE_FIXTURE_KINDS` in the
  framing renderer draws them as plain coloured boxes even with the X-ray
  off), which float at the ceiling plane when no ceiling exists — the
  ceilings now generated may simply hide them. Tests: porch (sharp posts,
  the box to the posts' faces on gable / hip / shed / canopy, ground-hosted
  deck posts and flight, the terrain case), finishes (the interior paint,
  garage walls bare), build (a ceiling per zone), Bones `extractPorchPosts`
  (slab / ground / terrain) — generate 95, Bones 2,119, sections 23, roof
  20, editor typecheck clean.

- 2026-09-06 night: **Batch N — the white blocks named, the rails by style
  (G24, G28).** G24 (Steve: "if I hover over it it shows the room area —
  solved it, not sure where that is"): clicking one selected "WIC ceiling"
  — they are the editor's `CeilingSelectionAffordanceSystem`, light-grey
  corner brackets plus a hit cube at every corner of every ceiling on the
  selected level (gated on a level being selected, which clicking a wall
  or visiting the 2D plan does — hence "not at first generation"). A
  generated house now has a ceiling in every room, so every wall junction
  grew one. The brackets now show only for the ceiling under the pointer
  or the selected one — the affordance is for the ceiling you are about
  to grab. G28: the fence gains a `baseStyle: 'raised'` (core schema,
  viewer fence-system, the fence panel): the base is a bottom rail held
  `groundClearance` above the ground with the infill ending on it and the
  end posts to the ground — the generator's baluster guards use it (2x4
  bottom rail 3½ in over the decking, 2x4 top rail), so the craftsman's
  balusters no longer run to the decking. The stair gains
  `railingStyle: 'cable'` (2 in posts on the post-and-rail stations, a
  flat cap rail, ½ in cables 3 in apart running with the flight; the
  stair panel offers it); the generator's flights take cable on the
  moderns and post-and-rail elsewhere, and `applyFinishes` paints the
  flight's guard (`railingMaterial`) with the same rule as the fences —
  the deck's stain, else the trim colour — so a flight and the guard it
  meets are one rail. Tests: viewer fence-system (raised base: bottom
  rail at the clearance, pickets on it, posts to the ground; grounded
  kickboard unchanged) +2, porch (raised guards, the flight's style per
  style), finishes (the flight's guard colour). generate 95, viewer
  fence 2, editor typecheck clean; core, viewer and nodes dist rebuilt.

- 2026-09-06 night: **Batch O — the railing system (G29).** Built to the
  AWC Deck Construction Guide (DCA 6) guard: 4x4 posts, a 2x6 cap rail
  flat on top, a 2x4 top rail on edge under it, and the infill — 2x2
  balusters on a 2x4 bottom rail at a 3½ in clear gap, ½ in cables 3 in
  apart, or 1x6 boards. The fence gains `style: 'guard'` with
  `guardInfill` (balusters | cable | boards), `startPost` / `endPost`
  (false: that end's post is left out so the rails die into the post
  already standing there) and `postThrough` (posts 3 in past the cap under
  a cap of their own — the fence panel carries all four); the viewer's
  fence-system builds it (`createGuardFenceParts`). The generator's guards
  now run ON THE POST LINE (6 in inside the landing edge, where the 6x6s
  stand): one section per bay between the 6x6s with no posts of its own,
  the sides from a 4x4 at the house wall into the corner 6x6 — the 4x4
  standing beside every 6x6 is gone (it came from the guard running 2¾ in
  inside the edge while the posts stood 6 in inside it, two lines 3¼ in
  apart). An uncovered landing has no 6x6s and keeps its own 4x4s at the
  deck edge. Cable rails get 4x4 posts too (DCA 6), not the 2 in pins.
  The stair guard is rewritten (`StairGuard`): the flight's rail path
  starts and ends half a tread past the nosings at the same height — the
  bend the cables made mid-air — so the guard now runs on the straight
  slope through the nosings, from the bottom station to the top and
  `railingTopReach` further along the slope into the post it dies into
  (the generator sets it to the 6 in between the landing edge and the post
  line, `railingTopPost` off whenever the landing has a guard); a 2x6 cap,
  2x4 top rail, and the infill straight with the flight — 'post-and-rail'
  (balusters on a 2x4 bottom rail), 'cable', or the new 'boards';
  `railingPostThrough` runs the posts past the cap with a cap. The sloped
  bars' orientation is built from a basis (x along the run, y plumb in the
  vertical plane) — `setFromUnitVectors` rolled them about their axis,
  the "rotated top rail" on the rear deck. Not done: DCA 6's graspable
  handrail on flights of four or more risers (the generator's flights are
  two or three) — noted for a taller entrance. Tests: viewer fence-system
  +3 (the guard's members, ends without posts, post-through, cable), porch
  (the guard on the post line dying into the 6x6s, the flight's reach and
  top post, the modern's cable guard on 4x4s). generate 95, viewer fence
  5, editor typecheck clean; core, viewer and nodes dist rebuilt.

- 2026-09-06 late: **Batch I — stair guards, the elevations, the WebGPU error
  (G19, G21, G22; G17 checked).** Stair node: `railingStyle` ('balusters' |
  'post-and-rail') and `railingTopPost`; the stair renderer's post-and-rail
  guard puts 4x4 posts on the nosing line no more than 4 ft apart (bottom
  always, top unless `railingTopPost` is off — the generator turns it off
  when the porch's flanking 6x6 stands there, so the rail dies into it),
  a 2x4 top rail at the guard height and a bottom rail 4 in over the
  nosings following the flight, 1½ in pickets at a 4 in gap between them,
  skipped at the posts; the stair panel gets a Balusters / Post & rail
  control; the generator's flights use post-and-rail. G22: the stair
  renderer's shared baluster, rail and box geometries are module constants
  and every mesh using one now carries `dispose={null}` — React disposed
  them when a regenerated house unmounted its stairs, and the next stair
  drew a disposed buffer (a cylinder of 8 segments is 96 indices — the
  DrawIndexed(96) in the error). Elevations (plugin-sections): new
  `FeatureSolid`s — porch posts (columns, on their slab), guards (fences,
  outline with a top rail band and pickets), flights (their box with a
  tread line per riser, from the stair's own position, rotation and
  segment length) and the trees plugin's trees (trunk and canopy at their
  height with a stand-in spread of 60 % of height, 40 % for evergreens,
  said in a warning — the plugin records no width) — painted in depth
  order with the walls; the roof prints in the roofing the building records
  (`metadata.finishes.roof.hex`; a textured shingle preset's catalog colour
  is its base tint, which drew the roof white); the eave LINE is now a
  1x8 fascia board hanging from the eave in the trim colour
  (`metadata.finishes.trim.hex`, else paper), and a gable end gets its
  rake boards under both slopes. Generated items write `scale` out
  explicitly so a headless reader sees the store's node. Seen as SVG in the
  browser pane on the ranch (seed 1308856731, garage): forest-green roof
  with courses, white fascia along the eaves, the porch's posts and gable
  on the east elevation, the tree. Tests: sections +1 (post, guard, flight,
  tree, roof colour, fascia colour) — sections 23, nodes stair 17, generate
  94, editor typecheck clean. Next: G18 / G20 — Bones frames the porch
  cover on its posts with pad footings.

- 2026-09-06 late: **Batch J — Bones frames the porch bearing (G18, G20).**
  New `engines/porch-framing.ts` (`framePorches`), PlanCrafters'
  `F.porchWall` in Bones: the generator's porch posts (`column` nodes with
  `metadata.porch`, read by `extractPorchPosts` — base at the slab or the
  grade under a deck, the column's own height as the cover's bearing line)
  define the beam line; a 6x8 girder (new lumber size, 5½ × 7¼) spans post
  face to post face under a single 2x6 top plate whose top is the bearing
  line; each post is a 6x6 from its base to the girder's underside; a gable
  or hip cover that dies into the house roof gets the two side girders
  (6x8 + plate) from the corner posts to the house wall face — the nearest
  exterior wall running with the beam line — while a shed on a ledger
  takes none (its rafters bear at the wall). Posts off a straight line, a
  single post, no cover over the line: nothing framed, said in a warning.
  The pediment studs the roof engine already stands on the plate line are
  the gable wall on that beam. G20: compute passes the porch posts to the
  foundation engine with the girder posts, so every one gets an R403.1 /
  R407.3 pad footing ("Pad footing 24×24×12 — porch post"), on the
  foundation plan and its schedule; the pad size is now the spec's
  `postPadIn` (absent = the engine's 24 in), set from the Bones panel's
  "Post pads (in)" control (16 / 18 / 20 / 24, 24 removes the key — the
  byte-parity rule), for every porch, deck and girder post at once. Probed
  headlessly on the farmhouse (seed 1308856731): front porch 6x8 girder
  4.10 m on four 6x6 posts (3 bays, widest 67½ in), two side girders 75¼ in
  to the wall face, the rear deck's beam on its four posts, seven pads (one
  post bears on a poured run). Tests: porch-framing +6 (girder and plate
  under the bearing line, posts base to girder underside, side girders,
  none on a ledger shed, off-line / single post refusals, two entrances
  apart), panel-framing +1 — Bones 2,119, editor typecheck clean. Seen in
  the editor's Framing view on the farmhouse (seed 777): the 6x6 posts on
  their pads, the 6x8 girder and plate under the pediment studs, the side
  girders back to the wall, the deck's joists and the flight's stringers.

- 2026-09-06 late: **Batch K — the entrance the shell shows (Steve: "none of
  the generated porches show the beam, the post should go to the below of
  the beam, and they don't have ceilings, not really a true front entrance"
  / "I can see them on the bones framing layer though, so it's the
  presentation side").** The cover's beam is now in the model, not only in
  Bones: a gable / hip / flat cover's roof segment carries a wall band
  `PORCH_BAND` tall (the 6x8 beam plus its 2x plate, 8¾ in) and 5½ in
  thick, seated `PORCH_BAND` under the bearing line — the band IS the beam
  under the eaves and the pediment stands on it; a shed cover on a ledger
  keeps no band (its raked sides would close the porch) and gets a beam
  SLAB along the low eave post to post (`metadata.floor: 'porch-beam'`, a
  new Bones slab kind 'trim' that no engine frames or pours). Every post
  stops under the beam. A `ceiling` node closes the porch at the beam's
  underside, painted with the trim. Bones' porch engine takes the posts'
  top as the beam's underside now (girder on the posts, plate on the
  girder, cover on the plate — the same lines). Checked on the reproduced
  auto-roof flow (Generate, then the Auto roof panel's "Rebuild roof from
  walls"): the porch pediment renders after the rebuild too. Seen in the
  editor on the farmhouse (seed 777): the beam across under the pediment,
  posts ending under it. Tests: porch expectations (band height and seat,
  posts under the band, the ceiling), Bones porch fixture — generate 94,
  Bones 2,118, editor typecheck clean. Not yet looked at: the rear shed
  cover's beam slab and the ceilings from below.

- 2026-09-06 late: **Batch L — the shell reads Bones' numbers (Steve: "the
  posts look dainty … should be 6x6 and match the framing view … the roof
  framing and thickness on this and the main roof syncs with bones, and
  posts sync with bones, only way to pull this off correctly").** Two
  causes. The posts: the column renderer draws its shaft at 72 % of the
  node's width by default, so a 5½ in column read as a 4x4 beside Bones'
  6x6 — the generator's posts now set the shaft to the full section. The
  roofs: every generated segment used the schema's placeholder
  `deckThickness` (0.1 m) while Bones framed a 2x6 rafter under 7/16 in
  sheathing — new `plugin-bones/src/core/shell-sync.ts`
  (`roofShellThickness(spec)` = rafter depth + sheathing, `ROOF_SHEATHING`
  shared with the roof engine) is read by the auto-roof plugin (every main
  roof and wing, the panel's rebuild too) and by the porch cover, both by
  relative path the way plugin-sheets reads Bones, so the slab the viewer
  draws is the rafter and its sheet. Seen in the editor on the farmhouse
  (seed 777): full 6x6 posts under the beam band, the thicker roof slab.
  Tests: porch (shaft scales, the cover's deck) — generate 94, roof 20,
  Bones 2,118, editor typecheck clean. The WebGPU "Vertex buffer slot 0"
  fix (Batch I) had not reached the editor: the nodes package is consumed
  from `dist`, which was rebuilt only now — reload the editor page.

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

- 2026-09-06 early morning: **W13b — the finish schedule sheet.** The plan
  set prints the exterior finish schedule when the level's building
  carries the generator's palette record (`metadata.finishes`):
  `finishScheduleFrom` reads it duck-typed into plain rows (Bones never
  imports the generator) — siding, roofing, trim + fascia, entry door,
  shutters, windows (the grid noted as recorded, not drawn), deck + rails
  — each with its finish, a colour swatch with the hex, the product line
  and a note; the sheet heads with the style and palette name, says the
  colours print approximate, and carries a one-line interior finish note.
  It sits after the door + window schedule, before the takeoff; the cover
  index lists it; no record → no sheet. The Bones panel wires it from the
  active level's building. Verified on the rendered farmhouse (navy /
  white / barn-red door). Tests: plan-set +2 (the record → rows, partial
  and empty records; the sheet's rows, swatches, ordering, absence) —
  Bones 2,089, panel typechecks.

- 2026-09-06 early morning: **W16d — the hip end strips get their stub
  joists.** The joist band stops `cjEndClear` short of each hip end wall
  (a few inches at 40°, 0.46–0.74 m on a 4:12 roof) and every hip joist
  wore the "end-triangle stub joists not modeled" statement. Where the
  strip is wide enough, `frameHip` now frames STUB joists perpendicular to
  the main run at the o.c. stations between the side eaves' clearances —
  sistered beside the end-plane jacks and the king (the mains' beside-
  rafter convention), the eave end clipped to the end plane (the B6
  inscribed box), the inner end butting the last full joist's piece at
  that station (base or lapped, one thickness over) on a Simpson LUS
  hanger, that joist named as the header to double (verify). The 400
  statement now says what was framed: stubs tying the end eaves to the
  last full joist, or — on a steep hip whose joists reach within a few
  inches of the end walls — that there is no strip to frame and the last
  full joist ties the end plane. The volume gate allows the stub hanger
  contact (the W9 hardware convention) and the hip family stays SAT-clean.
  Tests: W16d describe +2 (a 4:12 hip's stubs at both ends, hung, on the
  plate, inside the clearances; the ranch-class hip frames strips, the
  40° hip none, LOD 200 none), the B7 statement expectations reworded,
  two main-joist tests read past the stubs — Bones 2,091, typecheck clean.

- 2026-09-06 morning: monorepo run after the roof round — 6,425 tests: the
  sheets' SN1 "every engine flag reaches the paper" test assumed the
  cottage always carries a STRUCTURAL flag (its one-piece ceiling joists);
  W15 lapped and sized them, so the only flags left were HVAC / plumbing,
  which the S notes rightly leave to the P / M sheets — the test now reads
  `flagsOf` (the structural set) and expects no ENGINE FLAG line when
  there is none. The three `packages/cli` failures (private-storage mode
  bits on a fresh home, the managed-runtime force-stop pair) are Windows
  environment failures untouched by this work. Editor app typecheck clean.

- 2026-09-06 morning: **W17 — the attic separation over the garage.** New
  engine `engines/attic-walls.ts`: for every dwelling–garage separation
  wall (compute's `garageSideOf` pick) under this level's roofs it frames
  the wall ABOVE the ceiling — a flat 2x plate on the tallest ceiling joist
  it crosses, studs at the wall's stud spacing from that plate up to the
  lowest roof underside over the stud's plan rectangle (`roofUndersideAt`
  = the rafters' bottom-face plane, 5 mm clear), a station skipped where
  the roof's own wood sits in its reach (the ridge board and purlins,
  collar ties, purlin struts, hips, valleys, gable studs) or where the
  stud would be shorter than 6 in; a later plate is cut around an earlier
  crossing plate, and earlier attic members are obstacles to later walls.
  Honesty first: a separation that lies on a gable segment's end line IS
  the gable-end infill the roof engine already frames (the generator's
  garage hangs off the main's gable end — every farmhouse and craftsman),
  so nothing is added and the warning says to gypsum that infill to the
  deck; under a hip end the roof meets the plate and there is no attic to
  separate — said too. The volume gate composes the attic walls SAT-clean
  under the gable, the big gable with purlins and the 4:12 hip. Tests:
  attic-walls.test +6 (the plane read, a wall across the ridge — plate on
  the joists, studs at 16" to the underside, the ridge-board station,
  eave stations; the ridge-line wall's tops under the board and clear of
  the gable studs; the gable-end and hip-end cases; outside / curved / no
  roof; a purlin-line wall blocked, a clear one level), interpenetration
  +1 — Bones 2,098, plugin-sheets 235, typecheck clean. Honest gaps: no
  gypsum members on the attic wall (the note carries it); the attic wall's
  top plate along the slope is not modelled (studs cut to the slope).

- 2026-09-06 morning: **W18 — shed rafters bear on the interior partitions
  under them.** The mono-pitch modern house flagged every rafter (a 13 m
  projection against a 3.57 m row) because the shed framer knew no
  bearing but the eaves. `frameShed` now plans against the level's walls
  the way the joists do (`ceilingJoistBearingsFor`: partitions running
  with the eaves, ≥ 1.5 m, full height, 0.65 m clear of the eave lines):
  each rafter stays one stick, continuous over the partitions covering
  its station, and its span check is the longest projection BETWEEN
  supports (R802.4.1); the label names the walls it bears on, and the
  honest flag stays where no partition runs under a station (the garage
  wing, the great room). `compute` reads those wall ids off the labels
  (`shedBearingWallIds`) and frames them up to the rafters' underside
  with the W17 machinery generalised (`frameWallsToRoof`, kind 'bearing'
  — no flat plate where no joists carry the wall: the studs stand on the
  wall's own top plate; labels and the level warning say "frame as
  BEARING, sloped top plate not modelled, load path to verify").
  `roofPlaneAt` learned the shed's plane (it rises from the low eave at
  +Z), which also lets the W16c burial test see shed pairs — the mono
  house's shed wing now buries under its main. The volume gate exposed a
  pre-existing shed defect: the pediment studs' flat tops poked into the
  rafters (the plane slopes ACROSS the high wall) — inscribed now at the
  stud's inner face; the four shed hash pins recaptured with the note.
  Headless mono house: 11 partitions carry the rafters (91 studs), rafter
  over-span flags 42 → 35 with the garage wing (its own 6.71 m rafters
  and the great-room pieces remain honest). QA loop over 6 styles × 3
  seeds × garage × terrain: 72 sets, no crashes. Tests: roof-framing
  +2 (no partition / two partitions / one / half cover), attic-walls +1
  (bearing kind, no plate, taller studs upslope), interpenetration +1,
  the seat test's pediment expectation — Bones 2,102, plugin-sheets 235,
  typecheck clean.

- 2026-09-06 morning: **W16e — the valley join trimmed with the knife.** The
  valley model kept the wing's full rafters running through the main roof
  ("overlay framing") beside the valley jacks it also emitted, and hung an
  "overlay — trim on site" flag on the wing's deck. Now `trimValleyJoins`
  runs after the valleys: the wing's rafters inside the main's footprint go
  (the valley jacks ARE those rafters, ridge to valley); every other wing
  member is cut wherever it sits inside the main under the main's plane —
  beyond the valley, or at plate height inside the house (its ceiling
  joists, a purlin; a collar tie up in the exposed wing attic stays); the
  main's fascia and drip edge are cut wherever the wing's planes pass over
  them (the wing's roof covers that eave). The main's rafters and deck run
  through underneath (California valley). The overlay flag is retired —
  its three tests now assert the cut deck / membrane / rafters and the cut
  main fascia at 400; the valley pair pin recaptured (twice: the first
  cut missed the wing's joists at plate height). Headless farmhouse porch:
  zero porch rafters inside the main (6 jacks), porch ridge / deck / wrb /
  eave trim and the main's eave trim cut, one collar tie left in the
  porch's exposed attic; QA loop 72 sets, no crashes. Bones 2,102,
  plugin-sheets 235, typecheck clean. Honest gaps: the valley pair still
  fails the volume gate (the jacks' boxes overlap the main's deck in the
  wedge at the line — LOD 350 geometry, the gate case stays disabled);
  the wing's rafter stations and the jack stations differ by up to a bay.

- 2026-09-06 morning: **W16f — every other overlapping pair trimmed.** The
  ranch's hip wing set beside its near-square hip main rises through the
  main's east hip plane (a real intersection the model does not frame) —
  and until now the rest of the wing's west end, its rafters, joists and
  studs inside the main's attic, framed on regardless; the porch hips at
  the eave and the porch grazing the garage wing did the same. `trimOverlaps`
  runs after the valleys and the full burials: for every remaining pair
  whose footprints overlap and envelopes interleave, the SMALLER roof is
  cut wherever it sits inside the larger one's footprint under the larger
  roof's plane (by the plane there, or by the member's own top for wood at
  plate height), the larger roof keeps its structure (the lower roof runs
  through, California practice) and loses only its fascia and drip edge
  where the smaller roof passes over them. What rises above the larger
  roof stays — the intersection LINE itself is still not framed, and the
  B8c warning says both things now. Pairs with a plane the model cannot
  read (flat, gambrel, mansard, dutch) are left alone. Headless: ranch,
  modern and farmhouse — zero members of any other roof centred inside
  the main under its plane (98 / 47 / 17 cut pieces); QA loop 72 sets, no
  crashes. Tests: W16f describe +3 (the ranch pair: nothing buried, the
  risen hip end kept, the main's structure count unchanged, its east eave
  trim cut, the warning kept; the porch hip at the eave; a flat beside a
  gable untouched) — Bones 2,105, plugin-sheets 235, typecheck clean.
  Honest gap: the wing's rafters that cross the main's plane end at the
  cut with no valley board or sleeper — the line needs its detail.

- 2026-09-06 midday: **W19a — the line has its detail: every crossing pair
  framed as an overframe (California) valley.** The W16 family cut the fake
  wood but left the intersection line unframed, and the valley member sat
  inside the main's deck. The join is now read off the roofs' FACETS
  (`roofFacets`: the planes and plan polygons of a gable, hip or shed,
  overhangs included) as level sets of the height difference
  (`levelSets`): the crease at zero, the sleeper line where the smaller
  roof's plane clears the larger roof's deck-and-sleeper stack
  (`overframeStack`). One knife (`trimPairs`) replaces trimValleyJoins
  and trimOverlaps. Inside the larger roof's plate its structure runs
  through; the smaller roof's plane-riding members are cut by their OWN
  bottom against the stack — a dropped end rafter, a hip board, the deck
  and the rake outlookers each by what they are (`memberFrame`) — and its
  plate wood by its bottom against the attic. In the larger roof's eave
  zone the same band holds: the eave keeps its tails and deck under the
  band and loses them where the smaller roof rides clear over (panels cut
  in strips, `clipPanelBy` — breaking at the plate line, a strip covered
  where ANY point across it is, so two decks cut against each other never
  share a plan point), its fascia and drip edge wherever the smaller roof's
  deck rises into them, the smaller roof's fascia stopping past the larger
  roof's at the inside corner; a smaller roof tucked clear under the tails
  is left alone. A rafter cut at the band is a VALLEY JACK and says so.
  `emitSleepers` lays a 2x8 flat on the larger roof's underlayment along
  the sleeper line over the plates — the box up the facet normal
  (`eulerFromBasis`), boards meeting at a corner mitred — never in the
  eave corner. A roof's plane counts only where it is LIVE (`roofLiveAt`:
  no larger roof riding above it there): the ranch's wing carried under the
  main no longer cuts the porch that meets the main above it.
  `detectValleys` now asks a gable wing to reach the pierce point too, and
  a hip main serves any wing whose apex stays on the long plane. The
  reporter says how every pair was framed (the overframe with its creases
  and plan length; a smaller roof wholly under, or riding over; an edge
  graze), names a gable whose ridge stops short (its rake end a wall
  standing on the roof), and names every crease falling under ¼ in 12 a
  DEAD VALLEY. The valley-pair volume-gate case that "stayed disabled"
  since round 2 passes, and twelve more crossing pairs with it (a wing
  reaching, on a lower plate, above the eave; hip wings reaching and
  short; the pyramid exhibit; a wing on a hip main's long plane and past
  it; parallel gables; the ranch's wing and porch, before and after W19b).
  Tests: roof-framing (the valley describe, the jacks, the labels, B6a /
  B6b, B8c, W16c / W16f rewritten for the sleepers; the valley pair pin
  recaptured with its note, the eleven single-roof pins hold),
  interpenetration +2, compute.multistorey B8c reworded — Bones 2,106,
  plugin-sheets 235, typecheck clean. Honest gaps: a hip porch too low to
  pierce (its ridge within the sleeper band of the eave) ends its jacks
  over the larger roof's eave with no sleeper on the plate (W19b keeps the
  generator clear of it); the sleeper is one flat board — no valley
  flashing member; the box model cannot bevel the jacks (the label says
  cut on site).

- 2026-09-06 midday: **W19b — the generator makes joins Bones can frame.**
  The auto roof carries a HIP wing two runs into its neighbour: its ridge
  reaches the pierce point and its near hip end buries itself under the
  neighbour's roof (one run left that hip end facing the main's end plane
  in the 3.35 m dead valley the ranch used to have; a gable still reaches
  one run; a shallow neighbour caps the reach). The porch cover is sized
  against the house roof it dies into (`coverGeometry`, handed the plate
  and pitch by build.ts): a gable / hip cover keeps the style pitch under
  the 6:12 cap, steepens until its ridge pierces the house slope 0.9 m
  inside the wall (the ranch's 4:12 hip porch goes to 5.4:12), then lifts
  its beam toward the plate, and runs in to the pierce point measured from
  the wall CENTRELINE (the box starts at the face — half a wall short and
  detectValleys refused it), a hip one run further; a shed cover keeps its
  ledger 2 in under the plate — the pitch flattened toward 1:12, then the
  beam lowered to 7 ft, then a flat canopy (the farmhouse and craftsman
  rear patio sheds, whose ledgers stood 0.9 m ABOVE the wing's plate, now
  sit at 1:12 on a 7.7 ft beam); the summary carries the pitch, beam
  height and pierce, and a cover that still cannot reach says so.
  Headless: the farmhouse, ranch and craftsman porches are classic valley
  joins again (quiet), the ranch wing one falling 5.32 m valley with no
  dead crease; the ranch roof framing sheet shows the wing's jacks ending
  on the two sleepers meeting at its ridge end. QA loop 72 sets, no
  crashes; monorepo 6,441 with the three Windows-environmental cli
  failures. Tests: derive +1, porch +4 (and the hip test's reach) —
  plugin-roof 20, plugin-generate 74, editor typecheck clean. Open: the
  ranch's rear entrance sits on the main's hip END wall beside the wing —
  its cover overframes onto the end plane with two real valleys (not the
  classic join) and its eave overhang grazes the wing's; a layout rule
  keeping a rear door clear of an inside corner would make it a classic
  join.

- 2026-09-06 afternoon: **W19a follow-up — a roof level with a larger one is
  that roof's plane.** The ranch's front porch met the main AND the wing
  whose south plane continues the main's along that eave, and got its two
  sleepers twice (once per pair). `roofLiveAt` now treats a larger roof at
  the same height as riding above: a continuation wing is not a second roof
  to frame against, cut against or lay a sleeper on. Seen in the editor:
  the regenerated ranch (seed 777, 4 bd) in the Framing view shows the
  wing's jacks ending on the flat sleeper along the main's end plane, and
  its roof framing sheet the two sleepers meeting at the wing's ridge end.
  Test: W16c +1 (the wing not live on the shared eave, live on its own end;
  the porch's sleepers once, on the main) — Bones 2,107.

- 2026-09-06 afternoon: **the elevation finish key names the roofing.** The
  Sections plugin's elevations printed "ROOF: ASPHALT SHINGLES (assumed —
  roof material not modelled)" under every house while the Bones finish
  schedule listed the palette's roofing. `buildBuildingModel` now reads the
  building's `metadata.finishes.roof` (label + hex, duck-typed like the
  finish schedule) and the key prints it in the finish's own colour; a
  hand-made model without the record keeps the assumed line. Test: sections
  +1 — plugin-sections 21, editor typecheck clean.
