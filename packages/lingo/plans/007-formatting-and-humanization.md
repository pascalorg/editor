---
id: 007
title: Formatting & humanization
status: approved
created: 2026-07-03
updated: 2026-07-06
---

# Formatting & humanization

`format` is the inverse of `parse` and the round-trip contract holds both ways.

## API

```ts
format(q, {
  unit?,                       // target unit id; default q.unit
  compound?: true | string[],  // 5′11″; true = use unit's subunit chain, or explicit ['ft','in']
  style?: 'symbol' | 'long' | 'narrow',   // 5 kg | 5 kilograms | 5kg
  precision?,                  // max fraction digits (post-rounding)
  significant? = 4,            // max significant digits when precision absent
  locale?,                     // number formatting via Intl.NumberFormat; default 'en-US'-stable
  notation?: 'standard' | 'scientific' | 'engineering',
  exponentStyle?: 'e' | 'times' | 'superscript',
  spacing?: 'auto',            // symbol-dependent: '5 kg' but '5°C', '5′'
})
formatRange(r, opts)           // '5–10 kg', '≥ 5 kg', '10 ± 0.5 mm', 'under 10 minutes' (style long)
toBest(q, { system? = q's origin system, prefer?: 'small'|'large' }) // 1500 m → 1.5 km
```

## Rules

- **Rounding**: EPSILON-aware significant rounding (`round(1.00499999…, 3) = 1),
  never expose float artifacts (`0.30000000000000004` ✗). Trailing zeros trimmed
  unless `precision` explicitly set.
- **Compound output with carry**: decompose big→small; ROUND ONLY THE SMALLEST part,
  then carry: 1.9999 m as ft+in → 6′7″ (never 5′12″); 5.999 lb as lb+oz → 6 lb 0 oz →
  collapse zero-tails → "6 lb". Zero middle parts kept when meaningful (`6 ft 0.5 in`)
  else skipped (`1 h 0 min 5 s` → `1 h 5 s`).
- **Symbols**: prefer typographically correct output (′ ″ for ft/in compound, °C with
  no space, narrow NBSP between number and symbol OFF by default — plain space; ASCII
  fallback everywhere our parser reads back).
- **Intl integration**: number part through `Intl.NumberFormat(locale)` with grouping
  OFF by default in inputs-facing contexts (parse-back safety: '1,234 m' would re-parse
  under dot-decimal but the option `grouping: true` enables it for display-only).
  When `intl` id exists and `style: 'long'`, unit names may come from
  `Intl.NumberFormat unit style` — but ONLY for locales ≠ en (en names ship in data;
  keeps output deterministic in tests and en-bundles Intl-independent).
- **Scientific/engineering notation**: `notation:'scientific'` renders one
  non-zero digit before the decimal point; `notation:'engineering'` pins the
  exponent to a multiple of 3. Exponents render as parseable `e`, `×10^n`, or
  superscript `×10ⁿ`.
- **toBest**: candidates = same-system units with `best` weight; pick largest unit
  with |value| ≥ 1 (fallback: smallest candidate); tie-break toward fewer integer
  digits. Never cross metric↔us/imperial.
- **Ranges**: en-dash between bare numbers when units identical ('5–10 kg'); ' to '
  in long style; open bounds: symbol style '≥ 5 kg', long style 'at least 5 kg'
  (both re-parse).

## Round-trip invariants (tested property-style)

1. `parseQuantity(format(q, anyStyle)).base ≈ q.base` (rel 1e-9, post-rounding grain).
2. `format(parseQuantity(s).quantity)` is idempotent under same opts.
3. Compound: `parseQuantity('5\'11"').quantity.format({ compound: true }) === '5′11″'`.
