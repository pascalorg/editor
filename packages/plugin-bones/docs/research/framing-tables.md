# IRC Prescriptive Framing Tables — Research Notes

**Scope:** background for the Bones framing-inference engine and the companion dataset
[`data/framing-tables.json`](../../data/framing-tables.json).
**Code basis:** 2021 International Residential Code (IRC). 2024 deltas noted where checked.

> **Disclaimer.** Drafting aid, not engineering. Typical/approximate values — verify with the
> local authority having jurisdiction (AHJ). Everything below is the *prescriptive* path of the
> IRC; anything outside table limits (point loads, tall walls, high wind/seismic/snow, engineered
> lumber) requires accepted engineering practice.

---

## 1. How the values were sourced and verified

Primary text for all table values is the **2021 IRC as published on UpCodes**
(Texas adoption of the unamended base IRC; per-chapter print/export views, which embed the full
tables server-side):

- Ch. 6 Wall construction — headers R602.7(1), studs R602.3(5), fastening R602.3(1):
  <https://up.codes/viewer-export/texas/irc-2021/chapter/6/wall-construction>
- Ch. 5 Floors — floor joists R502.3.1(2):
  <https://up.codes/viewer-export/texas/irc-2021/chapter/5/floors>
- Ch. 8 Roof-ceiling — ceiling joists R802.5.1(2), rafters R802.4.1(1)/(5):
  <https://up.codes/viewer-export/texas/irc-2021/chapter/8/roof-ceiling-construction>
- Ch. 4 Foundations — anchor bolts R403.1.6/R403.1.6.1:
  <https://up.codes/viewer-export/texas/irc-2021/chapter/4/foundations>

Cross-checks (all values in the dataset were confirmed against at least one independent source):

- **Code Check Building 5th ed. supplemental header tables** (2021-IRC based; matches the 2021
  R602.7(1) values cell-for-cell for four of five support conditions):
  <https://codecheck.com/wp-content/uploads/2023/09/Additional-Header-Girder-Tables.pdf>
- **2015 IRC full chapter text** (ICC text mirrored in the cochise-county-building-codes repo) and a
  **2015 IRC scan** (Fine Homebuilding / Code Check 9th ed.) — used to establish the 2015→2018
  header-table rework and to confirm the joist/rafter/stud tables did not change 2015→2021:
  <https://raw.githubusercontent.com/chenders/cochise-county-building-codes/main/scripts/irc_chapters/chapter_06.txt>,
  <https://images.finehomebuilding.com/app/uploads/2022/05/06232725/9330_1651894045_9th-edition-Girder-and-Header-Spans-for-Exterior-Walls.pdf>
- **2024 IRC per-chapter exports** (same UpCodes mechanism, `irc-2024`): the exact SPF row
  signatures for the floor/ceiling/rafter tables and the header-table rows captured here appear
  verbatim in the 2024 text → **no 2024 delta** for anything in the dataset.
- **AWC Span Tables for Joists and Rafters, 2024 ed.** (the standard the IRC spans derive from;
  background on design criteria, not used for direct values):
  <https://web-media.awc.org/wp-content/uploads/2023/11/17210157/AWC_STJR2024_20231127_AWCWebsite.pdf>
