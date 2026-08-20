# Benchmarks (as-built)

Spec: `plans/018-performance-benchmarking.md`. Harness: `scripts/bench.mjs`
(zero benchmark deps — `node:perf_hooks`, warmup + median samples, sink against
dead-code elimination). Runs against `dist/`, i.e. the package a user installs.
In throughput rows, `samples` means timed measurement runs; `caseCount` means
the number of distinct generated inputs cycled through the suite.

## Commands

```sh
bun run bench                                        # backend report (Node)
bun run bench -- --json                              # machine-readable
bun run bench -- --browser --open                    # browser suites (partialState, DOM controller)
bun run bench -- --write-baseline bench/baseline-node.json
bun run bench -- --compare bench/baseline-node.json --threshold 30
```

Baseline: `bench/baseline-node.json` (checked in; regenerate on the same
machine class before comparing).

## Plain-English takeaway

The benchmark is not trying to prove that every laptop or server will get the
same number. It is there to answer product questions in human terms:

- **Typing fields:** a normal single-value field parses at 492,739 values/s
  across 900 generated cases (2.03 µs/input), so running it on each keystroke
  is comfortably cheap.
- **Bulk imports:** strict validation without did-you-mean suggestions runs at
  550,270 checks/s across 240 generated unknown-unit cases (1.82 µs/row), so
  batch validation can stay inline for common import sizes.
- **Messy text:** sentence scanning runs at 53,533 scans/s across 260 generated
  sentence cases, and a 50k-character no-match stress test finishes in
  0.341 ms.

Put differently: ordinary parsing is microsecond-scale. Debounce and background
work are product decisions, not parser survival tactics.

## First captured run — 2026-07-03

Apple Silicon (darwin arm64), Node v24.15.0, V8 13.6. Numbers are examples,
not guarantees — always pin runtime + command when quoting (plan 018 rule).

| Suite | ops/s | µs/op |
| --- | ---: | ---: |
| parseQuantity simple | 370,398 | 2.70 |
| lingo mixed grammar | 205,054 | 4.88 |
| partialState typing | 64,325 | 15.5 |
| parseDate mixed | 130,837 | 7.64 |
| parseDuration mixed | 352,313 | 2.84 |
| format quantity | 1,060,642 | 0.94 |
| humanizeDate | 1,104,883 | 0.91 |
| humanizeDuration | 54,143,083 | 0.02 |
| typo fix with kind | 22,932 | 43.6 |
| unknown unit suggestions | 3,329 | 300.4 |
| unknown unit, typos off (bulk) | 243,025 | 4.11 |
| strict confirm candidate | 51,517 | 19.4 |
| free text scan | 14,241 | 70.2 |

Latency probes (median ms): 50k-char no-match **1.95** · 20k unknown tail
**0.80** · 500-digit number **0.02**.

## Generated corpus baseline — 2026-07-04

The current checked-in backend baseline was captured with:

```sh
node scripts/bench.mjs --backend --samples 11 --iterations 200000 --write-baseline bench/baseline-node.json
```

The corpus is deterministic generated English, built from lingo's own aliases,
number forms, qualifiers, ranges, conversions, typos, dates, durations, and
sentence templates. The largest suites now cycle hundreds of distinct inputs:
900 single-value cases, 791 mixed grammar cases, 474 typing-prefix cases, 240
bulk unknown-unit cases, and 260 free-text sentence cases.

| Suite | cases | ops/s | µs/op |
| --- | ---: | ---: | ---: |
| parseQuantity simple | 900 | 492,739 | 2.03 |
| lingo mixed grammar | 791 | 389,820 | 2.57 |
| partialState typing | 474 | 275,519 | 3.63 |
| parseDate mixed | 103 | 339,669 | 2.94 |
| parseDuration mixed | 169 | 843,289 | 1.19 |
| unknown unit, typos off (bulk) | 240 | 550,270 | 1.82 |
| free text scan | 260 | 53,533 | 18.68 |

Latency probes (median ms): 50k-char no-match **0.341** · 20k unknown tail
**0.160** · 500-digit number **0.004**.

## Reading the numbers

- Every interactive path sits far inside a 16.7 ms frame; the worst observed
  single call (unknown-unit suggestions) is 0.30 ms. Debounce in the DOM layer
  is a UX choice, not a survival requirement.
- Bulk backend validation: ~200–370k parses/s on the happy path. For strict
  high-volume imports where did-you-mean output isn't needed, set
  `tolerance: { typos: 'off' }` (243k ops/s even on unknown-unit inputs).
- The did-you-mean scan (300 µs) was the one path ~100× the happy path —
  **fixed 2026-07-04 (D17)**: alias-length index + char-mask prescreen +
  row-bailout brought it to 28.1 µs/op (11.6×), with 2–6× side-wins on
  typo-fix (6.8 µs), strict-confirm (3.8 µs) and partialState (2.6 µs).
  Parity proven over 1.97M alias/probe pairs (D17). Re-baseline
  `bench/baseline-node.json` on the post-D17 build before future compares.
- **Hot-path pass 2026-07-04**: ASCII identity normalization plus prepared-state
  reuse for `partialState()`/`findQuantities()` cut free-text scan to 19.3 µs/op
  (51,897 ops/s), bulk unknown-unit validation to 1.66 µs/op (602,129 ops/s),
  and long no-match latency to 0.686 ms. The mixed grammar suite stayed flat
  within local benchmark noise (D19).
- **Generated corpus pass 2026-07-04**: the baseline moved from tiny fixed arrays
  to generated English corpora with `caseCount` recorded per suite. Throughput
  naturally reports a tougher corpus now; compare future runs against this
  baseline rather than the small-array hot-path report.

## Visualization

The docs site renders `bench/baseline-node.json` as theme-aware SVG bars in a
Performance section (`/docs`), with the environment caption mandated by
plan 018; `scripts/sync-site.mjs` copies the baseline into the site. The
landing hero readout also shows the visitor's own live parse time
(performance.now(), µs).
