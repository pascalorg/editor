# Plumbing LOD 400 rebuild — placed fixtures, mains, WH, sloped DWV

User ask (2026-08-16, all-nighter): placing toilet/shower/sinks shows almost
no plumbing. Match electrical's rigor. Review on localhost; prod when green.

## Stage 1 — extraction (src/core/wall-model.ts)
`extractPlacedFixtures(nodes, levelId)` → PlacedFixtureSlice[]:
{ id, kind: 'toilet'|'lavatory'|'shower'|'bathtub'|'clothes-washer'|'kitchen-sink',
  plan: [x, z], yaw, hot: boolean, dfu: number, drainIn: number }
- item nodes: type==='item', parentId===levelId, map asset.id:
  toilet→toilet(cold only, dfu 3, drain 3"), bathroom-sink→lavatory(hot, 1, 1.25),
  shower-square/shower-angle→shower(hot, 2, 2), bathtub→bathtub(hot, 2, 1.5),
  washing-machine→clothes-washer(hot, 2, 2" standpipe), kitchen|kitchen-counter→kitchen-sink(hot, 2, 1.5)
- dfu/drain from data/mep-rules.json (dwv.*, dfuByFixture) — cite IRC P3004.1/P3201.7.

## Stage 2 — engine rewrite (src/engines/plumbing.ts)
Signature +placed: layoutPlumbing(walls, rooms, spec, placed?: PlacedFixtureSlice[]).
- If placed.length > 0: fixtures = placed (snap each to nearest wall point via
  electrical's nearestWallPoint pattern + clearOfOpenings; stub-out at rough-in
  heights from fixtureRoughIn.*). Else: keep current room-category fallback.
- MAIN WATER SERVICE: meter fixture at street-facing exterior wall (longest
  exterior wall, panelMountU analog), ¾" cold main → WH and cold header.
- WATER HEATER like the panel: garage wall (tank, 50gal box member ~0.6Ø×1.5h)
  else exterior wall (tankless, wall-mounted). Cold in, hot header out.
- SUPPLY: buildWallGraph routing (reuse electrical export) at SUPPLY_COLD_Y /
  HOT_Y planes; cold to every fixture, hot to hot fixtures; drops in stud bays;
  RO avoidance (openingSpans) = invariant E1 applies (checklist row P-new).
- DWV: per-fixture trap (arm ≤ maxTrapArmFtBySize[size]), branch sized by
  downstream DFU sum (never decrease downstream; ≥3" once WC upstream),
  slope from slopeInPerFtBySize, REAL pitched members; branches → stack →
  building drain → sewer exit cleanout at lowest exterior point; vents:
  reuse vent-stack + re-vents per ventMinFractionOfDrainServed.
- Multi-storey: fixtures on upper levels tag members levelId (roof pattern).

## Stage 3 — gates
- plumbing.connectivity.test.ts: adapt unreachableDevices (test-helpers):
  (a) every fixture cold-reachable from service; hot fixtures hot-reachable
  from WH; (b) drain continuity fixture trap → sewer exit; (c) monotonic
  downhill along every drain path (sample member endpoints); (d) no pipe
  through RO (reuse roBoxes from electrical.openings.test.ts pattern);
  (e) trap-arm limit enforcement flags.
- mep.test.ts: keep fallback suite green; add placed-fixture scenarios
  (toilet+lav+shower bath, kitchen, 2-storey stack).
- CHECKLIST.md: P5 'supply+DWV reach every placed fixture; drains fall'.

## Stage 4 — surfaces
- MEP plan sheet: blue/red supply strokes (cold #4a7dbf, hot #c0504d),
  drain sizes labeled, WH/meter/CO tags (already in FIXTURE_TAG), slope
  callout '1/4 IN/FT' note; takeoff rows via material/length (existing).
- 3D: colorOf in renderer: pipe-run material copper→ hot/cold via
  sourceId prefix ('hot-'/'cold-'/'dwv-').

## Stage 5 — loop
Code skeptic + visual QA (place real items via graph POST, screenshot
supply/DWV) + blueprint examiner MEP sheet. Prod chain after green.
