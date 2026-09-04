# Standard Schema v1.1.0 and its consumers (research 2026-07-05)

Research pass 2026-07-05 — a multi-agent pass on Standard Schema v1.1.0's JSON
Schema sibling spec and its consumer ecosystem, verified against npm registry
timestamps, the GitHub Releases API, diffs of compiled `dist/` bytes between
published tarballs, and a direct read of lingo's own `packages/lingo/src/ai/*.ts`
in this session. Feeds plan 024 (`plans/024-ecosystem-integration-and-docs.md`),
which owns the build decisions; this document is the verified evidence under them.

**Versions verified**: `@standard-schema/spec@1.1.0` (published 2025-12-15;
`1.0.0` published 2025-01-27) · `ai@7.0.15` / `@ai-sdk/provider-utils@5.0.5` ·
`zod@4.4.3` (feature since `4.2.0`, 2025-12-15) · `arktype@2.2.2` (feature since
`2.1.28`, 2025-12-03) · `valibot@1.4.2` + `@valibot/to-json-schema@1.7.1`
(feature since `1.5.0`, 2025-12-11) · `effect@3.21.4` · `@hookform/resolvers@5.4.0`
· `@tanstack/react-form@1.33.0` · `@trpc/server@11.18.0` ·
`@hono/standard-validator@0.2.3` · `vee-validate@4.15.1` ·
`@standard-community/standard-json@0.3.5`.

## The load-bearing finding

