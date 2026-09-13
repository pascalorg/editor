# MANUAL-J EXPECTED-DIFF MANIFEST — code-based HVAC sizing (IRC M1401.3)

Expected-diff enumeration for `feat/manual-j-sizing` (base `eb27037`,
suite 1644 → 1662; round-1 skeptic findings F1 latent + F2 installed-band
fixed in commits e/f), following the B10/B11 playbook. Julien's ask,
verbatim: "tonnage should follow code for the volume to cool according to
code. Maybe sometimes there are multiple HVAC systems and
heatpumps/exchanger." Anything outside the classes below is a defect.

## The code basis (stated on every consumer)

IRC M1401.3 — cooling equipment sized per **ACCA Manual S** from loads per
**ACCA Manual J**. A full Manual J is out of scope; this batch ships
**MANUAL-J-LITE v1**, honestly labeled, sensible-only, four terms
(`src/engines/manual-j.ts`; every constant + citation in
`data/mep-rules.json` → `hvac.manualJLite`):

1. **Envelope UA × design cooling ΔT** — exterior walls net of openings at
   the zone's prescriptive cavity R (wall-assemblies
   `insulationByClimateZone`, the same read the batt sizing does) +
   exterior glazing at U-0.32 (2021 IECC R402.1.2) + the **ceiling** at the
   zone's prescriptive R (2021 IECC Table R402.1.3: zone 1 R-30, 2–3 R-49,
   4–8 R-60; top-storey-under-attic assumption, stated — a "cooling load"
   that omitted the roof would be a lie). ΔT = per-zone ASHRAE/ACCA-style
   outdoor design dry-bulb default (zone 1→33 °C, 2→35, 3→34, 4→33, 5→33,
   6→31, 7→29, 8→26) − 24 °C indoor, with the **'verify local design
   conditions'** caveat (Table R301.2(1) / ACCA MJ8 Table 1A) in the notes.
2. **Glazing solar gain** — window area × per-orientation factor
   (N 75 / E 220 / S 150 / W 220 W/m² of glass, ASHRAE-style peak cooling
   proxies) × assumed SHGC 0.30 (2021 IECC R402.1.2 zones 1–3 max).
   Orientation = the wall's outward normal (away from the interior
   centroid) bucketed to the dominant plan axis; axes assumed
   world-aligned (+x = east, −z = north) — stated, not divined.
3. **Internal gains** — Manual J defaults: 230 Btu/h (67.4 W) sensible per
   occupant at occupancy = **bedrooms + 1**, plus 1,200 Btu/h (351.7 W)
   appliances.
4. **Infiltration** — 0.33 Wh/(m³·K) × **ACH 0.35 (assumed)** × conditioned
   VOLUME (Σ room area × ceiling height — Julien's "volume to cool"; the
   same sum the characteristics block prints) × ΔT.

5. **Latent allowance** (round-1 skeptic F1 — the sensible-only figure
   sized a humid-zone system a half ton short IN band with the confession
   living only in docstrings/notes): the four-term SENSIBLE sum scales by
   a COARSE class factor keyed on the zone's IECC moisture-regime letter
   (the letter already in `stateClimateZone`): **A humid ×1.25 / B dry
   ×1.05 / C marine ×1.10**; bare-digit zones (AK '7') take ×1.0 and say
   so. Stated basis in the data table — 'full ACCA Manual J latent
   calculation governs'. The COMPOSITION (sensible × factor → selected)
   prints on every consumer: condenser + AH labels and meta, the takeoff
   buy line, the characteristics row VALUE, the schedules sheet + its
   basis line.

Btu/h ÷ 12,000 → sensible tons → × latent factor = the DESIGN load;
equipment = smallest **half-ton** multiple ≥ the design load, floored at
1.5 tons, within the **Manual S 95–115% band** (common practice) — a
selection pushed out of the band by stock steps or the floor **warns**,
never silent. The band holds on the **INSTALLED SUM too** (round-1
skeptic F2): the ≤5-ton split rounds each unit to a stock half ton, so
count × unitTons can leave the band the plan total passed — the overrun
warns with a one-decimal percent ('installed 6 tons = 118.1% of the
5.08-ton load — exceeds the Manual S 115% band…'; one decimal because a
115.1% overrun rounded to '115%' would print a contradiction). Duct
gains, floors, doors, shading: NOT modeled — labels say "Manual J-lite"
everywhere.

