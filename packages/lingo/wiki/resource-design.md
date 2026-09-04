# Resource design

This page adapts Pascal's `home-services` resource-design playbook to lingo.
The source idea is the same: model things with stable, outsider-readable names
and compose larger payloads from smaller primitives. The important difference is
that lingo mostly returns deterministic parser values, not persisted business
records.

For public function shapes, semver, issue codes, and gates, use
[`api-design.md`](api-design.md). This page answers what the output objects are.

## Persistence vs value objects

`home-services` primitives carry `id`, `object`, `created_at`, and `updated_at`
because they are persisted resources. lingo parser values do not. A parsed
quantity, range, issue, or conversion is reproducible from input text plus
options, so adding fake ids or timestamps would make logs noisier without adding
meaning.

lingo therefore has two layers:

- **Compact wire JSON**: `schemaVersion: 3` result and value JSON used for
  storage, round trips, and corpus stability. This stays small and canonical
  (flat shape, self-describing spans — D57).
- **Resource view**: opt-in output from `@pascal-app/lingo/describe`, designed
  for docs, logs, debugging, and tool output where self-explanatory shape is
  worth extra bytes. `describeResource(quantityOrRange)` returns standalone
  value resources; `describeResult(result)` wraps a full parse result with
  input, issues, alternatives, and candidates.

Do not mix the two layers casually. If a richer field is only for readability,
put it in the resource view. If a field is needed to rehydrate or preserve
semantics, it belongs in compact JSON and must pass the API-design checklist.

## Lingo resource primitives

These are the stable object names used by resource views:

| object | primitive or composition | purpose |
|--------|--------------------------|---------|
| `lingo.parse_result` | composition | Whole parse result: input, status, type, data, issues, alternatives, candidate. |
| `lingo.quantity` | primitive | One value in one unit plus its canonical value. |
| `lingo.range` | composition | Bounds or plus/minus values composed from quantity-like amounts. |
| `lingo.conversion` | composition | Source value, target unit, and converted value. |
| `lingo.number` | primitive | Bare number parse with no unit. |
| `lingo.date` | primitive | Parsed instant plus grain, known calendar fields, and a local calendar view. |
| `lingo.duration` | primitive | Parsed duration with displayed amount, canonical seconds, formatted text, and parts. |
| `lingo.issue` | primitive | Structured warning/error/info with code, severity, message, span, suggestions, and data. |
| `lingo.alternative` | composition | Ranked other interpretation attached to a successful result. |

The unit object nested inside quantities is not named `lingo.unit` today because
it is a description of a registered `UnitDef`, not a standalone result object.
Keep it as `{ id, symbol, name, plural?, system? }` unless it gains behavior or
identity beyond description.

## Shape rules

1. **Use outsider-readable object names.** Prefer `lingo.quantity` over parser
   implementation names. Preserve repo vocabulary: result, quantity, range,
   conversion, issue, candidate, alternative, suggestion.
2. **Group coupled fields.** A numeric amount and its unit travel together:
   `value: { amount, unit }`. Canonical values use
   `canonical: { amount, unit }`. A range root has no single canonical amount,
   so it uses `canonicalUnit` while its bounds use amount-bearing `canonical`.
3. **Keep source text with spans.** Both layers carry `{ start, end, text }`
   spans (v3 made `text` part of the compact shape too), so logs can be read
   without slicing the original input. Successful results use the parsed span;
   failed results include a full-input span while issue spans point at the
   precise source when known.
4. **Use `object` for resource identity and top-level `type` for result
   discrimination.** Nested resource objects generally do not need an extra
   `type` when `object` already names them.
5. **Model alternatives as resources, not strings.** A successful ambiguity
   should expose `object`, `type`, `reason`, `confidence`, and the alternate
   parsed data.
6. **Model conversions as a composition.** A conversion has `source`,
   `target: { unit }`, and `converted`. `target.unit` is a unit description,
   not only a string.
7. **Expose dates as instants plus local calendar fields.** `lingo.date`
   carries `value: { iso, epochMilliseconds }` and, for primary date results,
   `calendar` fields selected by `known`/`grain` so day-grain civil dates do
   not need to be mentally reconstructed from UTC ISO text.
8. **Do not add persistence fields to deterministic values.** No `id`,
   `created_at`, or `updated_at` unless lingo starts returning stored records.
9. **Avoid parser-internal field names in resource views.** `base` is compact
   JSON vocabulary; resource views use `canonical`.
10. **Keep dangerous ambiguity explicit.** If an input can mean different kinds
   or semantics (`mb`, `oz`, `NM`, `psig`, flow rates, molarity shorthands),
   design the issue or kind model before adding global aliases.
11. **Prefer additive readability.** Resource-view changes should not change
   compact wire JSON or existing parse interpretation unless the API-design
   semver process says so.
12. **Version parse-result resource envelopes as a view.** Use
    `resourceSchemaVersion`, not the compact parse-result `schemaVersion`, so
    logs do not imply the resource view is a storage JSON successor. Standalone
    value resources returned by `describeResource()` are the same primitives
    nested inside that versioned envelope.

## Review checklist

Use this before changing `describeResource()`, `describeResult()`, compact
JSON, or any new output object.

1. Is the object name stable and understandable outside the implementation?
2. Is this a primitive value or a composition of other values?
3. Are coupled fields grouped rather than flattened?
4. Does every parse-path span still point into the original input?
5. Are issue, candidate, alternative, and suggestion kept distinct?
6. Does the shape avoid fake persistence fields?
7. Does compact JSON remain stable, or is the breaking/additive impact recorded?
8. Does the resource view include enough context to read logs without calling
   back into the registry?
9. Are ambiguity hazards documented or deferred instead of silently accepted?
10. Are README, llms.txt, site markdown, plans, CHANGELOG, and size gates updated?
