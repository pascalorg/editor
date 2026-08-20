---
id: 026
title: First-class currency
status: done
created: 2026-07-06
updated: 2026-07-07
goal: "Currency amounts parse/validate/format in-library, lightweight and deterministic; cross-currency conversion takes caller-injected rates."
---

# 026 — First-class currency

Currency support ships **in-library**, lightweight and performant (D28, D31,
D40); async/historical FX providers remain deferred. Mission framing: lingo
converts human language — written or spoken — into structured/typed/sanitized
output; currency amounts are core to that.

## The split that makes currency tractable

- **Parse / validate / format need NO exchange rates** → fully deterministic,
  ships in-library, no hard-rule tension.
- **Cross-currency conversion needs rates** → rates are not static and not
  derivable from data, so they are **injected** by the caller. No network, no
  `Date.now`, no global provider in core (hard rules 1/5/6 preserved).

## Decision — currency is a rate-based kind, not an affine-factor kind

The registry's model is `base = value·factor + offset` with one base unit per
kind. Currency does not fit: there is no fixed factor between USD and EUR. So:

- Every currency unit is **self-canonical**: `factor: 1`, and a currency
  `Quantity` has `base === value`, `baseUnit === unit`. A `$5` serializes as
  `{ value: 5, unit: 'USD', base: 5, baseUnit: 'USD' }` — self-consistent under the
  plan-025 wire shape (each currency is canonical in itself).
- The `currency` kind is flagged rate-based (e.g. `KindDef.rateBased: true`). The
  generic `convert()`/`Quantity.to()` **throws** across *different* currencies:
  `lingo: cross-currency conversion needs rates — use convertCurrency(amount,
  from, to, { rates })`. Same-currency `to()` is identity. This is the key
  registry change; keep it tiny and data-driven.
- Parser-facing conversion requests never throw for user text. `"5 EUR to USD"`
  and mixed-currency ranges like `"€5-$10"` return `ok:false` with
  `RATE_REQUIRED` and a span over the conversion/range text.

## Design — data (lightweight)

- Unit ids = ISO 4217 codes (`USD`, `EUR`, `GBP`, `JPY`, …). Ship a **compact
  curated set** (~30 common currencies) in the default registry; the long tail is
  an opt-in `./currency/all` data module (or `registerUnits`) so the default
  bundle stays lean. Size measured; recalibrate deliberately if it moves budgets.
- `symbol` per code; **aliases**: symbols (`$ € £ ¥ ₹ …`), lowercased names
  (`dollars`, `euros`), and scoped slang (`bucks`→USD, `quid`→GBP). Multiplier
  slang (`grand`→×1000, `k`) rides the existing number layer.
- `minorUnit` metadata (2 default; 0 for JPY/KRW; 3 for KWD/BHD/OMR) for
  Stripe-style integer-minor-unit interop → `toMinor()` / `fromMinor()` on
  currency quantities.

## Design — parsing

Deterministic; reuses the number layer. Must parse:
`"$5"`, `"5 USD"`, `"USD 5"`, `"$1,234.50"`, `"€10"`, `"£3.50"`, `"5 dollars"`,
`"5 bucks"`, `"between $5 and $10"`, `"$5-$10"`. Handle prefix AND suffix symbol
placement and no-space adjacency (`$5`).

**Ambiguity policy** (lingo is honest about ambiguity, CONTEXT.md): `$` maps to
many currencies. The `currency` option disambiguates bare `$`/`¥`; absent it,
`$` assumes USD and `¥` assumes JPY with `AMBIGUOUS_UNIT`
(assume-with-warning under `forgiving`; a confirmable error under `confirm`).
Explicit ISO codes, names, slang, and unambiguous symbols such as `€` do not
warn. Broader locale/profile inference remains deferred (D40). New issue codes
ship complete (copy + `IssueDataMap` + corpus + escalate-ability) per
`wiki/api-design.md`.

GBP pence idioms are parser sugar, not registered units (D48): `50p` /
`50 pence` parse as `0.5 GBP`, `3 quid 50` parses as `3.5 GBP`, and
`3 quid ± 50p` parses as a GBP plus/minus range, while serialized quantities
still use `unit:'GBP'`. Context matters: `5 pounds 25` is GBP under
`{ kind: 'currency' }`, but unscoped `pounds` remains mass.

## Design — formatting (zero data, round-trip-safe)

`Intl.NumberFormat(locale, { style: 'currency', currency })` — Intl knows every
currency's symbol, placement, and minor-unit decimals, so we ship no format data.
Two-way guarantee: whatever `format()` emits (`"$5.00"`, `"5,00 €"`) must re-parse
to the same amount+currency; add round-trip tests (respecting the plan-025 format
locale/round-trip policy — localized separators need matching `numberFormat` on
parse).

## Design — conversion (injected rates)

```ts
interface RateSnapshot { base: string; rates: Record<string, number>; asOf?: string }
type RateProvider = (from: string, to: string) => number

function convertCurrency(
  amount: number, from: string, to: string,
  opts: { rates: RateSnapshot | RateProvider },
): number
```

- Rates are explicit; no wall clock, no network. `asOf` is caller-provided
  metadata, never read from the system clock.
- `CurrencyCode`/typed currency refs come from plan 027 for built-in helpers;
  dynamic strings still compile and validate unknown currencies at runtime.

## Non-goals / deferred

- No bundled FX rates or fetching. No historical-rate engine.
- Crypto/precious-metals as an opt-in extension only.

## Acceptance / gates

- `bun run check` green; size deltas reported, budgets recalibrated deliberately
  (D-entry) if the curated set moves them; zero runtime deps (Intl only).
- Parse + format round-trip tests; corpus rows for the parse cases above.
- Cross-currency `convert()`/`to()` throws the actionable message; `convertCurrency`
  with an injected snapshot is deterministic and tested.
- Cross-currency parse text and mixed-currency ranges return `RATE_REQUIRED`
  issues rather than throwing.
- New issue codes complete (copy/data/corpus/escalate). TSDoc `@example`s;
  README/llms.txt/site updated. Decision entry for the rate-based-kind model.

## Sequencing

Depends on: 025 (wire shape). Related: 027 (typed currency refs).
