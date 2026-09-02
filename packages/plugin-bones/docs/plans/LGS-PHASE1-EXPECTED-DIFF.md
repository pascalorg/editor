# LGS Phase 1 — expected diff manifest (feat/lgs-phase1)

Phase 1 of docs/plans/LGS-PLAN.md: walls at LOD-400 per IRC R603. A wall
that resolves to the `'lgs'` construction (per-wall override, or
`framingSystem: 'lgs'` as the level default) frames in STEEL — C-stud/track
assemblies consuming Phase 0's `profileFor` + the cited catalog
(data/lgs-profiles.json). This REPLACES Phase 0's honest interim behavior
(`framesAsLumber` routing + the "framed as lumber until the steel engine
lands" card) for those walls.

## 1. EXISTING corpora: ZERO deltas (the honesty-rule-6 statement)

No stored scene carries an `'lgs'` wall or a `framingSystem` field, and
absent fields round-trip absent (the Phase-0 schema contract). Every change
below is gated to the new input class:

- **E5 master-baseline**: recaptured on the Phase-1 tree —
  **byte-identical** to the pre-Phase-1 pin (proven with `cmp` before the
  1a commit; the committed `src/framing/master-baseline.json` did not
  change). The full suite's INTL/TX byte pins hold unmodified.
- `framesAsLumber` narrowed to `'framed'` AND every consumer that used it
  for the framed-ASSEMBLY meaning (sheathing/drywall area sites, layer
  routing, card engineering/insulation blocks) moved to the new
  `framedAssembly` (framed | lgs) in the same commit — for `'framed'` and
  `'cmu'`/`'skip'` values both predicates answer exactly as before.
- `resolveWallConstruction` grew one branch that fires ONLY when
  `config.framingSystem === 'lgs'`; the spec fold
  (`spec.framingSystem`/`spec.lgsMachine`) happens ONLY when the config
  carries the fields, so the spec object stays byte-identical otherwise.
- `frameHints` cap-lap suppression fires ONLY when a corner partner's
  override carries `construction: 'lgs'` (absent construction = lumber
  assumed, byte-equal). `frameWalls`' new `hintWalls` option is absent on
  the no-steel path (identical hint computation).
- `wall-layers` batt arithmetic branches ONLY on
  `override.construction === 'lgs'`.
- Takeoff: steel designator rows, strap-bracing row and screw rows appear
  ONLY when steel members exist; the 8d nail basis split degenerates to
  the identical `sheetCount` arithmetic when `steelSheathingSqft === 0`.
- `Member.profile`/`Member.punchouts` and the `'strap-bracing'` role are
  additive — no existing engine emits them.
- Suite: 1775 → 1820, all pre-existing tests pass unmodified EXCEPT the
  three Phase-0 F1 interim gates in `lgs-profiles.test.ts`, which pinned
  the very behavior Phase 1 exists to replace — they were updated to the
  Phase-1 truths in the SAME commit that changed the routing (1a), per the
  Phase-0 schema comment's explicit promise.

## 2. NEW input class — what an `'lgs'` wall now produces

Skeleton (system `wall-framing`, material `steel`, `Member.profile` =
catalog designator):

- Bottom + top TRACK (`350T125-*`/`550T125-*` — web depth-matched to the
  wall's lumber-equivalent size), envelope [run × 1-1/4" flange × web].
  ONE top track — no cap plate (steel walls have no double-plate lap).
  Track thickness == stud thickness by construction (R603.3.2 verbatim
  rule, stated on the label).
- C-STUDS (`350S162-*`/`550S162-*`) at the spec o.c. spacing, envelope
  [1-5/8" flange × height × web], seated INSIDE the tracks (ends on the
  track webs). The box nesting is a design-intent contact, allow-listed in
  the SAT gate — material + profile + same-wall SCOPED (a lumber stud in a
  lumber plate still trips).
- Openings: 2 king studs + `LGS_JACKS_PER_SIDE = 1` jack per side (R603.7
  STRUCTURE — the count table is unverified, label says 'minimum shown,
  verify'); header = 2-C box assembly (R603.6 STRUCTURE — every steel
  header carries the 'span capacity not verified against Table R603.6'
  flag); window sill = TRACK section (R603.8); cripples continue the
  rhythm above headers / below sills.
- R603.3.3 strap bracing at 300+: 1-1/2" × 33 mil flat strap rows on BOTH
  faces (layout assumption stated on the advisory) — mid-height ≤ 8 ft,
  third points above (through 10 ft); surface steel under the SAT skin.
- S240 A5.9 factory punchout METADATA on verticals at 400
  (`Member.punchouts`: ≥24" c-c, ≥12" ends, width ≤ min(depth/2, 2.5"),
  4.5" length) — box geometry carries NO holes yet (the Phase-2 MEP hook).
- Corner backing studs + CFS partition backing (`150U050-54` bridging
  channel) from the SHARED hint graph.

Layers/areas (the framesAsLumber/areas DECISION, documented): `'lgs'` LEFT
the `framesAsLumber` predicate; the area sites and the layer pass gained
steel awareness through the new `framedAssembly` predicate instead. Steel
walls ride the SAME `layoutWallLayers` pass in the ORIGINAL wall order —
sheathing/drywall/WRB/cladding members and the gross `areas` sums are
**byte-equal to a framed twin** (pinned). Batts stay too, with the bay
arithmetic mirrored to the steel members (flange width, track-flange
cavity band, 1 jack/side, no lumber fire rows).

Warnings channel (per level with steel walls, 300+):

- `LGS mil selection: R603.3.2 table cells not encoded — …` (always).
- `LGS wall bracing (R603.9 …) not evaluated — …` (always; steel walls
  also LEAVE the R602.10 braced-wall lines, like CMU — the only warnings
  an `'lgs'` flip may legitimately DROP are that wall's braced-line rows).
- R603.1.1 applicability: wind ≥ 140 / snow > 70 / storeys > 3 / stud
  length > 10 ft → loud warning + `engineered design required` flag on the
  wall's members (composed ' | ' with compression/header flags).
- `spec.highWindUplift` + exterior steel walls → 'LGS wall uplift
  strapping not modeled' (the B10 hardware is lumber-only; steel walls
  book no uplift connectors).
- ENERGY CODE (round-1 F2): every cavity R the plugin prints is the
  WOOD-frame prescriptive figure — steel-frame walls take 2021 IECC
  R402.2.6 / IRC N1102.2.6 (cavity + continuous insulation, or U-factor
  path), not evaluated, and steel-stud thermal bridging is not modeled in
  the UA/Manual-J arithmetic. Stated in THREE channels, all steel-gated:
  the level warning (P4 prints it), a characteristics note (keys on wall
  CONSTRUCTION resolution, so it holds with walls toggled off), and the
  card's insulation line qualifier. The old Phase-0-derived
  insulation-equality pin was rewritten into a truth pin (content equal
  PLUS the steel qualifier present). LOD-LADDER CHOICE (round-2 D): the
  qualifier ALSO rides `insulation.citation` itself — the R402 cavity-R +
  IECC cite print at EVERY LOD (paper block, notes, CSV) while the
  warning channel is 300+-gated, so a steel 200 set printed the wood
  cite unqualified. Qualifying the ONE source string means no surface
  can print the cite without the caveat; the zero-cites-at-200 ladder
  rule covers R603 STRUCTURAL claims — an energy cite that already
  prints at 200 must carry its honesty there too. Lumber 200 byte-clean
  (leak-gated).

Takeoff (new rows only when steel members exist):

- `LGS <designator>` per profile — LINEAR FEET quantity, pcs in the
  detail, and the stated basis 'weight requires vendor data (no verified
  lb/ft in the catalog)'. **Never lbs/kg** (gated).
- `LGS strap bracing 1-1/2" × 33 mil` by lf (own role — B9's
  'Portal straps 1000 lb' census untouched).
- Screws per the VERIFIED schedule: stud-to-track 2×No.8 per flange pair
  both ends (exact 4 × verticals); sheathing No.8 @6/12 and gypsum No.6
  @12 derived via `screwsPerSheet()` (66 and 42 per 4x8 sheet, layout
  assumption stated on the row).
- 8d wall-sheathing nails key off the LUMBER walls' sheets only (steel
  sheets screw); an all-steel level books zero wall 8d; sheet AREAS
  unchanged (F1).
- Steel members never enter the lumber pcs/bd-ft/16d/10d rows (material
  gate).

Card (`selectedWallInfo`): assembly line prints the steel truth from the
SAME resolver the engine uses (`lgsWallProfiles`) — e.g.
`Steel (LGS) — 550S162-68 (Gr 50) @ 16" o.c. — conservative: R603.3.2
table cell unverified`; a selected machine appends
`· machine <key> (constraint warnings land in Phase 2)`. Engineering block
stays populated (studSize/spacing drive the steel family; insulation/
cladding ride the same layers).

Construction-resolution precedence (`framingSystem: 'lgs'`): explicit
per-wall overrides win ('framed' stays lumber, 'cmu' stays block, 'skip'
skips); the FL CMU exterior default beats the framing system (interior
partitions still go steel). LOD 200 keeps generic 33-mil members with no
code claims (no straps, no punchouts, no selection warnings — the repo's
LOD-200 convention).

## 3. Conservative / unverified-basis points (the complete list)

1. **Stud/track mils**: NO R603.3.2(2)–(16) cells are encoded (research
   verified the table STRUCTURE + limits only). 300+ picks the thickest
   catalog variant inside the tables' 33–68 mil domain (68 mil, Gr 50 by
   the VERIFIED grade rule) — basis stated on every stud label
   (`conservative: R603.3.2 table cell unverified`) + one level warning.
   Deliberately heavy; verifying real cells later can only THIN members.
2. **Header capacity**: R603.6 span tables not encoded — every steel
   header carries the verify flag (prints on takeoff Flags + paper).
3. **Jack/king count**: Table R603.7(1) not encoded — structural minimum
   (1 jack + 1 king per side) with 'minimum shown, verify' on the labels.
4. **Strap bracing faces**: R603.3.3 row HEIGHTS are the verified
   structure; both-faces placement is a stated layout assumption
   (advisory); end anchorage/periodic blocking not modeled (advisory).
5. **Head track (R603.8)**: not modeled separately — the header assembly
   bottoms at the RO head, so a distinct head track would be coincident
   geometry. Sill track IS modeled.
6. **Screw counts per sheet**: derived arithmetic from the verified 6/12
   and 12 spacings on a stated 4x8-vertical/16"-o.c. layout assumption
   (printed on the row).
7. **Energy code (F2)**: the IECC figures are wood-frame prescriptive
   values used as-is for UA/Manual-J — R402.2.6 steel-frame equivalence
   and thermal bridging are NOT evaluated; three stated channels (card,
   characteristics, level warning) carry the caveat.
8. **Machine constraint**: `profileFor` resolution status rides member
   labels (verified machines brand; can't-roll/unknown/unverified fall
   back to generic dims with the loud Phase-0 status string). Real
   finding, gated: TF550H's published flange range (34–63 mm) covers the
   68-mil S162 studs but NOT the T125 track's 1-1/4" flange — tracks
   resolve generic-fallback per-row, honestly. Can't-roll WARNINGS (and
   the machine UX) are Phase 2; the card says so.

