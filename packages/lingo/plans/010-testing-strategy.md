---
id: 010
title: Testing strategy
status: approved
created: 2026-07-03
updated: 2026-07-09
---

# Testing strategy

Vitest, colocated `src/**/*.test.ts` + shared corpora in `tests/corpus/`.

## Layers

1. **Golden corpus (table-driven, the backbone)** — `tests/corpus/*.ts` export
   `Array<[input, expected, opts?]>` per domain: numbers, length, mass, temperature,
   duration, volume/area/speed/data/pressure/energy/angle, compounds, ranges,
   conversions, dates, durations-text, fuzzy, hostile. Expected = pared shape
   (`{ kind, base ≈, unit, warnings? }` with approx matcher for floats, 1e-9 rel).
   Target ≥ 400 rows v0.1; every bug fix adds a row. Hostile set: unicode homoglyphs,
   RTL marks, zero-width joiners, 10k-char inputs (performance guard: parse < 5 ms),
   emoji, SQL-ish strings, `-0`, `1e309`.
2. **Round-trip properties** (seeded PRNG, no deps): ∀ kind, ∀ unit, random magnitudes:
   `parse(format(q, style)) ≈ q` for all three styles + compound; date humanize→parse
   within grain; duration decompose→format→parse exact. *Implemented 2026-07-09:
   `src/format/roundtrip-property.test.ts` (mulberry32, all kinds × units ×
   10 styles × 5 magnitude regimes, 41k+ cases; found and fixed the
   scientific-coefficient and narrow-gluing round-trip bugs on landing).*
3. **Conversion truth table** — authoritative factor spot-checks (NIST/agreement
   values): 1 in = 2.54 cm exact, 72 in = 6 ft = 1.8288 m, 100 °C = 212 °F = 373.15 K,
   −40 °C = −40 °F, ΔT 5 °C = ΔT 9 °F, 1 US gal = 3.785411784 L, 1 imp gal = 4.54609 L,
   1 lb = 453.59237 g, 1 stone = 14 lb, 1 KiB = 1024 B ≠ 1 kB = 1000 B, 1 psi =
   6894.757293168 Pa, 1 kWh = 3.6 MJ, 1 knot = 1.852 km/h.
4. **Date determinism matrix** — fixed `now` values crossing DST entry/exit (US +
   EU dates), month ends (Jan 31, May 31), leap day (2028-02-29), year boundary;
   weekday semantics table for this/next/last from a Wednesday and a Sunday.
5. **DOM tests** (jsdom added as devDep with the dom module): lifecycle, debounce
   (fake timers), hidden field sync, aria wiring, Constraint Validation, IME guard.
6. **Type tests** — `expect-type` style assertions in `src/types.test-d.ts` for the
   discriminated unions and option inference (vitest typecheck mode).

## Invariant checklist (each is a named test)

- No parse path returns NaN/Infinity in `base`.
- Every issue's span is within input bounds and non-empty for errors.
- `ok:false` ⟺ ≥1 error issue.
- All registry aliases resolve to their own unit (self-consistency sweep at test
  time — catches alias collisions across kinds unless explicitly whitelisted as
  hazards).
- All units reachable from at least one alias; all `subunit` references exist;
  factors positive finite; offsets only on temperature.
- Size budgets (plan 001) — `bun run size` run in CI.

## Perf guard

Micro-bench in tests (soft): 10k mixed parses < 300 ms on CI baseline; single parse
of 64-char input < 1 ms typical. No regex catastrophic backtracking possible (scanner
is linear; assert with 50k 'a' input).
