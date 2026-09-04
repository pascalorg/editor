---
id: 029
title: Schema reference, JSON Schema, and validator adapters
status: in-progress
created: 2026-07-07
updated: 2026-07-07
goal: "Make lingo's data schema self-documenting and consumable by external validators without adding a runtime dependency."
success_criteria:
  - "Canonical JSON Schema (Draft 2020-12) of the v3 wire types exported from ./schema, kept honest by a gate that validates real lingo() outputs against it"
  - "A generated schema dictionary (every key + type + enum values) in the docs, sourced from the schema + catalog, highly readable"
  - "Ready-to-paste Zod / Valibot / TypeBox / ArkType / Effect Schema equivalents in the docs, generated from the JSON Schema (NOT depended on)"
  - "OpenAPI 3.1 components.schemas document available for API docs"
  - "Zero runtime dependency; ./schema ships pure data + tiny helpers; size gated"
---

# Schema reference, JSON Schema, and validator adapters

Driver (owner, 2026-07-07): beyond parse/convert/format, lingo should be a
holistic structured-data library — its schema should be self-documenting, and
consumers should get machine-readable schemas and ready-made validators for the
popular TS schema libraries. Pairs with the `./catalog` query layer (D56).

## Constraints

- **Zero runtime deps** (hard rule 1). We cannot import zod/valibot/typebox/
  arktype/effect. So: ship a canonical **JSON Schema** (pure data) as the source
  of truth, and GENERATE the framework schemas as code for the docs — users
  paste the exact schema; lingo never depends on the lib.
- The schema describes the **v3 compact wire JSON** (plan 025 + the v3 bump), the
  shape `JSON.stringify(lingo(...))` / `toJSON()` produce. Not the opt-in
  resource view (that is plan 028's `describe*`).
- The JSON Schema must not drift from the TS types / real output — gated.

## Surfaces

### 1. Canonical JSON Schema — `@pascal-app/lingo/schema`

Draft 2020-12 (also valid as OpenAPI 3.1 schema objects). A discriminated union
on `type` over `quantity | range | conversion | failure`, plus reusable
definitions: `Span` (`{start,end,text}`), `Issue` (`{code,severity,message,span,
suggestions?,data?}`), `QuantityValue`, `RangeValue`, and enums `Kind`,
`UnitSystem` (`metric|us|imperial|shared`), `Severity` (`error|warning|info`),
`IssueCode` (33 codes). Exported as a plain object `lingoJsonSchema` and a
`resultJsonSchema()`/`valueJsonSchema()` accessor. Each property carries a
`description` and, where bounded, an `enum`.

### 2. Schema dictionary (docs)

A generated reference page: for every key, a row with name, type, whether
optional, description, and enum values (linking kinds/units/issue-codes to the
catalog). Generated from the JSON Schema `description`s + catalog data so it can
never drift. Highly readable (grouped by result type).

### 3. Framework adapters (docs, generated)

A dev script (`scripts/gen-schemas.mjs`) emits ready-to-paste schema code for
Zod, Valibot, TypeBox, ArkType, and Effect Schema from the canonical JSON
Schema, published on the docs site (and/or as snippet files). No runtime cost;
no dependency. Effect Schema ref: https://effect.website/.

### 4. OpenAPI

A small `openapi.json` (3.1) wrapping the JSON Schema under `components.schemas`,
for teams documenting lingo-backed APIs.

## Gates

- A test validates several real `lingo(...)` outputs (quantity, range,
  conversion, failure, with issues + sub-spans) against the JSON Schema with a
  tiny built-in validator (zero-dep) so the schema stays honest.
- `bun run size` budget for `./schema`.
- Dictionary + adapter snippets regenerate deterministically (a `--check` mode
  fails if the committed docs drift from the schema).

## Sequencing

Depends on the v3 wire-shape bump (D57) — the schema documents v3. Related: 025
(schema clarity), 028 (resource view), and the D56 catalog. Build after v3 lands
so the schema targets the final shape.
