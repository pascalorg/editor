---
id: 004
title: Quantity grammar
status: approved
created: 2026-07-03
updated: 2026-07-03
---

# Quantity grammar

Hand-rolled recursive descent over normalized tokens. Entry points:

- `parseQuantity(text, opts)` — single value + unit (compounds allowed)
- `parseRange(text, opts)` — range/qualified bound; falls back to single quantity
- `lingo(text, opts)` — union: conversion request | range | quantity | (main entry
  also: date | duration | fuzzy) with discriminated `type`

Options: `{ kind?, unit? (implied unit for bare numbers), system? ('us'|'imperial'|
'metric'), numberFormat?, registry? }` (plus the strictness dial from plan 014:
`strictness`, `accept`, `tolerance`, `escalate`, `messages`, `profile`). *(As-built
note 2026-07-05: the sketched `maxIssues?` option never shipped.)*

## Normalization (offset-mapped — spans always refer to original input)

1. NFKC per code point with an index map (℃→°C, ²→2, ½→1⁄2, µ→μ, ﬅ ligatures…).
2. Curly quotes → straight (`’`→`'`, `”`→`"`); primes ′ U+2032 → `'`, ″ U+2033 → `"`
   (kept distinguishable via a token flag so angle context can prefer arc units).
3. Exotic spaces → space; `⁄` U+2044 → `/`; U+2212 − → `-`; dashes – — kept distinct
   from hyphen for range detection.
4. Lowercasing happens ONLY at alias-lookup time (case rules live in the registry).

## Grammar (EBNF-ish)

```
input       := ws? expr ws? EOF
expr        := conversion | rangeExpr
conversion  := rangeExpr ws (to|in|into|as|=|→|->) ws unitRef        // "72 in to cm"
rangeExpr   := 'between' qty 'and' qty
             | 'from' qty 'to' qty                                   // from 5 to 10 kg
             | qty (rangeSep qty)?                                   // 5-10 kg, 5 to 10 kg, 5 or 6 kg
             | qty '±' value unitRef?                                // 10 ± 0.5 mm
             | openBound qty                                         // under 10 min, ≥ 5 kg
rangeSep    := '-' | '–' | '—' | '..' | '...' | 'to' | 'or'          // hyphen only when
                                                                     // spaced or unambiguous (not "-5");
                                                                     // 'or' only before a value — "5 kg or so" stays a hedge
qty         := qualifier* value ('ish')? unitRef? tail*             // "5ish kg" → approximate
tail        := value unitRef            // compound: 5 ft 11 in / 2 lb 3 oz / 1 h 30 min
             | value                    // trailing bare number: 5'11 → in, 1m80 → cm,
                                        // 1h30 → min (via subunit hint of last unit)
qualifier   := about|around|approximately|approx.|roughly|circa|ca.|~|nearly|almost|
               please|give me|gimme|exactly|precisely|at least|at most|
               no more than|no less than|no greater than|
               greater than or equal to|less than or equal to|more than|over|
               above|less than|under|below|up to|max|min|≤|≥|<|>|
               (just|a bit|a little|slightly) openBound          // softened bound → approximate
value       := numeric literal | number words | fuzzy amount         (plan 002)
unitRef     := alias tokens per plan 003 (multi-word longest match)
```

## Semantics & edge rules

**Unit-slot rule for `in`**: bare token `in` counts as inches only when it occupies a
unit slot: immediately after a value AND (end of input | followed by punctuation |
followed by a conversion keyword | followed by a value that starts a compound tail |
kind context is length). Otherwise it's a preposition and the parse continues/fails
accordingly. `"72 in"` ✓ inches; `"72 in in cm"` ✓ inches→cm; `"arriving in 72"` ✗.

**Compound chains**: after `value unit`, accept further `value unit` pairs while same
kind AND strictly decreasing factor. Bare trailing number uses the last unit's
`subunit` hint with modulus check: `5'11` → 11 < 12 ✓ inches; `1m80` → 80 < 100 ✓ cm;
`1h30` → 30 < 60 ✓ min; `2 lb 30` → 30 > 16 ✗ (issue `COMPOUND_OVERFLOW`, still
returns 2 lb with warning + span on `30`). Sum in base units; `unit` of the result =
head unit; `parts` array retained for faithful re-formatting.

**Apostrophe forms**: `5'11"`, `5' 11"`, `5 ' 11 "`, `5’11”`, `5′11″`, `6'`, `5'-11"`
(lumber style hyphen). `"` alone after number with length context → inches. After a
degree token (`5° 30' 15"`) with kind angle (or `°` present) → arcmin/arcsec.