`StandardJSONSchemaV1` is not a speculative extension lingo invented or guessed
at — it is the ratified spec. [`@standard-schema/spec`](https://github.com/standard-schema/standard-schema)
shipped **v1.1.0 on 2025-12-15** (npm registry `time['1.1.0']` =
`2025-12-15T20:49:46Z`; GitHub Releases API `published_at` = `2025-12-15T20:53:43Z`
— two independent clocks, same date), adding a second, sibling interface —
`StandardJSONSchemaV1` — to the same package that has shipped `StandardSchemaV1`
(validate) since **v1.0.0 (2025-01-27)**. Diffing the compiled `dist/index.d.ts`
between the two tags confirms the shape is genuinely new: 1.0.0 is 58 lines and
never mentions `jsonSchema`; 1.1.0 is 119 lines and adds it wholesale, alongside
a new shared `StandardTypedV1` base. `packages/lingo/src/ai/standard-schema.ts`
is a field-for-field, near-verbatim port of that real `index.ts` (confirmed by
direct read this session) — `vendor`, `version`, `types`, `jsonSchema.input`/
`.output`, `Options.target`/`libraryOptions`, all present under the spec's own
names, just flattened out of TypeScript namespaces (`StandardJSONSchemaV1Props`
instead of `StandardJSONSchemaV1.Props` — cosmetic, structurally inert). lingo
is a spec citizen, not a guesser.

## The spec, verbatim

The official package (`packages/spec/src/index.ts` on
[github.com/standard-schema/standard-schema](https://github.com/standard-schema/standard-schema/blob/main/packages/spec/src/index.ts),
[npm](https://www.npmjs.com/package/@standard-schema/spec)) exports exactly
three names — `StandardTypedV1`, `StandardSchemaV1`, `StandardJSONSchemaV1` —
never a merged fourth:

```ts
export interface StandardTypedV1<Input=unknown, Output=Input> {
  readonly "~standard": StandardTypedV1.Props<Input, Output>
}
namespace StandardTypedV1 { export interface Props<I,O> {
  readonly version: 1; readonly vendor: string; readonly types?: {input:I; output:O}
}}

export interface StandardSchemaV1<Input=unknown, Output=Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>  // extends StandardTypedV1.Props
}
namespace StandardSchemaV1 { export interface Props<I,O> extends StandardTypedV1.Props<I,O> {
  readonly validate: (value: unknown, options?: {libraryOptions?: Record<string,unknown>}) =>
    Result<O> | Promise<Result<O>>   // Result = {value:O, issues?:undefined} | {issues: Issue[]}
}}

export interface StandardJSONSchemaV1<Input=unknown, Output=Input> {   // ← NEW in v1.1.0
  readonly "~standard": StandardJSONSchemaV1.Props<Input, Output>
}
namespace StandardJSONSchemaV1 { export interface Props<I,O> extends StandardTypedV1.Props<I,O> {
  readonly jsonSchema: { input(o:Options): Record<string,unknown>; output(o:Options): Record<string,unknown> }
}
interface Options { target: 'draft-2020-12'|'draft-07'|'openapi-3.0'|(string&{}); libraryOptions?: Record<string,unknown> } }
```

`StandardSchemaV1` itself is untouched by the 1.1.0 release — still just
`validate(value, options?)`, no `jsonSchema` member. The package never ships an
intersection type; implementers and consumers write
`StandardSchemaV1<I,O> & StandardJSONSchemaV1<I,O>` themselves whenever they
need both. AI SDK's own internal type does exactly this
(`StandardSchema<SCHEMA> = StandardSchemaV1<unknown,SCHEMA> & StandardJSONSchemaV1<unknown,SCHEMA>`),
and so does lingo's `LingoField<Output,Input>`. Because both interfaces key off
the same `"~standard"` property and share the `Props` ancestor (`version`/
`vendor`), one object satisfies both at once just by putting `validate`,
`jsonSchema`, `version`, and `vendor` under a single `~standard` — no adapter
or wrapper required, exactly the shape `createField()` builds.

On "ratified": there is no formal RFC ceremony in these sources, but
functionally it is released, not a draft — tagged `latest` on npm, versioned
as an ordinary semver-minor, documented at the canonical
[standardschema.dev/json-schema](https://standardschema.dev/json-schema), and
already implemented by five libraries (below). That is what matters for an
integration decision.

## Who consumes which half

Two consumption patterns exist today, and they do not overlap:

| Consumer | Version | Half used | Mechanism |
|---|---|---|---|
| `@hookform/resolvers/standard-schema` | 5.4.0 | validate only | `standardSchemaResolver` literally does `schema['~standard'].validate(values)`, nothing else ([source](https://github.com/react-hook-form/resolvers/blob/main/standard-schema/src/standard-schema.ts)) |
| TanStack Form | 1.33.0 | validate only | `validators: { onChange: schema }` accepts any Standard Schema ([docs](https://tanstack.com/form/v1/docs/framework/react/guides/validation)) |
| tRPC | 11.18.0 | validate only | `.input(schema)` ([docs](https://trpc.io/docs/server/validators)) |
| Hono | `@hono/standard-validator@0.2.3` | validate only | `sValidator('json', schema)` ([npm](https://www.npmjs.com/package/@hono/standard-validator)) |
| vee-validate | 4.15.1 | validate only | still validate-only in production; the author is prototyping JSON-Schema consumption in a *new* library (Formwerk), not vee-validate itself ([issue #147](https://github.com/standard-schema/standard-schema/issues/147)) |
| Vercel AI SDK | `ai@7.0.15` / `@ai-sdk/provider-utils@5.0.5` | validate **and** jsonSchema | `asSchema()` — see below |
| LangChain.js | — | validate **and** jsonSchema | structured-output tool binding needs a JSON Schema to hand the provider, not just a validator — included for completeness; not independently source-verified in this pass (its own citation pass is pending under plan 024's `ecosystem-langchain`) |

The AI SDK row is the one verified byte-for-byte, at three levels: npm registry
metadata, GitHub source, and the compiled bytes of the actual published
`provider-utils-5.0.5.tgz` tarball (not just `main`, which can drift ahead of a
release). `@ai-sdk/provider-utils@5.0.5` — a pinned, exact dependency of
`ai@7.0.15` (npm `latest`, published 2026-07-04) — declares
`"@standard-schema/spec": "^1.1.0"` directly. Its `asSchema()` dispatches:

```ts
'~standard' in schema
  ? schema['~standard'].vendor === 'zod' ? zodSchema(schema) : standardSchema(schema)
  : schema()
```

For any non-Zod vendor, the internal (unexported — `asSchema` is the only
public entry point) `standardSchema()` helper does:

```ts
jsonSchema(() => addAdditionalPropertiesToJsonSchema(
  standardSchema['~standard'].jsonSchema.input({ target: 'draft-07' })
), { validate: async v => { const r = await standardSchema['~standard'].validate(v); /* ... */ } })
```

The read is unguarded — no `in`/`?.` check. One mechanism refinement worth
keeping precise: `asSchema()` does not throw synchronously; `.jsonSchema` is a
lazily-evaluated getter, and `TypeError: Cannot read properties of undefined
(reading 'input')` fires the first time that getter is *read* — but every real
call path (`generateObject`/`streamObject`'s `await outputStrategy.jsonSchema()`,
`tool()`'s `inputSchema`) reads it unconditionally, and that read sits outside
the SDK's own `try {}` block, so the raw `TypeError` propagates uncaught rather
than arriving as a tidy `NoObjectGeneratedError`. The net effect stands: a
Standard Schema implementing only `validate` cannot serve as a
`generateObject`/`streamObject` schema or a tool `inputSchema` — both halves
are required for any non-Zod vendor. Zod is the sole exception:
`vendor === 'zod'` is hardcoded to route through AI SDK's own bundled
`z4.toJSONSchema()`/`zod3ToJsonSchema()`, so Zod's own real, spec-conformant
`~standard.jsonSchema` (attached in
[`to-json-schema.ts`](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/to-json-schema.ts)
~line 508) is never exercised by AI SDK at all. And this is not an
AI-SDK-invented convention to begin with — `StandardJSONSchemaV1` is the
ratified, orthogonal extension published at standardschema.dev/json-schema;
AI SDK just happens to be the consumer that makes implementing it
non-optional for drop-in compatibility.

## Three ways to implement the spec, and which one lingo matches

- **Native, from construction** — ArkType 2.2.2 (feature since 2.1.28,
  2025-12-03): the schema root type literally implements both interfaces
  ([`ark/schema/roots/root.ts`](https://github.com/arktypeio/arktype)); every
  schema always has both halves.
- **Lazy base, eager attach** — Zod 4.4.3 (feature since 4.2.0, 2025-12-15,
  "Implement Standard JSON Schema", standard-schema PR #134): the core
  `~standard` getter is lazily memoized (`util.defineLazy`), but the public/
  classic layer's `Object.assign(inst["~standard"], { jsonSchema: {...} })`
  runs at schema-construction time — by the time any ordinary `z.object()`
  exists, `jsonSchema.input`/`.output` already work directly, no extra call.
  ("Lazily-attached" undersells it: the base getter is lazy, the `jsonSchema`
  sub-object itself is eager.)
- **Separate package** — Valibot 1.4.2 core ships no JSON Schema at all;
  `toStandardJsonSchema()` lives only in
  [`@valibot/to-json-schema`](https://www.npmjs.com/package/@valibot/to-json-schema)
  (added in 1.5.0, 2025-12-11, peer `valibot@^1.2.0` at the time; the current
  1.7.1 has since raised its peer floor to `^1.4.0`). A raw Valibot schema
  validates fine in tRPC/TanStack Form and throws in AI SDK unless explicitly
  wrapped.
- **Non-adopter** — Effect Schema (`effect@3.21.4`): `Schema.standardSchemaV1`
  ([docs](https://effect.website/docs/schema/standard-schema/)) implements
  base `StandardSchemaV1` only. Effect's own changelog (PR #4648) makes the
  non-adoption deliberate — JSON Schema generation stays in Effect's separate,
  non-standard `JSONSchema.make()` module, never wired into `~standard`. Effect
  Schema consumers get zero benefit from any library, lingo included, that
  only speaks `~standard.jsonSchema`.
- Also implementing, per [standardschema.dev/json-schema](https://standardschema.dev/json-schema)'s
  own adopter list: GraphQL Standard Schema (v0.2.0+), VineJS (v4.3.0+) — the
  fourth and fifth of the "five libraries" above. Pre-spec, a community bridge,
  [`@standard-community/standard-json@0.3.5`](https://github.com/standard-community/standard-json),
  synthesizes JSON Schema from validate-only Standard Schemas by dispatching on
  `~standard.vendor` — evidence the ecosystem was solving this ad hoc before
  v1.1.0 formalized it.

lingo's `createField()` matches the **first** pattern — every `LingoField`
carries both halves the moment `quantityField()`/`rangeField()`/`dateField()`/
`lingoObject()` returns, the same shape as Zod ≥4.2 and ArkType ≥2.1.28, not
Valibot's wrapper-required pattern or Effect's non-adoption. Concretely:
`tool({ inputSchema: lingoObject({ weight: quantityField({kind:'mass', unit:'kg'}) }) })`
drops straight into AI SDK with zero adapter code, because `vendor === 'lingo'`
takes the generic branch and both `~standard` halves are already there. (lingo's
decision to ship both halves at all is already recorded as `wiki/decisions.md`
D18; this pass is the primary-source verification of why that decision was
load-bearing, not a proposal to revisit it.)

## Implications for lingo

Two real drifts surfaced, both confirmed by a direct read of
`packages/lingo/src/ai/*.ts` this session, not just the research brief:

1. **`StandardSchemaV1Options` is a loose index signature, not the canonical
   shape.** `standard-schema.ts:22-24` types it
   `{ readonly [key: string]: unknown }`; the upstream 1.1.0 shape is
   `{ readonly libraryOptions?: Record<string, unknown> | undefined }`.
   Cosmetic and inert today — no consumer verified in this pass (react-hook-form,
   AI SDK) ever passes a second argument to `validate()` — but worth matching
   exactly as the spec keeps evolving (it has already changed once, seven
   months ago).
2. **Every field's JSON Schema converter ignores its `options` argument.**
   `quantityField`'s and `rangeField`'s `input`/`output` closures in
   `quantity-fields.ts` (`stringJsonSchema(...)`, `quantityJsonSchema()`,
   `numberJsonSchema(...)`, all called with zero arguments) and `dateField`'s
   equivalent in `date-field.ts` are arity-0 —
   `field['~standard'].jsonSchema.input.length === 0` at runtime, and calling
   `.input({target:'draft-07'})`, `.input({target:'openapi-3.0'})`, and
   `.input({target:'made-up-value'})` on the same field returns byte-identical
   JSON. This is spec-legal (options are advisory; TS function-arity subtyping
   permits fewer params; `tsc --noEmit` stays clean) and safe today because
   lingo only ever emits `type`/`description`/`properties`/`required`/
   `additionalProperties`/`enum`/`minimum`/`maximum` — stable across draft-07,
   draft-2020-12, and OpenAPI-3.0 unmodified. It becomes a real bug the day a
   field needs a keyword that is not portable across all three (tuple
   `prefixItems` is 2020-12-only; OpenAPI 3.0 forbids `type` arrays and wants
   `nullable: true` instead). The gap is isolated to the leaf field factories —
   `lingoObject`'s composition layer (`canonicalize.ts`'s `jsonSchemaForSpec`)
   already threads the caller's real `options` down correctly through every
   nested field, and AI SDK's hardcoded `target: 'draft-07'` is exactly the one
   value lingo needs to keep handling correctly regardless of this gap.

Spec-fidelity opportunities, roughly in order of leverage:

- Fix `StandardSchemaV1Options` to the canonical
  `{ readonly libraryOptions?: Record<string, unknown> | undefined }` — a
  one-line, zero-runtime-effect type change that removes the only literal
  drift from upstream.
- Add a type-only, zero-runtime-cost self-certification check — a `.test-d.ts`
  using `@standard-schema/spec` as a types-only devDependency, asserting
  `quantityField(...) satisfies StandardSchemaV1<unknown, number> & StandardJSONSchemaV1<unknown, number>`
  — so the next upstream spec change (there has already been one) is caught
  mechanically, in the same spirit as `check-zero-deps.mjs`.
- Document, prominently, that AI SDK's `tool()`/`generateObject()`/
  `Output.object()` require **both** `~standard.validate` and
  `~standard.jsonSchema.input()` — validate-only throws a raw `TypeError`, not
  a friendly SDK error. This is the single most valuable, non-obvious fact for
  lingo's own `/ai` docs to lead with; it is exactly the trap current
  Valibot-core users fall into.
- Cross-sell the same field/object definitions as form-library recipes
  (`standardSchemaResolver(lingoObject({...}))` for React Hook Form;
  `validators: { onChange: lingoObject({...}) }` for TanStack Form) — these
  consumers only need `validate()`, which lingo already ships, making "one
  schema, both a human form and an agent tool" a provable code-reuse fact
  rather than a slogan. Same idea for a Hono (`sValidator('json', ...)`) and a
  tRPC (`.input(...)`) recipe.
- Track upstream issues
  [#147](https://github.com/standard-schema/standard-schema/issues/147)
  (cross-library JSON Schema fidelity — `default`, `required` vary by
  implementer),
  [#163](https://github.com/standard-schema/standard-schema/issues/163)
  (`uniqueItems` support), and
  [#166](https://github.com/standard-schema/standard-schema/issues/166)
  (runtime guarantees for `FailureResult.issues`) — all three sit exactly on
  the surface lingo depends on.
- Make the target-ignoring choice legible rather than incidental: one code
  comment in `quantity-fields.ts` noting the emitted keyword set is
  deliberately draft-07/2020-12/OpenAPI-3.0-portable, so the next contributor
  adding a non-portable keyword knows to branch on `target` at that point.
- Optional ergonomics, worth weighing on their own byte cost: a `.meta()`-style
  passthrough (title/examples/id merged into the emitted schema) and a thin
  standalone `toJsonSchema(field, {target})` wrapper over the
  already-implemented `field['~standard'].jsonSchema.output(...)` — friendlier
  discovery than reaching into `~standard` by hand.

Which of these ship, in what order, and at what byte cost is a plan 024
decision, not this document's — this pass exists to make sure that decision
starts from verified facts.
