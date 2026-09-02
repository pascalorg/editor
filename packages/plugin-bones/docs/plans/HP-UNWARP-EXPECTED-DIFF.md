# HP-UNWARP EXPECTED-DIFF MANIFEST — true condenser proportions + 24" face-clearance standoff

Expected-diff enumeration for the unwarp round (branch `feat/hp-first-class`,
base `9721ff7`), following the B5/B10/B11 playbook. Julien 2026-08-23: "the
heat pump… is warped — compressed in one dimension. I don't think we need to
scale the original model. If we do, let's make sure we shrink in all
dimensions instead of 1." Anything outside the classes below is a defect.

## Trigger (source of truth)

`data/mep-rules.json` hvac.condenser:

- `unitDimsM` **[0.9, 0.8, 0.35] → [0.95, 0.85, 0.95]** — real
  top-discharge ducted heat-pump class (Bosch IDS BOVA-36 0.95×0.95×0.85 m,
  Goodman GSZ, Carrier 25VNA4 — basis in `unitDimsNote`), equal to the
  editor 'AC block' asset's native bbox aspect (1.06×0.95×1.06) within
  0.2% ⇒ the X-ray wrapper scale is a UNIFORM ≈ 0.896 shrink (gate:
  condenser-asset.test.ts scale-ratio pin, 1% tolerance).
- `padSideM` **0.95 → 1.0** (40"-class stock pad, 2.5 cm reveal per side).
- `faceClearM` **NEW = 0.6096 (24")** — AUTO anchors now stand off at
  `condenserStandoff(t) = t/2 + 24" + depth/2` from the wall centerline
  (hvac.ts), replacing the flat 0.6 m `PAD_OFFSET`. Face clearance is
  wall-thickness-honest; the old constant left ~0.37 m face-to-face and
  with the true 0.95 m depth would have pinched the coil to ~7 cm.
  `wallClearM` 0.3 (12") **unchanged** — it stays the hard row/verbatim
  floor (`minOff`). `unitClearM` 0.6 unchanged.

## Enumerated classes (the ONLY allowed diffs — all hvac condenser family)

Per-jurisdiction baseline sweep (INTL + TX pinned corpus, 563 members /
47 fixtures each — COUNTS UNCHANGED, byte-diff classes only):

- **M1 cabinet member** — dims [0.95,0.85,0.95]; center y 0.5016 → 0.5266;
  anchor moves out to `condenserStandoff` (baseline t = 0.15 → 1.1596 from
  the centerline) and the RO-slide keepout half-width grew with the pad
  (halfW 0.475 → 0.5 ⇒ slid anchors shift ±0.025 along-wall).
- **M2 pad member** — dims [1.0, 0.1016, 1.0]; centered under the cabinet
  at the new anchor; the S1 cladding slide no longer fires for AUTO
  anchors (24" > the 0.13 m R703.8 allowance + reveal); label restates the
  basis: `Condenser pad 4" — concrete (24" face clearance basis; per mfr
  clearance + IRC M1403)`. NEW honesty class: a VERBATIM anchor tucked
  closer than the assembly allowance slides the slab past the 2.5 cm
  reveal and flags pad + cabinet `⚠ cabinet overhangs its pad …` (never
  silent; impossible for auto anchors by construction).
- **M3 line-set pair** (suction + liquid, per unit) — outside stubs
  lengthen with the standoff; in-wall legs unchanged in class.
- **M4 whip + disconnect** — whip run lengthens to the new anchor; whip
  drop + disconnect fixture rise 0.05 (unit top 0.9016 → 0.9516; discY
  1.2016 → 1.2516). Disconnect plan spot unchanged (wall face).
- **M5 AC-1 branch wiring** (`NM-B 10/2 w/G — AC-1`) — endpoints follow
  the disconnect (lengths/positions only; gauge/breaker/labels unchanged).
- **F1 condenser + disconnect fixtures** — positions per M1/M4; labels,
  meta (tons/sizing basis/circuit) unchanged.
- **Row pitch** — `COND_PAD_SIDE + COND_UNIT_CLEAR` 1.55 → 1.6 (multi-unit
  scenes only; none in the pinned baseline).
- **Service seeding** — heat-pump seed = the engine's unit-#1 anchor
  (A4 parity preserved by construction; the seeded coordinate moves with
  the standoff).
- **Paper** — the pad/cabinet rects print true-size; the SEWER/SEPTIC
  marker gained a beyond-equipment candidate ring (plan-set.ts) because
  the true-size equipment blanketed the old rings on exit-wall units —
  marker placement class only, no other sheet changes.
- **Placeholder parity** — SERVICE_BODY['heat-pump'] mirrors the engine
  dims + center height (basement/toggle-off placeholder, move-tool ghost).

Everything else — every other engine, B12 GES / B14 WR outdoor-wall
machinery near the meter, roofs, walls, plumbing, takeoff counts — is
REQUIRED byte-equal: the baseline label-class diff shows exactly the
7 member classes + 2 fixture classes above and nothing else, per
jurisdiction; warnings byte-equal.

## Election / validation sweep

- `electHeatPumpExit` candidates now validate their spot at the per-wall
  standoff — the Julien-scene / courtyard / fence exhibits re-oracled
  (hvac.condensers.test.ts): semantics unchanged (walk-by-distance,
  outdoor validation, least-bad + ⚠, elected-wall row anchoring, ε-anchor
  machine-seed coherence). `spotIsOutdoors` validates the pad CENTER
  point, not the footprint — pre-existing, verified and stated (a pad
  half-side can still overhang a zone boundary; same class as before, no
  regression).
- `condenserRow` foot for the out-normal now derives from the clamped-u
  lerp (was `projectOnto`): ULP-identical semantics, restores the
  post-seed == auto BYTE gate for non-dyadic slid anchors (6.15 vs
  6.1499999999999995 — the old keepout arithmetic only produced dyadic
  values, masking the class).

## E5

`master-baseline.json` recaptured (`bun scripts/capture-master-baseline.ts`);
compute.devices byte-equality green over the new pin. Starter-template
pins updated as INTENDED: wall-clearance gate 0.5 → 1.0 (stand-off class),
disconnect proximity pin 1 m → 1.2 m plan (NEC 440.14 is a visibility
rule; the pin guards sanity across the wider standoff).

## Oblique-shell ULP residual (round-1 skeptic advisory)
The post-seed == auto BYTE property holds on axis-aligned walls
(incl. the non-dyadic slid anchors the foot fix closed). On OBLIQUE
(rotated) shells a last-ULP drift (≤9e-16, pre-existing — base
drifted 2.7e-15; this round improves it 3×) survives in pad
rotation / line-set dims / whip lengths; semantics (warnings, census,
labels, flags, elected wall) are byte-equal. Canonicalizing `out`
from the wall normal is the queued follow-up.