## ONE system tonnage (the sizing unification)

`sizeCoolingPlan` (hvac.ts) is the single source: **air handler label,
duct cfm (400 cfm/ton), return-grille size AND the condenser row all size
from one plan.** The old engine ran TWO rules side by side — AH at
1 ton/500 sqft (`tonsFor`), condensers at 450/550/650 sqft/ton — so even
fallback scenes change their AH tonnage where the two rules disagreed
(enumerated below). `tonsFor` stays exported as a labeled legacy helper.

## FALLBACK (kept, labeled, never silent)

The 450/550/650 sqft-per-ton rule (`condenserPlan`) sizes **only** when
the load cannot compute; the trigger goes ON THE LABEL
("assumed 1 ton/550 sqft — Manual J-lite fallback: <trigger>"):

- **climate zone unknown** — INTL / unset / any code missing from
  wall-assemblies `stateClimateZone` (this is why every no-stateCode test
  scene and the INTL baseline stay sizing-identical);
- **no straight exterior envelope** on the level;
- **no conditioned volume** (no indoor, non-garage rooms).

**LOD does NOT gate the load** — walls/rooms exist at every LOD, so the
LOD-200/300/400 composes all size identically (decided; the brief's
"LOD<400?" candidate trigger was rejected as arbitrary: no input the load
needs is LOD-gated).

## MULTI-SYSTEM (Julien's "multiple HVAC systems and heatpumps/exchanger")

