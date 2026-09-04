---
id: 028
title: Resource-style output schema
status: done
created: 2026-07-07
updated: 2026-07-07
goal: "Make lingo outputs easy to read as resource objects without breaking compact v2 JSON."
success_criteria:
  - "[MET] Resource-style parse result view includes object names, grouped values, source text spans, rich units, date resources, and duration resources -> describeResult tests"
  - "[MET] Standalone value resource view via describeResource(quantity|range) reuses the same lingo.quantity/lingo.range primitives, with a clear guard error on misuse -> api-surface tests (D52)"
  - "[MET] Existing v2 toJSON shapes stay unchanged -> api-surface tests and corpus gate"
  - "[MET] Opt-in describe entry absorbs the richer shape cost -> size gate with D41/D42/D52 recalibration"
---

# Resource-style output schema

Driver: the owner wants lingo outputs to feel more like Stripe/Pascal resource
contracts: obvious object names, grouped fields, outsider-readable data, and no
parser-internal feel. Inspiration: `../home-services/wiki/resource-design.md` and
`../home-services/wiki/api-design.md`.

## Design principle

`toJSON()` remains the compact, stable storage/round-trip contract. Resource-style
output is an **opt-in view** from `@pascal-app/lingo/describe` so default parse
size and existing v2 serialized shapes do not move.

## Design — resource view (locked-in 2026-07-07)

```ts
import { lingo } from '@pascal-app/lingo'
import { describeResult } from '@pascal-app/lingo/describe'

describeResult(lingo('5 meterz', { kind: 'length' }))
// {
//   object: 'lingo.parse_result',
//   resourceSchemaVersion: 1,
//   status: 'success',
//   type: 'quantity',
//   input: { text: '5 meterz', span: { start: 0, end: 8, text: '5 meterz' } },
//   data: {
//     object: 'lingo.quantity',
//     kind: 'length',
//     value: { amount: 5, unit: { id: 'm', symbol: 'm', name: 'meter' } },
//     canonical: { amount: 5, unit: { id: 'm', symbol: 'm', name: 'meter' } },
//     formatted: '5 m'
//   },
//   issues: [{
//     object: 'lingo.issue',
//     code: 'TYPO_CORRECTED',
//     severity: 'warning',
//     source: { span: { start: 2, end: 8, text: 'meterz' } },
//     data: { unit: 'meterz', corrected: 'm' }
//   }],
//   confidence: 0.85
// }
```

Rules:

- Use `object` names for the primitives/compositions: `lingo.parse_result`,
  `lingo.quantity`, `lingo.range`, `lingo.conversion`, `lingo.number`,
  `lingo.date`, `lingo.duration`, `lingo.issue`, `lingo.alternative`.
- `describeResource(quantityOrRange)` returns standalone `lingo.quantity` /
  `lingo.range` primitives for callers that already hold a value and do not
  need a fake `lingo.parse_result` wrapper.
- Group numbers with units: `value: { amount, unit }`; canonical values use
  `canonical: { amount, unit }`. Do not expose a bare `base` in this view.
- Ranges use `canonicalUnit` at the range root because a range has no single
  canonical amount; each bound or plus/minus component uses amount-bearing
  `canonical`.
- Every parse-path span includes the source substring as `text` while retaining
  `{ start, end }` offsets. Failed resource results include a full-input
  `input.span` for log readability; issue spans stay precise when the parser
  knows the narrower source.
- Use `issues`, not `diagnostics`, to preserve the repo vocabulary.
- Failures use `status: 'failure'` and may include a recursively described
  `candidate`.
- Successful quantity ambiguities attach `alternatives` as `lingo.alternative`
  resources with `{ type, reason, confidence, data }`. Date alternatives use the
  same alternative resource shape with `data.object === 'lingo.date'`.
- Conversions are compositions with `source`, `target: { unit }`, and
  `converted`.
- Date and duration results from `@pascal-app/lingo/date` are accepted by
  `describeResult()` too. Date resources expose `value: { iso,
  epochMilliseconds }`, `grain`, `known`, and a local `calendar` object for the
  known civil fields. Duration resources expose displayed `value`, canonical
  seconds, `formatted`, and compound `parts` when present.
- The resource view uses `resourceSchemaVersion`, not parse-result
  `schemaVersion`, so it cannot be mistaken for compact storage JSON.
- The shape is display/debug/tool-boundary friendly, not a replacement for
  compact storage JSON until a future default-schema decision.

## Initial natural-language coverage slice

Also in this pass: broaden safe one-to-one aliases users say aloud or type in
forms: `miles an hour`, `meters a second`, `pounds per sq inch`, `m/sec`,
`mi/hour`, `µL`/`uL`, `cL`, `dL`, `sf`, and `cubic feet`. D46 later added a
declared `flow_rate` kind for common volume-per-time units; arbitrary
dimensional algebra remains out of scope.

## Acceptance / gates

- `bun run check` in `packages/lingo` — green 2026-07-07 (re-verified after the
  resumed correctness/DX pass: D52–D55).
- `bun run typecheck` + `bun run build` in `apps/site` — green 2026-07-07.
- Focused tests for `describeResult()`, spoken quotient aliases, and deferred
  unit hazards — covered by `src/describe/describe.test.ts`,
  `src/parse/grammar.test.ts`, and `src/parse/corpus.test.ts`.
- README / `llms.txt` / site docs / progress log updated.
