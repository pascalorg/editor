# B11 EXPECTED-DIFF MANIFEST — header rules by ground-snow band (Table R602.7(1))

Expected-diff enumeration for LOD-400 BATCH 11 (branch `feat/lod400-b11`,
base `779d70e`), following the B5/cavity-fit playbook. The batch selects
per-snow-band `headerRules` in `applyJurisdiction` — VT (60 psf ground
snow) used to frame headers byte-equal to INTL — so heavy-snow states'
headers deepen. Anything outside the classes below is a defect.

## Encoding (source of truth)

IRC 2021 Table R602.7(1), ground-snow 50-psf and 70-psf columns,
**roof-and-ceiling condition, 2-ply rows, 12/24/36-ft widths**, added to
`data/framing-tables.json` (`headers.groundSnow50Psf/groundSnow70Psf`) from
the same UpCodes 2021 ch. 6 export the shipped 30-psf block was read from
(docs/research/framing-tables.md §1); the extraction reproduced the shipped
30-psf cells cell-for-cell before the new columns were transcribed. 2024
delta: none (the meta note's spot-verification covers R602.7(1)).

Rule derivation (`headerRulesFromSnowColumn`, src/core/spec.ts): per size,
threshold = min(tabulated span at the **24-ft width column**, the shipped
default's threshold) — never looser than the low-snow default, never longer
than the code cell. ROUND 2 (skeptic): the terminal 4x12 rule is capped at
the band's 2-2x12 cell — `applyJurisdiction` takes
min(`engineeredHeaderSpan` 10 ft, 83" @ 50 psf / 74" @ 70 psf,
`terminalSpanOf`) — so a past-cap span routes to the ENGINEERED machinery
(supplier SKU + 'ENGINEERED BEAM REQUIRED' flag) instead of a silent
lumber 4x12 whose assumption label affirms the table outside its domain.
Low-snow keeps the shipped 10-ft threshold (its labels make no table
claim — that terminal gap is pre-existing and out of B11 scope).

| band | rules (max clear span → nominal 4x ≙ 2-ply) |
| --- | --- |
| ≤ 30 psf | 24"→4x4 · 36"→4x6 · 60"→4x8 · 84"→4x10 · rest 4x12 (the shipped default, byte-equal) |
| 30–50 psf | 24" · 36" · 60" · **71"** (5-11) · 4x12 to **83"** (6-11), engineered past |
| > 50 psf | 24" · 36" · **53"** (4-5) · **63"** (5-3) · 4x12 to **74"** (6-2), engineered past |

Band selection SNAPS UP (a column may not serve loads above it; footnote e
covers < 30 psf): ≤ 30 → 30 column, ≤ 50 → 50 column, else 70 column.
Sites past 70 psf (no shipped profile exceeds 60) additionally confess
'engineered design required' in the assumption.

## The deepened set (14 states; everything else REQUIRED byte-equal)

- **50-psf column** (researched ground snow 35–50 psf):
  AK ID MA MN MT ND NY SD UT WI WY
- **70-psf column** (60 psf): ME NH VT

## Enumerated classes (the ONLY allowed diffs, deepened states only)

- **M1 — header members** (`wall-framing`/`header`): `label` gains the
  assumption suffix `— sized per Table R602.7(1) @ 50|70 psf ground snow —
  ≤ 24 ft building width, roof-and-ceiling loading assumed` on EVERY
  header (engineered ones included — their drawn placeholder size still
  came from the band rules); where a band threshold bites the span,
  `size`/`dims`/`position[1]`/`flag` move one table step deeper
  (56–60" → 4x10 and 63–74" → 4x12 in the 70 band; 71–83" → 4x12 in the
  50 band). Plan position, length, sourceId: unchanged. ROUND 2 — spans
  past the band's 2-2x12 cell (74" @ 70 / 83" @ 50, up to the shipped
  120" threshold that used to gate them) additionally flip `material`
  lumber → 'engineered' with the supplier label + 'ENGINEERED BEAM
  REQUIRED' flag; because member-specific flags WIN over the wall's S7
  compression aggregate (B1 precedence), each flipped header on a
  compressed wall decrements that wall's aggregate Flags-row count by
  exactly one.
- **M2 — cripples above a RESIZED header**: dims[1]/position[1]/length
  (and possibly count) re-derive from the deeper stick. Cripples on walls
  whose header did not resize: byte-equal.
- **T1 — takeoff Wall-framing lumber rows**: header sticks move between
  the 4x8/4x10/4x12 SKUs (+ cripple stock/bd-ft follows M2) — only in
  composes where a size actually stepped; past-cap headers leave the SKU
  rows for the 'Engineered header (LVL/PSL — by supplier)' pcs/lf lines
  (round 2). The **Fasteners 'Nails 16d common' row** is in-class too
  (examiner advisory): cripple nails book 4 per PIECE, so the row moves
  exactly when M2 changes a cripple COUNT — member-derived, honest (it
  did not move in the exhibit sweep below: only cripple lengths changed).
- **P1 — B21d schedule HEADER cells** print the new size (the cell reads
  the member back; the M1 label never leaks into the cell).
- **P2 — cover DESIGN CRITERIA line** (round 2, examiner): deepened
  states' covers print 'DESIGN CRITERIA — headers sized per Table
  R602.7(1) @ 50|70 psf ground snow — ≤ 24 ft building width,
  roof-and-ceiling loading assumed' between the jurisdiction and date
  lines (PlanSetOptions.headerAssumption ← spec.headerAssumption, wired
  in panel.tsx). Low-snow covers carry no line — paper byte-equal.

Fixtures, warnings, every other member and takeoff row, and every
low-snow jurisdiction (INTL + 37 states incl. TX/CA/FL): byte-equal.
B9's bracing machinery keys on RO spans + seismic flags, never header
size — portal/flag censuses unchanged in all 52 codes (suite gates).

## Sweep verification (2026-08-22, round 2 re-run at a069149)

Scratch sweep (`/tmp/b11-sweep.ts` + `/tmp/b11-diff.py`, not committed)
ran `computeLevel` + `computeTakeoff` on the shared baseline scene AND a
straddle scene (two added windows at 56" and 80" RO) across ALL 52
selectable jurisdiction codes, before (at `779d70e`, reference worktree)
vs after; the verifier fails on ANY diff outside the classes above.

Result: **PASS — nothing moved beyond the enumerated classes.**

| metric | count |
| --- | --- |
| jurisdiction codes swept | 52 (INTL + 51 states) |
| scene composes diffed | 104 (baseline + straddle per code) |
| low-snow composes strictly byte-equal (members + takeoff) | 76 (38 codes × 2) |
| deepened composes — non-header/cripple members byte-equal | 28/28 |
| header labels gaining the assumption (M1) | 112 (8 headers × 14 states) |
| header size 4x8 → 4x10 (70-band 56" exhibit) | 3 (ME NH VT) |
| header size 4x10 → 4x12 (80" exhibit, both bands) | 14 |
| header lumber → engineered past the 74" cap (r2, 80" @ 70-band) | 3 (ME NH VT) |
| S7 compression-aggregate Flags row −1 per flipped header (r2) | 3/3 exact |
| composes with Wall-framing takeoff row shifts (T1) | 14 (straddle only) |
| Fasteners 16d row drift | 0 (cripple counts unchanged here) |
| cripple drift off resized walls | 0 |
| fixture / warning drift | 0 (all 104) |

E5 baseline: recaptured (`bun scripts/capture-master-baseline.ts`) —
byte-identical, zero delta (INTL + TX are low-snow; the non-vacuity lives
in the VT compose gates in wall-framing.test.ts / plan-set.test.ts /
takeoff.test.ts).
