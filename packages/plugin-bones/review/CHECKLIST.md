# Bones invariant checklist — things that must NEVER regress

Living list. Every reviewer (architect · quality · blueprint) walks this
before scoring; every item names its automated gate. When a user report or a
review round finds a new class of physical impossibility, it gets a row here
AND a gate — a checklist line without a test is a wish.

## E — Electrical

- **E1 Nothing electrical occupies a rough opening.** Wire runs detour over
  the header (or under the sill) of ANY opening crossing the drill plane —
  doors, low windows, glazing. Boxes, switches and the panel never mount
  inside an RO; anchors/junctions snap to the adjacent stud bay. Full-height
  ROs that cannot be routed around are ⚠-flagged, never silently crossed.
  Origin: prod report 2026-08-15 (wire through window, box on door).
  Gate: `src/engines/electrical.openings.test.ts`
- **E2 Every device is panel-reachable as continuous cable.** Union-find
  over wire endpoints connects the panel to every routed device — detours,
  jumpers and per-circuit planes included.
  Gate: `src/engines/electrical.connectivity.test.ts`
- **E3 Circuit colors are unique and identical in 3D and on paper.**
  Gate: `src/plans/circuit-colors.test.ts` (uniqueness pins)
- **E4 No air runs at living height.** Every horizontal wire segment lies
  along a wall centerline band, at/above the ceiling plane (joist/attic
  crossings — the disconnected-island fallback rises through the plates,
  crosses above both walls, drops back to drill height), or below grade
  (the meter→panel island fallback is buried conduit per NEC 300.5).
  Bed-height jumpers and cross-room diagonals are physically impossible
  cable paths even when they avoid ROs. Island crossings clear EVERY
  wall in the scene (a 2.5m→2.5m hop must not cross a 4m great room at
  its own ceiling); per-room light legs at their room's ceiling are
  legal. Origin: QA E1 round 2026-08-15; closed night-4 (mixed heights
  round 2). Gate: `src/engines/electrical.e4.test.ts` (airRuns invariant
  on connected + island + MIXED-HEIGHT scenes, connectivity preserved).
  cable paths even when they avoid ROs. Origin: QA E1 round 2026-08-15;
  closed night-4. Gate: `src/engines/electrical.e4.test.ts` (airRuns
  invariant on connected + island scenes, connectivity preserved).
