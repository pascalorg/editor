# Procedural house generation for Pascal — how PlanCrafters does it, and how to bring it here

Written 2026-09-04 for the Pascal v1 push. Steve wants a **Generate** button in
Pascal that produces a complete, buildable house the way PlanCrafters' ⚡ Generate
and 🎲 Random buttons do. This is the distilled recipe, with the exact source to
crib from. Verbatim copies of the PlanCrafters sources sit in
`docs/reference/plancrafters/` (read-only reference; PlanCrafters itself is done
integrating and is not touched from here).

| File in `docs/reference/plancrafters/` | What it is |
|---|---|
| `GENERATOR-DESIGN.md` | PlanCrafters' own design doc for the generator |
| `gen.js` | the generator (≈6,100 lines): envelope → footprint → room graph → walls → openings → porch → hillside → style → fixtures |
| `roomcode.js` | "houses as code": the small JSON document that AUTHORS a plan; the engine derives everything else. The contract is in the file header (the separate SCHEMA.md it mentions was not in the repo) |
| `adu-templates.js` | nine hand-authored ADU designs (Poppy, Olive, Sequoia…) built through the same engine — the best worked examples |
| `planset.cjs`, `planset-pdf.cjs`, `dev-planset-test.cjs` | the vector PDF plan-set reader (pure JS, 35 headless checks) — for importing real CAD sets |

## 1. The principle: declare intent, derive engineering

Everything in PlanCrafters rests on one idea (roomcode.js header):

```
L1 rooms & envelope    authored: rooms with real dimensions, adjacency, a front door
L2 systems intent      authored: roof form/pitch, ceilings, style, HVAC
L3 derived engineering NEVER authored: walls, seated doors, egress windows,
                       fixtures, kitchen/bath programs, porch, foundation,
                       roof geometry, MEP
L4 pins                per-room overrides (cathedral ceiling, floor finish…)
```

A "generated" house and a "hand-authored" house are the same thing to the engine:
the generator ROLLS an L1+L2 document from a seed; a template or the chat AUTHORS
one; the engine builds walls/openings/roof/fixtures from it identically. This is
why one code path covers Generate, Random, the ADU templates, `apply_floor_plan`
from the chat, and roomcode files. Do the same in Pascal: one **plan document →
model** builder, fed by a generator, by templates, and by the plan-set reader.

## 2. The pipeline (gen.js header, verbatim order)

```
1 ENVELOPE  -> setback polygon of the lot (fallback: a default lot), oriented
               into a LOCAL frame: u = along the street front, v = depth into lot
2 FOOTPRINT -> a target-square-footage rectangle inside the envelope + a style
               "jog" (L or T massing) chosen by style/seed
3 ROOM GRAPH-> recursive BAND SLICES of the footprint into public / service /
               private zones; documented kitchen and master-suite variants
4 WALLS     -> exterior loop + interior partitions on a 6" grid, collinear
               merge; openings: doors on graph edges, windows per room type
               (bedrooms always get an egress window on an exterior wall)
5 PORCH     -> full / entry / none (style decides)
6 HILLSIDE  -> terrain sampling -> basement / raised / slab foundation
7 STYLE     -> preset roof (gable / hip / shed, pitch, overhang, eave) + finishes
8 FIXTURES  -> kitchen / bath / bed / living / dining / laundry + room labels
```

Rules that make the output look designed rather than random:

- **All geometry is computed axis-aligned in the local frame, then rigidly rotated
  to the lot.** Rooms stay rectangles. The house is square to its street edge,
  not to north.
- **Everything snaps to a 6" grid** (`GRID = 6`). Dimensions read clean on a sheet.
- **Seeded RNG (mulberry32).** The same seed reproduces the design byte-for-byte;
  "reroll" = new seed, same options. Expose the seed in the UI; it is how a user
  says "same again but with a garage".
- **Every omitted option is rolled.** Generate with no arguments still produces a
  complete house (style, beds, baths, garage all rolled). Only pass what the user
  actually asked for.
- **Style is a preset bundle, not a colour.** From `gen.js` `STYLES`:

| style | roof | pitch | overhang | eave | cladding / siding id | roofing | porch | notes |
|---|---|---|---|---|---|---|---|---|
| farmhouse | gable | 8 | 14" | closed | lap / lap_white | shingle_charcoal | full | |
| craftsman | gable | 6 | 24" | exposed | lap / lap_sage | shingle_brown | entry | |
| ranch | hip | 4 | 16" | closed | stucco / stucco_sage | shingle_green | entry | long-low massing |
| modern | hip | 3 | 20" | closed | lap / lap_black | metal_black | none | window-wall living room |
| modern-mono | shed (single plane) | 2.5 | 22" | closed | stucco / stucco_gray | metal | none | clerestory on the high wall |
| cottage | (see gen.js) | | | | | | | |

  Palettes (siding + trim + door + shutter) are rolled as a UNIT from curated
  `PALETTES`, never one colour at a time.
- **Room program by mode.** `1story`, `2story` (parked — designs a 1story),
  `adu`. Beds 2–5 (ADU 1–2), baths 1–3. ADUs get a kitchenette, not a full
  kitchen (`model._genOpts.mode` drives the kitchen tier).
- **Garage** is planned against the lot (`planGarage`): attached on the driveway
  side, an overhead door, a person door to the outside; interior doors to living
  space are rejected except laundry/utility.
- **Roof policy is self-healing.** After massing, a gate checks roof coverage and
  invalid gables on concave notches; if the auto roof fails the check, the massing
  is simplified rather than shipping a bad roof (`_roofGate`, `_hipBadGables`).
- **Site features regenerate with the pose.** Driveway, walk and yards are derived
  from the house pose; rotating the house re-derives them (`regenSiteFeatures`).

