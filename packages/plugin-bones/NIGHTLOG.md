# Bones — Night Log (2026-08-12 → 08-13)

*The all-nighter, documented as it happened. Times US Eastern.*

## Evening — v0.1 (the proof)

- Studied Plugin API v1 via `docs/developers/plugins.mdx` + `pascalorg/plugin-trees`
  (the reference plugin) and the host wiring in the community app.
- Shipped **v0.1**: `bones:lumber` node (dimensional lumber at actual dressed
  sizes), panel, placement tool, inspector, tests. Icon generated (fal.ai
  nano-banana-pro — hammer over blueprint, Xcode-style).
- Verified end-to-end headlessly (Playwright): panel in the Plugins sidebar,
  members placed on canvas, count chip live.
- Gotcha logged: Next static image imports are `{src}` objects — export `.src`
  or the rail icon renders `[object Object]`.

## Night — the X-ray

- **Repo moved to pascalorg** (`pascalorg/plugin-bones`), package renamed
  `@pascal-app/plugin-bones`, plugin id `pascal:bones`.
- **Research fleet #1** (5 parallel agents): state code adoption (51/51, with the
  2025–26 edition transitions verified — NY 2025 RCNYS, PA/GA/CA/NH/MI/IA/ND moves),
  real 2021 IRC framing tables (headers R602.7(1), joists R502.3.1(2), rafters
  R802.4.1, studs R602.3(5), anchors R403.1.6 — each cross-checked against two
  sources; my simplified header fallback flagged unconservative past 24 ft
  building width), NEC 2023 receptacle geometry (incl. the 2023 island change),
  MEP rules of thumb. Climate agent stalled → re-run split in two + merge.
- **Core architecture** (see ARCHITECTURE.md): derived-not-persisted members;
  `bones:framing` config node per level; pure engines; instanced renderer;
  jurisdiction profiles with zero-network AUTO guess (timezone → state).
- **Wall framing engine**: plates/studs/kings/trimmers/span-sized headers/sills/
  cripples, 13 numeric tests. Verified live: 4 drawn walls → 72 members.
- **X-ray vision**: skeleton was hidden inside the drywall → depth-test-off +
  late render order = the see-through engineering view. Verified visually.
- **Product directions folded in mid-flight** (Julien):
  - Identity: *construction / actual plans / see-through / engineering access.*
  - Jurisdiction default suggested from browser (no network); dropdown override;
    INTL profile for non-US.
  - Not everything is 2x4: per-wall construction override (framed/CMU/skip),
    CMU default for Florida exteriors.
  - BIM-style LOD ladder: 200 generic → 300 code-sized → 400 details.
- **Engine fleet** (7 parallel agents, file-disjoint): floor joists (span tables,
  polygon clipping, girders), roof (rafters/ridge/hips from real roof-segment
  schema), foundation (frost footings, stemwalls, anchor bolts, hold-downs),
  electrical (NEC 210.52 walk, GFCI by room, switches, smoke alarms, panel),
  CMU coursing (running bond, lintels, bond beams), takeoff (stock rounding,
  board feet, concrete yards), plumbing + HVAC (schematic DWV/supply/ducts).

## Deep night — every system online

