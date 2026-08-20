---
id: 002
title: Number parsing
status: approved
created: 2026-07-03
updated: 2026-07-05
---

# Number parsing

The value layer parses one *numeric value expression* from the token stream and returns
`{ value: number, span, approximate?: boolean, spread?: [lo, hi], issues: [] }`.
`spread` carries fuzzy-amount ranges ("a few" → [2,4]) distinct from explicit ranges.

## Numeric literals

| form | examples | rule |
|------|----------|------|
| integer | `5`, `72`, `1200` | |
| decimal | `1.8`, `.5`, `0,5` | leading dot allowed; comma per separator policy below |
| grouped | `1,234,567.89`, `1.234.567,89`, `1 234 567,89`, `12,34,567` (Indian) | groups validated (first group 1–3 digits, later groups 3 — or 2 for Indian grouping); NBSP/thin/narrow spaces count as space |
| signed | `-5`, `−5` (U+2212), `+3` | sign binds to the number; "minus five" via words |
| scientific | `1e3`, `2.5E-4`, `1.2 × 10^6`, `3×10⁵` | superscript exponents normalized |
| percent | `15%` | only when kind ∈ {percent-tolerant contexts}; v0.1: parsed as bare number with `unit: '%'` under a `percent` pseudo-kind |
| ASCII fraction | `1/2`, `3/4` | denominator ∈ 2..64 guard against dates ("5/3/2026" is NOT a fraction — lookahead: a second `/` or a 4-digit part vetoes fraction) |
| mixed number | `1 1/2`, `2-3/4` (lumber style) | integer + fraction, hyphen or space joined |
| unicode fraction | `½ ⅓ ⅔ ¼ ¾ ⅕ ⅖ ⅗ ⅘ ⅙ ⅚ ⅐ ⅛ ⅜ ⅝ ⅞ ⅑ ⅒`, `1½` | NFKC normalizes to `1⁄2` (U+2044); handle both bare and mixed |

## Decimal/group separator policy

Deterministic algorithm, no locale sniffing:

1. If both `.` and `,` occur → the LAST occurring one is the decimal separator, the
   other must form valid groups (else `NUMBER_FORMAT` error).
2. Only `,`: decimal if the fractional part length ≠ 3 (`1,5` → 1.5) or if it repeats
   validly as grouping (`1,234,567` → grouped int). `1,234` alone is ambiguous →
   resolve by `numberFormat` option (`'auto' | 'dot-decimal' | 'comma-decimal'` or a
   locale string mapped to one of these); under `auto` default to dot-decimal
   (1,234 = 1234) and attach an `AMBIGUOUS_NUMBER` warning + alternative value 1.234.
3. Only `.`: mirror of rule 2 (`1.234` German-style grouping ambiguity — under `auto`,
   decimal wins: 1.234; alternative 1234 listed; `1.234.567` valid grouping → 1234567).
4. Space groups (incl. U+00A0/U+2009/U+202F): always grouping, never decimal.

## Number words (English)

- ones (`zero…nineteen`), tens (`twenty…ninety`), hyphenated (`twenty-five`),
  scales (`hundred, thousand, million, billion, trillion`), optional `and`
  (`one hundred and five`).
- Articles as one: `a hundred`, `an hour` (the article is consumed by the value layer
  when directly preceding a scale or a unit — "an hour" = value 1 + unit hour).
- Fraction words: `half` (0.5), `a quarter` (0.25), `third(s)`, `x and a half`
  (`two and a half` = 2.5), `half a/an X` (0.5 applied to following unit),
  `a quarter of a X`. As-built (2026-07-07): the `of a/an` linker is consumed so
  `a quarter of a mile`, `two thirds of a meter`, `a third of an hour`, and
  `three quarters of a mile` resolve the fraction against the following unit;
  bare `a quarter`/`two thirds` (no unit) stay plain numbers.
- `dozen` (12), `half a dozen` (6), `a dozen and a half` (18).
- `minus`/`negative` prefix — applies to spelled numbers (`minus five`) AND to
  digit literals (`minus 5 kg`, `negative 5 kg`, `minus 20 celsius`); a spelled
  number after the word still routes through the number-word parser.
- Grammar cap: parse greedily but reject mixed digit+scale-word ("2 thousand" IS
  allowed: 2000; "1.5 million" allowed) — digits may combine with scale words.

## Fuzzy amounts (feed `approximate` + `spread`)

| phrase | value | spread |
|--------|-------|--------|
| a couple (of) | 2 | [2, 3] |
| a few | 3 | [2, 4] |
| several | 5 | [4, 7] |
| a handful (of) | 5 | [3, 6] |
| dozens (of) | 24 | [12, 60] |

These parse only when followed by a unit or when kind context exists ("a few minutes").
Confidence penalty applies (plan 009).

## Suffix multipliers

v0.1 ships `k`/`K` (1e3) and `bn` (1e9) only. "70k" → 70000. Applied only when
directly attached to digits; suppressed for temperature kind (`5K` is kelvin).
When a unit follows (`70k km`), multiplier composes with the unit.

Deferred (see backlog): `M` (1e6) collides with mega/meters, bare `b` (1e9)
with `b` = bit — each needs hazard analysis and corpus gating before shipping.

## Explicit non-numbers

Reject with `NO_VALUE` (not silent 0): empty string, lone sign, lone separator, `NaN`,
`Infinity` (issue `NONFINITE`). Guard every path against producing NaN — a parse either
fails with issues or yields a finite number.

## Output precision

Parsing never rounds. `0.1 + 0.2`-style artifacts are a formatting concern (plan 007's
`round(value, sig)` helper using EPSILON-aware rounding).
