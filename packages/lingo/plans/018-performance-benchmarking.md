---
id: 018
title: Performance benchmarking
status: in-progress
created: 2026-07-03
updated: 2026-07-07
---

# Performance benchmarking

Lingo's performance story is part of the product promise: natural-language
input should feel cheap enough for every keystroke in the browser and safe enough
for backend batch validation. The benchmark framework must measure that promise
directly, using the built package a user would install.

## Goals

- Quantify normal-path throughput in thousands of parses per second.
- Isolate slow paths, especially typo correction and unknown-unit suggestions.
- Cover frontend behavior in a real browser, including `partialState()` and the
  DOM controller, without adding runtime or benchmark dependencies.
- Cover backend batch behavior in Node, including bulk-validation settings such
  as `tolerance: { typos: 'off' }`.
- Make regressions visible without making noisy shared CI runners flaky.

## Non-goals

- Do not benchmark TypeScript source through Vitest as the primary number. Tests
  keep linear-time guards; `scripts/bench.mjs` owns product performance numbers.
- Do not introduce a benchmark framework dependency. `node:perf_hooks` and a
  small browser harness are enough for v0.1.
- Do not publish absolute claims without the runtime, device, package version,
  and command used to produce them.

## Suites

### Backend suites

Run in Node against `dist/`. Quantity-oriented suites use deterministic
generated-English corpora derived from built-in unit aliases, number forms,
qualifiers, ranges, conversions, typos, dates, durations, and sentence
templates; tiny fixed samples are only acceptable for isolated formatter calls.

- `parseQuantity` simple quantities: hundreds of unit/value forms across all
  built-in measurement kinds.
- `lingo` mixed grammar: compounds, ranges, conversions, fuzzy amounts, unicode
  fractions, scientific notation, open bounds.
- `partialState` typing states: short prefixes, incomplete units, candidate
  paths.
- Dates and durations: relative dates with explicit `now`, shorthand idioms,
  ISO datetimes, ISO-8601 durations, natural durations.
- Formatting/humanizing: quantity compound format, date humanize, duration
  humanize.
- Slow paths: typo-fix with kind context, unknown-unit suggestions, unknown-unit
  with typo suggestions disabled, strict confirm/candidate mode, free-text scan.
- Latency probes: one-shot long no-match input, long unknown tail, huge numeric
  literal. These report milliseconds per call, not ops/s.

### Frontend suites

Run in a browser page served by `scripts/bench.mjs --browser`:

- Browser `lingo` mixed grammar.
- Browser `partialState` typing loop.
- Browser date/duration parsing and humanizing.
- DOM controller `field.set()` / commit path on a real `<input>`, including
  hidden canonical value work.
- Browser long-input latency probes.

The browser mode posts results back to the local script process so the terminal
captures a comparable report. `--open` may launch the system browser; otherwise
the script prints a URL for manual opening.

## Reporting

Each run records:

- package version from `package.json`
- runtime (`node` version or browser user agent)
- platform/arch where available
- suite name, group, iterations, median ms, ops/s, µs/op
- corpus metadata and per-suite `caseCount` for generated input coverage
- latency probe median ms

Use medians over repeated timing samples after warmup. In report JSON,
`samples` means timing repetitions and `caseCount` means distinct generated
inputs. The script keeps a tiny sink so engines cannot trivially discard
benchmarked work.

## Baselines and gates

Benchmarks are noisy. CI should not fail on a single raw throughput number from a
shared runner.

- `bun run bench` prints a local backend report.
- `bun run bench -- --browser --open` runs the frontend/browser report locally.
- `bun run bench -- --write-baseline bench/baseline-node.json` captures a local
  backend baseline.
- `bun run bench -- --compare bench/baseline-node.json --threshold 30` fails only
  when matching suites regress by more than the threshold percentage.

Recommended CI posture:

1. Always run the existing tests and size gate.
2. Optionally run backend benchmarks as a non-blocking report.
3. Use `--compare` only on stable runners with a checked-in or downloaded
   baseline produced on the same runner class.
4. Keep hard tests only for pathological complexity: long no-match input must
   stay bounded and should remain covered by the hostile-input test.

Captured numbers, baselines, and optimization history live in
`wiki/benchmarks.md` and `bench/baseline-node.json` — never in this plan.

## Visualization (docs site)

`/docs` gains a **Performance** section rendering `bench/baseline-node.json`:
hand-rolled theme-aware SVG horizontal bars grouped by suite on an ops/s
scale (higher is faster), with µs/op shown only as the secondary latency cue, a
latency-probe table, and a mandatory environment caption (package version,
runtime, platform, date, command) per the "no absolute claims" rule. No chart
dependencies. Optional flourish
(impeccable-compatible because it is product truth): the landing hero readout
may show the live parse time of the visitor's own input via performance.now(),
rounded, throttled.

## Remaining work

- **Browser suites**: capture the frontend/browser report into a checked-in
  baseline comparable to `bench/baseline-node.json`.
- **CI posture**: decide between a non-blocking backend benchmark report on
  every run and `--compare` gating on a stable runner class with a checked-in
  baseline (see "Baselines and gates").

## Production guidance this framework should support

- Frontend copy: normal field parsing is microsecond-scale; debounce is about UX,
  not survival. Unknown-unit suggestion paths are still safe for user feedback.
- Backend copy: ordinary parsing can run in bulk; disable typo suggestions for
  high-volume strict imports when did-you-mean output is not needed.
- Release copy: publish numbers as examples, not universal guarantees, and pin
  the command and runtime used to produce them.
