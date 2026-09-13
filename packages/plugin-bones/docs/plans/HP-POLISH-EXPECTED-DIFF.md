# HP OBJECT POLISH — expected diff (feat/hp-polish, 2026-08-23)

Julien's hands-on feedback after using the shipped heat-pump object
(verbatim): "by default it's not aligned to the grid. It's like scaled and
everything. But first of all it's red. And also it's tilted. And also it
looks like I can't rotate it like a normal object or with R. … let's make
sure it's aligned normally and grayed out normally like the object would
be." Base `1a5e627`. Anything outside the classes below is a defect.

## The four items (mechanism → where)

1. **COLOR** — `prepareCondenserClone` (src/framing/condenser-asset.ts)
   retints EVERY clone mesh to `CONDENSER_SCHEMATIC_TINT = '#8b8f96'` —
   byte-equal to the steel tone the cabinet box rendered before the asset
   swap (framing/renderer `colorOf` 'steel'), roughness 0.82 like every
   bucket material; ONE module-cached material (night-8 identity doctrine),
   geometry shared, the CACHED asset's authored materials untouched.
   DECISION (stated): neutralize to the bones equipment-gray schematic
   family, NOT the host item treatment — host investigation (read-only,
   private-editor `packages/nodes/src/item/renderer.tsx`) shows the item
   renderer displays the AUTHORED GLB materials whenever viewer `textures`
   is on (the default — i.e. it would keep the red) and only collapses to a
   themed 'furnishing' clay (`createSurfaceRoleMaterial` + colorPreset) in
   monochrome mode, a theme path a plugin cannot reach. Labels/tonnage
   surfaces untouched.

2. **TILT** — every condenser unit's ASSEMBLY (cabinet + pad + fixture →
   pick proxy) sits SQUARE to its row wall: yaw = the outward wall normal
   (`Math.atan2(out)`), back to the house. Unit #1's legacy yaw was its
   equipment-room BEARING (rotY ≈ 2.99 on off-axis scenes) against a
   wall-aligned pad. THE RULE: machine placements square to the ELECTED
   wall; a verbatim user drag squares to ITS OWN row wall — the nearest
   exterior exit (A4 keeps the dragged position; orientation is derived
   truth). Only the rowless no-exterior-wall fallback keeps the legacy
   bearing (no wall to square to; already ⚠-flagged). `padRotY == rotY`
   always now (one rigid object). Disconnect (wall-face box) keeps the
   wall-square bearing; line-set/whip attach points recompute from the new
   anchor/orientation (E2 gates re-ran green).

3. **GRID SNAP** — AUTO anchors only (`condenserRow`, non-verbatim path).
   AMENDED in the verify fix round (**F1** — the wall-frame convention was
   wrong on oblique walls: exact wall-frame multiples, world residuals
   0.153/0.496 against the lattice the editor renders): the host
   convention for item floor placement is the **WORLD XZ grid** —
   `floorStrategy` snaps world components through
   `snapWorldXZForActiveBuilding` "so item edges land on the visible grid
   even when the active building is rotated" (private-editor
   `placement-strategies.ts` + `lib/world-grid-snap.ts`). The engine runs
   a deterministic lattice-candidate search within ±3 steps of the honest
   (RO-slid) spot: VALID = on the wall span, RO-keepout-clear, stand-off ≥
   the honest stand-off (away-only — the 24" face clearance is a FLOOR the
   snap can only raise); PICK = least stand-off first (round-2 F2a — the
   accepted stand-off is the window minimum, which is what makes the M2
   reach bounds provable), then nearest, then smaller along-coordinate.
   The chosen lattice point is taken
   VERBATIM (exact world multiples) and u/out/stand-off re-derive with the
   exact verbatim-path expressions — post-seed == auto stays BYTE-equal by
   construction, obliques included. Window exhausted (clearance/openings/
   span) ⇒ the fully honest un-snapped spot + the off-grid flag (**F3**,
   '⚠ off-grid — clearance/openings leave no 0.5 m grid position near
   the elected spot' composed onto pad + cabinet, B1 ' | ' convention;
   wording per verify round 2 F3 — the search is deliberately
   WINDOW-LOCAL, ±3 steps of the elected/slid spot, because roaming the
   whole wall would betray the election; a farther grid spot may well
   exist, so the flag claims only the neighborhood). Pad label
   restates the basis: `≥ 24" face clearance basis`. Verbatim drags never
   snap (A4 — the host move tool already applied the user's grid mode).
   STEP BASIS (skeptic F4, informational): `gridSnapStep` defaults to
   0.5 m ([0.5, 0.25, 0.1, 0.05]), but the host's DEFAULT item snapping
   mode is 'lines' — `getGridSnapStep()` returns 0 unless the mode is
   'grid' — i.e. interactive placement is free + line-snap until the user
   opts in. AUTO placement has no gesture to align to, so the machine
   picks the tidy default a user would: the 0.5 m world grid, the
   coarsest host step (every finer option divides it, so the spot sits on
   a grid line at every setting).

4. **ROTATION** — additive nullable `yawOverride` on the `bones:service`
   schema, threaded `node.yawOverride → ServicePointOverride.yaw →
   layoutHvac hpYaw`, consumed for unit #1's whole assembly (cabinet + pad
   + fixture/proxy) — beats wall-square when set, verbatim at any angle;
   null/absent == wall-square (never a stored copy of the derivation). Pad
   clearance under an oblique override uses the rotated reach
   `(|sin φ|+|cos φ|)·half` (+ matching overhang slack), so the night-4 F1
   punch-through class cannot return. The basement/off placeholder body
   reads the same yaw (placement.ts) — one orientation in every mode.
   HOST INVESTIGATION (read-only): the standard gestures reach nodes via
   two DEFINITION seams — `keyboardActions.r/t` (use-keyboard.ts, checked
   before the raw `rotation[1]` fallback) and a `handles` arc-resize
   'rotate' descriptor (`getDirectRotateHandle` in direct-manipulation.ts,
   used by the ⌘-drag rotate, the 2D floorplan rotate AND the on-canvas
   gizmo the arrow renderer mounts). BOTH are wired in
   src/service/definition.ts for heat-pump nodes only (other service types
   keep the host default — an inert rotation write, pre-existing).
   **NO host follow-up needed** for the single-selection gestures. STATED
   LIMITATION: the host's multi-selection `rotateGroupSelection` writes raw
   `rotation` on every node in the group (no registry seam) — a heat pump
   inside a MULTI-select rotate keeps its assembly orientation; host
   follow-up only if group-rotate parity is ever wanted.
   NOTED (verify round): `yawOverride` accumulates past 2π after full
   circles — exact host-item parity (the host's own rotation[1] does the
   same), no geometric effect (three.js wraps the euler); R/T step 45° =
   the host `ROTATION_QUANTUM` π/4, round-to-nearest-then-step semantics.