- A 2018-IRC county handout (Humboldt County NV,
  <https://www.humboldtcountynv.gov/DocumentCenter/View/3391/Header-Table>) was consulted but
  contains transcription errors (several 36-ft cells copied from the 50-psf column); the official
  2021 text above resolves them. Secondary blog/calculator pages (jaspector.com, sitecalcapp.com)
  were consulted and found **numerically unreliable** — do not source values from them.

Historical note that builds confidence in edition stability: the 2003 IRC print of Table
R502.3.1(2) (<https://www.yournhpa.org/BasicTrainingBuildingMaterials/Lumber/2Selling_Lumber/Using_Span_Tables/presentation_content/external_files/Floor%20Joist%20Spans%20for%20Common%20Lumber%20Species.pdf>)
already shows today's SPF values; only Southern pine (2013 SPIB downgrade) and slight DF-L updates
changed between 2003 and 2015. From 2015 through 2024 the joist/ceiling/rafter/stud tables captured
here are unchanged.

---

## 2. Headers / girders — IRC 2021 Table R602.7(1)

**Where read:** UpCodes 2021 IRC ch. 6 export (above); verified against Code Check 5th ed. tables
30B-30E.

**What the table is:** maximum header/girder spans in *exterior bearing walls* for built-up
dimension-lumber headers (1-, 2-, 3-, 4-ply 2x4…2x12), organized by:

- **Support condition** (rows): roof+ceiling; roof+ceiling+1 center-bearing floor;
  roof+ceiling+1 clear-span floor; roof+ceiling+2 center-bearing floors; roof+ceiling+2 clear-span
  floors. "Center-bearing" = the floor joists bear on an interior wall/girder mid-span (half the
  load goes to the header); "clear-span" = joists span the full building width (worst case).
- **Ground snow load** columns: 30 / 50 / 70 psf. Footnote e: use the 30-psf column where ground
  snow < 30 psf and roof live load ≤ 20 psf — so **30 psf is the low-snow default**.
- **Building width** columns: **12 / 24 / 36 ft** (perpendicular to the ridge). Footnote c permits
  linear interpolation between widths.

**Species/grade assumption:** one span for No. 2 grade Douglas fir-larch, hem-fir, Southern pine
and spruce-pine-fir (footnote b) — i.e. the table already takes the weakest of the four, so no
species selection is needed for headers.

**Key footnotes carried into the dataset:**

- NJ = jack studs required each end; where NJ = 1 an approved framing anchor may substitute
  (footnote d).
- Spans assume the header top is laterally braced by perpendicular framing; if cripple studs bear
  on the header, multiply 2x8/2x10/2x12 spans by **0.70** (footnote f).

**The ~28-ft building problem.** The task geometry (~28 ft width) fell directly on a column in the
**2015** table (widths 20/28/36) but the table was completely recalculated for the **2018/2021**
editions (widths 12/24/36, single-ply rows added, spans generally shorter — e.g. roof+ceiling
2-2x10 at 28 ft was 7-3 in 2015; 2021 interpolation gives ≈ 6-5). The dataset therefore stores the
official 2021 columns at 24 ft and 36 ft **plus** an `interpolated28ftWidth` block (linear
interpolation per footnote c, floored to the whole inch, jack studs taken as the max of the two
columns). Flag: **interpolated values are derived, not printed in the code.**

Selected 2021 values, ground snow 30 psf (span ft-in / NJ):

| Size | Roof+clg 24 ft | Roof+clg 36 ft | Roof+clg ≈28 ft* | +1 c.b. floor 24 ft | +1 c.b. floor 36 ft | +1 c.b. floor ≈28 ft* |
|---|---|---|---|---|---|---|
| 2-2x4 | 3-1 / 1 | 2-7 / 1 | 2-11 / 1 | 2-6 / 1 | 2-2 / 1 | 2-4 / 1 |
| 2-2x6 | 4-7 / 1 | 3-10 / 1 | 4-4 / 1 | 3-9 / 1 | 3-3 / 2 | 3-7 / 2 |
| 2-2x8 | 5-9 / 1 | 4-10 / 2 | 5-5 / 2 | 4-10 / 2 | 4-1 / 2 | 4-7 / 2 |
| 2-2x10 | 6-10 / 2 | 5-9 / 2 | 6-5 / 2 | 5-8 / 2 | 4-10 / 2 | 5-4 / 2 |
| 2-2x12 | 8-1 / 2 | 6-10 / 2 | 7-8 / 2 | 6-8 / 2 | 5-8 / 2 | 6-4 / 2 |

\* derived by interpolation — not code text.

**Simplified fallback** (`headers.simplifiedFallback`): the requested coarse map
`{24:"4x4", 36:"4x6", 60:"4x8", 84:"4x10", 999:"4x12"}` (max clear span in inches → nominal size,
double-2x ply ≈ 4x solid). Checked against the real table: it is consistent with the roof+ceiling
condition up to ~24-ft building width, but the `60→4x8` and `84→4x10` steps **exceed** tabulated
spans at 28-36 ft widths (2-2x10 allows only 77 in at 28 ft). It is a rendering fallback only; the
engine should use the full table whenever the support condition and width are known.

**2024 delta: none.** The 2024 export shows the same snow columns, widths and row values
(spot-verified across all five support conditions and the footnotes). A widely-cited claim that the
2024 table uses 20-40 ft widths (jaspector.com) is wrong.

---

## 3. Floor joists — IRC 2021 Table R502.3.1(2)

**Where read:** UpCodes 2021 IRC ch. 5 export; identical values in the 2015 ICC text and the 2024
export.

**Assumptions:** residential living areas, **40 psf live / 10 psf dead, deflection L/360**,
repetitive-member bending. The same table carries a 20-psf-dead block (shorter spans — use it under
tile floors, thick gypcrete, etc.); sleeping areas may use the 30-psf-live Table R502.3.1(1).

Dataset carries **SPF #2** (primary; note SPF #1 has identical design values so the rows match) and
**DF-L #2** (noted alternative; longer at 12 in oc where deflection governs, nearly identical at
16/24 in oc where strength governs):

| Size | Species | 12" oc | 16" oc | 24" oc |
|---|---|---|---|---|
| 2x6 | SPF #2 | 10-3 | 9-4 | 8-1 |
| 2x8 | SPF #2 | 13-6 | 12-3 | 10-3 |
| 2x10 | SPF #2 | 17-3 | 15-5 | 12-7 |
| 2x12 | SPF #2 | 20-7 | 17-10 | 14-7 |
| 2x6 | DF-L #2 | 10-9 | 9-9 | 8-3 |
| 2x8 | DF-L #2 | 14-2 | 12-9 | 10-5 |
| 2x10 | DF-L #2 | 18-0 | 15-7 | 12-9 |
| 2x12 | DF-L #2 | 20-11 | 18-1 | 14-9 |

Span is clear span between supports. Decimal-feet values in the JSON are **truncated down** to
0.1 ft (e.g. 15-5 → 15.4) so the decimal never exceeds the code value; the ft-in string is
authoritative.

---

## 4. Ceiling joists — IRC 2021 Table R802.5.1(2)

**Numbering gotcha:** the 20-psf "uninhabitable attic with limited storage" table is
**R802.4(2) in IRC 2015 and earlier**, renumbered **R802.5.1(2) in IRC 2018/2021/2024** (chapter 8
was reorganized in 2018: rafter tables became R802.4.1(x), ceiling-joist tables R802.5.1(x)).
Content is unchanged. The no-storage 10-psf table is R802.5.1(1) (longer spans; only appropriate
where the attic truly cannot be accessed for storage — most engines should default to 20 psf).

**Assumptions:** live 20 psf, dead 10 psf, L/240, SPF #2:

| Size | 12" oc | 16" oc | 24" oc |
|---|---|---|---|
| 2x4 | 9-5 | 8-7 | 7-2 |
| 2x6 | 14-9 | 12-10 | 10-6 |
| 2x8 | 18-9 | 16-3 | 13-3 |
| 2x10 | 22-11 | 19-10 | 16-3 |

---

## 5. Rafters — IRC 2021 Tables R802.4.1(1) and R802.4.1(5)

**Numbering:** 2021 rafter tables are R802.4.1(1)-(8) (formerly R802.5.1(1)-(8) in 2015):
(1) roof live 20 psf / not attached; (2) same, ceiling attached; (3)/(4) ground snow 30 not
attached / attached; **(5)/(6) ground snow 50** not attached / attached; (7)/(8) ground snow 70.
Note the 2015→2021 mapping is *not* one-to-one by index (2015's snow-50/not-attached table was
R802.5.1(4)).

**"Ground snow 20" mapping:** there is no snow-20 rafter table. Where ground snow is low, the
20-psf **roof live load** table R802.4.1(1) governs (same convention as header footnote e). The
dataset labels it `groundSnow20Psf` with an explanatory note.

**Assumptions:** dead 10 psf, **ceiling not attached to rafters** (L/180 — ridge-board roof with
ceiling joists at plate level; if the ceiling is attached to the rafters, e.g. cathedral, use the
L/240 variants which are shorter), SPF #2. **Spans are horizontal projection**, not slope length.

| Size | LL20: 16" oc | LL20: 24" oc | Snow 50: 16" oc | Snow 50: 24" oc |
|---|---|---|---|---|
| 2x6 | 14-4 | 11-9 | 9-9 | 7-11 |
| 2x8 | 18-2 | 14-10 | 12-4 | 10-1 |
| 2x10 | 22-3 | 18-2 | 15-1 | 12-4 |
| 2x12 | 25-9 | 21-0 | 17-6 | 14-3 |

(12-in-oc values also in the dataset; 2x12 @ 12 in oc under LL20 prints "Note b" — exceeds 26 ft —
capped at 26.0 in the JSON with a note.) Rafter tables also assume the ridge is a non-structural
ridge *board* with rafter ties / ceiling joists resisting thrust (R802.4.5, heel-joint table
R802.5.2(1)); raising ties above the plate reduces allowable span (H_C/H_R factors, footnote a of
the rafter tables).

---

## 6. Studs — IRC 2021 Table R602.3(5) and R602.3.1

**Where read:** UpCodes 2021 ch. 6 export; identical in 2015 text and 2024 export.

Bearing walls (heights are *laterally unsupported* height; sheathing one side or bridging at
≤ 4 ft satisfies footnote a):

- **2x4:** max height 10 ft; 24 in oc supporting roof+ceiling only; 16 in oc supporting one floor
  + roof+ceiling; **not permitted** under two floors + roof; 24 in oc supporting one floor only.
  Footnote c: under a habitable attic, 2x4 is limited to 32-ft roof span.
- **2x6:** max height 10 ft; 24 in oc for roof+ceiling or one floor + roof+ceiling; 16 in oc for
  two floors + roof+ceiling.
- Nonbearing: 2x4 to 14 ft, 2x6 to 20 ft, both at 24 in oc; 2x3 interior only, 10 ft @ 16 in oc.

**The "10-ft limit" and its escape hatches (R602.3.1):** utility-grade studs are capped at 16 in
oc / 8 ft (exterior or bearing); No. 2 2x6 studs may go to **18 ft @ 16 in oc or 20 ft @ 12 in oc**
where ground snow ≤ 25 psf, ultimate wind ≤ 130 mph, and roof tributary length ≤ 6 ft; and
Table R602.3(6) (not captured) permits exterior bearing studs to 12 ft under Exposure B,
roof live ≤ 20 psf, snow ≤ 30 psf. Taller than that → engineered design.

---

## 7. Anchor bolts — IRC 2021 R403.1.6, R403.1.6.1, R602.11.1

2021 text (values unchanged from 2015; 2021 adds language permitting wet-set bolts placed while
concrete is plastic):

- **1/2-in diameter** bolts, spaced **≤ 6 ft oc**, embedded **≥ 7 in** into concrete or grouted CMU
  cells, located in the **middle third of the plate width**, nut + washer tightened on each bolt.
- **≥ 2 bolts per plate section**, with one bolt **≤ 12 in and ≥ 7 bolt diameters (3.5 in)** from
  each end of each plate section.
- Exceptions: short walls connecting offset braced panels (≤ 24 in: one centered bolt; ≤ 12 in: no
  bolt).
- **SDC D0-D2 (and SDC C townhouses), R403.1.6.1:** add **0.229 x 3 x 3 in plate washers** on all
  bolts along braced wall lines (R602.11.1; diagonally slotted hole up to 3/16 in oversize allowed
  with a cut washer); interior braced-wall plates and interior bearing sole plates on continuous
  foundations get the same 6-ft/12-in rule; **max spacing drops to 4 ft for buildings over two
  stories**. (The often-repeated "closer spacing at braced panels" in lower SDCs is a common local
  amendment, not base 2021 text.)

---

## 8. Fastening — IRC 2021 Table R602.3(1)

Captured as *notes only* (`fasteningHighlights`), items verified verbatim from the 2021 export:
ceiling joist→plate 3-8d common toe (item 2); rafter→plate 3-10d common toe, 2+1 (item 6);
stud→stud 16d @ 24 in (item 8); double top plate 16d @ 16 in with 8-16d splice / 24-in lap
(items 13-14); bottom plate→joist 16d @ 16 in, braced panels 3-16d box per 16 in (items 15-16);
stud↔plate toe 4-8d or end 2-16d (item 17); WSP sheathing 6 in edge / 12 in field, roofs 6/6 with
8d common or RSRS-01 (items 31-32). High-wind/seismic uplift connectors (hurricane clips, straps)
are outside this table — R802.11 governs uplift and is not captured in the dataset.

---

## 9. What is approximate / engine guidance

| Dataset field | Status |
|---|---|
| Header spans at 12/24/36 ft, snow 30 | **Exact 2021 code text** |
| `interpolated28ftWidth` | Derived (interpolation permitted by footnote c, but numbers are ours) |
| `simplifiedFallback` | Approximate; unconservative for 2x10+ at ≥ 28 ft width — prefer the table |
| Joist/ceiling/rafter spans | Exact 2021 code text (SPF #2 / DF-L #2 rows) |
| `spanFt` decimals | Truncated down to 0.1 ft; ft-in strings authoritative |
| Stud/anchor/fastening rules | Exact 2021 code text, condensed |
| Loads (40/10, 20/10, snow 30/50) | Typical defaults; actual loads vary by jurisdiction and assembly |

Not covered (out of scope for this dataset, engine should flag): Southern pine and hem-fir species
rows, 20-psf dead-load blocks, snow 70 columns, interior-bearing header table R602.7(2), open-porch
header table R602.7(3), rim-board headers R602.7.2, girder table R602.7 for interior girders under
floors (R502.5 points to the same R602.7 tables), wall bracing (R602.10), heel-joint connections
(R802.5.2), and all engineered-lumber products.
