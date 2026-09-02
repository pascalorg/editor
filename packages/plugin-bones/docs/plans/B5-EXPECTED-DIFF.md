# B5 EXPECTED-DIFF MANIFEST — PT sole plates on slab (R317.1)

Byte-equality RESET for LOD-400 BATCH 5 (branch `feat/lod400-b5`, base
`1555027`), following the night-4 cavity-fit playbook: this batch changes
the material of EVERY ground-level bottom plate, so `master-baseline.json`
was re-captured in the same commit and the exact expected diff is
enumerated + swept below. Anything outside these classes is a defect.

## Enumerated classes (the ONLY allowed diffs)

- **M1 — ground-level `wall-framing`/`bottom-plate` members**:
  `material` `'lumber'` → `'pt-lumber'`; `label` `'Bottom plate…'` →
  `'PT sole plate on slab (R317.1)…'` (splice notes preserved verbatim).
  Every other field — dims, position, rotation, length, size, flag,
  sourceId — byte-equal. Member COUNT and ORDER identical. Scope: framed
  walls on the ground level (`isGroundLevel`) only. NOT in scope and
  byte-equal: upper-storey plates, top/cap plates, studs, headers, sills,
  cripples, mixed-CMU walls (their framed zone bears on the PT seam sill,
  which was already `pt-lumber` pre-B5), full-CMU walls.
- **T1 — takeoff Wall-framing lumber SKU split**: sticks and board feet
  leave the untreated `2x4`/`2x6` rows and land on the sibling
  `2x4 PT`/`2x6 PT` rows (detail suffix `(pressure-treated)`). Piece
  counts conserve EXACTLY per size; board feet conserve to ≤ 0.1 bd-ft
  (the pooled row was `round1(a+b)`, the split books `round1(a) +
  round1(b)` — display rounding, not drift).
- **T2 — takeoff Foundation anchor row retitle**: detail
  `'mudsill anchorage (R403.1.6)'` → `'sole plate anchorage (R403.1.6)'`,
  quantity/unit/section unchanged. The Wall-framing seam-sill anchor row
  (`'seam sill to bond beam (R403.1.6)'`) is untouched.

Fixtures, warnings, and every other member/takeoff field: byte-equal.

## Sweep verification (2026-08-20)

Scratch sweep (`/tmp/b5-sweep.ts` + `/tmp/b5-diff.ts`, not committed) ran
`computeLevel` + `computeTakeoff` on the shared baseline scene AND a
two-storey scene (storey 0 + storey 1) across ALL 52 selectable
jurisdiction codes (INTL + 51 state profiles), before (at `1555027`) vs
after; the verifier fails on ANY diff outside the classes above.

Result: **PASS — nothing moved beyond the enumerated classes.**

| metric | count |
| --- | --- |
| jurisdiction codes swept | 52 (INTL + 51 states) |
| scene composes diffed | 156 (baseline + storey-0 + storey-1 per code) |
| members byte-equal | 49 830 |
| bottom plates material `lumber`→`pt-lumber` (M1) | 460 |
| bottom plates label re-cited (M1, same 460 members) | 460 |
| takeoff rows untouched | 6 096 |
| PT SKU rows grown/added (T1) | 359 |
| untreated SKU rows shrunk (T1, conservation held) | 359 |
| Foundation anchor rows retitled (T2) | 104 (= 2 ground composes × 52) |
| member count / order drift | 0 |
| fixture / warning drift | 0 |
| storey-1 (upper) composes | fully byte-equal — 0 diffs |

Plate counts vary per jurisdiction because CMU-default states frame fewer
walls (their exterior walls never enter `frameWalls`) — the verifier
checks per-member identity, not a fixed count.

## Baseline recapture

`src/framing/master-baseline.json` re-captured via
`bun run scripts/capture-master-baseline.ts` on this tree (INTL: 485
members / 44 fixtures, TX: 485 / 44 — counts unchanged from pre-B5; only
the M1 fields differ inside). The E5 byte-equality gate
(`compute.devices.test.ts`) is green against the new pin.