- Fleet round 1 landed foundation / electrical / CMU / takeoff (with their
  agents' own numeric test suites). Floor, roof, and MEP agents stalled —
  rebuilt by hand: polygon-clipped floor joists (scanline over the slab
  polygon — L-shapes frame correctly), the full roof engine against the real
  `roof-segment` schema (gable/shed/hip, rafter rotations verified by
  rotating vectors through three.js Eulers), schematic plumbing (wet-core
  clustering, through-roof vent stack) and HVAC (tonnage from conditioned
  area, trunk + branch ducts).
- Climate retry: 51-state dataset merged (N–W fully sourced; A–M
  backfilled approximations, flagged).
- **191 unit tests green**, typecheck clean.
- Live E2E in the real editor (Playwright driving the actual wall/door/
  window tools): walls + door → **105 members · devices**, takeoff showing
  2x4s by stock length, a 4x10 header sized from the actual opening,
  11.1 yd³ of concrete (NY's 48" frost line doing its job via the AUTO
  jurisdiction guess), 17 anchor bolts per R403.1.6.
- Adversarial verification pass over roof/CMU/electrical math (3 reviewer
  agents attempting refutation with runnable counter-tests).

## Dawn — verified and shipped

- Adversarial verification found and FIXED three real bugs, each proven with
  a failing test first: hip common rafters sloped the wrong way on
  depth>width segments (inverted yaw); a degenerate door could float a
  switch past its wall end; the `skip` wall override silently deleted all
  plumbing when it hit a wet room's boundary wall. Regression suites kept
  (incl. a 400-case NEC 210.52 property test).
- Final: **214 tests / 20,309 assertions green**, typecheck clean, live E2E
  re-run on the shipped pin (105 members, takeoff intact, zero page errors).
- Both hosts pinned to the verified sha on `feat/plugin-bones`
  (private-editor + editor submodule). Morning routine: pull both branches,
  `bun install`, `cd editor/apps/editor && bun run dev` → localhost:3002 →
  Bones panel → ⚡ X-Ray this level.

## Known limitations (honest list)

- Curved walls skipped (panel warning). California corners not yet framed.
- Roof: gable/shed full, hip best-effort; gambrel/dutch/mansard/flat pending.
- Climate values are state-typical; site design values govern in reality.
- MEP routing is schematic (LOD 200), not joist-bay-aware.
- A hydration warning fires during scripted wall-drawing in the dev editor —
  reproduced without Bones loaded during interaction sequences; not plugin-caused
  on plain load (0 errors).

## Night of 2026-08-13 → 14 (round-10 backlog + rendering root-cause)

Prod shipped opt-in earlier tonight (private-editor #340, squash bdcb0f51);
everything below is LOCAL ONLY until approved — hosts' package.json pins
bumped on the local branches, prod untouched.

- **README hero replaced** (830deef): fresh LOD-400 capture on the demo
  house, correct near-hides-far occlusion, JPEG at web weight.
- **X-ray rendering root-caused and fixed for good** (50bd690): the host
  renders through a TSL RenderPipeline (MRT scene pass + separate overlay
  pass). Every in-scene depth trick fails there — clearDepth() poisons the
  WebGPU pass, an inverted depth-wipe box never lands its depthWrite, and
  transparent-list membership loses to the MRT pass when cutaway wall faces
  re-appear on camera change ("walls closed off after orbiting"). The fix:
  seeThrough members ride the host's own OVERLAY layer (layers.set(1)) —
  fresh depth buffer, composited on top, member-vs-member occlusion intact.
  Verified live: survives load, zoom, and orbit on fresh clones.
- **Repo-wide interpenetration gate** (858e5fb): 15-axis OBB SAT over a
  per-engine scenario matrix, 2mm skin, design-intent pairs allow-listed.
  It caught five real geometry bugs, all fixed with updated numeric pins:
  rafters buried in the ridge/each other (now ridge-face bearing with
  inscribed plumb cuts), fascia centered on tail cuts (now outside), flat
  outlookers crossing the sloped plane (now rolled into it over dropped
  gable-end rafters), coplanar ceiling joists/collar ties (now sistered),
  and the foundation's thickened slab edge doubling the stemwall volume
  (removed — slab pours against the stemwall).
- **Round-10 demotions all addressed**: wall corner/tee run insets (butting
  frames stop at the through wall's FACE; detectTees knows its stem), fire
  blocking every ≤10 ft, splice arithmetic (ceil sticks, n−1 laps),
  RO-shift flag, bay-clipped partition backing; girder end-bearing
  validation un-deadened via the new Member.advisory channel (rim pockets
  + notch rims recognized as bearing); oblique foundation corners scale
  laps by (1+|cosθ|)/sinθ with a 45° pin; birdsmouth seat capped at d/4
  (R802.7.1) with numeric HAP pins; 1x8 finish fascia purchasable; CMU
  grout counts a dedicated grouted flag with yd³ numeric pins; HVAC square
  trunks price as rectangular duct; LA-1/GA-1 circuit pins.
- **Known open**: intersecting roof segments still interpenetrate at the
  valley (overframe clipping — documented test.todo); autosave wrecks
  server scene drafts after the first browser session on a clone (host
  bug, documented in memory; clone-per-session workaround).
- Suite: **408 tests / ~24.8k assertions green**. Round-10 scorecard
  archived; round-11 independent review launched at 7d3f986.

## Round 11 (dawn, 2026-08-14)

Independent reviewer at 7d3f986: strict 3/10 — it found the new gate's
slab fixture had a type error (y vs elevation) that composed floor
members at NaN and made two scenarios pass vacuously (tsc was red).
Fixed immediately (7248c57): non-finite geometry is now itself a gate
violation, and the un-vacuous gate drove per-bay floor blocking sizing
(constant nominal-bay blocks overran joists/rims in narrow bays).
Electrical PROMOTED to 400 (LA-1/GA-1 pins + rotation-agnostic wall
routing verified 0.0000 m at 0/17/30/45°); takeoff + ui-ux-perf hold
400; inscribed rafter geometry verified exactly tangent at 5°–60°.

**Round-12 backlog (reviewer's counterexample matrix)**: sweep plan
ROTATION (17/30/45°), ROOF TYPES (flat/gambrel/mansard/dutch, pitches
5/10/60/80°, square hip), and JUNCTION topology (oblique wall + CMU
corners — port the foundation multiplier; interior-tee footings;
Y-junctions; 15° foundation corners; rebar×anchor-bolt dedupe in SDC-D;
non-axis-aligned slab rims; trimmer×joist dedupe; sister offsets;
hanger stacking). Biggest structural item: plumbing/HVAC route on WORLD
axes, not wall-relative (electrical's wall-graph is the model).

## All-nighter round 14 (2026-08-15)

Dual loop stood up per the PO: the LOD architect (round-14, strict
rubric) + a NEW quality reviewer driving the live editor through
review/QUALITY.md (screenshots, panel UX, blueprint sheets, code refs).

Architect verdict 2/10 strict — every finding fixed the same night:
wall-layers corner insets + stud-face stacking + sheet-goods takeoff;
foundation splice/tee precedence; oblique multiplier ported to plates
and CMU; floor sisters beside rows + rotated slabs framed in their own
frame; ALL roof families inscribe (flat, gambrel, big gables, steep
hips, low pitches, mansard/dutch arris skirts); plans project through
the full euler and paginate schedules. 434 tests + tsc green.

UI per PO: 'Blueprints' CTA (full-width primary, live sheet count),
searchable jurisdiction picker, ICC code links, code basis in title
blocks.

Tracked open: MEP wall-relative routing, electrical Phases 1-3,
valley overframing.
