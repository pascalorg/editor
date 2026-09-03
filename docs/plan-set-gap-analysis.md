# Getting Pascal's sheets to permit-set grade

Written 2026-09-03 against the reference set **2489 Garden Hwy, Sacramento —
PC#3 submission** (AE Drafting, 34 sheets: A1 cover/site, Z1 flood elevation,
A1.1 arborist, A2 general notes, A3–A5 floor plans with schedules, A6–A7
elevations, A8 building sections, A9 roof plan, A10 electrical, A11 plumbing,
G/C/D septic, T24 energy, SN1 + S1.0–S6.0 + SD1–4 structural, FP-1/2 fire
sprinklers) and the Florida demo scene `plancrafters-cottage` (3612 W Palmira
Ave, Tampa; Hillsborough APN 1829333TP000012000010A; 10,487 sf lot).

Everything below is drawn by Pascal's own React renderer from Pascal's own
nodes (`docs/construction-documents.md` is the architecture; this document is
the gap list, the approach, and the status).

## 1. What the reference set has that we did not

| # | Reference | Pascal before this pass | Fix |
|---|-----------|-------------------------|-----|
| 1 | Site plan: one property line, setback envelope aligned with it, pole in the right-of-way, service drop that lands on the meter, north arrow + azimuth legend, grade contours, driveway | Two dashed boxes (the 2D panel's building-frame property line painted on top of the site-plan's site-frame lot); the drop ended on a stored vertex in the yard; pole placed against the wrong box | Panel hides its building-frame lot/handles/labels in site-plan mode (`floorplan-panel.tsx`); "attach end → meter/pole" repair (`plugin-utilities/utility-line/attach.ts` + panel button); demo pole moved to the ROW and the drop bound to the meter. Grade contours: see §3 |
| 2 | Floor plan at 1/4" = 1'-0" with room labels (NAME / F.F. / C.H.), fixtures, door/window tags, dimension strings, wall legend, north arrow | Plan filled the sheet at whatever scale fit (3/8"); no rooms in the scene → no labels; no furniture/fixtures in the scene; no north arrow | `generate.ts` prefers 1/4" whenever it fits, plan takes 62 % of the field with room + fixture schedules beside it, furniture layer on; north arrow beside every plan title (`titleblock.ts northArrowGlyph`); demo scene now has 12 named ROOM zones (auto-detected from the walls, with numbers, finishes, 9'-0" ceiling) and 55 real library items |
| 3 | Real furniture / cabinets / sinks / appliances with plan symbols | Nothing placed | `scripts/demo/furnish-cottage.ts` places catalog items (the same assets the Items panel places — GLB + plan sprite): kitchen L with sink base, range + hood + uppers, fridge, dishwasher; dining; living (sofa, coffee table, TV wall, rug); three bedrooms; two baths (shower, toilet, vanity); laundry (washer/dryer, panel); WIC; condenser outside |
| 4 | Elevations with materials (stucco, stone, shingles), exterior finish key, datums in ft-in (Finish Floor, Ceiling, Ridge, Grade), roof pitch marks, sconces | Blank white walls, metric datums, flat grade with no label | Material rendition from the wall ASSEMBLY (`plugin-sections/geometry/materials.ts`): lap siding courses at 7" exposure, stucco stipple, brick coursing at 2⅔", stone beds; shingle courses on roofs foreshortened by the pitch; openings clipped; EXTERIOR FINISH KEY listing the assemblies actually facing the viewer (a wall with no assembly is called out, never dressed in a default); datums and grade in feet-inches with ground ticks. Pitch marks and sconces: §3 |
| 5 | Dedicated GENERAL NOTES sheet, every note with a code section | Four generic lines on the cover | `general-notes` viewport kind → A0.1 (notes workstream, `providers/general-notes.ts`, `notes/**`), jurisdiction from the site's state through Bones' adoption data (FL → FBC-R 8th ed. 2023, 2021 IRC base) |
| 6 | Energy compliance sheet (T24 CF1R in CA; Form R402/R405 in FL) | Nothing | `energy` viewport kind → EN1.0: envelope summary computed from the model (areas by orientation, glazing %, volume), climate zone from Bones data, prescriptive requirement rows only where citable, compliance-path note. Pascal does not run the FL performance calc (§3) |
| 7 | Structural: foundation & shearwall plan (footing/shearwall/holdown schedules), floor framing, roof framing (beam schedules, legends, notes), SN1 structural notes, SD details | Foundation plan = slab outline + walls | `structural` viewport kind → S1.0 / S2.0 / S3.0 / SN1 from the Bones engines (footings, anchor bolts, hold-downs, joists, rafters/trusses, beams, bracing) with schedules, legends, cited notes (structural workstream, `providers/structural.ts`). Details (SD) remain outside Pascal (§3) |
| 8 | Electrical plan derived from the model, with legend, panel note, GFCI/WP/TR tags, circuits, electrical notes | E1.0 drew only Bones override nodes (none in the scene) | `electrical` viewport kind → E1.0 derived LIVE from Bones' NEC 210.52 engine (`providers/electrical.ts`): receptacles, GFCI zones, switches, lights, smoke/CO, panel and meter — the meter placed at the site-utilities service point so the site plan, 3D and E1.0 agree; panel schedule from `circuitSchedule`; legend of symbols actually used; NEC-cited notes |
| 9 | Plumbing plan with plumbing key (W/H/C/G/T), fixture schedule, CPC-cited notes | Nothing | `plumbing` viewport kind → P1.0: placed fixtures tagged with plumbing keys and schedule marks, Bones plumbing fixtures (stub-outs, vents, water heater, cleanouts), key + notes |
| 10 | Fixture schedule (LABEL / DESCRIPTION / QTY / INFO / STATUS) beside the plans | Door/window/room schedules only | `scheduleOf: 'fixtures'` (`schedule-fixtures.ts`) from the placed items, on A2.x and P1.0 |
| 11 | Roof plan with pitch arrows ("6:12"), overhang, attic ventilation calculation + R806 notes | Ridge/hip lines only | Pitch arrows + overhang on the roof plan (`nodes/roof/floorplan.ts`), attic-ventilation table on A3.0 (`general-notes` notesKey `attic-ventilation`) |
| 12 | Revision table, plot date, scale, design/drawn/checked in every title block | Present (project record `revisions[]`, editable in the rail's Project editor) | Verified; rows print when the record carries revisions |
| 13 | Building sections with an OPAQUE SURFACE CONSTRUCTIONS table and "Per T24" insulation callouts | Vector sections with assembly poché | Assembly table on A5.0 from `resolveWallAssembly` (§3) |
| 14 | Cover: 4 rendered views, scope of work, code data legend, legal description, sq-ft tabulation, vicinity maps | Title block, hero, index, project data, notes | Sq-ft tabulation from the room zones and code legend from Bones adoption data (§3); vicinity map needs a tile fetch (§3) |
| 15 | Fire sprinkler, septic, flood elevation, arborist | Not applicable to every project | Out of scope — consultant sheets are imported as `image` viewports |

## 2. Why the 2D site plan showed two boxes (the bug, precisely)

`FloorplanPanel` draws the property line in BUILDING-LOCAL metres
(`worldToFloorplanLocalPoint(x, z, buildingPosition, buildingRotationY)`) so
that it lines up with the walls, which are level-local. The site-plan drawing
type mounts `FloorplanSitePlanLayer` inside the same scene `<g>` and draws
the lot in SITE metres (origin = the geocoded point) with the footprint
transformed by the building's placement. Both layers were mounted at once,
so the lot appeared twice, offset by exactly `building.position` — and the
building-frame copy moved whenever the house moved, which is what made the
pole look misplaced. The setback envelope was correct all along (it was inset
25' on the street side, 7' on the sides, 20' at the rear, in the site frame).

Fix: in site-plan mode the panel no longer mounts `FloorplanSiteLayer`,
`FloorplanPolygonHandleLayer` (site vertex handles) or the edge labels. Editing
the lot's vertices stays in floor-plan mode. A follow-up could draw the
handles in the site frame instead.

## 3. Approach for what is still ahead (grade lines and the rest)

### Grade lines and topography
The reference site plan carries surveyed contours (1' interval) and spot
grades; the elevations carry the grade line at the true ground profile.
Pascal already samples the site terrain for the elevation grade line
(`plugin-sections/geometry/projection.ts gradeLine` → `site.terrain` field via
`decodeTerrainField`/`surfaceHeightAt`) — flat at 0.00 when the site has no
terrain, which is the demo's state. The plan:

1. **Elevation source.** Add an `elevation` step to the parcel resolver
   (`apps/editor/lib/parcel/service.ts` already has an `/api/parcel/elevation`
   route stub): sample a DEM (USGS 3DEP 1/3 arc-second via the EPQS point
   service, or the state LiDAR service for FL) on a grid over the lot ring +
   a 15 m margin, and write the samples into `site.terrain` (the existing
   terrain field format) with `metadata.terrainSource` naming the dataset and
   its vertical datum (NAVD88). Never invent contours: with no fetch, the
   grade stays flat and the elevation prints "GRADE 0'-0" — site terrain not
   resolved".
2. **Contours on the site plan.** A contour extractor in
   `packages/editor/src/lib/floorplan/site-plan/contours.ts` (marching squares
   over the terrain grid at 1' intervals, index contours every 5' heavier,
   labelled along the line) registered as a site-plan contributor — the same
   seam the utilities use (`registerSitePlanContributor`). Spot grades at the
   lot corners and building corners (FFE, "grade at corner").
3. **Finished floor elevation.** `site.finishedFloorElevation` (NAVD88) on the
   Site card, printed on the site plan and as the FINISH FLOOR datum on the
   elevations; the flood-zone check (BFE + freeboard) stays a note until a
   FEMA NFHL lookup lands in the parcel resolver.
4. **Elevations.** `gradeLine` already samples along the view; the grade
   ticks and label landed in this pass. With terrain present the profile is
   real. Cut/fill and retaining walls stay out of scope.

### Structural (Bones)
The Bones engines are the source: foundation (footings, stem walls, anchor
bolts per R403.1.6, slab per R506), floor framing (joists/girders), roof
framing (rafters/trusses, ridge/hips), wall bracing (R602.10). The sheets
draw the members as plan linework with schedules derived from the members'
sizes. Engineered items the engines do not size (holdown capacities,
shearwall nailing schedules, beam calcs) print as "(verify — engineer of
record)" rows rather than numbers. Structural details (SD sheets) are not
generated; a detail library of `image` viewports is the honest route.

### Electrical / plumbing (Bones, live)
`computeLevel` runs on every render of the sheet, so moving a wall, a door or
a sink re-derives receptacles (12'/6' rule, GFCI zones from the room names,
counter/basin rules from the placed sinks), switches at the doors, lights,
alarms, and the panel next to the meter. The meter is the site-utilities
service point, so the overhead drop, the site plan and E1.0 share one spot.
User-moved devices are Bones `bones:device` override nodes and survive
re-derivation. Circuits come from Bones' `assignCircuits`/`circuitSchedule`.
Homerun routing (`routeWiring`) is available for a wiring diagram later.

### Energy
The envelope summary is computed; the compliance RESULT is not. Florida's
Form R402 (prescriptive) / R405 (performance) is produced by approved software
(EnergyGauge, REM/Rate). The sheet prints the inputs those tools need and the
prescriptive requirement rows with their citations, and says plainly that the
form is attached separately. If a rulepack with cited FBC-EC tables becomes
part of Pascal, those rows fill from it.

### Materials on elevations — user library vs. Pascal library
The pattern is driven by the wall ASSEMBLY's `exterior.finish`
(siding / stucco / brick / stone / fiber-cement), which is what the section
poché and the wall thickness are driven by too, so paper and model agree.
A wall painted with a library or user material but no assembly is drawn blank
and listed as "no cladding specified" — the fix is to pick an assembly (Wall
panel → Assembly). Mapping Pascal's material library ids to finish kinds
(e.g. `material/siding/lap_*` → siding, `concrete/white_stucco` → stucco,
`roofing/roof_shingles_*` → shingles, `roof_tiles_*` → tile courses) is the
next step, so a painted wall without an assembly still gets the right symbol,
and the roof's material picks its course pattern instead of the assumed
asphalt shingle.

### Remaining polish
- Roof pitch text on elevations (the "6:12" flag next to the roof slope).
- Assembly table on A5.0 sections; wall legend (exterior/interior fill) on
  the plan sheets; sq-ft tabulation and code legend on the cover.
- Door/window schedule columns to match the reference (SIZE as 3068-style,
  EGRESS, TEMPERED per R308.4, BOTTOM/TOP).
- Site vertex handles in site-plan mode; contours; driveway/walk polygons.
- Vicinity map (needs a tile service; the parcel resolver already has the
  lat/lng).

## 4. Status of this pass (2026-09-03)

Landed and verified in the running app (see the commit messages for detail):
2D site-frame fix, attach-end repair, demo house furnished/sited/roomed,
1/4" plans with fixture schedules and north arrows, elevation materials,
provider plumbing for the new sheet kinds. The structural, MEP and
notes/energy sheets are being filled in by their workstreams into the
`providers/` and `plans/` modules; until each lands its viewport prints
"<kind> — nothing to draw" rather than a blank.

Known gaps carried honestly: terrain/contours (flat grade), engineered
structural values (verify rows), FL energy form (inputs only), roof material
(assumed asphalt shingle until the roof material maps to a finish kind).
