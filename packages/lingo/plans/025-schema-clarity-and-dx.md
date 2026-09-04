---
id: 025
title: Wire schema (v3) & serialization DX
status: done
created: 2026-07-06
updated: 2026-07-07
goal: "The compact JSON that lingo emits reads for itself — flat results, self-describing spans, one canonical pair — with the rich labeled view split into ./describe."
---

# Wire schema (v3) & serialization DX

Driver: `JSON.stringify(lingo(...))` is the developer's first contact with lingo
output, and it must hold the bar of the best-documented APIs: every field
self-evident without reading docs, no redundant data, no bare tuples. The wire
schema is **v3** (D57). Machine-readable JSON Schema artifacts and adapters for
v3 live in plan 029 (`./schema`).

## Design principle

The wire shape stays **lean**: canonical string unit ids plus the two numbers
that matter (`value` in `unit`, `base` in `baseUnit`). Symbols, names, and
`formatted` strings live in the separate, tree-shakeable `./describe` view —
zero cost unless imported.

## Span

```ts
/** [start, end) character offsets (UTF-16 code units) into the ORIGINAL input. */
export interface Span {
  start: number
  end: number
}
```

Used everywhere public: `LingoIssue.span`, result `span`s, `DateResult.span`,
`FoundQuantity.span`. Invariants (half-open, pre-normalization input, UTF-16
units) are documented once on `Span`'s TSDoc + CONTEXT.md, not repeated as
per-span fields. In **serialized** output every span additionally carries its
matched text: `{ start, end, text }` where `text = input.slice(start, end)` —
so a span in a log or tool payload reads for itself.

## v3 wire shape (D57)

Three rules govern what `JSON.stringify(result)` / `result.toJSON()` emit:

1. **Flat.** One `schemaVersion`/`type` per result, `kind` at the top — no
   `{ type, quantity: { … } }` nesting. A quantity result is
   `{ schemaVersion: 3, ok: true, type: 'quantity', kind, value, unit, base,
   baseUnit, approximate?, parts?, alternatives?, text, span, issues,
   confidence }`; ranges hoist `baseUnit` to the root with
   `min`/`max`/`plusMinus` bounds of `{ value, unit, base, exclusive? }`;
   failures are `{ schemaVersion: 3, ok: false, type: 'failure', text, issues,
   candidate? }` (the candidate is a full recursive result).
2. **Self-describing spans.** Every serialized span is `{ start, end, text }`.
3. **Conversions are de-duplicated.** `source` carries the one authoritative
   canonical pair (`value`/`unit`/`base`/`baseUnit`); `converted` is
   `{ value, unit }` only — magnitude is preserved by conversion, so a second
   `base`/`baseUnit` and the old `targetUnit` (redundant with
   `converted.unit`) are dropped.

Field semantics: `base` + `baseUnit` are the source of truth (`fromJSON()`
trusts them and recomputes `value`, so a stale `value` never corrupts a
round-trip); `value` is the human-facing amount in `unit`; `plusMinus.center`/
`.delta` carry the DISPLAY value in `unit` AND `base` — never a bare
base-magnitude number beside a display unit.

Serialization-only: runtime result objects keep every accessor (`.quantity`,
`.source`, `.converted`, `.targetUnit`, Quantity methods); only what
serializes changes. `Quantity.toJSON()`/`QuantityRange.toJSON()` emit the same
flat field vocabulary with `schemaVersion: 3`.

### Enumerable `toJSON` (gotcha, pinned by test)

The `toJSON()` attached to results at the parse boundary
(`parse/serialize.ts`) MUST be **enumerable**: JavaScriptCore (Bun,
Safari/WebKit — where the DOM layer runs) has a `JSON.stringify` fast path
that skips a non-enumerable `toJSON` on objects whose own values are all
JSON primitives, silently serializing the raw runtime shape instead of v3. A
structural guard test pins this. Cost: `Object.keys(result)` lists `toJSON` —
switch on `.type` or `JSON.stringify` rather than enumerating keys.

## `fromJSON` validation

`fromJSON` input is developer-supplied → throw programmer errors naming the
exact field:

- Reject unknown `schemaVersion` (reads v3 only; nothing earlier was released).
- Reject non-finite `base`/`value`/`center`/`delta`.
- Reject reversed range bounds (`min.base > max.base`) — no silent pass-through.
- If `baseUnit` is present, verify it equals the kind's registered base unit.

## `./describe` — rich view, opt-in, tree-shakeable

Standalone functions in `@pascal-app/lingo/describe` (NOT class methods —
methods can't tree-shake off the always-shipped class):

```ts
export function describeResource(q: Quantity): QuantityResource
export function describeResource(r: QuantityRange): RangeResource
// { object:'lingo.quantity', kind:'length',
//   value:{ amount:72, unit:{ id:'in', symbol:'in', name:'inch', … } },
//   canonical:{ amount:1.8288, unit:{ id:'m', symbol:'m', name:'meter', … } },
//   formatted:'72 in' }
```

Symbol/name/`formatted` live here — for docs, debugging, and LLM tool output
that wants maximum self-evidence. `formatted` couples to the format module, so
it stays out of the lean wire `toJSON`. Resource-style result views
(`describeResult`) build on the same primitives in plan 028.

## format() round-trip policy

`format()` must never emit what the parser can't read back (hard rule 4):

- Default: unit LABELS use the registry's English `name`/`plural` (parseable)
  even under a non-English `locale`; the NUMBER may still localize via
  `Intl.NumberFormat`.
- Explicit opt-in `localizedUnits?: boolean` (default false) restores Intl
  unit words, documented as **display-only, outside the two-way guarantee**.
- The two-way guarantee holds for default formatting; localized NUMBERS
  round-trip only when parsed with the matching `numberFormat`.
- Round-trip tests exercise every default `FormatOptions` path.

## Acceptance / gates

- `bun run check` green (typecheck + test + build + size + corpus + zero-deps).
- Every wire-shape change has serialized-JSON corpus fixtures.
- Two-way: round-trip tests for format() defaults; `toJSON`→`fromJSON` identity.
- Plans 001/009/012 result-shape references match v3.
- TSDoc `@example` on every changed/new export; README/llms.txt/site synced.