## Enumerated baseline classes (E5 recapture — the ONLY diffs)

Per-jurisdiction sweep (INTL + TX pinned corpus): **563 members /
47 fixtures each, counts and warnings byte-unchanged**; diff classes (all
the hvac condenser family, verified by field-level diff old→new):

- **M1 pad member** — label `(24" …)` → `(≥ 24" …)`; position
  [4.01905, ·, −1.1596] → [4.5, ·, −1.5] (along-snap + outward ceil on the
  baseline's 0.15 m walls). Rotation unchanged (pad was already
  wall-aligned).
- **M2 cabinet member** — position with the pad; rotation[1]
  2.8296 (equipment-room bearing) → **π** (wall-square on the south row).
- **M3 line-set pair** (suction + liquid) — outside stubs re-derive from
  the new anchor (dims/length/position class only).
- **M4 whip** — run re-anchors (position; the face-parallel leg lengthens
  with the stand-off), drop follows.
- **M5 AC-1 branch wiring** (`NM-B 10/2 w/G — AC-1`) — endpoints follow
  the disconnect spot (position/length class; gauge/breaker unchanged).
- **F1 condenser fixture** — position per M2; rotationY 2.8296 → π (the
  pick proxy reads this — proxy yaw == assembly yaw by construction).
- **F2 disconnect fixture** — position (along-wall foot of the snapped
  anchor); rotationY unchanged (already wall-square).

- **T1 takeoff lf cells** (REC-1 — the honest S4 mirror of M3/M4/M5,
  both corpora/jurisdictions): line-set ×3 rows (suction lf, liquid lf,
  insulation-sleeve lf) 12.1 → 14.8 lf; `NM-B 10/2 w/G` 13.2 → 11.6 lf;
  aggregate demo lines 58 → 58.4 and 33 → 32.4. **pcs counts unchanged**
  (condensers/pads/disconnects/whips) — only printed LENGTH cells move
  with the re-anchored runs. The pad row DETAIL also gains its size/basis
  (REC-2): `1 × 1 m × 4" concrete equipment pad (40"-class stock; IRC
  M1403)`, mirrored from the rendered member.
- **P1 paper elevations** — E/W elevation sheets recenter by a uniform
  −4.9 px transform (the moved condenser widens the projected extent;
  every mark shifts together — a recenter class, not a geometry class).

Everything else — every other engine, takeoff pcs counts, warnings,
labels — byte-equal (the compute.devices byte gate re-pins it live).

## Verify fix round (tip after 308ee22)

- **F1** world-XZ grid rework above; axis-aligned scenes reproduce the
  prior results exactly — the E5 recapture after the rework is
  BYTE-IDENTICAL to the wall-frame capture, so M1–F2/T1/P1 above stay the
  complete class list.