## 4. Residuals / stated limitations (for the verify round + board)

- **C-profile render**: members are box ENVELOPES with profile-truth
  labels (the plan's stated v1 approach); web+flanges+lips render and
  punchout holes are the stated later refinement.
- **Foundation anchorage on steel walls**: the R403.1.6 bolt kit still
  applies (bolts clamp the bottom TRACK); the S240 steel-wall anchorage
  schedule is not modeled. The pre-existing anchor-bolt × stud shank
  class extends to steel studs (same documented S1 residual family).
  The 'sole plate anchorage (R403.1.6)' takeoff row wording is
  lumber-flavored on an all-steel level (candidate Phase-2 polish).
- **LOD-200 gross WSP fallback**: the single gross area sum has no
  per-wall split, so its 8d nail basis still covers steel walls' sheets
  at 200 (no code claims at 200; the member-derived 300+ path splits
  correctly).
- **Steel × CMU junctions (round-1 F4d + round-2 A)**: the shared hint
  graph is masonry-blind, so a steel partition's stud/track run tees into
  full-CMU through walls exactly like the documented lumber class (S1
  residual, lumber-twin symmetry kept). The NEW strap-bracing role does
  NOT join that class IN EITHER DIRECTION: strap ENDS trim clear of CMU
  corner/through walls via `mixedWallInsets`, and strap RUNS split around
  the station band of every CMU stem teeing INTO the steel wall — the
  band is the width-aware S5 half-width PLUS the strap-plane offset term
  |z|·cosθ/sinθ (round-3 F2: the straps live at z = ±(wFit/2 + strap/2)
  off the centerline, and an oblique stem's crossing of that offset plane
  shifts along u by z·cotθ — a 45° stem bored a grouted cell 32 mm past
  the centerline-only band; perpendicular stems keep the exact
  centerline band, byte parity) — advisory states the trimmed
  anchorage. TRIM REMNANTS UNDER 6" DROP (unbuildable strap) and the
  drop is NEVER SILENT (round-3 F1, the S13 doctrine): every dropped
  span raises a per-wall LEVEL warning naming the wall and the unbraced
  band extent ('R603.3.3 strap bracing interrupted at CMU junction — …
  verify bracing at the junction'; whole-run variant 'strap bracing
  omitted — run(s) shorter than 6 in after CMU trims'), and warnings
  print on paper via P4 — the advisory channel alone cannot carry a
  whole-run drop (advisories ride strap members, and none exist then).
  CMU-conditioned: a pure-steel stub too short for any strap stays the
  pre-existing quiet class (byte parity); the pure-
  length clamp (minimum-run re-extension on stubs) states its own truth
  ('strap run clamped to the wall length'), never a masonry claim
  (round-2 B). Gated on the FL-default composition AND the CMU-stem-into-
  steel-through exhibit, both with non-maskable straps-only SAT scans;
  pure-steel strap geometry byte-identical (proven vs the round-1 tip).
- **Steel↔steel corner claims**: both walls follow the through/butt
  insets from the shared hint graph; no interlock/clip-angle detail is
  modeled or claimed (junction fastening per R603 is the builder's).
- **Off-stud device blocking on steel walls**: emits as steel with 'CFS
  strap/track blocking per detail — not booked' (1d commit) — geometry
  honest, takeoff honest, no phantom wood.
- **Mixed CMU + lgs object form**: `cmuHeightM` stays CMU-only (schema
  refine) — no steel knee-wall variant.
- **Member-label UX (round-1 visual advisory)**: designators live in
  `member.label` data, on the wall card and on paper — the plugin has NO
  member-tooltip machinery, so there is no hover surface that shows them
  in the 3D view. A member-label hover affordance is a Phase-2 UX item
  (board note); nothing in Phase 1 claims one.
- **R603.9 shear bracing**: not evaluated (warned); R603.3.3 rows are
  stud stability bracing only (stated).
- **Wind uplift**: LGS walls carry no WFCM uplift hardware; warned when
  `highWindUplift` (see §2).

## 5. Gates + probes

`src/engines/lgs-wall-framing.test.ts` (37) + LGS scenario matrix in
`interpenetration.test.ts` (7 scenarios incl. the scoped steel-nest
allowance bite test) + the rewritten F1 describe in
`lgs-profiles.test.ts` + the steel device-blocking twin in
`electrical.devices.test.ts`. Mutation probes (all die, /tmp-backup
reverts): M1 framedAssembly drops lgs (16 fails) · M2 track-mil decouple
(5) · M3 third-points dropped (1) · M4 conservative→33 (11) · M5
cap-claim suppression removed (1) · M7 8d split removed (1) · M8 punchout
end-distance ignored (2) · M9 wind limit dropped (1) · M10 invented
designator (8) · M11 framingSystem default ignored (12). Suite 1820,
`bunx tsc --noEmit` clean, E5 recapture byte-identical.