- **E5 Moved devices stay code-legal; untouched scenes stay byte-equal.**
  Every wall device fixture (receptacle / GFCI / switch) carries a
  DETERMINISTIC `meta.deviceId` (per-wall ordinal / opening key / hallway
  room key): an unchanged scene reproduces identical ids and editing one
  wall never shuffles another wall's. COUNTER-WALK ORDINAL STABILITY
  (night-10, the r3 skeptic's re-base advisory): a face's B14c counter
  ids key on the KITCHEN ZONE (rank × 100 id block among the zones
  facing that face, sink-independent), so deleting a sink never
  re-bases a surviving sibling walk's ids (ctr-4..7 used to become
  ctr-0..3 and orphan the user's bones:device overrides) — delete
  either of two sibling sinks and the other walk's ids are unchanged,
  re-adding round-trips byte-equal, and the reconciler removes only
  the true orphans (a MOVED surviving node is never re-minted or
  re-anchored). Rank 0 keeps plain 0-based ids: single-kitchen faces —
  the baseline/master-parity class — are byte-identical. DOCUMENTED
  residuals: same-ZONE sibling walks (two sinks split by a door RO)
  keep the legacy running ordinal within their block, so deleting the
  FIRST same-zone sink still re-bases the second walk (solo-scene id
  parity makes sibling-independent ids impossible in a pure engine);
  deleting/adding a kitchen ZONE re-ranks the blocks (structural edit,
  note 3's same-wall class). Each derived device is mirrored by a
  `bones:device` node (reconciler: create at the derived anchor with
  seed == anchor, re-seat UNMOVED nodes when the derivation drifts, NEVER
  touch a moved node's anchor, drop orphans/duplicates) so any outlet is
  hoverable/draggable. A node whose anchor differs from its seed is an
  engine override that WINS over the derived spot but lands buildable:
  never inside a door/window RO (snapped clear + warning), box edge
  against a stud face — off-stud books a 'device blocking' member across
  the bay (SAT-clean vs the studs) — and heights clamp to the legal bands
  (receptacle 0.15–1.7 m, switch 0.9–2.0 m per NEC 404.8(A)). Wiring
  consumes the POST-override positions (a wire endpoint lands ON the moved
  box, E2 continuity preserved). NEC 210.52 spacing re-checks ONLY walls a
  moved receptacle left/joined — the derived layout is spacing-correct by
  construction, so untouched scenes never warn. CRITICAL regression: zero
  device nodes/overrides computes members STRICTLY byte-equal to master
  (pinned master-baseline.json) and fixtures identical except the added
  `meta.deviceId`; seeded-but-unmoved nodes stay byte-equal end-to-end.
  DRAG-COMMIT CONTRACT (night-5, D2/D3 closure): the parentFrame drag
  frames — device AND service — carry NO `onCommit`; a host move-commit is
  exactly ONE tracked write ({position: on-axis plan point}) and the
  reconcile batch converts it to the wall anchor (wallId + wallT, position
  → [0,0,0]) history-paused. The host `onCommit` branch is what patched the
  parent WALL (`resolveSupportSlabPatch` no-op) and woke the space-detection
  sync mid-commit — rewriting unclassified walls' frontSide/backSide (the
  exact fields `extractWalls` derives exterior-ness from) + zone defaults,
  partly TRACKED: one drag minted three undo entries and drifted the counts
  (night-4 D2/D3 evidence: 1255·77 → 1218·79 → Cmd+Z → 1207·74). One drag =
  one undo entry; Cmd+Z returns the box AND the wiring; Cmd+Shift+Z goes
  forward; counts never drift. Sibling host defect (D4, editor branch
  fix/outlets-hidden-wall-clicks): walls hidden by the wall-mode pass kept
  full-height invisible raycast meshes that swallowed clicks aimed at
  devices behind them — hidden walls are pointer-transparent now.
  Origin: user ask Q7 ("outlets should move like doors — against a stud or
  an extra piece of wood, per code"), built night-4; live drag closed
  night-5 (movableOutlets defaults ON since).
  Gates: `src/engines/electrical.devices.test.ts` (ids + snapping matrix) +
  the night-10 ordinal-stability describe in
  `src/engines/electrical.receptacles.test.ts` (zone-block pins, the
  delete-A/delete-B/re-add trio, single-kitchen master parity,
  same-zone one-block pin, reconciler never-re-mints — mutation-checked) +
  `src/framing/compute.devices.test.ts` (byte-equality pin, wiring
  re-route, warning parity) + `src/device/schema.test.ts` +
  `src/device/place.test.ts` (reconciler + position→anchor normalization
  matrix) + `src/service/frame.test.ts` (onCommit-ABSENCE pin for both drag
  frames + `normalizeServiceAnchors` matrix) + the device-blocking SAT
  scenario in `src/engines/interpenetration.test.ts`.
  MOVE-PARITY ENCODING (2026-08-21): the affordance-tool path writes
  the ANCHOR form directly (wallId+wallT+heightAff, position reset to
  the [0,0,0] sentinel; live preview rides OVERRIDE_Y=1e-4 so the
  sentinel never collides) — the {position}+reconciler conversion
  stays for MCP/legacy writes. Plugin-side #694 own-wall gate +
  one-entry session gated in src/wall-mount/*.test.ts.
- **E6 Life-safety alarms are complete, on ONE circuit, and their
  interconnect is pullable cable.** Placement (IRC R314.3/R315.3): every
  bedroom alarms; the outside-sleeping-area alarm NEVER silently drops —
  a missing hallway falls back to a bedroom-ADJACENT room (polygon
  adjacency, garage/bathroom last — OUTDOOR zones NEVER host: R314
  covers the dwelling interior, so a garden sharing the bedroom's wall
  is open air, not "outside the sleeping area"; night-10) and an
  impossible proxy is a LEVEL WARNING; every story with rooms carries
  at least one alarm (R314.3(3)) hosted by the largest INDOOR room —
  a bigger garden never outranks the living room, and an outdoor-only
  level warns ('all zones on this level are outdoor — … R314.3(3) not
  placed…') instead of hanging the alarm in the yard (night-10 close
  of the day-9 residual family); a level with an attached garage + bedrooms places a
  `co-alarm` outside the sleeping area (R315.3 — the fuel-appliance
  condition rides the same garage trigger as the plumbing tank-WH
  assumption); centroid nudges clamp INTO the host polygon (narrow-
  corridor hosts, `nudgeInside`). Circuits (R314.4 / NEC 210.12): EVERY
  smoke/CO alarm rides the single `SD-1` branch (`ALARM_CIRCUIT`), marked
  `interconnected` — alarms scattered across two breakers cannot be
  interconnected. Wiring — the PER-STOREY contract: compute routes one
  LEVEL, so each storey mints its own panel + SD-1 and the modeled chain
  truthfully claims ONLY its storey — 14/3 legs are labeled 'alarm
  interconnect (this storey) — IRC R314.4', walkably CONTINUOUS through
  every alarm box on the level (E2-style union-find scoped to the
  interconnect members), and any scene whose sibling storeys carry rooms
  gets the level warning 'alarm interconnect modeled per storey — R314.4
  requires interconnection across the dwelling; verify the cross-storey
  chain' (single-storey scenes stay warning-free; room-less roof levels
  don't count). threeWay switch groups get a 14/3 traveler chain
  box-to-box (NEC 210.70/404.2) under the TRAVELER PREDICATE (round 3):
  same threeWay room AND same branch circuit AND distinct openings (one
  switch per wall+opening deviceId key — a door's -p/-m face twins are
  two rooms' controls, never a pair; a duplicate overlapping zone once
  welded a cross-circuit LTG-1×LTG-2 'traveler' boring 0.07 m through
  the wall). The takeoff books 14/3 as its own NM-B SKU (it used to book
  as phantom 14/2 lf) and the ceiling-box census counts lights + smoke +
  CO alarms exactly.
  Origin: LOD-400 audit BATCH 13 (2026-08-20), confirmed defects (a)+(b);
  cross-storey honesty + nudge clamp = round-2 skeptic driver/advisory.
  Gate: `src/engines/electrical.alarms.test.ts` (proxy census + warning,
  per-story pin on a two-storey scene, CO presence/absence matrix,
  one-circuit pin, 14/3 interconnect walk, traveler continuity, takeoff
  row split, 3-storey cross-storey warning matrix + scoped labels,
  corridor nudge-clamp repro, duplicate-zone/face-twin traveler
  exhibits + legitimate-pair keep, ceiling-box census) +
  `src/engines/electrical.outdoor.test.ts` (garden-only warning pair,
  indoor-only per-story election, garden-vs-den proxy exhibit,
  proxy-fail bedroom+garden scene — all mutation-checked night-10).
- **E7 Every service chain carries its grounding electrode system.**
  A meter + panel imply the GES (NEC 250.50 — every build orders it):
  TWO driven 5/8" × 8 ft rods below grade AT the meter, exactly 6 ft
  apart, tops strictly below grade (250.52(A)(5), 250.53(A)(2)/(B)/(G));
  a CONTINUOUS GEC meter → rod 1 → rod 2 (250.53(C)) sized from the
  service rating (250.66 — `gecSizeAwg`; a missing rating books 8 AWG
  labeled 'assumed 100 A service'); an intersystem bonding termination
  at the meter (250.94); and the metal-water-pipe bond (250.104(A))
  panel → water entry along the walls at its own service plane. The
  bond target is the CROSS-TRADE seam: the waterEntry service override
  (authoritative), else plumbing's own water-meter auto-spot mirrored
  in compute (`placeMeterSpot` — placed-path parity gated: the bond
  ends ON the water-meter fixture). No visible water entry (fallback
  plumbing models no meter; plumbing off) = the intersystem member is
  LABELED 'water-pipe bond not modeled' AND the level warns — NEVER
  silent. GEC grade runs stay at/below the grade line (above the
  stemwall top — nothing bores the foundation; E4-legal as buried);
  rods stand off the footing projection. ROD SPOTS ARE SCENE-AWARE
  (round 3): the pair must clear the buried SE street lateral (which
  approaches the meter along its own normal — it BORED rod 1 on the
  default scene), every wall's below-grade foundation band, and every
  room footprint (a concave L-plan put rod 2 inside the wing), the
  buried rod-to-rod leg scanned against the wall bands too; an
  obstructed pair SLIDES along the wall axis (deterministic ± steps)
  and an unplaceable pair keeps the default and FLAGS both rods.
  GES conductors never run INSIDE the SE cable: parallel legs clear
  the summed half-sections (crossings stay legal — one cable straps
  over the other) via bay-step strap-outs at the meter, panel and
  water-entry ends plus a bond plane a full section-sum above the
  feed (round-3 F2: the panel-bay drop sat coincident with the feed
  rise; the old plane embedded 12.5 mm). The clearance machinery
  covers the NO-WALL-PATH FALLBACKS too (round 4 / r2 skeptic): the
  rod scan's buried-conductor list includes the feed fallback's legs
  + panel rise AND the bond fallback's post-strap legs (a detached
  island panel put the buried feed 6 mm from a rod centerline while
  the scan looked only at the street lateral), and the bond fallback
  takes the same bay-step strap-outs at both ends (its naive panel
  drop was BYTE-IDENTICAL to the feed fallback's rise — ~1.9 m of
  conductor coincident inside the cable). The fallback MID-legs are
  scanned too (round 5 / r3 residual — round 4 relocated the
  coincidence to the buried x-leg: a PERPENDICULAR island wall put it
  exactly on the feed's leg inside a 49 mm strap window, with the
  symmetric water-end window against the street lateral): each strap
  end walks a DETERMINISTIC multiple ladder (±1, ±2 … ±6 bay-steps)
  until its buried legs clear every buried service element by the
  summed half-sections + skin — parallel elements only, crossings
  stay legal — and never run parallel inside a wall's below-grade
  band (a dodge must not trade embedment for a stemwall bore); an
  undodgeable end keeps the default step and CONFESSES the embedment
  on the member labels. PER-STOREY HONESTY (the E6
  class): compute mints one GES per storey with a service chain —
  rod/GEC labels say 'per-storey model' and multi-storey scenes get
  the level warning (NEC 250.53/250.58: ONE electrode system per
  service). The rows mirror the members: rods pcs, clamps pcs (rod
  count + water clamp), GEC lf, bonding jumper lf, termination pcs —
  GEC/bond lf NEVER book as NM-B. On paper, rods + the termination
  carry keyed symbols (GR/IB bubbles + legend rows — they printed as
  unkeyed dots). The GES lands identically in all 51 jurisdictions
  (universal NEC).
  Origin: LOD-400 audit BATCH 12 (wave-1 confirmed: regex for
  ground/rod/electrode/GEC over composed members = zero); round-3
  skeptic F1–F4 + examiner keys; round-4 r2 skeptic fallback root
  cause; round-5 r3 mid-leg residual (2026-08-21).
  Gate: `src/engines/electrical.ges.test.ts` (census + 6-ft/8-ft/
  below-grade pins, E2-style GEC + bond continuity, E4 legality of
  bond legs, no-meter subset zero, takeoff parity matrix, 51-state
  sweep, water-meter parity, override + warn/label matrix; round 3:
  lateral×rod clearance on the DEFAULT scene, parallel-embedment scan
  GES×SE, L-plan slide + wall-band/room scans, unplaceable-flag pin +
  Flags row, per-storey warning matrix + label pins; round 4: island
  exhibits — buried-feed×rod clearance with the slide, double-fallback
  bond embedment scan + continuity + rod×bond clearance; round 5:
  perpendicular-island 49 mm windows at BOTH ends — mid-leg embedment
  scans + deterministic flip-step pins + no-confession pins — all
  mutation-checked) + the GR/IB key pins in
  `src/plans/plan-set.test.ts`.
- **E8 Receptacle coverage is complete beyond the 15" wall walk — and
  honest where the scene can't carry it.** OUTDOOR (NEC 210.52(E),
  210.8(A)(3), 406.9(A)/(B)): every scene with an exterior shell mounts
  a front AND a back receptacle on EXTERIOR faces — front = the
  street-nearest exterior wall via the SAME `streetEdgePoint` the
  service lateral rides, back = the most nearly opposite wall farthest
  from street — as the dedicated `receptacle-wr-gfci` kind (WR + GFCI +
  extra-duty in-use cover in kind, meta AND label; own `EXT-1` 20 A
  GFCI circuit, never AFCI; takeoff books WR boxes and covers as their
  own rows, paper marks them `WR` with a legend line). A
  single-exterior-wall scene doubles up on it and WARNS; a shell-less
  scene warns — two required outlets never silently collapse or drop.
  SINK RADIUS (210.8(A)(7)/(9)): any receptacle within 6 ft plan of a
  PLACED kitchen-sink/lavatory/bathtub/shower flips to GFCI — measured
  from the item center (no bowl-edge geometry; stated proxy), deviceId
  untouched by the flip (the reconciler follows deviceKind). The reach
  is STRAIGHT-LINE and pierces walls BY DECISION (round-2 F3): NEC
  measures the cord path 'without piercing a wall', so this
  over-protects — a same-room guard would need zone data on both
  sides and silently UNDER-protect exactly where scenes are weakest,
  and extra GFCI is always code-legal while a missed one is a
  violation. Dry-room flips carry the assumption on their label
  ('straight-line reach, conservative'). COUNTER
  (210.52(C), hybrid-honest): a placed kitchen-sink pins its counter
  wall → 44" AFF walk per layoutAlgorithmHints (first box ≤ 24" of
  each run end, ≤ 48" o.c.), clipped to the kitchen polygon, broken by
  door ROs, faucet zone kept clear; a sink-less kitchen zone WARNS per
  kitchen instead of inventing casework; island sinks raise the 2023
  210.52(C)(2) per-kitchen WARNING. A sinked kitchen with ZERO (or
  gutted) counter coverage is NEVER wordless (round-2 F1/F2 + round-3):
  the post-snap walk audits its own 24"/48" contract — the behind-sink
  strip is exempt counter space — and warns when a window RO breaks
  the pitch; the sink-in-doorway and no-kitchen-face bails and the
  sub-12"-strip exemption each raise a per-kitchen WARNING; and the
  per-face walk dedupe is SPAN-AWARE (round 3 — the old global
  wall|face key was a fourth wordless zero-box exit): a second kitchen
  zone down the same wall, or a same-kitchen sink across a door RO,
  walks its own uncovered span with unique continuing deviceIds, while
  a sink inside an already-walked span stays silent because its boxes
  exist.
  An outdoor WR box that cannot clear near-full-width glazing is
  ⚠-flagged on its label + `meta.obstructed` + a level warning
  (round-2 F4 — the E1 never-silent contract), and the flag is
  RECOMPUTED on user moves (round 3): a drag to a clear wall sheds the
  ⚠ + meta, a drag into glazing gains them — never stale. BASIN (210.52(D)): a
  placed lav pins a GFCI box within 3 ft at 40" AFF on the basin-side
  face; one box may serve two basins; freestanding basins and >3 ft
  RO snap-outs warn, never silent. Counter/basin boxes never count
  toward the 210.52(A) floor-line spacing census
  (doNotCountTowardWallSpacing; census-exclusion gated round 2). NOTE
  (pre-existing, documented not fixed): the census's
  `us.length===0 && wall.exterior` skip makes the exclusion reachable
  only on INTERIOR counter walls — an exterior counter wall's faces
  skip the 210.52(A) census entirely. OUTDOOR ZONES ARE OPEN AIR
  (night-10, the day-9 M4 residual): a wall face opening onto an
  'outdoor' zone with no indoor room at the same point is NEVER a
  210.52(A) mounting face — interior-style 15" receptacles used to
  mint on the yard side of shell walls (winning the face election
  from the indoor side on some orientations) and on garden fences; an
  exterior wall resolves its interior side against INDOOR rooms only,
  a wall whose only resolved side is outdoor (fences, freestanding
  garden walls — EITHER wall typing: real fences classify
  interior-typed since both-sides-uncovered leaves exposedSides=2 and
  the host fallback marks exactly-1, and an interior-typed wall
  touching open air keeps a face only by resolving a REAL indoor room;
  round-1 F2) gets NO faces at all, the exterior-entrance-light zone
  lookup is INDOOR-FIRST like the face predicate (an outdoor polygon
  double-claiming an indoor slice mints no phantom entrance light and
  never swallows the zone's honesty warning; round-1 F1), and the
  moved-device spacing census skips open-air faces exactly like
  exterior faces (a courtyard partition's outdoor side is a by-design
  zero, not a >12ft gap). `exteriorFaceOf` reads an outdoor zone as the OUTSIDE when no
  indoor room resolves a side, so the meter/WR boxes stop flipping
  indoors on garden-backed walls. Outdoor coverage stays the B14a WR
  machinery's job — the two required WR boxes are UNAFFECTED by the
  open-air skip. On paper the B14 boxes print as
  their OWN tags — GC (44" AFF) / GB (40" AFF) / WR — with legend
  rows naming the heights and a tag-keyed bubble dedupe (a counter box
  plan-stacks exactly over the wall-line box below it); EXT-1 carries
  its own circuit-color family (round-2 E3 blocker: it printed
  byte-identical to the SE copper fallback). All B14 boxes carry
  deterministic deviceIds (`-out-front/back`, `-ctr-<i>` — `i` numbers
  inside the kitchen ZONE's 100-wide block so sibling-sink deletion
  never re-bases a surviving walk, E5 night-10; single-kitchen faces
  keep plain 0-based ids — `-basin-<lavId>`) and are movable
  `bones:device` nodes (E5 contract).
  Origin: LOD-400 audit BATCH 14 (2026-08-21) — zero outdoor
  receptacles ever, all kitchen/bath boxes at 15", the sink-GFCI test
  skipped behind a stale 'once sink positions are extracted' comment;
  round-2 skeptic F1–F5 + examiner E3 blocker + GC/GB tags; round-3
  walked-dedupe fourth bail + WR-flag staleness (2026-08-22).
  Gate: `src/engines/electrical.receptacles.test.ts` (46 tests, all
  sub-invariants mutation-checked) + the GC/GB/WR/EXT-1 paper pins in
  `src/plans/plan-set.test.ts` + the EXT family floor (incl. the
  explicit `service-entrance` id) in
  `src/plans/circuit-colors.test.ts` + the open-air face gates in
  `src/engines/electrical.outdoor.test.ts` (garden/fence/courtyard
  sweeps, indoor-first face election, meter-side pins incl. the
  un-zoned-interior fallback, census skip, indoor-overlap
  conservatism — all mutation-checked night-10).

## S — Structure

- **S1 No member interpenetrates another** outside the allowed bearing
  pairs (15-axis OBB SAT, 2 mm skin; non-finite geometry = violation).
  The SAME-WALL framing-vs-finish-cavity class is DEAD since night-4
  (cavity-fit framing): 140 pairs on default 0.15m/2x6 exteriors and the
  explicit-misfit carve-out are retired — framing geometry compresses to
  the drawn cavity (`fitAcross`) so contact replaces overlap at every
  thickness. The anchor-bolt × bottom-plate slab-on-grade class CLOSED in
  LOD-400 B5: the foundation's bolts rise through the wall engine's bottom
  plate — the (PT, R317.1) SOLE PLATE they exist to clamp (R403.1.6) — so
  the pair is allow-listed as design intent and a foundation+walls compose
  scenario pins it. The seismic kit's design-intent contacts joined the
  allow-list with B9's SDC-D compose (the first seismic foundation ×
  walls × layers scenario): hold-down × post (the HDU exists to clamp
  the CS-PF portal post) and hold-down × bottom-plate (the HDU standoff
  base bears on the sole plate at its anchor). KNOWN residual
  pre-existing classes (byte-identical to the pre-night-4 baseline,
  queued on the board): tee-stem face layers × through-wall framing;
  anchor-bolt × STUD on slab-on-grade (the shank tops out 3" above the
  slab — 1.5" above the plate — and can land inside a grid stud's
  footprint; bolt-vs-stud layout nudging queued, surfaced by the B5
  compose scenario) and its washer sibling plate-washer × STUD (the 3"
  washer follows its bolt one-for-one under a grid stud's footprint;
  named by the B9 seismic compose); corner drywall × hold-down (a layer
  running to the through wall's face crosses the neighbor's HDU body at
  the corner — the tee/corner layer-vs-hardware family, named by the B9
  seismic compose); framed partition tees into full-CMU through walls
  (frameWalls never sees CMU walls for insets); stem layer×layer at
  tees.
  Gate: `src/engines/interpenetration.test.ts` scenario matrix + the
  cavity-fit thickness sweep (8 thicknesses × 3 stud configs × batts)
- **S2 Every roof family inscribes inside its footprint** (no eave-line
  overhang unless declared; rake ladders from actual member positions).
  Gate: roof-framing tests
- **S3 Foundation corners close** at any angle (oblique multiplier, butt
  claims, splice suppression) — no gaps, no bow-ties on paper.
  Gates: foundation tests + mitered-path pins in `plan-set.test.ts`
- **S4 Takeoff areas never book material the members don't render — and
  never book one material twice.** The gross sheet-goods areas
  (wallSheathingM2…) and the member list derive from the same wall
  classification: if the takeoff books WSP sheathing, sheathing members
  exist on the level — and an interior-only storey books zero. ONE booked
  row per material: when the layer engine emitted sheathing/drywall MEMBERS
  for the level, the member-derived tally is the single surviving row and
  the gross-area row is suppressed (members are truth; the gross path is
  the LOD-200 fallback only, mirroring the subfloor deck fallback) — the
  pre-B4 takeoff booked 'Wall sheathing | 34 sheets gross' AND 'Sheathing
  7/16" WSP | ~33 sheets net' on one scene, so a purchaser summing sections
  ordered ~2× (S4 in reverse: renders once, books twice). Fastener basis ==
  the booked row: 8d WSP nail poundage keys off the SURVIVING row's sheet
  count, never a suppressed one. CMU walls contribute ZERO gypsum area —
  the layer engine never sees masonry, so the gross drywall path skips
  non-framed walls (the ghost drywall on CMU scenes is dead; mixed walls
  follow the CMU layer treatment whole-wall, v1). The slab-on-grade FIELD
  is member-truth too (B17): the foundation engine BUILDS the R506.1
  3-1/2" slab strips + the 6-mil vapor retarder under them, and the
  takeoff derives the 'slab field' yd³ row from the member volumes and
  the vapor-retarder sqft row from the member areas (stated +10% lap
  factor) — no members, no rows; upper storeys grow deck framing, never
  a pour. The 4" base course is an assumption LABEL on the slab members
  (R506.2.2), never invented geometry or a phantom row. The ROOF package
  is member-truth from birth (B6): the roof engine BUILDS the 7/16" WSP
  deck on every slope plane (R803.2) + the underlayment membrane 1:1 on
  it (R905.1.1) + drip edge at fascia'd eaves and gable rakes
  (R905.2.8.5), and the takeoff derives the Roof sheet/sqft/lf rows from
  exactly those members — no members, no rows, no gross fallback. The
  suppression gates FILTER BY SYSTEM (the B4 skeptic's advisory): only
  WALL-framing sheathing/drywall members suppress the wall gross rows,
  and the wall layer tallies skip non-wall systems — a roofed scene with
  LOD-200 walls keeps its wall gross buy, and roof sqft never lands in a
  wall row. Roof deck 8d nails book their OWN fastener row ('Nails 8d
  common (roof deck)', roofSheathing-sheet connection) — Table R602.3(1)
  keys roof and wall sheathing separately, and the pounds follow the
  booked deck row's sheet count. The COVERING stays HOST cosmetic: the
  top membrane and the underlayment row both state 'covering by finish
  schedule — not booked' (the assumption-label contract); underlayment
  buys the deck area at a STATED +10% course-lap factor; tapered
  hip/arris planes strip-tile conservatively INSIDE the hip lines with
  the EXACT per-compose coverage percentage stated on the member labels
  (never 'slight' prose — the shortfall is scene-dependent) and the
  waste caveat repeated on the buy row; the area gate floor is DERIVED
  from the strip arithmetic (edge wedges + vanishing tail strips +
  apexes), never a pinned magic number; valley-minor panels carry
  the overlay-framing trim statement as a FLAG (it must PRINT — Flags
  rows/block, never a label-only aside). Stated trim gaps are flags too:
  SHED roofs model no fascia and therefore NO drip edge at 400 (deck
  flag, count pinned at zero); the gambrel rake-metal flag RETIRED when
  B8d landed the rake ladder + rake drip edge as real members (S17d —
  the retirement is pinned).
  Stated WASTE factors are ordering allowances, never quantity
  multipliers (B21e): every sheet-goods, lumber-pcs and concrete buy
  row keeps its member-derived NET quantity in the quantity column and
  prints '+X% waste ≈ buy' in the detail — sheet goods (WSP/drywall/
  subfloor/roof deck) +10% offcut, dimensional lumber +5% cull/damage
  (the cut drop is already bought via stock-length rounding), concrete
  pours +5% spillage/over-excavation; NAHB-style estimating defaults,
  deliberately coarse, basis + 'verify for your job' cited in the
  takeoff convention header. Counted hardware, fixtures, supplier SKUs
  and rule-of-thumb rows (mortar/grout) carry none. LAP factors are the
  OPPOSITE convention (B6 reconcile): seam/course overlap is INSTALLED
  material, so the vapor-retarder and underlayment quantities include
  their stated +10% and a lap row never reads as waste. 'gross' prints
  ONLY on the LOD-200 WALL fallback rows (WSP + drywall faceArea sums —
  openings never deducted, so no factor stacks on top; the drywall
  fallback states that basis now instead of leaving it unstated). The
  SUBFLOOR fallback is NOT gross (compute deducts slab holes —
  stairwells; r1 F2): it states its 'from slab area, net of floor
  openings' basis and joins the stated-waste convention, and the
  member-derived subfloor row says 'from deck members, net' instead of
  the pre-B21e 'gross' mislabel over net (holes-carved) deck area. The
  concrete BUY figure ceils to the 0.1 yd³ ready-mix batch (r1 F1: a
  round that collapses onto the net states a factor adding zero), and
  every printed '+X%' derives from the factor constant itself, so the
  label can never drift from the arithmetic. SUB-BATCH pours (r2
  advisory, night-10): when 5% is smaller than one 0.1 yd³ display step
  the ceiled order figure and the net PRINT identically ('0.6 … ≈ 0.6')
  — the detail then states the basis ('waste smaller than the 0.1 yd³
  display step — net and order figures meet at display rounding'),
  wording only, zero quantity drift; pours that clear the step stay
  note-free byte-for-byte. The roof deck's under-tile
  caveat states that the exact scene-dependent shortfall sits ON TOP of
  the generic stated waste.
  Origin: verify round 2026-08-16 — the attic blanket-exterior rule fired on
  an in-progress GROUND storey (no slabs anywhere, no rooms), partitions
  framed exterior/CMU and the takeoff booked sheathing the layer engine never
  rendered. The attic rule now requires a storey BELOW in the same building
  (`extractWalls` hasLowerStorey). Double-booking: LOD-400 audit B4
  (2026-08-20).
  Gates: `src/framing/compute.multistorey.test.ts` (takeoff/member
  consistency + the B17 describe: baseline slab census, yd³/sqft parity,
  warning-names-real-geometry pin, upper-storey exclusion) +
  `src/engines/takeoff.test.ts` ('one row per material' describe: one-row
  pin, fastener-basis pin, LOD-200 fallback, CMU scene books no drywall;
  B17 describe: slab-field/vapor rows == member geometry exactly; B6d
  describe: roof rows == member geometry exactly, BOTH system-filter
  directions, drywall-gate symmetry, 8d re-key non-vacuous, no-members-
  no-rows) + `src/engines/roof-framing.test.ts` B6a/B6b/B6c describes
  (per-shape deck presence + area≈plane bounds, deck-on-rafter-top pin,
  underlayment 1:1 count/area/normal-offset parity, drip counts/lengths,
  LOD-200/300 zeros, valley notes) +
  `src/engines/foundation.test.ts` B17 describe (field/membrane geometry,
  holes carved, carve bands) + `src/engines/takeoff.test.ts` B21e
  describe (net-preservation per class, stated-factor buy figures
  re-derived from the same net arithmetic, gross-only-on-fallback
  header honesty, subfloor label both paths, demo-compose enumeration
  in BOTH directions, lap-vs-waste distinction, sub-batch display
  collapse note both directions)
- **S5 A mixed CMU/framed wall seams on a whole course and tops out at its
  architectural height.** The override `{ construction: 'cmu', cmuHeightM }`
  splits the wall at `snapCmuHeight` (8" module, R606 coursing): bond beam as
  the CMU zone's top course, PT sill anchor-bolted to it (R403.1.6 layout,
  7" embed), shortened framed zone with its own bottom/top plates above —
  zones never share volume (S1 matrix covers the seam), openings zone per
  the seam, a CROSSING opening always flags ('opening crosses the CMU/framing
  seam — verify detail') and frames as if fully in the taller zone. At a
  shared corner, and as the STEM of a tee, the mixed wall BUTTS, never
  through-runs: both zones inset to the neighbor's near face — the retreat
  is block-width-aware at acute corners,
  (neighborThickness + blockWidth·|cosθ|)/(2·sinθ), since the CMU block is
  wider than a thin framed neighbor — with the per-junction advisory
  ('mixed wall butts at corners — verify tie detail'), so it never shares
  volume with a framed, full-CMU or mixed neighbor at those junctions.
  Reverse-direction tees and oblique tees follow the pre-existing repo-wide
  tee conventions (night-board next-session queue), not this row.
  A height absent or at/above every fitting course = byte-equal to today's
  full-height CMU. Takeoff: blocks for the zone only, PT booked on its own
  `<size> PT` row, seam bolts under Wall framing. The WRITE side holds the same line:
  the height slider on both Engineering surfaces (`cmuHeightOverride`)
  stores the plain legacy 'cmu' string at full height and the object form
  with a course-snapped height otherwise — never an unsnapped number.
  Gates: `src/engines/mixed-wall.test.ts` + mixed scenarios in
  `interpenetration.test.ts` + slider write shape / snap round-trip /
  resolver read-back in `src/panel-selection.test.ts`
- **S6 Per-wall engineering overrides plumb through EVERY consumer; defaults
  stay byte-equal.** The WallOverride object's engineering fields change the
  derived members end-to-end — `studSize` re-sizes that wall's framing dims,
  `spacingIn` its stud count, `insulation` ≠ 'none' emits pink batt members
  in the stud bays (labeled 'batt R-13 (zone 2A)' style: type + override R
  or the climate zone's code minimum) that lay out against the framing's
  OWN frameHints (trimmed runs, corner backing, opening keep-outs,
  backing-ladder bays, LOD-400 fire-row splits — SAT-clean with NO
  insulation allow-list pair), `cladding` swaps that wall's finish family
  (stucco doubles the WRB per R703.7.3); the takeoff books batts by
  area per type+R and claddings per family. A config with no overrides, an
  empty map, or an object carrying only its construction (or explicit
  insulation 'none') computes members BYTE-EQUAL to today's. The write side
  stores the MINIMAL form: field writes merge into the object
  (engineeringOverride), construction flips preserve engineering fields and
  drop cmuHeightM off-CMU (constructionOverride), the CMU height slider
  keeps sibling fields (cmuHeightWrite), and a fields-less object collapses
  to the plain legacy string. Both Engineering surfaces resolve through ONE
  `selectedWallInfo` (per-wall recipe + 'per state code' defaults flags +
  code-min hint + dimensions readout + R302.6 garage-separation note).
  Gates: `src/framing/compute.test.ts` (plumb-through + byte-equal
  regression) + `src/engines/wall-framing.test.ts` (per-wall spec) +
  `src/engines/wall-layers.test.ts` (cladding/batt members) +
  `src/engines/interpenetration.test.ts` (batt SAT scenarios) +
  `src/engines/takeoff.test.ts` (batt/cladding rows) +
  `src/panel-selection.test.ts` (resolver + write helpers)
- **S7 Batts live INSIDE the layer cavity; misfit overrides warn.** Batt
  depth caps at min(stud depth, wall thickness − 1") — the cavity the layer
  stacks leave — with a member flag ('compressed … R derated', flag not
  label so takeoff rows keep their names) when the squeeze exceeds 1/4".
  Zone-less jurisdictions label batts with the SAME assumed-zone-4 R the
  panel hint prints (one fallback, both sides). An EXPLICIT studSize
  override deeper than thickness − 1" + 2mm (the SAT-skin rounding grace —
  the textbook 2x4-in-0.114m partition never warns) draws CAVITY-FIT
  (geometry compresses to thickness − 1", the batt rule extended to
  lumber via `fitAcross`; labels/size/takeoff/cut lengths stay nominal;
  members carry one aggregated 'compressed' flag per (size, thickness)
  class) and raises a compute warning + amber studsNote on both surfaces;
  defaults never WARN — they compress with the flag only. Gates: 0.15m zone-5 SAT case in
  `interpenetration.test.ts`, INTL parity in `wall-layers.test.ts`,
  misfit note/warning in `panel-selection.test.ts`.
- **S8 Colinear dedupe preserves the duplicates' OPENINGS.** When a twin
  is dropped, its openings project onto the kept centerline and merge
  (same-center+width dedupes, off-run projections skip) — studs/layers/
  batts/devices must never run through a doorway that only the dropped
  twin carried; the card's opening count includes merged ones. Kept-only
  walls stay reference-equal. Gates: `src/framing/compute.test.ts`
  (dedupe describe block).
  ZONE TWINS (same class, night-10): duplicate zones sharing a polygon
  (vertex-for-vertex within 1 cm, any start vertex / winding, same level)
  collapse to ONE room AT EXTRACTION (`extractRooms` — every consumer
  sees the deduped census, A4 parity). Tiebreak, stated: a CATEGORIZED
  name beats 'other' (engines key on category), then the LONGER trimmed
  name, then the smaller id; the dropped twin's boundaryWallIds union
  onto the kept room (the opening-merge mirror) and room ORDER stays
  scene order (circuit numbering is byte-pinned to it). compute warns
  'duplicate zone … merged (classified once, not twice)' — the twin used
  to make honesty warnings contradict the sheets (the demo's
  'Living / Kitchen' twin printed 'countertop receptacles … not modeled'
  while the other twin's counter run was drawn; B13's false-traveler
  root). Genuinely distinct zones (≥ 5 cm apart) never merge. Gates:
  `src/core/wall-model.test.ts` (zone-twin dedupe describe: tiebreak
  matrix, tolerance both directions, winding/rotation, wallId union,
  order pin), `src/framing/starter-template.test.ts` (false
  countertop-warning exhibit + real-two-kitchens keep).
- **S9 The Engineering cladding choice reads in BOTH render modes.** Every
  CLADDING_OPTIONS family emits ≥ 1 member (ROLE_OF covers veneer/lamina/
  foam/drainage) with a per-family X-ray color (label-matched, pairwise
  distinct, locked to the data file's material strings), and the panel
  writes the host wall's `slots.exterior` MaterialRef (library texture or
  minted flat scene material, kept id + colinear twins via paintIds) so
  solid mode changes too. Gates: `wall-layers.test.ts` (family members),
  `src/framing/cladding-colors.test.ts` (distinct colors),
  `src/framing/cladding-paint.test.ts` (paint plans).
- **S10 Roof members respect the wired span tables; splices never book
  silently.** data/framing-tables.json is LIVE: R802.4.1 rafter spans
  (horizontal projection, SPF #2) reach the spec as `rafterSpans`, swapped
  by ground-snow band in `applyJurisdiction` exactly beside the rafterSize
  bump (<50 psf → 20-psf-live table per its low-snow note, ≥50 → 50-psf);
  ceiling joists check R802.5.1(2) limited storage. Every shape verifies
  each slope plane's projection at LOD 300+: the GABLE gets the real fix —
  a purlin row (rafter stock, plumb on edge, its downhill top corner
  MEETING the rafter underside, stopped at the end rafters' inner faces)
  plus 2x4 struts ≤ 4 ft o.c. SNAPPED onto ceiling-joist lines, feet on
  the joist top face (assumed bearing, labeled — no floating struts), and
  its rafters read 'purlin-supported @ mid-span'; shapes with no modeled
  bearing below (shed / hip commons+kings / LONG jacks on their own
  bearing run / flat joists / gambrel planes / mansard+dutch skirts /
  valley jacks) flag instead. One-piece discipline: any spanning member
  beyond 20-ft stock flags its field splice (collar ties are tension —
  they always flag); continuously-supported members (ridge boards, flat
  rims, barges, purlins, fascia) NAME their splice bearing in the label
  AT 400 (fabrication data, the rafterCutData convention — the shipped
  default detail), so the takeoff's '20 ft stock (field splice)' rows are
  never silent where users live. Unknown sizes / LOD 200 stay unchecked;
  spacing between table columns snaps UP (conservative). Compact roofs —
  every plane and joist within its table — are BYTE-EQUAL to a
  tables-emptied spec at 300 and 400, and byte-equal to the SHIPPED
  master at 300 (at 400 the splice notes are the only delta on span-legal
  members longer than 20-ft stock).
  Origin: LOD-400 audit B2 (26.5-ft one-piece rafters ×40, 12 m ceiling
  joists, zero flags). Gates: `src/engines/roof-framing.spans.test.ts`
  (repro, matrix, S1 strut bearing, byte-equality, takeoff rows),
  `src/jurisdiction/profiles.test.ts` (band swap),
  `src/engines/interpenetration.test.ts` (purlin+strut SAT, reproGable).
- **S11 Wood in concrete contact is preservative-treated and says so.**
  A bottom plate bearing on the ground-level slab is a SOLE plate in
  direct concrete contact — IRC R317.1(2): it emits material `pt-lumber`
  with the cite in its label ('PT sole plate on slab (R317.1)'), books on
  the takeoff's own `<size> PT` SKU row (never blended into the untreated
  count), and the foundation's anchor-bolt row names it ('sole plate
  anchorage (R403.1.6)' — no mudsill member exists on slab-on-grade).
  ONLY the sole plate changes: studs, headers, top/cap plates bear on
  wood and stay untreated; upper storeys (plates on framed floors) and
  mixed CMU walls (framed zone on the PT seam sill, already booked)
  are byte-equal to pre-B5. `frameWalls` carries the context as
  `FrameWallsOptions.slabBearing` → `FrameHints.slabBearing`, forwarded
  from `computeLevelUncached`'s `isGroundLevel`.
  Origin: LOD-400 audit B5 (untreated lumber on concrete across every
  ground-level plate; 'mudsill anchorage' row named a member that isn't
  there). Byte-equality reset: docs/plans/B5-EXPECTED-DIFF.md (52-code
  sweep — only plate material+label and the enumerated takeoff rows
  moved). Gates: `src/engines/wall-framing.test.ts` (material pins,
  PT-swap isolation), `src/engines/takeoff.test.ts` (PT SKU row +
  conservation, anchor-row text pin),
  `src/framing/compute.multistorey.test.ts` (storey-0 vs storey-1 split),
  `src/engines/interpenetration.test.ts` (slab-on-grade compose).

- **S12 Anchorage is real: bolts clamp a plate that exists, and seismic
  stemwalls carry their top bar.** The foundation's R403.1.6 anchor-bolt
  layout runs per PLATE SECTION: the run splits at every door RO crossing
  the plate band [0, 1.5"] (the sole plate is interrupted there — a J-bolt
  inside a doorway anchors nothing) and every remaining section keeps its
  own layout — one bolt within 12" of EACH section end (the door jambs),
  never fewer than two per section, ≤ spacing o.c. SLIVER sections never
  crowd steel (skeptic round 1, F2): a section too short for two bolts at
  the R403.1.6 7-diameter edge distance (4-3/8" for the 5/8" J-bolt) plus
  a washer-clear 6" gap — under ~14-3/4" — takes ONE centered bolt, and
  below 2×7d_b (~8-3/4") NONE; either way the wall's footing carries
  'plate section too short for R403.1.6 layout — strap per detail,
  verify'. The old blanket ≥2 rule put third-point bolts ~2" apart on a
  corner sliver: 3" plate washers inside each other and inside the corner
  HDU. Windows (sill above the
  plate band) never split the plate; plate washers (R602.11.1) follow the
  section bolts one-for-one; stemwall verticals nudge clear of the ACTUAL
  emitted bolt layout. SDC D0–D2 stemwalls carry the R403.1.3.1 horizontal
  #4 within 12" of the TOP of the wall (2" cover, run mirrors the
  interlocked stemwall extent) in addition to the footing-bottom mat —
  AK's 34" stemwall used to have its nearest horizontal steel 38.8" below
  the top; non-seismic jurisdictions stay byte-equal. CMU-BASED walls
  (full-CMU and mixed knee walls) carry NO sole plate at the foundation
  top, so the whole sole-plate kit is off them — zero foundation anchor
  bolts, plate washers and HDU hold-downs (a J-bolt used to rise 3" into
  a block cell where no plate exists; an HDU body is wood-frame hardware
  inside the first course) — and their anchorage is the grouted-cell
  story instead: #5 foundation DOWELS rise from the footing mat 48d_b
  (30") past y = 0, one BESIDE every wall vertical (1" across-wall
  offset, same cell — cmu.ts `cmuDowelPositions` is the one layout truth
  compute feeds the foundation), replacing the generic 48"-grid stemwall
  verticals that never lapped the wall bars. The dowel top CAPS at the
  ZONE's bar top (`barTop`, bond-beam mid-height — skeptic round 1, F1):
  on a knee wall the CMU story can be shorter than the full lap, and a
  fixed 30" dowel punched through the PT seam sill, the framed zone's
  bottom plate and its studs; a capped dowel prints its TRUE overlap in
  the label ('laps CMU wall vertical 20"') and carries '#5 dowel lap
  short of 48d_b — hook into bond beam per detail, verify' — honesty
  over an invented full lap. Mixed walls keep their
  seam-sill bolts on the bond beam (cmu.ts) — on a CMU scene the ONLY
  'Anchor bolts' takeoff row is the seam sill's, and the dowels book on
  the Foundation rebar lf row. No new S1 allow-list pair: rebar×block /
  rebar×rebar / rebar×stemwall / rebar×footing already cover embedment
  and bar-to-bar laps. INTERIOR GIRDER POSTS BEAR ON PADS: the storey
  above's girder 4x4 posts land on the ground floor plane — compute
  derives their plan spots from the same floor-framing pass the upper
  storey renders (walls only sister joists, so the girder/post layout
  reproduces exactly) and the foundation pours a 24"×24"×12" pad footing
  (R403.1 sizing assumption labeled / R407.3 restraint advisory) under
  each, monolithic with the slab (top at y = 0 = the post's bearing
  seat, the interior-thickened-footing convention). The bearing test is
  the POST POINT, never the pad rectangle (skeptic round 1, F3 — the
  rect-overlap skip left a post whose pad merely GRAZED a band bearing on
  the bare 3-1/2" slab, silently): a post landing ON a poured band
  (perimeter/interior footing, stemwall, an earlier pad) bears on THAT
  concrete — never two pours in one volume; a post BESIDE one keeps its
  pad, SHRUNK centered in 1" steps (down to the 12" minimum — post +
  bearing edges) until it clears every pour, labeled at its true size
  with a 'clipped beside an adjacent pour' advisory; a post with no room
  for even the minimum pad flags the pour it abuts ('girder post bears
  without a pad footing — R403.1 pad does not fit beside this pour;
  verify detail'), loudly, never bare. Pads
  register as B17 carve bands so the slab field pours AROUND them, and
  they join the Foundation 'footings' yd³ row (S4). The POST itself now
  spans girder underside → the storey-below floor plane exactly (the old
  fixed storeyBelowHeight length over-ran the bearing plane by the
  girder depth — a 4x4 tail punched ~0.23 m through the slab).
  Origin: LOD-400 wave-2 audit B18 (a)+(b)+(c)+(d), 2026-08-20 (3 bolts
  booked installable inside a 16-ft garage door RO; dead per-section end
  rule; 'sole plate anchorage' J-bolts up into block cells; dowels never
  lapping the wall verticals; girder posts bearing on nothing) + skeptic
  round 1, 2026-08-21 (F1 knee-wall dowels through the seam wood; F2
  sliver sections crowding washers into each other and the HDU; F3 the
  grazing-pad silent skip).
  Gates: `src/engines/foundation.test.ts` (B18a describe: RO exclusion,
  per-section layout, window byte-equality, washer parity, vertical
  nudge, F2 sliver matrix — corner sliver zero bolts, twin-door middle,
  one-bolt section, flag pins, no-flag inverse; B18b describes: kit
  absence, dowel geometry/lap, per-wall interface, interior-CMU dowels,
  computeLevel FL scene truth + takeoff rows, F1 knee-through-compute —
  cap/label/flag + sill clearance + full-wall inverse; B18c describe:
  seismic top bar presence/position, INTL absence, AK/CA-vs-INTL profile
  matrix; B18d describe: pad geometry/label, slab carve, post-point
  bearing skip, coincident-post dedupe, LOD-350 gate, footings row
  growth, F3 matrix — clipped grazing pad, unfooted-flag repro,
  two-posts-0.5m both-on-concrete) + `src/engines/cmu.test.ts`
  (cmuDowelPositions layout matrix incl. mixed-zone insets + barTop
  formula pins) + `src/engines/interpenetration.test.ts` (B18b compose:
  foundation + blockwork SAT-clean, verticals all lapped, kit-absence
  pin; F1 knee compose at 0.61 m and 1-course seams — dowel×wood class
  dead; F2 sliver composes — zero washer×washer / washer×hold-down
  pairs; B18d two-storey compose: post-on-pad census, bearing plane
  y = 0, SAT-clean) + `src/engines/floor-framing.test.ts` (post
  bearing-plane pin) + `src/framing/compute.multistorey.test.ts` (B18d
  describe: end-to-end census, slab carve, takeoff rows,
  no-upper-storey and upper-storey exclusions). ON PAPER (examiner round
  1): the foundation legend's derived bolt spacing is the max gap WITHIN
  a plate section — a jamb-to-jamb hop across a door RO is a gap where no
  plate exists and never prints (the garage plan read '@ 17'-11.25" o.c.
  max'); cut REBAR prints OPEN (white fill, dark stroke, keyed 'open
  rects = cut rebar') so the B18c top bar never vanishes #222-on-#222
  inside the stemwall poché; pad footings key a derived legend row
  ('post pad 24"×24"×12" — under girder posts (R403.1/R407.3) — N pcs',
  one row per size incl. F3-clipped pads). Gates:
  `src/plans/plan-set.test.ts` ('B18 paper round' describe: per-section
  legend max on the garage-CA compose + RO-hop exclusion + legacy
  no-walls fallback, open cut-bar rect + caption key, pad rows per
  size).

- **S13 Wall bracing is declared and cross-tied, never silently absent
  (R602.10).** Every framed level at LOD 300+ identifies its braced wall
  LINES from the exterior wall graph (dominant plan axis, walls within the
  R602.10.1.1 4-ft offset on one line, deterministic X1…/Z1… labels by
  ascending offset) and declares the METHOD from
  `spec.wallBracingMethod` ('CS-WSP' — the continuously-sheathed assembly
  the layer engine already builds on every exterior face) with ONE honest
  per-line warning: R602.10 panel length/spacing NOT verified — the
  required-bracing-amount and Table R602.10.5 panel-schedule math is v2,
  and nothing claims compliance meanwhile. CMU walls brace as reinforced
  masonry (cmu.ts) and stay out of the lines; LOD 200 makes no code
  claims. GARAGE RETURNS: a wide opening (clear RO span ≥ 6 ft — where
  R602.10.6.4's CS-PF header-span range starts, == DOUBLE_TRIMMER_SPAN)
  whose return to the run end is under the 48" braced-panel minimum
  (Table R602.10.5 WSP baseline) is NEVER framed as plain kings+trimmers
  silently. SDC D+ (`spec.seismicHoldDowns`) builds the CS-PF portal set
  when the return meets the Table R602.10.5 CS-PF minimum (16"/18"/20"
  at 8/9/10-ft walls, snapped UP): hold-down end posts as DOUBLED studs
  (role 'post', one beside the king stud, one beside the run-end stud;
  grid studs yield by keep-out — contact allowed, overlap never; posts
  slide off California backing studs, and a return too congested flags
  instead of guessing) plus the 1000-lb header-to-jack strap (role
  'strap', ~1.2 mm surface steel on the framing face under the 2 mm SAT
  skin; its advisory says it is SYMBOLIC surface hardware — it mounts on
  the −v framing face regardless of exterior side, installed per the
  Figure R602.10.6.4 nail schedule — and names what v1 does not model:
  CS-PF panel nailing, header continuation to the wall end). The method
  has a DOMAIN (skeptic round 1): CS-PF ends at 10-ft wall height
  (Figure R602.10.6.4 max; the table column stops at 20" @ 10 ft) —
  `portalMinPanelWidth` returns null past `PORTAL_MAX_WALL_HEIGHT` and a
  taller SDC-D wall flags '⚠ … exceeds the 10 ft CS-PF maximum height',
  NEVER extrapolated hardware (an unflagged portal outside the table is
  an implicit compliance claim); under a SECOND storey the minimum
  widens to 24" (first-of-two-storeys column), plumbed from compute's
  level list (`FrameWallsOptions.storeyAbove` → `FrameHints.storeyAbove`
  — a slabbed level above is a storey, an attic is not); standalone
  callers without the hint ASSUME single-storey and the strap advisory
  says so. A return under the applicable CS-PF minimum flags '⚠ portal
  frame required — not modeled … engineered shear wall required';
  low-seismic jurisdictions flag the same returns (Table R602.10.5 +
  R602.10.6.4 cites) instead of inventing hardware; inter-opening piers
  say 'bracing between adjacent openings not evaluated (v1)'. Bracing
  flags COMPOSE with the wall's aggregate compression flag (B1 ' | '
  convention) and NAME their wall ('wall w_s: …' — examiner round 1) so
  a printed flag locates its geometry. CROSS-REFERENCE (both
  directions, ground level with walls + foundation both computed): a
  foundation HDU with no framed vertical within 0.15 m (a corner HDU
  matches the orthogonal wall's end stud — one corner assembly) flags
  'hold-down has no framed post above'; a portal post with no HDU below
  flags 'portal post has no foundation hold-down below' — the foundation
  places HDUs at wall ENDS only, so the opening-side portal posts flag
  BY DESIGN until per-panel hold-downs land. TAKEOFF (B4 convention):
  'Portal straps 1000 lb' books by role count with no invented nail
  poundage; posts ride the ordinary lumber rows; every bracing flag
  aggregates on Flags. JURISDICTION TRUTH: the CA-vs-INTL STRUCTURAL
  wall-member delta is EXACTLY the bracing content (portal hardware +
  R602.10 flag parts + grid studs yielded to post keep-outs) — layers
  legitimately differ by jurisdiction pre-B9 and are excluded; the
  SDC-D set (AK/CA/HI/NV/OR/UT/WA today) builds hardware, every other
  framed state flags, FL's CMU default builds neither, and no state
  throws or stays silent on a 16-ft garage door.
  Origin: LOD-400 audit B9, 2026-08-20 (CA SDC-D structural wall members
  byte-identical to INTL; 16-ft garage door returns framed as plain
  kings+trimmers — prescriptively a portal frame — with zero hardware
  and zero label; the only bracing artifact repo-wide was the
  foundation's honestly-labeled SDC-D hold-downs).
  Gates: `src/engines/wall-bracing.test.ts` (line identification incl.
  4-ft split + exclusions, warning pin, LOD-200 silence, CS-PF minimum
  matrix + null-past-10-ft domain pins, jurisdiction-truth describe with
  the enumerated CA-vs-INTL delta, 51-state sweep, cross-reference
  describe both directions + toggle honesty, two-storey plumb-through
  describe: 24"-min flag under a slabbed level above + no assumption
  clause when compute passes known context) +
  `src/engines/wall-framing.test.ts` (garage-returns describe: portal
  census, contact matrix, surface-strap pin, INTL flag pin, ⚠
  too-narrow, 48"-panel no-op, out-of-scope, pier flag; CS-PF domain
  describe: 11-ft SDC-D exhibit → flag + ZERO hardware, 10-ft boundary
  portals; first-of-two-storeys describe: 19.6" return portal/flag by
  storey context, >24" portals under a second storey, single-storey
  assumption stated-when-unknown/silent-when-known, wall-id flag pin) +
  `src/engines/interpenetration.test.ts` (SDC-D garage compose:
  walls+layers strictly clean; +foundation inherits only the named
  pre-existing classes) + `src/engines/takeoff.test.ts` (B9 describe:
  strap-row parity, lumber piece delta == member delta, flag
  aggregation, hold-down row parity).

- **S14 Header sizing follows the ground-snow band; low snow stays
  byte-equal (Table R602.7(1)).** `applyJurisdiction` selects the
  spec's `headerRules` from the profile's ground snow load exactly beside
  the rafter band swap: IRC 2021 Table R602.7(1) tabulates header spans at
  30/50/70-psf columns and the band SNAPS UP (a column may not serve loads
  above it; footnote e makes 30 psf the low-snow default) — ≤ 30 psf reads
  the shipped default rules (REFERENCE-identical, so INTL/TX/CA/FL members,
  takeoff and paper stay byte-equal to master, E5 baseline included),
  30–50 the 50-psf column, above 50 the 70-psf column; past 70 psf the
  assumption confesses 'engineered design required'. Band thresholds are
  DERIVED from the encoded table cells (roof-and-ceiling condition, 2-ply
  rows ≙ solid 4x, 24-ft width column: 50-psf → 4x10 cap 71"; 70-psf →
  4x8 cap 53", 4x10 cap 63") clamped at the default's rounding — heavier
  snow never prints a shallower header, and no threshold exceeds the code
  cell — INCLUDING the terminal rule (round 2, skeptic): the band caps
  `engineeredHeaderSpan` at its 2-2x12 cell (83" @ 50 psf / 74" @ 70), so
  a past-cap span routes to the ENGINEERED path (supplier SKU +
  'ENGINEERED BEAM REQUIRED' flag) and the open-ended 4x12 rule never
  claims the table outside its domain; low-snow keeps the shipped 10-ft
  threshold (its labels make no table claim — pre-existing gap, out of
  scope). The table also keys on BUILDING WIDTH, which the spec does not
  carry: every band-sized header states the assumption on its label
  ('… — sized per Table R602.7(1) @ 70 psf ground snow — ≤ 24 ft building
  width, roof-and-ceiling loading assumed'), engineered headers included —
  label, never a guess; low-snow labels carry nothing. The assumption
  reaches PAPER too (round 2, examiner): deepened states' covers print it
  as a DESIGN CRITERIA line (PlanSetOptions.headerAssumption ←
  spec.headerAssumption via panel.tsx) — low-snow sheet sets stay
  byte-equal to paper built without the option. Downstream mirrors
  move ONLY in the deepened states (50-band: AK ID MA MN MT ND NY SD UT
  WI WY; 70-band: ME NH VT — docs/plans/B11-EXPECTED-DIFF.md): the takeoff
  header stick shifts SKU, the B21d schedule cell prints the new size
  (size verbatim — the label never leaks into the cell), cripples
  re-derive above a resized stick; B9's bracing keys on RO spans + seismic
  flags and is untouched everywhere.
  Origin: LOD-400 audit BATCH 11 (2026-08-20) — VT (60 psf) headers
  byte-equal to INTL; DEFAULT_SPEC.headerRules was the last static
  prescriptive wall table.
  Gates: `src/jurisdiction/profiles.test.ts` (band identity pins incl.
  low-snow reference equality, threshold encodings, headerFor
  plumb-through, assumption matrix, 51-state sweep with the deepened set
  enumerated, r2 cap identity/value pins) +
  `src/engines/wall-framing.test.ts` 'LOD-400 B11' describe (per-span
  deepening matrix VT/MN vs INTL incl. the 53" boundary, honest
  full-depth geometry, exact label pins, engineered-label composition,
  low-snow member byte-equality, spec↔band purity, r2 past-cap exhibit —
  76"/90"/110" engineered at VT / pre-B11 lumber at INTL, 74"/83"
  boundaries prescriptive) + `src/plans/plan-set.test.ts` (B11
  schedule-cell pin + TX≡INTL paper + r2 cover DESIGN-CRITERIA pins with
  the without-option byte-equality) + `src/engines/takeoff.test.ts` (B11
  SKU shift + low-snow row pins + r2 supplier-line routing).
- **S15 Every hip-family roof carries its thrust path.** A hip, mansard or
  dutch segment models the R802.4.2 rafter ties the gable/gambrel always
  had: ceiling joists at `ceilingJoistSpacing` o.c. span the SHORT
  footprint axis at the eave line — labels cite R802.4.2 at every LOD,
  span discipline rides the S10 `ceilingJoistFlag` (R802.5.1(2)), LOD 200
  keeps the schematic full box — and the hip's ridge portion carries 2x4
  collar ties in the upper third on every other common pair, labeled
  'upper third (R802.4.6)' (tension members flag past 20-ft stock, S10).
  Mansard/dutch model the MAIN ceiling under the skirts and inherit the
  upper thrust story from their inner shapes (hip crown joists + R802.4.6
  ties when steep enough; the dutch gablet's gable machinery). GEOMETRY
  DISCIPLINE: joists sister BESIDE every parallel rafter plane (commons,
  side-plane jacks, skirt rafters — snapped toward the center, snapped
  pairs deduped: two stations beside one jack once emitted twin joists in
  one volume at 25°), ends inscribe inside the B6 field clip so nothing
  pokes the deck riding the rafter tops, and the station band stops where
  the END planes' rafter undersides / hip boxes / arris hips descend to
  joist-top height — and that gap PRINTS (fix round F1, the B6 stated-gap
  class): at 400 every hip/skirt ceiling joist carries the end-plane
  statement flag ('… rafter ties parallel to the end-plane/end-face span
  + end-triangle stub joists not modeled … verify tie detail
  (R802.4.2)'), COMPOSED ' | ' onto whatever over-span honesty the joist
  already carries (M2 rule — never masked), reaching the takeoff Flags
  rows and the P4 schedules block; the hip wording's parenthetical
  ('collar ties ride the ridge portion only') subsumes the near-square
  zero-tie case; 300 stays quiet (the shed-drip convention). The mansard
  CROWN's joists bear on nothing modeled at their ends — their labels
  append '(assumed bearing at skirt top — verify)' (the purlin-strut
  convention; the dutch gablet ships the same class from the gable
  machinery, pre-existing). HONESTY GUARDS: a near-flat hip
  crown whose ridge-board underside descends into the joist band emits no
  joists (an inner mansard crown computes ~5° from the host ratios); a
  degenerate skirt whose planes never rise clear emits no ceiling frame;
  near-square hips (no real ridge portion) carry no collar ties — all
  pinned. SQUARE-HIP APEX (NIGHT-10 residual closed): with NO ridge board
  (width == depth, incl. the square mansard crown) the hips' top cuts bear
  on the apex COMMON pair — layout()'s guaranteed end station parks that
  pair OFF-CENTER (u = ridgeHalf − t/2, box overhanging one thickness past
  the negative ridge end), so the two hips facing the overhung side trim
  past the pair's FAR face (√2·overhang/cos(tilt) extra slope inset, the
  exact mirror of the opposite hips' clearance); the extra derives from
  the ACTUAL commons-box overhang, which is zero whenever a ridge board
  exists — rectangular hips byte-identical by construction. The square-hip
  compose joins the interpenetration matrix. SCOPE NOTE: windy SLOPED
  roofs carry a distinct pre-existing class (tieAt centers the steel ON
  the rafter station at every gable/shed/hip bearing — only FLAT got
  B8b's beside-the-joist fix); board-queued, not this residual's class.
  BLAST RADIUS: gable/shed/flat/gambrel/valley outputs are pinned
  byte-equal to master 779d70e by sha256 hash across 200/300/400 + windy;
  the E5 baseline scene has no roof segments (recapture byte-identical) —
  the hip-roofed computeLevel compose carries the end-to-end truth. The
  takeoff rides EXISTING rows only: joists/ties book on the Roof lumber
  pcs rows and the fastening schedule's shipped 10d rows (S4, no invented
  rows).
  Origin: LOD-400 audit BATCH 7 (2026-08-20) — hip 10×12 @40° emitted 12
  commons + 4 hips + 64 jacks + 76 hurricane ties and ZERO
  ceiling-joist/rafter-tie/collar-tie members: a non-structural ridge
  board with unresisted thrust and no ceiling frame for the storey below;
  mansard/dutch shared the core gap.
  Gates: `src/engines/roof-framing.test.ts` (B7a describe: audit-repro
  census vs span/spacing + band bound, clip-pinned length + short-axis
  orientation, R802.4.2/R802.5.1 label+flag pins, besideRafter
  separation, alongX variant, LOD-200 pins, compact flag-free case, 25°
  station-collapse repro; B7b describe: every-other-common count +
  upper-third height + ridge-portion band + R802.4.6 pins, endpoint
  reconstruction ON the slope planes, near-square zero pin, 20-ft
  tension-splice flag, S4 takeoff parity; B7c describe: mansard/dutch
  band/clip/label/flag census, inner-story + steep-crown ties +
  flat-crown zero pin, orientation, 3° degenerate zero pin, LOD-200 pin;
  blast-radius describe: 12 sha256 hash pins; fix-round describe:
  end-plane statement + ' | ' composition pins, near-square subsumption,
  skirt-face statement both shapes, Flags-row quantity == joist census,
  300-quiet + whole-flag pins, crown assumed-bearing label + main-joist
  exclusion; NIGHT-10 square-hip apex describe: no-ridge + pair-station
  pin, per-side inset/length/top pins with far-face clearance + exact
  corners, rect-hip equal-inset byte guard) +
  `src/engines/interpenetration.test.ts` (B7 matrix: hip audit repro /
  25–75° sweep / wide + z-span variants / mansard 25–55 / dutch 25–70 —
  compose SAT-clean at 400, non-vacuous joist presence; NIGHT-10 square
  matrix: 8/6/10-steep/10-shallow squares + near-square sliver + square
  mansard crown, non-vacuous hips + commons) +
  `src/framing/compute.multistorey.test.ts` (B7 describe: hip-roofed
  storey composes joists + ties end-to-end incl. the Roof lumber rows) +
  `src/engines/roof-framing.spans.test.ts` (compact hip-family cases
  carry cj-legal depths; the default 8×6 hip honestly flags its 6 m
  one-piece joists).

- **S16 The high-wind uplift path continues past the roof ties — or says
  it can't (R802.11, R301.2.1/WFCM).** ≥ 130 mph design wind
  (`spec.highWindUplift`, set by `applyJurisdiction` from the data's own
  highWind overlay trigger `ultimateWindMph >= 130 && flags.hurricaneTies`
  — DELIBERATELY narrower than `hurricaneTies`, whose sub-130 coastal
  belt keeps roof ties with byte-equal walls — and since NIGHT-10 those
  ties STATE the scope themselves: every belt tie is labeled 'hurricane
  tie (roof-to-wall ties only — wall/foundation uplift path not modeled
  below 130 mph design wind)', ≥130 ties keep the plain label because the
  wall hardware IS the continuation; the belt is derived from the
  profiles data and PINNED as exactly 12 states (AL CT DE GA MA MS NC NJ
  NY RI SC TX vs FL HI LA full-path), geometry proven label-only by
  strip-equality per tying shape, takeoff row-count/detail unchanged
  (role-counted), label-not-flag (no Flags row), INTL tie-less byte-equal
  — docs/plans/B10-EXPECTED-DIFF.md NIGHT-10 addendum) every framed
  EXTERIOR wall books the continuation as S13 surface hardware (1.2 mm
  symbolic steel on the framing face under the SAT skin, honest 'install
  per strapping schedule' labels, WFCM capacity/nailing stated as not
  modeled): (a) ONE `uplift-connector` at every full-height vertical's
  top (grid studs / kings / portal posts / corner backing — the wall-side
  mirror of the roof's per-rafter `tieAt`; coverage = the stud rhythm,
  stated on the buy row); co-planar surface steel never shares a drawn
  spot — a taken spot (HI: seismic AND high-wind puts B9's portal strap
  on the exact king) side-steps via a deterministic ±1..3 strap-width
  dodge ladder over a y-aware surface registry; (b) one `uplift-strap`
  per opening side at the INNERMOST TRIMMER line (the stick the header
  bears on — never B9's king line), lapping header + jack; (c)
  `foundation-strap`s at 48" o.c. along SLAB-BEARING plates (ends
  covered, door ROs skipped — a strap in a doorway anchors nothing, the
  S12 lesson), DEDUPED by compute where a foundation R403.1.6 J-bolt/HDU
  already anchors within the 0.3 m (~12") window — one anchorage point, one
  booking (the bolt is the modeled hardware and wins; HI's 4-ft seismic
  bolt spacing visibly wins more spots than LA's 6-ft); a walls-only
  result keeps the full ladder (toggle honesty, B9c). Interior
  partitions, LOD 200, upper storeys' plates (no slab bearing) and
  CMU-default walls (FL — masonry anchorage is the B18b grouted-cell
  story) book nothing. THE FLAT-ROOF SEAM IS CLOSED (B8b landed the
  roof side — S17b pins ties present AND this warning absent on the
  windy-LA flat compose); the GUARD remains for any future tie-less
  shape: connectors under a roof framing
  rafters with ZERO steel ties raise exactly one level WARNING per such
  roof, naming it ('…R802.11 uplift path incomplete at the roof bearing,
  verify tie schedule' — P4 prints it); tied roofs, roofless results and
  other-storey roofs stay silent (machinery non-vacuous via the
  synthetic-member matrix). NIGHT-10 (residual 4): the warning's
  parenthetical states the generic truth — 'this roof models no tie
  members at its bearing' — the old 'flat roofs model no rafter/plate
  ties today' claim was stale once B8b landed flat ties; new wording
  pinned, stale wording banned (B10d gate). TAKEOFF (B4/S4 both directions): three
  dedicated member-derived rows counted by ROLE (three new roles — B9's
  `strap` census untouched), the foundation row stating the dedupe
  convention, NO invented nail poundage (B9's fastener rule).
  JURISDICTION TRUTH: the LA/HI-vs-INTL wall delta is EXACTLY the uplift
  set (stripping the three roles → byte-equal, order included); INTL +
  49 states incl. TX and FL byte-equal to master everywhere
  (docs/plans/B10-EXPECTED-DIFF.md — 52-code × 3-scene sweep PASS); E5
  baseline recaptured byte-identical.
  Origin: LOD-400 audit BATCH 10 (2026-08-20) — LA walls byte-identical
  to INTL; `hurricaneTies` consumed ONLY by roof-framing; the only
  acknowledgment a disclaimer buried in data/fastening-schedule.json.
  Gates: `src/engines/wall-framing.uplift.test.ts` (LA census 1:1 with
  verticals + exact-placement floor, strap line/envelope pins,
  foundation ladder spacing incl. the crossing-gap bound, dedupe matrix
  incl. seam-sill exclusion + compute-level bolt-layout proof with the
  walls-only strictly-more pin, flat/gable/INTL warning matrix naming
  the roof, TX/INTL byte-equality pins, 51-state sweep with the derived
  uplift set + FL framed-override inverse) + `src/engines/takeoff.test.ts`
  B10 describe (row==role both directions, LA-delta-is-exactly-three-rows,
  HI dual-family census split) + `src/engines/interpenetration.test.ts`
  B10 describe (LA walls+layers BOTH faces strictly clean with NO uplift
  allow-list pair; +foundation post-dedupe inherits only the documented
  bolt-shank class; HI portal+uplift coexistence). All mutation-checked
  (17 probes across B10a-e). NIGHT-10 belt-label gates:
  `src/engines/roof-framing.test.ts` belt describe (exact clause on every
  tie × 7 tying shapes, ≥130 plain, strip-equality label-only proof,
  12-state derived enumeration pin + per-state labels + INTL byte pin,
  takeoff row parity + no-Flags-row pin; gable-400-windy sha REPINNED —
  the pin's spec is the belt).

- **S17 Roof shape closures (B8): low-slope ridges, flat-roof uplift,
  unframed intersections and the gambrel break are never silent.**
  (a) A ridge below 3:12 is NOT upgraded to a beam silently and NOT
  accepted silently: the ridge member carries 'ridge slope < 3:12 — ridge
  beam required, R802.4.3 (…not modeled — verify design)' at 300+, reaching
  the takeoff Flags row and the P4 schedules block (flag route, v1 — the
  beam+post member set is the follow-up). The slope that answers the
  question is the one CARRYING the ridge: the gable's schema pitch, the
  GAMBREL main ridge's shallow UPPER planes' φ (fix-round advisory —
  a 15° gambrel composes sub-3:12 uppers while its steep lowers sit above
  3:12; flagged + pinned, break purlins excluded), and — NIGHT-10, B8a's
  stated residual closed — the HIP ridge's long-plane commons' pitch (=
  schema pitch) with the MANSARD CROWN riding the same route via the inner
  frameHip at its COMPUTED crown pitch (sub-3:12 even on the default 40°
  mansard, tan ≈ 0.154 from the host ratios — the default mansard now
  states it; the compact-mansard spans gate carves the statement out as
  shape honesty, table-independent) and the DUTCH GABLET served by the
  gable route at its computed pitch (pre-existing coverage, now pinned).
  A SQUARE sub-3:12 hip converges to a point — no ridge board exists, so
  nothing for R802.4.3 to govern (pinned). Slopes ≥ 3:12 and LOD 200 are
  byte-equal to pre-B8 (hip 3:12 boundary + default 40° hip + 55° mansard
  crown pinned clean; moved shapes = sub-3:12 hip 300/400 + default
  mansard crown only).
  (b) `spec.hurricaneTies` reaches FLAT roofs (R802.11 — shed tied both
  ends, frameFlat never called tieAt): every flat joist ties at BOTH
  bearing ends, at the plate line (footprint edge, never the overhung rim
  line) on the joist underside plane. The connector nails to the joist
  FACE, and the offset direction resolves PER STATION (fix round, skeptic
  F1): toward center first, flipped outward when any station sits inside
  the clearance window (tieClear + tie half + t/2 — layout()'s guaranteed
  END station can survive one joist thickness from its grid neighbor,
  ~12% of widths per spacing period; the old fixed offset drove 1.5"
  steel through the neighbor joist and overlapped the two end-side ties),
  and a station blocked BOTH ways (the end joist butts the rim band)
  OMITS its ties and says so ON the joist, composed ' | ' onto its span
  honesty (M2) and printed via the Flags row — steel through lumber is
  never an option, silence isn't either. Rim inner-face clamps hold every
  placed tie SAT-clean against joists and rims (zero-overhang and
  end-gap-window geometries included) — and the takeoff books the ties
  for free (role+material+system). Non-windy flat is byte-equal to pre-B8
  (the flat-400 sha pin holds it). SEAM CLOSED (B10, wall side): the
  windy-LA flat compose carries ties at every joist bearing, so B10's
  'R802.11 uplift path incomplete at the roof bearing' warning dies BY
  CONSTRUCTION — pinned end-to-end (ties present AND warning absent);
  B10's warning machinery stays non-vacuous via its synthetic-member
  matrix.
  (c) An overlapping roof-segment pair the valley detector does NOT serve
  (a hip wing into a gable main; skewed/parallel/buried/eave-mismatched
  gable pairs) NEVER frames straight through silently:
  `detectUnframedRoofIntersections` (2D OBB SAT on the yawed footprints,
  ≥ 5 cm real penetration + vertical-envelope interleave) raises one
  computeLevel warning per pair — 'roof intersection not framed — valley
  detail required (…)' — printed verbatim in the P4 schedules flag block.
  Served gable×gable pairs stay quiet (their members ARE the answer);
  touching/grazing neighbors and vertically separated stacks never warn;
  LOD 200 makes no code claims (valleys aren't framed there either). Full
  hip-plane valley FRAMING stays out of scope — v1 is the printed warning.
  Members are untouched — the valley sha pin holds.
  (d) The gambrel break purlins carry their R802.5.1 support: 2x4 struts
  ≤ 4 ft o.c. drop from each purlin's underside to the ceiling joists
  (stations SNAP onto real joist lines — the gable purlin-fix convention,
  no floating struts, assumption labeled), the purlin's 400 splice note
  names 'struts' as its bearing, and a break too low for a real strut
  FLAGS the purlin ('gambrel break purlin unsupported … R802.5.1')
  instead of bearing on air — members preferred, honesty as fallback;
  struts are SHAPE geometry (table-independent, present on compact
  gambrels — the compact byte-equal gate enumerates them). The gambrel
  ends carry frameGable's rake ladder, ported per PLANE: dropped end
  rafters (olT along each plane's normal), 8 barges (4 steep + 4
  shallow), per-plane outlooker ladders off the ACTUAL xs positions, the
  deck widened past the barges, and rake drip edge on all 8 rake runs at
  400 — which RETIRES the B6 F4 rake-metal deck flag honestly (real
  members, not stale prose; sub-MIN_RAKE_OVERHANG follows the gable
  convention: sheathing cantilevers, no ladder, no flag). LOD 200 keeps
  the schematic shape. INTENDED pin move: gambrel-400 repinned for B8d
  alone; gable/shed/flat/valley/windy pins hold master bytes.
  Origin: LOD-400 audit BATCH 8 (2026-08-20) — frameGable accepted a plain
  ridge board at 2.5:12; frameFlat never called tieAt while shed tied both
  ends; a hip wing into a gable main framed straight through with no
  members AND no warning; the 9 m gambrel break purlins carried every
  rafter joint with zero struts and the gambrel gable ends had no rake
  framing despite the overhang.
  Gates: `src/engines/roof-framing.test.ts` (B8a describe: 2.5:12 flag pin
  at 300/400 + ridge-only placement, 3:12 boundary + 40° clean, LOD-200
  silence, takeoff Flags row, 15°-gambrel upper-plane flag + 40° clean;
  NIGHT-10 hip/crown tests: 10° hip ridge-only flag at 300/400, hip 3:12
  boundary + 40° clean + 200 silent + square-no-ridge pin, default-mansard
  crown flag + 55° clean, sub-3:12 dutch gablet pin, hip+mansard takeoff
  Flags rows; `roof-framing.spans.test.ts` compact-mansard INTENDED
  carve-out with the crown-flag non-vacuous pin;
  B8b describe: windy 2-per-joist census at the
  plate line + beside-a-joist placement, spansX orientation, free takeoff
  tie row, non-windy byte-equality, fix-round window matrix — 6.9×5
  omit+compose+clearance+Flags row, 2×2-zero whole-flag pin; B8c describe: hip-wing audit exhibit
  zero-members + warning, served-pair silence, parallel/buried/eave-
  mismatch matrix, abut/graze silence, cupola stacking, three-wing mix;
  B8d describe: strut census/foot-on-joist/top-at-purlin/snap pins,
  ≤4ft-o.c. spacing discipline, purlin splice-note + flag-free pin, rake
  census with dropped-end deltas + roll pins, 8 rake-drip runs at barge
  lengths + flush edge, 10° no-bearing fallback flag + Flags row, LOD-200
  schematic pin, S4 2x4-row parity; F4-retirement pin in the B6 fix-round
  describe; gambrel-400 INTENDED repin with per-shape enumeration) +
  `src/engines/interpenetration.test.ts` (B8b windy-flat compose matrix
  incl. zero overhang + the end-gap-window pair 6.9×5 / 2×2-zero,
  non-vacuous; B8d gambrel compose matrix 25/40/60°
  + wide, struts/ladder/drip non-vacuous) +
  `src/framing/compute.multistorey.test.ts` (B8c describe: hip-wing scene
  warns end-to-end + no valley members, LOD-200 silence) +
  `src/engines/roof-framing.spans.test.ts` (compact gambrel byte-equal
  gate enumerates the break struts as shape geometry) +
  `src/engines/wall-framing.uplift.test.ts` (the B10 compose pin flipped
  to the CLOSED seam: LA flat ties 2-per-joist end-to-end AND the roof-
  bearing warning absent; INTL stays tie-less and silent).

- **S18 The LGS honesty chain: steel claims only what the catalog and
  the code research verify — everything else states its basis.**
  (a) Every steel member label carries a designator that EXISTS in
  data/lgs-profiles.json (exact-token parse, no invented '-HD' variants,
  no invented weights on labels or rows — takeoff books length +
  'weight requires vendor data'); printed grade re-derives from the
  catalog's yieldKsi per row (S230 A4.4: 33/43 → Gr 33, 54/68 → Gr 50),
  never a constant. (b) NO R603.3.2 table cell is encoded: conservative
  picks (thickest table-domain variant) state 'conservative: R603.3.2
  table cell unverified' on EVERY role's label (studs, kings, jacks,
  cripples, headers, tracks, sills, backing-stud) plus a level warning;
  the bridging channel states its own only-catalog-variant truth.
  (c) profileFor's fallback chain order is gated: verified machine roll
  → vendor-own profile with the dims-delta note ON the label (grade
  'per vendor spec', never inherited from the nearest generic) → generic
  + loud 'unverified — generic AISI fallback' → 'engineered design
  required'; unverified machines can claim NO rollable rows (data-shape
  gate + code guard, both legs pinned). (d) Steel walls carry the
  energy-code truth wherever the cavity-R + IECC cite prints, at every
  LOD: '— wood-frame prescriptive; steel-frame walls take R402.2.6/
  N1102.2.6, not evaluated' rides insulation.citation itself; lumber
  scenes never carry it (both leak directions gated). (e) R603.3.3
  strap bracing is NEVER silently absent: CMU-junction trims that drop
  a span or a whole run raise a per-wall warning with the unbraced
  extent (P4 prints it); trim attribution never claims CMU for a pure
  length clamp; the oblique-stem band widens by |z|·cotθ so straps
  never bore grouted cells (band domain = detectTees tees, sinθ ≥ 0.3
  — sub-17.5° crossings stay in the documented S1 junction-residual
  family, straps included). (f) The LOD ladder claims only what each
  rung does: 200 = generic 33-mil, ZERO R603 cites on labels/warnings;
  300 = conservative + straps; 400 = + punchout metadata (S240 A5.9,
  never drawn as holes). Existing framed/cmu corpora and the E5
  baseline stay byte-identical — steel is a new-input class only.
  Gates: src/engines/lgs-wall-framing.test.ts (label sweeps, basis-off
  + grade-flip + qualifier-off mutant kills, drop-warning exhibits),
  src/engines/lgs-profiles.test.ts (chain + citation gates),
  src/engines/interpenetration.test.ts (round-3 F2 oblique SAT),
  src/engines/takeoff.test.ts (zero-nail steel + grade rows).

## M — Mechanical (HVAC)

- **M1 Ducts never cross plate bands; interior storeys route in soffits.**
  No duct-run member OBB enters any wall's top-plate band
  [wall.height − topPlateBandM, wall.height] (IRC R602.6 — a duct never fits
  the plate boring limits). Top storeys run the trunk at ATTIC elevation
  above the tallest plate (M1601) with ceiling-boot registers whose grille
  hangs just BELOW the ceiling plane (visible from inside, like a light);
  storeys with a WALLED storey above have no attic — the trunk caps below
  the ceiling as a dropped-soffit run and the level warns
  ('interior-storey ducts run in soffits/floor webs — verify'). Exhaust
  runs exit through stud bays below the LOWEST wall along their path (the
  exit wall's own height governs, not the room ceiling); register drop
  points are area centroids nudged inside the room and off every wall band
  (concave/L rooms).
  Origin: prod report + skeptic round 2026-08-16 (short exit wall, L-room
  register in the wall, ground-storey trunk inside the storey above,
  invisible grilles).
  Gates: `src/engines/hvac.plates.test.ts` +
  `src/framing/compute.multistorey.test.ts` (M1 soffit storey)
- **M2 The AC condenser row is sized, placed and booked honestly.** ONE
  system tonnage (IRC M1401.3 — equipment per ACCA Manual S from Manual J
  loads) sizes the air handler, the duct cfm, the return grille AND the
  condenser row: the MANUAL-J-LITE v1 sensible load (src/engines/manual-j.ts
  — envelope UA at prescriptive R including the ceiling × per-zone
  ASHRAE/ACCA-style design ΔT + per-orientation glazing solar × assumed
  SHGC 0.30 + Manual-J internal gains at bedrooms+1 occupancy + ACH-0.35
  infiltration over the conditioned volume, then a COARSE LATENT
  ALLOWANCE by the zone's IECC moisture-regime letter — A humid ×1.25 /
  B dry ×1.05 / C marine ×1.10, bare-digit zones ×1.0 and say so (the
  four terms are sensible-only; a humid-zone selection sat a half ton
  short IN band with the confession buried in a docstring — skeptic F1);
  every constant cited in data/mep-rules.json hvac.manualJLite, every
  fixture label carries the basis AND the composition — 'Manual J-lite,
  zone 2A design 35°C, 2.62 t sensible × 1.25 latent (regime A)' — and
  'verify local design conditions' + 'full Manual J latent calculation
  governs' ride the notes), selected in half-ton steps within the
  Manual S 95–115% band (an out-of-band selection — stock steps, the
  1.5-ton floor — warns, never silent). The band is checked on the
  INSTALLED SUM too (skeptic F2): the ≤5-ton split rounds each unit to a
  stock half ton, so count × unitTons can leave the band the plan total
  passed — the overrun warns with a one-decimal percent ('installed
  6 tons = 118.1% of the 5.08-ton load — exceeds the Manual S 115%
  band…'), and the AIR HANDLER reconciles to the installed figure (its
  drawn coil serves the cabinets that exist: label/cfm/grille read
  6 ton beside 2 × 3-ton cabinets, never 5.5) with the plan-vs-installed
  distinction stated on its label ('2 × 3 t installed vs 5.5 t
  selected') and meta.selectedTons carrying the Manual S selection when
  the two differ. FALLBACK, stated ON THE LABEL:
  unknown climate zone (INTL/unset) / no straight exterior envelope / no
  conditioned volume → the labeled sqft rule (1 ton per 450/550/650 sqft
  by IECC zone band 1-2/3-4/5+, 'Manual J-lite fallback: <trigger>'); LOD
  never gates the load (walls/rooms exist at every LOD). One condenser per
  ≤ 5 tons — a >5-ton load splits into N units with per-unit tonnage on
  every cabinet/fixture label and on the takeoff buy line ('N × X tons
  (installed total)'); ONE air handler is drawn with the
  single-indoor-coil/exchanger assumption stated on its label PLUS a level
  warning (the duct machinery models one trunk network; inventing zoning
  dampers would be a lie). Tiny homes floor at 1 unit/1.5 tons.
  The BUILDING CHARACTERISTICS cooling row prints the SAME load —
  'Cooling load (Manual J-lite)' with the term-by-term basis notes (panel
  rows, CSV and the schedules sheet's 'MANUAL J-LITE load' + M1401.3
  basis line all switch together; the rule-of-thumb wording survives only
  on the stated fallback and on pre-batch hand-built fixtures).
  Manual-J-lite gates: `src/engines/manual-j.test.ts` (hand-computed
  four-term load, zone divergence, fallback triggers, Manual S band) +
  the 'Manual-J-lite engine sizing' describe in
  `src/engines/hvac.condensers.test.ts` (hand-derived engine tonnage,
  5-ton split with A6 triple + row compose + the installed-band exhibit
  in the (5.0, 5.22] window, climate divergence incl. the 115.1%
  hair-over-band arm, latent exhibit — 2.6 t sensible → 3.5 t selected,
  dry-zone 2B stays 3.0 —, band warning, takeoff mirror) + the
  characteristics/paper coherence gates in
  `src/engines/characteristics.test.ts` and `src/plans/plan-set.test.ts`.
  Every pad + cabinet sits OUTSIDE an exterior wall, ≥ 0.6 m clear between
  units, cabinet ≥ 0.3 m off the wall face (per mfr clearance + IRC M1403),
  the pad slab's inner edge clears the worst-case exterior assembly
  (face + 0.13 m — brick veneer, R703.8), and nothing fronts a door/window
  RO (the row slides along the wall to clear). Each unit's refrigerant
  LINE-SET — suction ¾" (insulated, the COLD line) + liquid ⅜" (warm) as a
  PARALLEL pair — runs from the cabinet through ONE exterior-wall
  penetration at ~0.4 m SNAPPED clear of any RO crossing the pipe band (a
  verbatim heat-pump node can front glazing the row never slid for), then
  FOLLOWS THE WALL GRAPH to the air handler coil on the plumbing engine's
  routePipe rails — the same E1 RO detours (over the header / under the
  sill), junction jumpers, and flagged air-run fallback the supply/vent
  pipes use; a full-height opening that cannot detour is ⚠-marked in the
  label, never silent. The route is solved ONCE at the pair's center plane
  with the band set to the pair ENVELOPE (one shared detour decision — an
  RO sill landing between per-pipe bands used to make the pipes CROSS);
  both pipes derive from that reference: ±2 cm vertical on every horizontal
  member, and risers ROLL the pair 90° (±2 cm perpendicular to the arriving
  leg) so the lower pipe's riser never bores through the upper pipe —
  zero suction×liquid volume hits at a 2 mm skin, gated over a genuine
  detour scene. On the MEP sheet the pair prints with a ±2.5 px SCHEMATIC
  perpendicular nudge (drawing convention — the truthful projection
  overprinted the pair and the suction color never showed); the cover axon
  still draws the pair as one line (accepted, queued). Both pipes chain
  endpoint-adjacent condenser → air handler (E2 for refrigerant). Runs over
  ~15 m carry a 'verify manufacturer max line-set length / oil return'
  advisory (assumption class — mfr line-set charts govern). CROSS-TRADE:
  the pair rides a 3.5 cm LATERAL off the wall centerline — plumbing owns
  that plane (supply risers + the DWV stack stand on it; post-merge seam
  round: 24 OBB hits from sharing it) — clamped on thin walls so the
  OUTBOARD pipe keeps its full section inside the wall body (the SUCTION
  riser rolls outboard of the lateral plane and is the binding surface;
  the LIQUID riser rolls back toward the plumbing plane); clamped runs
  carry a 'clamped in a thin wall' coordination flag. Adjoining legs
  MITER at junctions (extend/trim to the shifted lines' intersection —
  the fitting a real pair gets), so acute corners stay endpoint-closed;
  near-reversals bridge instead. Crossing flags COMPOSE with ' | ' onto
  whatever honesty a member already carries (a >15 m advisory never
  masks a stack bore). Residual crossings that
  geometry cannot dodge (a 3" stack fills the cavity wider than any
  lateral) get a '⚠ line-set crosses DWV stack — coordinate trades' /
  '… crosses plumbing …' flag from compute's post-both-engines scan
  (flagLinesetTradeCrossings) — never a silent bore; night-5 D2 set the
  trade-skin convention. Colors mirror
  the plumbing convention (E3): suction cold-blue / liquid warm-red in 3D
  AND on the MEP sheet, each with its own legend row. A disconnect mounts
  within sight of each unit (NEC 440.14 — a visibility rule, ≤ 50 ft; the
  figures below are the engine's own proximity-sanity bounds).
  LOOP LESSON (round-2 F2): a numeric class bound for a SEARCH needs a
  CLASS-SWEEP gate, not a scene gate — a scene allowance can be true of
  its scene and false of the class (this row went stale twice that way).
  AMENDED, HP-polish round 2 (verify F2): the box mounts at the unit's
  along-wall projection (lateral = 0 unobstructed — nothing to slide
  closer), so the reach is the clearance-floored stand-off itself, and
  the grid search picks the LEAST stand-off the window permits
  (tie-break s → d² → u; total because distinct lattice points cannot
  share both s and u). Reach basis √((S − t/2 − 0.02)² + 0.725²), split
  by wall class because the two are different THEOREMS:
  - AXIS-PARALLEL walls: keepouts are u-only, so the minimal s-row is
    always reachable (or the search exhausts honestly) ⇒
    S ≤ condenserStandoff(t) + 0.5 ⇒ plan ≤ 1.57 m, 3D ≤ 1.73 m
    (measured corpus max 1.71 / 1.55).
  - OBLIQUE walls: keepouts cut diagonal lattice stripes, so the minimal
    valid candidate can sit rows out (composed exhibit: θ = π/5, t = 0.2,
    S − S0 ≈ 2.17). Window-supremum theorem: candidates lie within
    1.5 m + 0.25 m rounding of the honest spot per world axis ⇒
    S ≤ S0 + 1.75·(|sin θ|+|cos θ|) ≤ S0 + 1.75√2 ≈ S0 + 2.475 ⇒
    plan ≤ 3.54 m, 3D ≤ 3.62 m.
  - EXHAUSTED window ⇒ the honest un-snapped spot: S = S0 exactly, pad +
    cabinet carry the off-grid flag.
  + the ±1.2 m along-wall slide budget when the box clears a fronting RO
  ⇒ plan ≤ √(plan_class² + 1.2²) per class. History: the original ≤ 1 m /
  ≤ 1.5 m figures went stale at the unwarp round (24" clearance + 0.95 m
  cabinet floor the plan reach at 1.10 m); round-1 restated them for the
  snap but only for axis-aligned walls — the oblique class needed its own
  theorem. Gates agree to the digit per class: hvac.condensers /
  hvac.lineset 1.73 (axis scenes); hvac.polish class-sweep + oblique
  exhibit 3.62 with the S-theorems asserted on every composed pick;
  starter-template pins its scene-true plan 1.5. The disconnect keeps an
  endpoint-adjacent whip; the
  dedicated AC-n branch circuit (30A/10 or 40A/8, 2-pole) is panel-homerun
  by compute's post-HVAC pass (gated in compute.devices.test.ts).
  The heat-pump service node stays authoritative for unit #1 (A4 verbatim;
  the row re-anchors to it), and the takeoff books exactly the rendered row
  (S4): condensers/pads/disconnects/whips by count, line-set by SIZE
  (suction ¾" lf + liquid ⅜" lf) plus the suction insulation-sleeve lf —
  never phantom copper lf, elbow fittings or NM-B.
  Origin: night-4 user ask 2026-08-17 ("AC block" catalog item — 1/2/3+
  outdoor units by cooled volume + jurisdiction, piped and powered) +
  line-set round 2026-08-20 ("pipes hot cold that go to the exchanger
  indoor … should follow a sensible path").
  Gates: `src/engines/hvac.condensers.test.ts` +
  `src/engines/hvac.lineset.test.ts`
  CONDENSER-ALWAYS (2026-08-21 user report): the outdoor block ships at
  EVERY LOD the air handler ships — AH ⇒ condenser ≥ 1 OR a warning
  names why (placement fallback carries '⚠ verify condenser placement';
  unmounted disconnect warns per NEC 440.14). Gate: hvac.condensers
  'condenser-always' describe incl. the 1500-compose invariant matrix.
  CONDENSER-HONESTY (2026-08-22 prod report #2, "I don't see the heat
  pump"): three never-silent contracts on top of condenser-always.
  (1) SILENT-EMPTY MEP LEVELS: HVAC + plumbing derive from rooms, so a
  level whose zones can't feed them composes ZERO hvac/plumbing output
  while framing/electrical render fine — compute now warns, keyed off the
  ACTUAL compose (a system that emitted anything is not silent; a
  toggled-off system is not missing hardware, B9c), naming ONLY the
  silent system(s): 'no indoor zones on this level — <systems> derived
  from rooms; draw zones here or X-ray the storey that has them' (no
  zones at all / building-parented zones / wrong storey / roof levels),
  'all zones on this level are outdoor — no conditioned space to serve'
  (the day-9 outdoor-category delta that honestly-but-silently removed a
  previously-drawn unit), 'no habitable rooms on this level
  (garage/hallway zones only)…'. (2) UPPER-STOREY FACADE HEIGHT: each
  level mints its condenser at LEVEL-LOCAL grade, so an upper-storey
  X-ray draws the outdoor unit at facade height — the level states
  'condenser for this storey drawn at its floor elevation — grade
  mounting not modeled; verify' (once per storey; the levelId remount is
  queued on the board — fixtures can't cross-mount today). (3) HEAT-PUMP
  MIS-DRAG: the service node stays A4-verbatim but a moved point inside
  an indoor zone warns naming the room ('heat-pump point is inside
  <room> — the outdoor unit belongs outside…'; a wall-band guard keeps
  wallId/wallT centerline anchors silent), and a point beyond the NEC
  210.63 25 ft service reach (7.62 m — the code's own 'serviceable from
  the dwelling' radius; the 15 m line-set advisory is a run-LENGTH class
  and would bless a 13 m yard drag) from every exterior wall warns with
  the distance + basis. Auto placement and legitimate near-wall
  overrides stay silent. All three ride result.warnings into the panel
  drawer + plan-set flags block.
  Gates: `src/framing/compute.mep-honesty.test.ts` (F1 classes incl. the
  ||→&& mutant killer + single-toggle grammar pins, F2 storey gates,
  plan-set flags reach) + `src/engines/hvac.condensers.test.ts`
  'heat-pump override honesty' describe (mutation-checked both ways).
- **M3 Return air is modeled, and never taken from a garage.** The air
  handler prefers CONDITIONED service space (laundry/utility > closet-named
  rooms > hallway); the garage is a last resort that fires a loud warning
  ('air handler in garage — M1602.2(1) forbids garage return air; provide a
  sealed return + R302.5.2 duct protection — verify') — never silent. The
  OPEN central return grille lives in a central conditioned room (hallway
  first) and NEVER in the garage (IRC M1602.2(1)); a RETURN trunk — full
  supply-trunk section (schematic mirror; label honesty over invented cfm),
  labels prefixed 'Return', sourceId `return-trunk` — connects the grille to
  the air handler as continuous duct (riser → plane legs → drop offset 0.5 m
  from the supply riser). The return path NEVER shares tin with the supply
  system (round-2 blocker): horizontal legs ride their own plane one section
  height + gap off the supply plane (up in the attic, down in a soffit) and
  every return vertical clears the whole supply plan footprint
  (`supplySpineOf` — the one axis/register computation both the trunk
  emission and the keep-out model consume). Compromised placements are LOUD,
  never silent: a drop ring with no clear candidate takes the
  least-intrusion spot + 'return drop cannot clear walls in <room> — verify
  routing'; a compromised grille (`clear: false`, register ≥ 0.5 m floor
  holds on every fallback pass) warns 'return grille cannot fully clear the
  supply ducts in <room>'. Rooms a DOOR can close off carry the
  transfer-path assumption on their supply register ('door undercut /
  jumper duct assumed (M1602.2)' + `meta.transferAirAssumed`) AND on paper —
  the room's supply boot carries the member flag 'door undercut / jumper
  duct assumed — M1602.2', aggregated to one Flags row — v1 never invents
  jumper-duct geometry; the grille room itself stays label-free. The takeoff
  books return duct on its own `Return duct W×H"` lf/fitting rows equal to
  the drawn lengths (never blended into supply rows) and every duct row
  prints its TRUE section — verticals never book their length as a side
  (the supply `Duct 8×NN"` analog died with the same fix). The MEP sheet
  prints return runs in the darker return duct tone with 'duct — supply
  air' / 'duct — return air' legend rows (thermostat auto-spot targets the
  REAL grille).
  SOFFIT legs (interior storeys) never hang in a doorway unflagged: a
  horizontal leg crossing a wall is checked against the wall's rough
  openings at the leg's own y-band (`legCrossesRo`) — the return path
  slides its crossing to a solid segment (drop-candidate × elbow search);
  where no solid crossing exists the leg carries 'return duct crosses a
  doorway — verify routing (soffit/floor-web coordination)'; the SUPPLY
  soffit path (axis fixed by the registers, cannot slide) flags the same
  way. Attic legs ride above wall tops — immune; the head-band raise is
  not modeled (a standard 2.17 m head under a 2.5 m plate band leaves less
  than section + margins).
  Origin: LOD-400 wave-2 audit B19 (a)+(c) BLOCKER (2026-08-20): AH + open
  return modeled INSIDE the garage silently; return air arrived by magic.
  Round 2 (2026-08-21): return×supply interpenetration blocker + silent
  fallbacks + fictitious vertical sections. Round 3 (2026-08-21): soffit
  legs crossed doorways unflagged (return leg dead center of a door, half
  a meter below the head).
  Gates: `src/engines/hvac.return.test.ts` (placement, warning, grille
  exclusion, E2-style return continuity, duct-vs-duct SAT + plane pins,
  loud-fallback closet plan, doorway compose verbatim + no-solid variant +
  attic immunity, transfer labels + Flags row, takeoff mirror + true
  sections), `src/plans/plan-set.test.ts` (return tone + legend rows).
- **M4 Outdoor zones are OPEN AIR — classified, unserved by HVAC, and
  honestly reported.** A zone named for the outdoors (garden/yard/patio/
  terrace|terrasse|terraza|terrazza — anchored forms, material adjectives
  like 'Terrazzo'/'Terracotta' never match; garden/yard are WORD-anchored
  (day-9 misfire list — 'Kindergarden'/'Vineyard cellar' never classify)
  with courtyard/backyard/frontyard + plurals as their own anchored
  compounds — deck/porch/balcon/lanai/pergola/
  jardin/outdoor/outside/exterior) classifies category 'outdoor'; compound
  names resolve by HEAD NOUN — the LAST matching word is the thing the
  room IS (day-9 refinement: 'Garden bedroom' is a bedroom and keeps its
  R314 alarm; 'Master terrace'/'Bedroom terrace' are terraces, open air) —
  and an outdoor word LEADING as a qualifier flips outdoors regardless
  (outdoor|outside|exterior|roof — 'Outdoor kitchen', 'Roof terrace');
  EVERY path that lands a sleeping-word name in 'outdoor' WARNS
  ('reads as open-air — no smoke alarm placed (R314)') — the check keys on
  the RESULT (category + SLEEPING_NAME_RE), never on one branch; the
  'Winter garden'/'Garden room' conservatory class stays outdoor by
  design. An outdoor zone needs NO floor slab — the room-coverage warning
  ('has no floor slab under it') is indoor-only, while an indoor room
  without flooring still warns. ELECTRICAL honesty (night-10, closing the day-9 residual
  family): NO ceiling light composes in an outdoor zone ('Light —
  Garden' floated at y=2.7 over the grass) — the zone's honest lighting
  is NEC 210.70(A)(2)(2)'s own requirement, a wall-mounted 'Exterior
  light — <zone> entrance' on the OUTDOOR face above each dwelling
  door into the zone (riding the served indoor room's LTG circuit;
  the door's interior latch-side switch is the control), and a zone no
  dwelling door opens into carries the level warning 'outdoor zone
  "<name>": open air — ceiling lighting not modeled; exterior fixtures
  by site plan' — garden gates in fences are not dwelling entrances;
  outdoor zones pack no phantom 220.12 lighting VA and never form
  3-way groups; smoke-alarm + receptacle-face honesty per E6/E8.
  HVAC serves indoor rooms only (no supply register, no tonnage,
  never the equipment room / thermostat / heat-pump anchor — filtered at
  every exported rooms-boundary, A4 parity with seeding and the panel); an
  outdoor-only level composes NO air handler, hence honestly no condenser
  (M2's condenser-always contract). The exterior-wall election treats
  INDOOR zone polygons as declared floor coverage when the whole building
  has no flooring (the starter templates ship walls + zones + no slab —
  the slab-only probe framed the shell interior and sent the outdoor unit
  to the ⚠ fallback with no disconnect: prod heat-pump report 2026-08-22);
  outdoor zones never count as coverage. BUILDING CHARACTERISTICS floor
  area/volume/cooling size from CONDITIONED space (outdoor area excluded
  with the basis stated in the notes); an all-outdoor level prints 0 with
  the TRUE n/a reason — 'no conditioned space on this level (all zones
  outdoor)', single-sourced (zeroAreaNa) across the panel rows, CSV and
  the plan-set schedules block, so a roof terrace WITH its floor slab
  never prints 'no floor slabs' beside the slab-on-grade flag; a room-less
  slab keeps the legacy slab-outline fallback verbatim.
  Origin: prod starter-template report 2026-08-22 ("I don't see the heat
  pump standing outside the house") + skeptic/examiner rounds 1-4
  (terrazzo harm class, R314 drop, yard-inflated sheet figure, terrace
  slab-outdoor corner, stale n/a reason) + day-9 skeptic misfire list
  (head-noun tie-break both directions, terrazza, Kindergarden/Vineyard
  substring traps, outdoor slab-warning exclusion — night-10).
  Gates: `src/framing/starter-template.test.ts` (starter-template compose
  pin: whole-shell election, unflagged condenser outside the footprint +
  NEC 440.14 disconnect + E2 line-set, no HVAC in the outdoor zone,
  indoor-only tonnage, A4 seeding parity, B14 WR-GFCI + meter seam guard,
  classifier witnesses incl. 'Terrazzo entry' + head-noun/anchoring
  matrix, R314 warning pair + smoke-alarm compose pin + 'Master terrace'
  speaks / 'Garden bedroom' silent pair, outdoor slab-warning exclusion
  both directions, characteristics corners + paper n/a strings,
  outdoor-only honesty) + `src/engines/electrical.outdoor.test.ts`
  (the night-10 electrical slice: entrance-light pins + E2 wiring
  reach, garden-only warning pair, open-air face sweeps).

## P — Plans (the exported document)

- **P1 One shared transform per sheet set** — same scale, same origin, so
  systems align across sheets. Gate: `plan-set.test.ts`
- **P2 Every symbol/color on a sheet appears in that sheet's legend.**
- **P3 Title block: jurisdiction + code name, date, disclaimer, SHEET n/N,
  ratio scale, north arrow.** Gate: `plan-set.test.ts` pins
- **P4 Engine warnings print verbatim in the schedules flag block** — a
  silent drop of a warning is a lie on paper.
- **P6 Every opening is SCHEDULED and cross-referenced.** When the caller
  passes the wall model (`PlanSetOptions.walls` = compute's deduped active
  walls), the set carries a door + window schedule with ONE row per
  opening — census equals the scene's OpeningSlices, marks D1…/W1… assigned
  deterministically by wall order (length desc with the wall ID as a
  CONTENT tiebreaker — equal-length walls must never ride node insertion
  order, round-2 F2) + ascending u, so an unchanged scene reproduces
  identical marks. Tables at ≤18 lines FOLD onto the Schedules + takeoff
  sheet (round-1 examiner: a 5-opening dedicated sheet reads ~80% empty):
  both takeoff columns start below the folded table and EVERY capacity is
  page-indexed — including the FLAG BUDGET when a one-page takeoff puts
  the bottom-anchored flag/characteristics blocks on the fold's own page
  (closing round: the un-indexed budget let a 45-warning block climb INTO
  the fold table while the 4-row floor clamped takeoff rows into the flag
  band); a page 0 that cannot host fold + blocks + the 4-row takeoff
  floor REJECTS the fold back to the dedicated sheet — the schedule never
  overprints and never vanishes. Bigger tables keep dedicated sheet(s)
  with (p/N) titles and contiguous SHEET numbers; multi-page takeoffs
  anchor the blocks on the LAST page under the unchanged budget. The RO cell prints the engine's roughWidth/roughHeight
  verbatim and the HEADER cell reads the FRAMED member back, claimed by
  RO-SPAN CONTAINMENT first and global distance order second — a
  clamp-slid header must never STEAL a neighbor's stick (round-2 F1
  blocker: D1 printed the window's 4x6 over a 16-ft opening and every
  ENGINEERED flag vanished from paper). Size verbatim; material
  'engineered' prints 'ENGINEERED (by supplier)', never the drawn
  placeholder stick; CMU lintels print 'precast lintel'; an opening whose
  head lands within MIN_PIECE of the bond beam (the FL tie-beam detail —
  cmu.ts frames NO lintel by design) prints 'bond beam as lintel', never
  a dishonest '—'. Window sills print AFF; every flag riding the opening's
  head/sill members prints WHOLE (wrapRow — P4 applies), and a flag the
  wall's non-opening members also carry is WALL-scoped (the S7 compression
  aggregate) and prints prefixed 'wall <id>:' so it never reads
  opening-scoped. Each mark also prints on the wall framing plan as a
  small bubble de-collided through the placed[] registry (A-A section
  bubbles included) with a legend row keying the symbol (P2). Zero
  openings → no schedule; callers that don't pass walls get paper
  byte-equal to pre-B21d.
  Origin: LOD-400 wave-2 audit B21(d) — openings framed to fabrication
  level but never tabulated, no out-of-scope label.
  Gates: `src/plans/plan-set.test.ts` 'door + window schedule (LOD-400
  B21d)' describe (census/byte-match/determinism/F1 steal exhibit/F2 tie
  shuffle/CMU-through-computeLevel incl. the bond-beam cell/wall-scoped
  flag prefix/fold-vs-dedicated/fold×flags overprint (one-page corrected
  budget + multi-page untouched budget + reject hatch)/bubble clearances/
  40-opening pagination/
  byte-equal fallback).

## P — Plumbing

- **P5 Supply + DWV reach every placed fixture; drains only fall.** Every
  stub-out is cold-reachable from the service meter and hot fixtures
  hot-reachable from the water heater as continuous pipe (union-find over
  endpoints); every trap drains to the sewer exit along a strictly
  monotonic downhill path (P3005.3); no pipe crosses a rough opening
  (supply/vents detour like cable — E1 applied to plumbing); trap arms
  past Table P3105.1 and island fixtures carry flags, never silent runs.
  Origin: plumbing rebuild 2026-08-16 (placed fixtures showed almost no
  plumbing).
  Gate: `src/engines/plumbing.connectivity.test.ts`

- **P6 The water heater ships SAFE, vent distance is measured at the weir,
  and thin walls confess their cover.** Every placed-path WH carries a T&P
  relief valve whose ¾" discharge terminates within 6" of the floor
  (P2803.6.1); a tank sits on a real STAND (M1307.3 — 18" of steel, not
  air) inside a drain pan (P2801.6); SDC-D specs (`seismicHoldDowns`)
  strap the tank at its upper+lower thirds (P2801.8) and low-seismic specs
  ship ZERO straps — all booked as takeoff pieces from the members.
  P3105.1 flags measure TRAP WEIR → VENT (the developed distance to the
  re-vent riser actually serving the wall, printed in ft) — one re-vent
  never silently "serves" a whole wall; island fixtures flag P3112 island
  venting as not modeled. A 3" stack with <1.5" cover to the wall face
  flags steel shield plates (P2603.2.1 — the plate members ride B15). The
  water meter + cold-main riser WARN when they land in the panel's NEC
  110.26(E) dedicated space (reservation rides B12/B16). Trap-DROP
  verticals clamp clear of EVERY wall's concrete (perpendicular corner
  stemwalls, interior thickened footings) or emit sleeved (P2603.4).
  Origin: LOD-400 wave-2 audit B20 + F3 trap-drop residuals (2026-08-21).
  Gates: `src/engines/plumbing.safety.test.ts` +
  `src/engines/interpenetration.test.ts` (F3 corner-drop repros)

## App

- **A1 X-ray off = the editor's own look.** No plugin layers rendered solid
  (z-fight), no stipple ghosts at eye level.
- **A2 Recompute on every graph change** — openings added AFTER the first
  compute must reroute (the prod E1 report was exactly this experience).
  The renderer derives from the live nodes prop; any memo that caches past
  an opening edit is a bug.

- **A3 Multi-storey: bones aligns with what the host DRAWS.** The host mounts each node
  inside its level group at the stacked storey elevation — members render
  level-local; anything pulled from ANOTHER level (the roof search) carries
  the storey delta (baseY mirror of core getLevelElevations). A shared roof
  is framed by exactly ONE X-ray node (highest storey of the SAME building
  wins — never skipped on the roof's own level). Level arithmetic (ground
  detection, storey-below height, roof search) never crosses buildings;
  height-less legacy levels default to the host's 2.5 m. The reference is
  the HOST-DRAWN shell (world Y of the rendered roof), not wall tops — if
  the scene data floats its roof, bones floats WITH it (demo scene carries
  roof y=2.7 inside a stacked roof level: shell draws at 5.2, verified in
  the live three.js graph). Origin: prod report 2026-08-15 (two-storey
  starter house wore its roof at ground level).
  EXPLODED EXCEPTION (day board A + F1 verify round 2026-08-16): in exploded
  level mode a foreign roof group additionally drops half an exploded slot
  (host EXPLODED_GAP 5 → −2.5; editor
  packages/viewer/src/systems/level/level-system.tsx) so floor / trusses /
  shingle shell read as three strata — ONLY for groups whose source level
  sits strictly ABOVE the owner's storey (`Member.strataAbove`, tagged by
  compute, propagated as group userData): a ground-storey porch roof foreign
  to an upper owner is NEVER offset into the storey below it. INTENDED
  F1b closed (prod report 2026-08-16): an owner ON a true attic level
  (roomless, slab-less, storey below) strata-drops its OWN roof members via
  the render-only mountLevelId tag — sheets keep drawing them owner-local.
  Gates: `src/framing/compute.multistorey.test.ts` (scenario matrix incl.
  strataAbove tagging + the own-level F1b pin) +
  `src/framing/renderer.test.ts` (offset only when strataAbove; userData
  propagation)

- **A4 Service overrides are authoritative; routing follows.** A
  `bones:service` node on the level IS the location of its system point —
  all EIGHT service types: panel / water heater / water entry / sewer exit /
  power entry / thermostat / heat pump / electric meter — and the engines
  consume it VERBATIM — wallId+wallT+heightAff resolved by wall lerp, or a
  plain position snapped to the nearest wall point — instead of
  auto-placing. Moving the panel re-anchors every homerun (E2 continuity
  still holds); moving the electric meter re-anchors the whole street →
  meter → panel service chain; moving the water meter/WH re-routes supplies
  (still continuous, P5); moving the sewer exit re-slopes the drains (still
  strictly monotonic downhill, P3005.3); moving the thermostat re-mounts it;
  moving the heat pump re-anchors pad + cabinet + lineset. Every verbatim
  wall mount forced into a door/window RO warns (panel / WH / water entry /
  thermostat / electric meter — parity, no silent RO squatters).
  Auto-placement applies ONLY when no node exists; seeding is AUTOMATIC and
  idempotent per level (no button since 2026-08-20) — the activation click
  creates all types at the engines' current auto spots in the SAME undo
  entry as the framing node, pre-automation scenes heal once through the
  reconcile batch, and the `servicesSeeded` latch guarantees a service
  point the user deletes is never resurrected. Creation alone never moves
  anything.
  Origin: service-nodes plan 2026-08-16 ("drag the panel like a door — the
  wires follow").
  Gates: `src/engines/service-overrides.test.ts` (override → re-route,
  continuity + downhill re-proofs) + `src/service/place.test.ts`
  (idempotent placement at engine auto spots + the seeding latch) +
  `src/activation.test.ts` (one-entry creation, position parity) +
  `src/framing/compute.test.ts` (RO-warning parity)

- **A5 The wall-mode restore never fires while ANY other X-ray is live.**
  Wall mode is one global host pref; X-rays are per-level. Activation
  imposes 'down' ONCE, click-scoped (src/activation.ts — never renderer
  mount magic), remembering the user's previous mode; the restore rides
  ONLY the action that deactivates the LAST live X-ray (viewMode → 'off'
  or the panel Remove), and only while walls are still 'down' — a manual
  wall-mode change after activation is the user's and survives every
  recompute / re-render / remount. "Live" = a bones:framing node whose
  effective view mode isn't 'off' (an X-ray parked in Normal holds
  nothing). UNDO CONTRACT (deliberate, confirmed browser QA round 3): undo
  restores CONTENT, never viewer state — undoing the activation entry
  leaves the wall chip on Low, because wall mode is a host viewer pref
  outside scene history and replaying viewer writes on undo/redo would
  fight the user's own chip clicks; the restore belongs only to the
  explicit deactivation actions (viewMode → 'off', panel Remove), and the
  pre-X-ray mode is one click away after an undo.
  Origin: skeptic blocker 2026-08-21 — removing level A's X-ray restored
  the walls while level B's X-ray was still on (the same failure class the
  round-1 fix closed at the renderer, surviving at the remove/off
  boundary).
  Gate: `src/activation.test.ts` ("INVARIANT W1" describe — the A+B
  remove repro, the viewMode-off variant, parked-in-Normal holds nothing)
  plus the one-shot / manual-survival rows in the activation describe
- **A6 The condenser-cabinet asset swap is visual-only, X-ray-only, and
  never a hole.** In the 3D X-ray, the hvac cabinet member renders as the
  host's real heat-pump model — the item-catalog "AC block" GLB (id
  `ac-block`, URL pinned in `src/framing/condenser-asset.ts` with a
  graceful missing-asset path) — under four invariants:
  (1) X-RAY-ONLY SUBSTITUTION: 'off' draws no members, 'basement' keeps
  its faint shell box; only 'xray' with a LOADED asset swaps.
  (2) EXACT MATRIX PARITY, UNWARPED: the wrapper takes the box's instance
  matrix verbatim (shared `composeEntryMatrix`; the asset is normalized to
  a unit cube, so the model fills precisely the member's dims volume — the
  engine footprint governs, 0.95 × 0.85 × 0.95 m since the unwarp round
  2026-08-23: real top-discharge proportions equal to the asset's native
  bbox aspect within 0.2%, so the per-axis scale is a UNIFORM ≈ 0.896
  shrink — the scale-ratio pin (CONDENSER_UNIT_DIMS vs
  AC_BLOCK_NATIVE_BBOX_M, 1% tolerance) keeps either side from drifting
  back into single-axis compression); live drags patch wrapper matrices in
  place, and asset arrival/departure/count change is a STRUCTURAL change
  (full rebuild, never a torn patch).
  (3) NEVER-A-HOLE FALLBACK: headless, missing asset, network failure, a
  spec-valid GLB with NO default scene, a mesh-less scene, or a payload
  that crashes normalize — every arm resolves `null` (the loader NEVER
  rejects into the renderer), the steel box renders bit-identical to
  master, and the failure clears the in-flight slot so the next activation
  retries (a wedged-forever cache was the round-1 skeptic exhibit).
  (4) TRIPLE UNIQUENESS: the swap keys on `hvac`/`equipment`/`steel` —
  no label regex, no engine-side meta (the Member type carries none and
  adding one breaks the byte-identical baseline). The triple matches the
  cabinet and NOTHING else: gated live over the pinned baseline corpus
  plus 52 jurisdictions × {baseline, garage-variant} full computeLevel
  sweeps (triple ⇔ 'AC condenser #' label, zero mismatches, non-vacuous);
  the round-1 skeptic swept 52 jurisdictions × 3 scene shapes — zero
  collisions in the class. Renderer conventions hold: clone meshes are
  raycast-no-op (F2) with bucket shadow flags, geometry/materials are
  SHARED with the module-cached asset (never re-minted, never disposed by
  group teardown), and the bucket material cache stays flat. The MEMBER
  itself is untouched everywhere — SAT, plans, takeoff, panel: the
  'AC condenser #N — X tons outdoor unit' label keeps printing, and the
  master baseline stays byte-identical. Pad, disconnect, whip and line-set
  render exactly as before (M2 owns their honesty).
  Origin: user ask 2026-08-22 ("that's actually a heatpump… called 'AC
  block' — you could use that for placeholder. keep the label on it") +
  round-1 skeptic (resolve-then-throw wedge, mesh-less hole).
  Gate: `src/framing/condenser-asset.test.ts` (census both ways with the
  loader mocked, matrix parity, patch structure, raycast/material
  conventions, all loader arms, the uniqueness sweeps, the scale-ratio +
  placeholder-parity pins) — every clause mutation-probed (10 probes, each
  red).

- **A7 The X-ray heat pump is directly selectable — hover, click, move on
  the unit itself.** (Julien 2026-08-23, overruling the day-10 trade that
  left the sign plate as the suppressed body's only handle.) In 'xray'
  with hvac ON, the heat-pump service node mounts a NEAR-INVISIBLE pick
  proxy (colorWrite:false + depthWrite:false, visible — renders in the
  list but writes NO pixels and no depth; QA round 2026-08-23 retired the
  opacity-0.03 recipe, whose stacked panes read as a faint 'glass case'
  against dark drywall — the bones:device proxy took the same property;
  editor #665 trio: useNodeEvents + useRegistry + host SelectionManager /
  merged-outline, whose mask pass re-renders silhouettes with its own
  material, so the ghost outlines) sized to the ENGINE cabinet footprint
  (× 1.04 hug inflate) at the unit's center height and unit-#1 yaw, read
  from the memoized computeLevel the framing renderer draws from. Unit #1
  sits at the node verbatim (A4), so the proxy rides the node's group —
  live drags track for free and the engines re-route on commit (the
  proven sign-drag flow). Invariants: the proxy is the ONE stated
  exception to the X-ray raycast-no-op convention (it is a SERVICE mesh
  in the node's registered group — picking it IS picking the node; the
  engine-drawn asset meshes stay raycast-disabled, A6); the sign plates
  keep picking; a visible body (off/basement/toggle-off/no-framing) means
  NO proxy (the body is the handle); ENGINE SILENCE (no unit #1 composed)
  means NO proxy (no phantom hover volume — the sign is the handle, the
  stated trade); water-heater/electric-meter stay proxy-less (wall-mounted,
  sign hugs the equipment — follow-up candidates, stated).
  Origin: Julien 2026-08-23 ("select the heat pump… highlights when I
  mouse over it… similar experience to the kitchen island").
  Gates: `src/service/place.test.ts` (the suppression matrix's pickProxy
  column — exactly the xray+engine-suppressed heat pump) +
  `src/service/proxy.test.ts` (footprint/height/yaw parity vs the engine
  compose, A4 position parity, engine-silence null, composition arms).

## Process

- New invariant ⇒ new row + new gate in the same commit.
- Reviewers cite rows by id (E1, S3…) in scorecards so rounds are diffable.