- **F2** CHECKLIST M2 disconnect row amended (the ≤ 1 m/≤ 1.5 m figures
  went stale at the unwarp round; the batch's silent 1.7 test allowance is
  gone). ROUND 2 (the round-1 restatement repeated the class in subtler
  form — 'S < S0 + 0.5' is an axis-aligned theorem only): the pick is now
  LEAST-STAND-OFF-FIRST (tie-break s → d² → u, total + deterministic —
  distinct lattice points cannot share both s and u; axis-parallel picks
  unchanged, PROVEN by the byte-identical E5 recapture cmp), and the row
  splits by wall class: axis-parallel S ≤ S0 + 0.5 ⇒ plan ≤ 1.57 / 3D ≤
  1.73 (keepouts are u-only, the minimal s-row is always reachable or the
  search exhausts honestly); OBLIQUE window-supremum theorem S ≤ S0 +
  1.75·(|sin θ|+|cos θ|) ≤ S0 + 2.475 ⇒ plan ≤ 3.54 / 3D ≤ 3.62 (keepouts
  cut diagonal lattice stripes — composed exhibit θ = π/5, t = 0.2,
  S − S0 ≈ 2.17, reach 3.32, on-grid, flag-free); exhausted ⇒ S = S0
  exactly + the flag. Gates agree to the digit PER CLASS: the axis scene
  gates keep 1.73; a CLASS-SWEEP gate (loop lesson: numeric class bounds
  for a search need a class-sweep gate, not a scene gate — sentence added
  to the M2 row) asserts the S-theorems + reach digits + byte-equal
  recompose determinism on every composed pick across azimuth × t ×
  shift × window sets, non-vacuous on both beyond-axis picks and
  exhaustion firings. Geometry option (a) alone was insufficient: the
  tie-break minimizes S but the only-valid-candidate case remains — the
  row covers it by theorem.
- **F3** off-grid honesty flag implemented + mutation-gated (above).
- **F5** (pre-unwarp seed → disconnect 'w_fence' orphan) is pre-existing
  at base — queued on the board by the coordinator, not this branch.

## Blast-radius re-oracles (updated as INTENDED)

- `hvac.condensers.test.ts` — election/fence/courtyard/exhaustion pins
  moved to the snapped coordinates (−1.1846→−1.5 class, slid 6.15→6.5 with
  the keepout-aware multiple pick); seed-parity BYTE gates re-pin on the
  new geometry (post-seed == auto held without change — the seed spot
  snaps identically by construction).
- Starter template — disconnect proximity pin restated (scene-true plan
  reach ≤ 1.5 with the snapped stand-off; the class bound lives in the
  amended M2 row); template composes on the same machinery, no data-file
  pins existed.
- `service/place.test.ts`, `service-overrides.test.ts`,
  `compute.mep-honesty.test.ts` — seed/auto consumers now compare against
  `placeCondenserSeedSpot` (the composed anchor: slide + snap);
  `placeHeatPumpSpot` remains the raw pre-snap election (panel action
  unaffected — seeding goes through the seed spot).
- ε-anchor — THREE machine spellings recognized: raw election spot,
  today's snapped unit-#1 spot, and `unit1Presnap` (the pre-snap slid
  spot), so heat-pump nodes seeded BEFORE this round keep the elected wall
  (no disconnect flip onto fences) and their verbatim position (no silent
  move on upgrade).

## New gates (all mutation-bitten)

- `src/engines/hvac.polish.test.ts` (18) — wall-square pinned on 3
  azimuths (0/90°/33.7° off-axis) incl. absolute π pin; row-of-two both
  square; verbatim-drag rule; 24-case thickness×offset snap sweep
  (on-grid both axes + clearance ≥ 24" always); WORLD-XZ snap on oblique
  walls (verify F1 — both world components exact multiples, yaw stays
  wall-square, floor holds, silent healthy path); away-only stand-off;
  physics-beats-grid window exhaustion → HONEST un-snapped spot + the
  off-grid flag on pad + cabinet (verify F3), verbatim scenes never carry
  the class; verbatim never snapped; byte seed parity on snapped geometry
  across 3 azimuths (oblique byte parity by construction — the lattice
  point is taken verbatim and re-derived with verbatim-path expressions);
  SLID legacy pre-snap seed recognition (the `unit1Presnap` bite);
  yawOverride verbatim/auto-anchor(rotate without
  moving)/absent==wall-square/oblique-pad honesty.
- `src/service/rotate.test.ts` (7) — R/T appliesTo gate; first press steps
  from the DERIVED yaw (host `steppedRotation` semantics) through the real
  `useScene` store; arc-handle shape/placement + `base − delta` sign
  convention; override reaches fixture + pick proxy; null clears to
  wall-square; placeholder body turns with the override.
- `condenser-asset.test.ts` color census — a red multi-material asset
  clones to 100% schematic tint (pinned `#8b8f96` == the steel bucket
  family), source asset untouched, module-cached material shared across
  builds, bucket material census flat.
- Schema (`schema.test.ts`) — yawOverride number/null/absent parse, junk
  rejected; compute extraction end-to-end incl. NaN/null honesty
  (`compute.test.ts`).

Mutation probes (all verified to fail the suite): retint disabled; legacy
bearing restored; grid snap disabled; hpYaw ignored; extraction dropped;
`unit1Presnap` recognition dropped. Verify fix round re-probes: off-grid
flag suppressed (1 fail); world snap disabled (5); away-only floor
dropped (4); world-z regressed to the honest stand-off, i.e. a partial
wall-frame regression (4) — all from /tmp backups, restore green.
