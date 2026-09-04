---
id: 009
title: Errors & suggestions
status: approved
created: 2026-07-03
updated: 2026-07-07
---

# Errors & suggestions

Errors are a first-class output designed for form UX, not exceptions. Nothing throws
on bad input (throwing is reserved for programmer errors: unknown option values,
bad registry definitions).

Severity ESCALATION (strictness presets, per-code overrides, and the `candidate`
contract for "did you mean?" UX) is specified in plan 014 — issue codes never
change under escalation, so the `messages` customization below works identically
across all strictness modes.

## Shape

```ts
interface LingoIssue {
  code: IssueCode              // stable, documented, union-typed
  severity: 'error' | 'warning' | 'info'
  message: string              // human copy, en default, overridable
  span?: { start: number; end: number } // half-open offsets into ORIGINAL input
  suggestions?: string[]       // did-you-mean candidates, max 3, ready to render
  data?: Record<string, JSONValue>  // code-specific: { unit: 'kq', candidates: [...] }
}
```

`span` is present on every parse-path issue; it is absent only on field-level
bound issues (`RANGE_MIN`/`RANGE_MAX` from the `/ai` fields), which are raised
against option bounds after a successful parse.

## Codes (complete list — mirrors the `IssueCode` union in `src/core/types.ts`)

| code | severity | example trigger |
|------|----------|-----------------|
| EMPTY | error | "" / whitespace |
| NO_VALUE | error | "kg" alone (unless fuzzy matches) |
| UNKNOWN_UNIT | error | "5 flurbs" → suggestions from registry |
| KIND_MISMATCH | error | field wants length, got "5 kg" |
| RANGE_KIND_MISMATCH | error | "5 kg to 10 cm" |
| CONVERSION_KIND_MISMATCH | error | "5 kg to cm" |
| RATE_REQUIRED | error | "5 EUR to USD" without caller-provided rates |
| TRAILING_INPUT | error | "5 kg and stuff" |
| SINGLE_VALUE_EXPECTED | error | range/compound input where a single value is required |
| APPROX_NOT_ALLOWED | error | "about 5 kg" where approximations are disabled |
| UNIT_REQUIRED | error | bare number where a unit is required and none is assumable |
| CONVERSION_NOT_ALLOWED | error | "72 in to cm" where conversion requests are disabled |
| NUMBER_FORMAT | error | "1,23,4.5" invalid grouping |
| NONFINITE | error | "Infinity", overflow |
| RANGE_MIN | error | field min bound violated |
| RANGE_MAX | error | field max bound violated |
| RANGE_OPEN_BOUND_NOT_ALLOWED | error | open-ended range ("under 10 kg") where both bounds are required |
| REQUIRED | error | dom required + empty commit |
| UNSUPPORTED_DATE | error | date text recognized but out of grammar |
| NOW_REQUIRED | error | reference-dependent date ("tomorrow", "in 2d") without explicit `now` |
| TYPO_CORRECTED | warning | "5 metres"→ok; "5 meterz" → corrected, noted |
| AMBIGUOUS_NUMBER | warning | "1,234" under auto |
| AMBIGUOUS_UNIT | warning | "mb", "ton", "gal" system pick; bare "$"/"¥" |
| AMBIGUOUS_DATE | warning | "5/3" day-first vs month-first |
| RANGE_REVERSED | warning | "10-5 kg" swapped |
| COMPOUND_OVERFLOW | warning | "5 ft 13" |
| CIVIL_AVERAGE | info | months/years as durations |
| UNIT_ASSUMED | info | bare "72" in a length field |
| WEEKDAY_ASSUMED_NEXT | info | bare "tuesday" |
| SLANG_UNIT | warning | "5m" as minutes under duration kind |
| TZ_IGNORED | warning | "3pm EST" — zone detected but not applied (no `applyZone`) |
| AMBIGUOUS_TIMEZONE | warning | abbreviation zone ("EST") — use an explicit offset or IANA name |

Guarantee: `ok: false` ⟺ at least one `severity: 'error'` issue. Warnings/infos ride
along on success.

## Message copy & i18n

- Default en copy: short, imperative, names the fix: `Unknown unit "kq" — did you
  mean kg?` `This field needs a length like "180 cm" or "5'11"".` Placeholder syntax
  `{unit}`, `{suggestions}`, `{example}` — kind-aware examples generated from registry
  (first two common units).
- `messages` option: partial map `{ [code]: string | (data) => string }` — both parse
  APIs and dom layer accept it. Full i18n = swap the map (plan 013).

## Suggestion engine (`src/core/suggest.ts`)

Bounded Damerau–Levenshtein (transpositions count 1): early-exit rows, cap distance 2.
Candidate pool: alias keys of context kind first (distance ≤2), then other kinds
(distance 1 only). Rank: distance, then alias frequency rank (data order), then
shorter. Dedupe by unit id, present using the unit's preferred symbol (not the matched
alias): "kq" → ["kg"]. Also powers value-slot help: `NO_VALUE` on "tall" in a length
field suggests example formats, not units.