Loads over 5 tons split into N condensers (count = ceil(total/5), per-unit
tonnage = total/count to the nearest half ton) on the EXISTING
condenser-row machinery — election, RO slides, pads, line-sets,
disconnects untouched. The indoor side is drawn as **ONE air handler with
the single-indoor-coil/exchanger assumption STATED** (AH label suffix
"serves N condensers (N × X t installed vs Y t selected), single indoor
coil assumption" + a level warning "…ONE air handler/duct system drawn…
Manual S/D govern"). The AH FIGURE (label/cfm/grille) is the **INSTALLED
capacity** (F2 reconciliation: an AH reading 5.5 t beside 2 × 3.0-ton
cabinets was its own honesty gap — the drawn coil serves the cabinets
that exist; `meta.selectedTons` keeps the Manual S selection when the two
differ, and single-unit scenes carry no duplicate key). Decided
because `supplySpineOf` models exactly one trunk network from one
equipment point; drawing N air handlers would invent zoning
(dampers/per-system register splits) the engine cannot route, and the
brief forbids invented zoning dampers.

## Enumerated diff classes (blast radius: every scene with HVAC)

- **D1 — condenser fixture labels**: `(assumed 1 ton/450 sqft, zone 2A)` →
  `(Manual J-lite, zone 2A design 35°C, 2.62 t sensible × 1.25 latent
  (regime A))` on zone-resolving jurisdictions (the F1 composition;
  regime-less zones print `…, X t sensible, no latent allowance (no
  regime letter)`);
  on fallback scenes the old wording is KEPT and gains the appended
  trigger (`… — Manual J-lite fallback: climate zone unknown for 'INTL' —
  set the jurisdiction`). `meta.sizingBasis` added everywhere.
- **D2 — sized tonnage moves where the load ≠ the old rule**: cabinet
  member labels (`AC condenser #N — X tons outdoor unit` — format
  byte-stable, value moves), condenser fixture tons/totalTons, AH
  tons, all cfm figures (registers, trunk step-down labels, return
  trunk), return-grille in² selection, disconnect `meta.va`
  (tons × 1200). On typical scenes the Manual-J-lite load lands BELOW the
  sqft rule (the rule is the industry's oversizing habit; the lite load
  omits latent/ducts — stated), so tonnage usually drops toward the
  1.5-ton floor on small/tight scenes.
- **D3 — AH label** always changes: `(rule of thumb; Manual J/S govern)` →
  `(<sizingNote incl. composition>; Manual J/S govern)` (+ the multi-unit
  installed-vs-selected suffix when N > 1; the AH FIGURE = installed
  capacity, F2); meta gains `sizingBasis`, `loadBtuH` (design load),
  `sensibleBtuH`, `latentFactor`, `moistureRegime` (manual-j basis;
  omitted when regime-less) and `selectedTons` (splits only).
- **D4 — new warning classes** (panel drawer + P4 flags block):
  - Manual-S band: `cooling selection X tons sits outside the Manual S
    95–115% band for the Y-ton Manual J-lite load…verify equipment
    selection (M1401.3)` — fires honestly on small loads hitting the
    1.5-ton floor (incl. the TX baseline scene);
  - multi-system: `cooling load takes N condensers — ONE air handler/duct
    system drawn…` (N > 1 only);
  - installed-sum band (F2): `installed X tons = P% of the Y-ton Manual
    J-lite load — exceeds the Manual S 115% band (stock unit steps after
    the ≤5-ton split); verify selection` (fires only when the plan total
    passed the band and the split's rounding left it).
- **D5 — takeoff 'AC condensers' row** carries per-unit tonnage + the
  composition: `N × X tons (Y tons total) — Manual J-lite S t sensible ×
  F latent (R), Manual S governs (M1401.3)` (fallback keeps `assumed
  sizing`; regime-less prints `Manual J-lite sizing (sensible-only, no
  latent allowance)`); the total is the INSTALLED sum (2 × 3-ton units =
  6 tons bought, above a 5.5-ton plan — real purchasing).
- **D6 — characteristics cooling row**: `Cooling estimate (rule of
  thumb)` → `Cooling load (Manual J-lite)`; the row VALUE shows the F1
  composition — `0.52 (0.42 sensible × 1.25 latent A)` — the SAME design
  load HVAC sizes from, + seven term-by-term basis notes (incl. the
  latent line); fallback keeps
  the old row name and its note gains `(Manual J-lite unavailable:
  <trigger>)`. New optional `coolingBasis` field (absent = rule-of-thumb,
  so hand-built fixtures/paper stay on the legacy wording).
- **D7 — schedules sheet**: `Cooling ~X ton (RULE OF THUMB)` →
  `(MANUAL J-LITE: S t sensible × F latent R)` (regime-less:
  `(MANUAL J-LITE load, sensible-only — no latent allowance)`) + the
  basis line `cooling per Manual J-LITE (M1401.3) — coarse latent
  allowance by moisture regime, full Manual J latent governs; verify
  local design conditions; not a full Manual J` (only when the basis is
  manual-j-lite).
- **D8 — one sub-millimetre geometry delta per baseline jurisdiction**: a
  stepped trunk segment's width is `TRUNK_W × remaining/totalCfm` over
  integer-rounded register cfm — a different total re-rounds the ratio
  (INTL 0.23683 → 0.23736 m; TX → 0.23707 m). Labels round to the same
  9"; no other member geometry moves anywhere (verified over the full
  baseline: 563/563 members, only this dims[2]).

Placement, election, row machinery, line-sets, disconnects, plumbing,
electrical, framing: **byte-identical** (0 geometry deltas beyond D8 in
the E5 recapture; all 16 election/row hunt gates green untouched).

## E5 baseline recapture (exact, from the old-vs-new JSON diff)

**INTL** (fallback — sizing-identical for the condenser: 2 tons then and
now; the AH moves 2.5 → 2.0 because the old 500-sqft AH rule died):
members 563→563 (D8 only + 3 label cfm changes: trunk 666→534 cfm,
2× return trunk 1000→800 cfm, 2× branch 333→267 cfm); fixtures 47→47 —
AH label/tons/cfm (2.5 t/1000 cfm → 2 t/800 cfm) + fallback-trigger
label, condenser label gains the trigger (tons unchanged 2), central
return 600→400 in² (need 2×200=400 exactly fits the 400 catalog grille),
3 register labels 333→267 cfm, `sizingBasis` metas; warnings 8→8.

**TX** (zone 2A → Manual-J-lite): the 96 m² baseline scene's load =
4,995 Btu/h ≈ 0.42 tons → 1.5-ton floor. Members 563→563 (D8 + trunk
666→400 cfm, 2× return 1000→600, 2× branch 333→200, cabinet label
2.5→1.5 tons); fixtures 47→47 — condenser `2.5 tons (assumed 1 ton/450
sqft, zone 2A)` → `1.5 tons (Manual J-lite, zone 2A design 35°C)`, AH
2.5→1.5 t (600 cfm, loadBtuH 4995), return 600→400 in², registers
333→200 cfm, disconnect va 3000→1800; warnings 8→9 (+ the Manual-S band
warning — the 1.5-ton floor is 3.6× the lite load; honest).

**F1 re-recapture (commit e)** on top of the record above: INTL
byte-identical (fallback — no regime, no latent); TX = exactly 2 fixture
label/meta deltas (AH + condenser gain the `0.42 t sensible × 1.25
latent (regime A)` composition; meta gains sensibleBtuH 4995 /
latentFactor / moistureRegime, loadBtuH becomes the design 6244) + the
band warning's load figure moves 0.42 → 0.52 tons. Members untouched
(563/563 byte-identical — the 1.5-ton floor absorbed the allowance, so
no cfm/tonnage figure moved on this scene). **F2 recapture: verified
byte-identical** (single-unit scenes; `selectedTons` is split-only by
design).

INTL ≠ TX now diverge through the climate zone — EXPECTED and gated
(FL-vs-MN divergence gate; the INTL fallback arm pins the label trigger).
`starter-template.test.ts` (INTL) passed **unchanged** — fallback sizing
is identical to master there (2 tons from 96 m²).

## Mutation probes (all RED, /tmp backup-restore, never git checkout)

| # | mutant | biting gates |
|---|--------|--------------|
| P1 | drop infiltration term | 4 fail (hand-computed load, engine tonnage) |
| P2 | east solar factor 220→150 | 2 fail (hand gates) |
| P3 | drop ceiling UA term | 4 fail |
| P4 | design-temp lookup pinned 33 (live line — mutating the dead JSON-fallback literal was a no-op, re-oracled) | 6 fail (hand, divergence, labels) |
| P5 | Manual S ceil→round | 3 fail (selection, band) |
| P6 | sizeCoolingPlan never consults the load | 5 fail (labels, coherence) |
| P7 | condenser count pinned 1 | 1 fail (5-ton split) |
| P8 | multi-system warning silenced | 1 fail |
| P9 | characteristics ignores the load | 4 fail (coherence, notes, CSV) |
| P10 | takeoff per-unit tonnage dropped | 2 fail (S4 mirror) |
| P11 | cabinet material steel→wood (A6 triple) | 9 fail (A6 sweeps + split gate) |
| P12 | latent allowance dropped (factor forced 1) | 8 fail (F1 exhibit, hand gates, regime tests, coherence) |
| P13 | installed-band check neutered (always true) | 2 fail (F2 window exhibit, 115.1% arm) |
| P14 | AH figure back to the plan total | 2 fail (F2 reconciliation pins) |
| P15 | label composition dropped from sizingNote | 3 fail (label pins across gates) |

## Gates

`src/engines/manual-j.test.ts` (hand-computed four-term load — every term
independently derived in the test; latent regime A/B/C/bare + marine 4M;
zone divergence; fallback triggers; Manual S band; orientation
bucketing) · the "Manual-J-lite engine sizing" describe in
`src/engines/hvac.condensers.test.ts` (hand-derived engine tonnage incl.
the ×1.25 step w/ design-load sanity pin; 5-ton split → 2 units w/
composed per-unit labels, A6 triple on every cabinet, row composed
outdoors + 0.6 m clearances, takeoff mirror, multi-system label+warning,
the F2 installed-band exhibit in the (5.0, 5.22] window — selection in
band, installed 118.1% out, AH reconciled to 6 t; FL-vs-MN divergence
incl. the 115.1% hair-over-band arm; the F1 latent exhibit — 2.6 t
sensible → 3.5 t selected, dry 2B stays 3.0; band warning + fallback
silence) · basis-label gate (FL Manual-J vs INTL fallback + AH parity) ·
characteristics coherence + composed row value + fallback arm
(`characteristics.test.ts`) · paper composition pins incl. the
regime-less sensible-only arm (`plan-set.test.ts`). Checklist row **M2**
rewritten to the new invariant (same commits), amended for F1/F2.

Suite: 1662 pass / 0 fail, tsc clean; E5 recaptured at slices (b) and
(e), F2 verified a baseline no-op.