**Additive chains (2026-07-03 extension)**: an explicit joiner — `and`, `plus`,
`+`, `,` (list style, e.g. humanize-duration's "1 day, 3 hours, 2 minutes"), or
`minus` (subtraction) — lifts the descending-factor restriction: same-kind terms
sum in ANY order and across systems (`20in and 10cm`, `1 m + 3 ft`,
`2 m minus 10 cm`). Juxtaposition without a joiner keeps the strict big→small
rule (that's what makes "5 ft 11 in" safe). Tail terms always add as deltas
(factor-only — temperature-safe). Spaced `-` remains a RANGE separator, never
subtraction (only the word `minus` subtracts); attached `-` before a value/word
remains compound glue (`5-foot-11`, `5ft-11in`). Inside `between A and B`, the
A-side parser suppresses the `and` joiner so `between 5kg and 10kg` stays a
range. Parts are recorded verbatim; non-chain parts format as `20 in + 10 cm`
(long: "… and …", negatives via the word `minus`) — all re-parseable.

**Range rules**:
- Unit distribution: `5-10 kg` → both sides kg. `5 kg - 10 g` → per-side units kept
  (validated same kind; else `RANGE_KIND_MISMATCH`).
- Compounds inside ranges: `5'10" - 6'2"` ✓.
- Reversed bounds auto-swap + `RANGE_REVERSED` warning.
- Hyphen ambiguity: `-5 kg` is negative (hyphen at start / after nothing); `5-10`
  needs digits on both sides; `5 - 10` spaced hyphen is a range; scientific `1e-3`
  consumed by the number scanner first.
- Open bounds map to `{ min?, max?, exclusive? }`: `under/below/<` → max exclusive;
  `up to/at most/≤/max` → max inclusive; `over/more than/>` → min exclusive;
  `at least/≥/min` → min inclusive.
- Softened bounds (as-built 2026-07-07): a `just`/`a bit`/`a little`/`slightly`
  prefix before any open-bound word (`just under 2 hours`, `a bit over`) keeps the
  bound but marks the range approximate. The softener only fires when a bound
  actually follows, so bare `a bit` stays 1 bit (data).
- `from…to` frame (as-built 2026-07-07): `from 5 to 10 kg` is a closed range,
  symmetric to `between … and …`; a `from` that doesn't reach `to`/a value
  re-parses normally.
- `or` separator (as-built 2026-07-07): `5 or 6 kg` is a closed range. Guarded so
  `5 kg or so` remains the trailing approximate hedge (`or` before `so`, or before
  a non-value, is not a separator).
- `±`: `{ center, delta }` preserved (formats back as `10 ± 0.5 mm`).

**Conversion requests**: `expr (to|in|into|as|=|→) unit` → `{ type: 'conversion',
source, target, converted }`. Double-`in` handled (`2 in in cm`). Target unit typo
suggestions same as source. Kind mismatch (`5 kg to cm`) → error with both kinds named.

**Bare numbers**: with `opts.unit` (the field's implied unit) → quantity in that unit +
`UNIT_ASSUMED` info-level issue. With only `kind` → same but confidence lower; without
either → `type: 'number'` result (still useful: "72" in a free lingo() call).

**Multiple values / trailing garbage**: `parseQuantity` requires full consumption
(trailing non-ws → `TRAILING_INPUT` error with span, EXCEPT trailing qualifier words
("5 kg or so" → approximate, "around the 5 kg mark" → approximate)). `findQuantities(text)` (v0.1 minimal; shipped name,
was sketched as `findAll`) scans for value starts and yields non-overlapping
successful parses (each `{ result, span: { start, end } }`) for agent/highlighting use cases.

## Result shapes

```ts
type LingoResult =
  | { type: 'quantity',  ok: true, quantity: Quantity, issues, span, confidence, alternatives? }
  | { type: 'range',     ok: true, range: QuantityRange, ... }
  | { type: 'conversion',ok: true, source: Quantity|QuantityRange, target: string, converted: ..., ... }
  | { type: 'number',    ok: true, value: number, ... }
  | { type: 'date' | 'duration' | ..., ... }        // main entry composition
  | { ok: false, issues: LingoIssue[] }
```

`Quantity` is a small class: `.kind .base .unit .value` (in `.unit`), `.to(unit)`,
`.valueIn(unit)`, `.format(opts)`, `.toBest(opts)`, `.parts?`, `.approximate?`,
`.toJSON()` (stable, documented shape for agents). Plain-object twin via `toJSON`;
`fromJSON` provided.

**Confidence** (deterministic; as-built penalties from `parse/config.ts`): start
1.0; −0.15 typo-corrected unit; −0.2 ambiguous number; −0.1 ambiguous unit; −0.25
assumed unit; −0.2 slang unit accepted; −0.1 approximate result; floor 0.05,
rounded to 2 decimals. Alternatives carry their own confidence; list sorted desc,
max 3.
