---
id: 001
title: Architecture
status: approved
created: 2026-07-03
updated: 2026-07-07
---

# Architecture

## Layer diagram

```
                    ┌────────────────────────────────────────────┐
 entries            │  .        /date      /dom        /react    │
                    ├────────────────────────────────────────────┤
 surface API        │ lingo() parseQuantity parseRange convert   │
                    │ format toBest humanize* describe* find*    │
                    ├────────────────────────────────────────────┤
 grammar            │ normalize → tokenize → value → unit →      │
                    │ compound → range → qualifier → conversion  │
                    ├────────────────────────────────────────────┤
 registry           │ kinds · units · aliases · subunit hints ·  │
                    │ best-fit ladders · fuzzy vocab             │
                    ├────────────────────────────────────────────┤
 canonical layer    │ SI-anchored base values (m, kg, K, s, m³…) │
                    │ affine conversion (factor + offset)        │
                    └────────────────────────────────────────────┘
```

Everything above the canonical layer speaks *human*; everything below speaks *SI*.
The registry is data, not code — new units/kinds are additive definitions.

## Canonical representation

Every kind declares a base unit (SI or SI-coherent):

| kind | base | note |
|------|------|------|
| length | meter | |
| mass | kilogram | |
| temperature | kelvin | affine units (°C, °F) use factor+offset |
| duration | second | `.toMilliseconds()` helper for JS interop |
| volume | cubic meter | 1 L = 1e-3 m³ |
| area | square meter | |
| speed | meter/second | |
| data | byte | bit = 0.125 B; binary vs decimal prefixes both defined |
| data_rate | bit/second | network throughput; bare `bps` remains percent basis points |
| flow_rate | cubic meter/second | deliberate volume-per-time kind; arbitrary unit algebra remains out of scope |
| acceleration | meter/second² | declared acceleration units only; bare `g` remains gram |
| pressure | pascal | |
| energy | joule | |
| force | newton | |
| torque | newton meter | declared torque units only; not general unit algebra |
| power | watt | |
| frequency | hertz | |
| angle | radian | |
| percent | percent | |
| luminous_intensity | candela | |
| luminous_flux | lumen | |
| illuminance | lux | |
| luminance | candela/square meter | |
| voltage | volt | |
| current | ampere | |
| resistance | ohm | |
| charge | coulomb | |
| substance | mole | amount of substance only |
| concentration | mole/cubic meter | amount concentration; declared chemistry units only |
| radiation_absorbed_dose | gray | absorbed dose; not equivalent/effective dose |
| radiation_equivalent_dose | sievert | equivalent/effective dose; no radiation weighting inference |
| radioactivity | becquerel | activity; detector counts are out of scope |
| currency | self-canonical ISO currency id | rate-based; no bundled FX rates |

A `Quantity` carries `{ kind, value, unit, base, baseUnit }`: `value` is the
number in the display unit, `unit` is the canonical unit id it was
expressed/requested in, and `base` is measured in `baseUnit`. Affine kinds use
`toBase(x) = x·factor + offset`, `fromBase(b) = (b − offset)/factor`. Delta
conversions (temperature differences) use factor only — separate API
(`convertDelta`). Rate-based kinds such as currency are self-canonical until the
caller supplies rates.

## Module map

| path | contents |
|------|----------|
| src/core | types, registry, convert, round, unit-ref types |
| src/parse | normalize (offset-mapped), tokenize, quantity/range/conversion grammar, wire serialization |
| src/number | numeric literals, number words, fuzzy amounts |
| src/units | pure data tables per kind |
| src/format | format, toBest, compound output |
| src/fuzzy | temperature vocab profiles |
| src/messages | default human-readable issue copy (`./core` ships copy-free) |
| src/date | date/duration parse + humanize, timezones, time ranges |
| src/describe | opt-in rich/resource value + result views |
| src/catalog | read-only query API over unit/kind/currency data |
| src/schema | JSON Schema reference & adapters (plan 029) |
| src/dom | headless input controller |
| src/element | custom-element wrapper over the DOM controller |
| src/react | hook adapter |
| src/ai | Standard Schema fields for LLM structured output |
| src/mcp | Model Context Protocol tool helpers |

All parsing is hand-rolled recursive descent over a shared token stream — no regex
grammar for the main path (regexes only for token-level scanning). Rationale: spans,
error recovery, and alternatives need parser state; monolithic regexes can't report
*why* something failed.

## Entry points & tree-shaking

- `@pascal-app/lingo` (main): quantities + dates + fuzzy — the batteries-included path.
- `@pascal-app/lingo/core`: engine without bundled unit tables (bring-your-own registry).
- `@pascal-app/lingo/date`, `/dom`, `/react`: layer entries.
- `sideEffects: false`; unit tables are pure const data so bundlers can drop unused
  kinds when users import granular helpers.

## Size budgets (min+gzip, enforced in CI)

Per-entry and per-marginal budgets are enforced by
`packages/lingo/scripts/size.mjs` (part of `bun run check` and CI) — that script
is the single source of truth for the numbers; they are not restated here.
Design constraints behind the budgets:

- The main entry stays **quantity-only**; dates compose via `./date` (D11).
- `Quantity` methods statically couple format/convert into any entry that
  touches the class — a deliberate DX choice (chainable results) that caps
  tree-shaking granularity; documented, not fought.
- Budget changes are deliberate decisions recorded in `wiki/decisions.md`,
  never silent edits to the script.

## Determinism

- No `Date.now()`/`Math.random()` in library logic; `now` is an explicit option
  (defaulting at the *API boundary only*, `dom`/`react` layers).
- No locale sniffing in core parse; locale is an option. `Intl` used for *output*
  formatting and for nothing in the parse path (parse implements its own separator
  logic so behavior is identical across runtimes).

## Error philosophy

Single `LingoIssue` shape everywhere: `{ code, message, span: { start, end }, severity,
suggestions?, data? }`. Spans are half-open UTF-16 offsets into the ORIGINAL input
string — the normalizer carries an offset map (NFKC can change lengths: ℃ → °C).
Parse APIs return a versioned `LingoResult` envelope, serialized as the flat v3
wire shape (plan 025, D57):
`{ schemaVersion: 3, ok: true, type, kind, ...payload, text, span, issues, confidence }`
or `{ schemaVersion: 3, ok: false, type: 'failure', text, issues, candidate? }`.
Serialized spans are self-describing `{ start, end, text }`; conversions carry
one canonical pair on `source` (the converted target is `{ value, unit }` only).
Issues can accompany success (warnings: ambiguity, typo correction applied,
range swapped).