## 3. The authored document (roomcode v1) — the shape to standardise on

```json
{
  "roomcode": 1,
  "name": "cottage-32",
  "units": "ft",
  "mode": "1story",
  "style": "farmhouse",
  "ceiling": 9,
  "hvac": "minisplit",
  "roof": { "form": "gable", "pitch": 8, "overhang": 14, "gables": ["front"] },
  "rooms": [
    { "name": "LIVING",  "kind": "living",  "x": 0,  "y": 0,  "w": 16, "d": 14 },
    { "name": "KITCHEN", "kind": "kitchen", "x": 16, "y": 0,  "w": 12, "d": 14 },
    { "name": "BED 1",   "kind": "bedroom", "x": 0,  "y": 14, "w": 12, "d": 12, "primary": true },
    { "name": "BATH",    "kind": "bath",    "x": 12, "y": 14, "w": 6,  "d": 8,  "bath": "full" }
  ],
  "attach": [ ["LIVING", "KITCHEN", "open"], ["LIVING", "BED 1", "door"], ["BED 1", "BATH", "door"] ],
  "frontDoor": "LIVING",
  "finishes": { "palette": "farmhouse-white" }
}
```

- `x` from the plan LEFT, `y` from the plan FRONT (street side); room coords in
  feet, everything else in inches once normalised.
- `attach` connectors: `door` (a seated door on the shared wall), `open` (a cased
  opening), `zone` (NO wall — an open-concept boundary).
- The engine validates in room-name language (`validate()` never throws; it
  returns errors a person can act on: "BED 1 has no exterior wall for an egress
  window"). Keep that: a generator that explains its rejections is one you can
  steer from a chat.

## 4. The ADU templates — the best worked examples

`adu-templates.js`: nine designs from 780 to 1,200 sq ft, each a `build()` that
returns a full model through the same engine. Poppy (792 sf, 2bd/1ba, straight
gable) is the standard test scene. Read one `build()` end to end before writing
the Pascal generator: it shows exactly which fields the engine needs and in what
order the derived passes run (rooms → walls → openings → fixtures → roof →
finishes → `_genOpts` stamp).

## 5. Bringing it to Pascal — a concrete plan

Pascal already has the derived layer's building blocks: wall nodes with
assemblies, doors and windows with schedule marks, zones (rooms), roof and
roof-segment nodes with auto-roof, Bones for structure/MEP, the site node with a
parcel and setbacks, and the sheets pipeline. What is missing is L1/L2 authoring
and the roller. Suggested shape, in order:

1. **`packages/plugin-generate`** (new): a `PlanDocument` type mirroring roomcode
   v1 (rooms as feet rectangles in a local frame, attach list, front door, roof
   intent, style key), `validate()` with room-name errors, and `buildScene(doc,
   site)` that emits Pascal nodes: level → walls (exterior loop from the union of
   room rects, interior partitions from shared edges, 6" grid, collinear merge) →
   doors on `door` attachments (seated on the shared wall, 36" default) →
   windows per room kind (bedroom egress ≥ 5.7 sf clear opening on an exterior
   wall) → zones from the rooms → roof intent onto the roof node → finishes onto
   the wall assemblies. Place the local frame on the parcel: front edge = the
   street side of the lot (Pascal's site node already carries setbacks), house
   centred on the frontage at the front setback.
2. **The roller**: `rollDocument(seed, opts)` — band-slice a footprint rectangle
   into public / service / private zones exactly as gen.js step 3 does (read
   `design1story` in gen.js; it is the heart), with the style table above as data.
   Keep it deterministic (mulberry32) and keep the seed on the scene
   (`site.metadata.generated = { seed, opts }`) so "same again" works.
3. **The button**: command palette "Generate house" + a Generate button in the
   editor chrome (the plugin can register commands; see plugin-plans for how a
   plugin adds palette commands and a panel). First press rolls everything;
   a small options form (style, beds, baths, garage, seed) for the second press.
4. **Templates**: port Poppy first as a roomcode document (not code) to prove the
   builder; then the rest of the nine as documents in `templates/*.json`.
5. **Plan-set import**: port `planset.cjs` (pure) as the reader for CAD PDF sets;
   its spec (levels with wall centerlines + openings + labels, storey heights,
   roof pitch, finishes) maps onto the same `buildScene` path. `planset-pdf.cjs`
   needs `pdfjs-dist` on the server side (an API route in `apps/editor`).

Tips that cost days in PlanCrafters and are free here:

- Build the exterior loop from the UNION of room rectangles, then verify it
  closes before doing anything else; a roof needs a closed loop and every later
  pass assumes one.
- Snap every coordinate to the grid at the boundary of each pass, not once at the
  end — accumulated float error is what produces 0.01" gaps that break loops.
- Doors need clearance: never seat a door within 6" of a corner or over another
  opening; PlanCrafters' seating routine slides along the shared wall to the
  first legal spot and reports when there is none.
- Egress first: place bedroom windows before other windows so they get the
  exterior wall; then fill living/kitchen/dining windows by room kind.
- Garage overhead doors and slider doors have their own types; do not model them
  as wide hinged doors (the sections and elevations draw them differently).
- Keep the generator pure (no DOM, no scene store): a function from
  `(seed, opts, lot)` to a document, and a function from a document to nodes.
  Both are then unit-testable headlessly, which is how PlanCrafters keeps 290+
  suites green.

## 6. What "generate like PlanCrafters" does NOT mean

PlanCrafters does not use an LLM to place walls — ever. The chat produces an L1/L2
document (`apply_floor_plan`) and the engine solves the geometry deterministically,
reconciling room bands so their sum equals the stated footprint exactly. Keep that
split in Pascal: models may author documents; only code places walls.
