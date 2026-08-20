# LLM provider integration surfaces for lingo /ai (research 2026-07-05)

lingo's `/ai` fields (`quantityField`, `rangeField`, `dateField`, composed via `lingoObject`) are
[Standard Schema](https://standardschema.dev) objects that also implement the newer
`StandardJSONSchemaV1` companion spec: every field's `~standard.jsonSchema.input(options)` emits
`{ type: 'string', description }` — the most portable JSON Schema fragment that exists — and
`.validate()`/`.safeParse()` return a canonical number or ISO date string. This page consolidates a
verified multi-agent research pass (four staged briefs — Vercel AI SDK, OpenAI, Anthropic,
Gemini/others — each independently adversarially fact-checked against primary sources: npm registry
timestamps, shipped `.d.ts`/source files, and current provider docs) on how that one field shape
lands across the real July-2026 LLM ecosystem. Every correction the verify pass produced is folded
into the prose below as the corrected fact, not appended as a caveat list. Decisions and any
shipped-code gates based on these findings live in `plans/024-ecosystem-integration-and-docs.md`;
this page is the dated record of what's true today, meant to be re-checked on a cadence rather than
trusted forever.

## Version pins at a glance

| Surface | Package | Version | Notes |
|---|---|---|---|
| Vercel AI SDK 7 | `ai` (`latest`) | 7.0.15 | patch 2026-07-04; major shipped 2026-06-25 |
| Vercel AI SDK 6 | `ai` (`ai-v6`) | 6.0.219 | patched 2026-07-02 |
| Vercel AI SDK 5 | `ai` (`ai-v5`) | 5.0.210 | patched 2026-07-02 |
| — | `@ai-sdk/provider-utils` | 5.0.5 | pairs with `ai@7.0.15`; Standard JSON Schema path since `4.0.0` |
| — | `@ai-sdk/mcp` | 2.0.7 | `createMCPClient` + `client.tools({schemas})` live here, not core `ai` |
| Standard Schema | `@standard-schema/spec` | 1.1.0 | 2025-12-15 — added `StandardJSONSchemaV1` |
| OpenAI | `openai` | 6.45.0 | 2026-06-29 |
| Anthropic | `@anthropic-ai/sdk` | 0.110.0 | 2026-07-02 |
| Gemini | `@google/genai` | 2.10.0 | 2026-06-24 |
| xAI Grok | `openai` + custom `baseURL` | 6.45.0 | first-party `xai-sdk` 1.0.0-alpha.0 (2025-07-11) is stale — avoid |
| Mistral | `@mistralai/mistralai` | 2.4.1 | — |
| Cohere | `cohere-ai` (`ClientV2`) | 8.0.0 | v1's `parameter_definitions` is not JSON Schema — avoid |
| Groq | `groq-sdk` | 1.3.0 | OpenAI-compatible proxy |
| Ollama | `ollama` | 0.6.3 | structured output is local/self-hosted only |
| Hugging Face | `@huggingface/inference` | 4.13.22 | — |

## Vercel AI SDK

**Version landscape.** As of 2026-07-05 the `ai` package on npm carries three simultaneously
maintained majors (registry dist-tags): `latest` = **7.0.15** (AI SDK 7 — the major shipped
2026-06-25 per [Vercel's announcement](https://vercel.com/blog/ai-sdk-7); the current patch
published 2026-07-04), `ai-v6` = **6.0.219**, and `ai-v5` = **5.0.210** — both patched 2026-07-02
(a fresher build than an earlier "last patched 2026-06-29" reading of the same line suggested; that
date belongs to the prior patch, 5.0.208). All three are live, not legacy: v5, v6, and v7 all
shipped patches within three days of this research. Guidance scoped only to "AI SDK v5" undersells
the ground — the notes below are version-gated, with v7's APIs treated as primary and v5/v6 called
out only where call-site shapes actually differ.

**lingo fields already speak the native dialect.** `@standard-schema/spec` — the interop spec
Zod/Valibot/ArkType/lingo all implement — shipped **v1.1.0 on 2025-12-15**
([PR #134](https://github.com/standard-schema/standard-schema), merged that day), adding a second
interface alongside the original `StandardSchemaV1`:

```ts
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardJSONSchemaV1.Props<Input, Output>
}
export declare namespace StandardJSONSchemaV1 {
  interface Props<Input, Output> extends StandardTypedV1.Props<Input, Output> {
    readonly jsonSchema: Converter
  }
  interface Converter {
    readonly input: (options: Options) => Record<string, unknown>
    readonly output: (options: Options) => Record<string, unknown>
  }
  type Target = "draft-2020-12" | "draft-07" | "openapi-3.0" | ({} & string)
  interface Options { readonly target: Target; readonly libraryOptions?: Record<string, unknown> }
}
```

lingo's own `LingoField` (`packages/lingo/src/ai/standard-schema.ts`) independently implements this
exact shape — `~standard.jsonSchema.input/output`, the same `{target, libraryOptions?}` options bag
— so a lingo field is, structurally, a real `StandardJSONSchemaV1` object today, not a hopeful
lookalike. (The upstream `CHANGELOG.md` is stale and still lists only the v1.0.0 entry — the
addition shipped in the package, source tree, and [docs site](https://standardschema.dev/json-schema)
with no changelog line, so don't rely on the changelog to notice future revisions.)

**Where it plugs in: the v6/v7 vs v5 split.** `@ai-sdk/provider-utils`'s `asSchema()` — the function
underneath `tool({inputSchema})`, `Output.object({schema})`, `ToolLoopAgent`'s `callOptionsSchema`,
and the MCP client's `client.tools({schemas})` — treats non-Zod Standard Schema objects differently
across majors:

- **v6/v7** (`@ai-sdk/provider-utils@4.0.0` through the current `5.0.5`): detects `'~standard' in
  schema`, and for any vendor other than `'zod'` calls
  `schema['~standard'].jsonSchema.input({ target: 'draft-07' })` for the provider-facing schema and
  `schema['~standard'].validate(value)` for parsing — confirmed byte-identical across the `4.0.0`,
  `4.0.35`, and `5.0.5` tarballs against the
  [raw source](https://github.com/vercel/ai/blob/main/packages/provider-utils/src/schema.ts). **A
  lingo field passed as-is needs zero glue code.** This path is precisely dated: it landed in
  `@ai-sdk/provider-utils@4.0.0-beta.52` (2025-12-16, PR #11224 "feat: Standard JSON Schema
  support"), went stable in `4.0.0` (2025-12-22, paired with `ai@6.0.0`) — betas before `.52`
  validated only, with no JSON-Schema-generation half.
- **v5** (`@ai-sdk/provider-utils@3.0.28`): `asSchema()` has no `'~standard'` branch at all —
  anything that isn't already an SDK-wrapped `Schema` or a thunk is force-fed into `zodSchema()`,
  which throws on a non-Zod object.

```ts
// v6/v7 — no wrapper; asSchema() detects '~standard' directly
import { tool, generateText, Output, ToolLoopAgent, isStepCount } from 'ai' // ^6 or ^7
import { quantityField, lingoObject, dateField } from '@pascal-app/lingo/ai'

const weight = quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 200 })
const logWeight = tool({
  description: 'Log a package weight',
  inputSchema: weight, // LingoField passed directly
  execute: async (kg) => ({ ok: true, kg }),
})
const { output } = await generateText({
  model,
  output: Output.object({ schema: lingoObject({ weight, loggedAt: dateField() }) }),
  prompt: 'Log: 12 lbs at 3pm yesterday',
})
const agent = new ToolLoopAgent({ model, tools: { logWeight }, stopWhen: isStepCount(4) })
```

```ts
// v5 — jsonSchema() is the public escape hatch; a ~10-line back-port of v6's own standardSchema()
import { tool, generateObject, jsonSchema } from 'ai' // ^5
import { quantityField, repairTextWith, type LingoField } from '@pascal-app/lingo/ai'

function forAiSdkV5<T>(field: LingoField<T>) {
  return jsonSchema<T>(
    () => field['~standard'].jsonSchema.input({ target: 'draft-07' }),
    { validate: (v) => {
        const r = field['~standard'].validate(v)
        return 'value' in r ? { success: true, value: r.value }
                             : { success: false, error: new Error(r.issues.map((i) => i.message).join('; ')) }
      } },
  )
}
const weight = quantityField({ kind: 'mass', unit: 'kg', min: 0 })
const { object } = await generateObject({
  model, schema: forAiSdkV5(weight),
  experimental_repairText: repairTextWith({ weight }),
  prompt: 'Log 12 lbs',
})
```

The [tools foundations doc](https://ai-sdk.dev/docs/foundations/tools) lists four supported schema
kinds — Zod, Valibot, "Standard JSON Schema compatible schemas," and raw `jsonSchema()`. Valibot needs
its own bridge package (`@ai-sdk/valibot`, built on `@valibot/to-json-schema`) because Valibot doesn't
implement `~standard.jsonSchema` itself; a library that does (lingo) isn't even named in the docs —
it just works generically.

**`generateObject`/`streamObject` are deprecated, and the repair story diverges.** AI SDK 6.0
deprecated both ("They will be removed in a future version" —
[migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)) in favor of
`generateText`/`streamText` with `output: Output.object({schema})` / `Output.array({element})` /
`Output.choice({options})` / `Output.json()`; the v6/v7 docs tree has no `generate-object.mdx`/
`stream-object.mdx` file at all anymore. `experimental_repairText` — the hook `repairTextWith()`
already targets — disappears with `generateObject` and gets **no direct successor**. The closest
analog, `experimental_repairToolCall`, is tool-shaped, not text-shaped:

```ts
experimental_repairToolCall?: (options: {
  messages: ModelMessage[]
  toolCall: LanguageModelV4ToolCall   // { toolCallId, toolName, input: string /* JSON */ }
  tools: TOOLS
  inputSchema: (o: { toolName: string }) => JSONSchema7
  error: NoSuchToolError | InvalidToolInputError
}) => Promise<LanguageModelV4ToolCall | null>
```

available on `generateText`, `streamText`, and `ToolLoopAgent`. lingo has no v6/v7-shaped counterpart
yet — `repairToolCallWith(spec)` (`JSON.parse(toolCall.input)` → `canonicalizeValues`/
`field.safeParse` → `{...toolCall, input: JSON.stringify(fixed)}`) is a clear, buildable gap using the
same skeleton `repairTextWith` already ships (see Implications, below).

**Agents and MCP.** `ToolLoopAgent` (stable since v6; a general `Agent` interface, `version:
'agent-v1'`, arrived in v7) takes `tools`, `stopWhen` (default `isStepCount(20)`), `prepareStep`,
`toolApproval` (superseding the now-deprecated per-tool `needsApproval`), `output`,
`experimental_repairToolCall`, and `callOptionsSchema: FlexibleSchema<CALL_OPTIONS>` — another slot a
lingo field fills with no wrapper on v6+. The MCP client's `client.tools({ schemas: { toolName:
{ inputSchema, outputSchema? } } })` narrows a remote MCP tool's inferred schema through the same
`asSchema()` plumbing, but as of July 2026 it ships from the standalone **`@ai-sdk/mcp`** package
(verified v2.0.7), not the core `ai` package; the export also renamed from v5's
`experimental_createMCPClient` to v6/v7's stable `createMCPClient`. v7 additionally flipped the MCP
transport's `redirect` default from `'follow'` to `'error'` (an SSRF hardening fix) — worth knowing if
a lingo-authored MCP example ever configures its own transport.

**Should lingo ship an adapter package? No.** v6/v7 need zero glue and the v5 fix is a self-contained
~10 lines built entirely from AI SDK's own public `jsonSchema()` — a dedicated `@pascal-app/lingo/ai-sdk`
entry would be exactly the kind of speculative layer AGENTS.md rules out. Document the recipe instead.
It costs nothing at runtime either way: `@standard-schema/spec@1.1.0`'s published `dist/index.js` is a
literal 0-byte file, so lingo can `import type` from it in tests — to assert the hand-rolled
`StandardJSONSchemaV1` never drifts from the ratified spec — without touching the zero-runtime-deps
gate.

**One real gap: warnings vanish on the generic path.** AI SDK's `standardSchema()` adapter (v6+) only
reads `{success,value}`/`{success,error}` from a field's `validate()` result — lingo's `warnings`
channel (typo-fixed, unit-assumed, and other benign-forgiveness signals) is silently dropped once
routed through AI SDK's default `tool`/`Output` plumbing. Anything that needs to surface those
warnings has to call `field.safeParse()` directly — inside `execute()`, or a tool-result step —
rather than trusting the validated input alone.

Sources: [ai-sdk.dev/docs/reference/ai-sdk-core/{tool,json-schema,output,generate-text,tool-loop-agent,agent,create-mcp-client}](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool)
· [migration-guide-6-0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)
· [migration-guide-7-0](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0)
· [vercel.com/blog/ai-sdk-7](https://vercel.com/blog/ai-sdk-7)
· [github.com/vercel/ai](https://github.com/vercel/ai/blob/main/packages/provider-utils/src/schema.ts)
· [github.com/standard-schema/standard-schema](https://github.com/standard-schema/standard-schema)
· npm registry dist-tags for `ai`, `@ai-sdk/provider-utils`, `@ai-sdk/mcp`, `@standard-schema/spec`.

## OpenAI

**Versions, and a hard deadline.** `openai` npm package **v6.45.0**
([latest](https://www.npmjs.com/package/openai), published 2026-06-29); current docs default to
`gpt-5.5`, with `gpt-4o-2024-08-06`/`gpt-4o-mini` as the oldest Structured-Outputs-compatible
snapshots. **The Assistants API is deprecated and shuts down 2026-08-26** — seven weeks after this
research — and OpenAI's own guidance is "for new integrations, use the Responses API." Any lingo doc
or example must target the **Responses API** or **Chat Completions**; Assistants is a dead end.

**Two wire shapes for "a tool."** This is the number one place a hand-rolled integration gets bitten:

```ts
// Chat Completions — nested `function` key
{ type: 'function', function: { name, description?, parameters?: Record<string, unknown>, strict?: boolean | null } }

// Responses API — flat, no nested `function` key
{ type: 'function', name, description?: string | null, parameters: Record<string, unknown> | null, strict: boolean | null, defer_loading?: boolean }
```

Both `parameters` fields are typed as plain `Record<string, unknown>` — the SDK does zero
compile-time strict-mode checking; a non-compliant schema type-checks fine and only fails at request
time.

**Strict mode: the actual rules**, verified verbatim against the current guides:

- The root schema must be `type: "object"` and must not be `anyOf` — a bare `quantityField()` can
  never be a whole tool's `parameters`; it has to be wrapped in `lingoObject`. (This root/`anyOf`
  rule lives specifically in the Structured Outputs guide's "Supported schemas" section; the
  function-calling guide states the `additionalProperties`/`required` rules directly but points back
  to Structured Outputs for this one.)
- Every object — recursively, per the guide's own worked examples plus external corroboration on
  nested schemas — needs `additionalProperties: false`.
- Every key in `properties` must appear in `required`; there is no true optionality. OpenAI's own
  documented emulation is a null-union: `"unit": {"type": ["string", "null"], "enum": ["F", "C"]}`
  with `"unit"` still listed in `required`.
- **Explicit `strict: true` against a non-compliant schema is a hard, synchronous reject on both
  APIs** — an HTTP 400 (`invalid_request_error`, code `invalid_json_schema`) naming the violated
  field, e.g. `"'additionalProperties' is required to be supplied and to be false"`. This holds
  unconditionally on Chat Completions and Responses alike whenever `strict` is explicitly `true`.
- **The default when `strict` is *omitted* differs by API** — a materially different scenario from
  the point above. Chat Completions stays non-strict by default. The Responses API attempts to
  auto-normalize the schema into strict mode and, if it can't, **silently falls back** to non-strict
  best-effort function calling, echoing `strict: false` back on the tool object — no exception is
  raised either way. Net for lingo: as long as a lingo-backed tool always sets `strict: true`
  explicitly (which OpenAI itself recommends — "we recommend always enabling strict mode" — and which
  a spec-compliant field should never omit), any malformed schema fails loudly on both APIs; the
  silent-degrade path is reachable only by omitting `strict`.
- **Keyword whitelist** (non-fine-tuned models): `type, properties, required, enum, $ref/$defs, anyOf`
  (nested only), plus string `pattern`/`format` (`date-time`, `time`, `date`, `duration`, `email`,
  `hostname`, `ipv4`, `ipv6`, `uuid`), number `multipleOf, minimum, maximum, exclusiveMinimum,
  exclusiveMaximum`, array `minItems, maxItems`. Never supported at all: `allOf, not,
  dependentRequired, dependentSchemas, if/then/else`; `minLength`, `maxLength`, `patternProperties`
  are absent even for base models. That whole `pattern`/`format`/bounds tier only became
  strict-mode-supported on **2025-05-20** — it wasn't present at the 2024-08-06 Structured Outputs
  launch — and **fine-tuned models lose the entire tier**, plus silently drop strict enforcement
  outright when calling two or more functions in the same turn.
- Size ceilings: ≤5000 total object properties with ≤10 nesting levels; ≤1000 total enum values
  across all enum properties (a single enum property over 250 values is capped at 15,000 characters);
  ≤120,000 combined characters across all property names, definition names, enum values, and const
  values.

**What this means for a lingo field.** A field's `.input()` schema is always the trivial
`{type:"string", description}` — no `properties`, no `pattern`/`format`, no bounds keywords — so it
is unconditionally strict-safe on its own; the only applicable rule is "root can't be a bare string,"
satisfied by wrapping in `lingoObject`. Reading `packages/lingo/src/ai/canonicalize.ts` confirms
`lingoObject`'s non-passthrough default is already compliant: `objectJsonSchema()` sets `required:
Object.keys(shape)` (100% of keys) and `additionalProperties: passthrough` (`false` unless opted in).
Three gaps, found by direct source read:

1. **`lingoObject(shape, { passthrough: true })` silently breaks strict mode.** It sets
   `additionalProperties: true`, which strict mode never permits — a hard 400 on Chat Completions with
   explicit `strict: true`, a silent downgrade to `strict: false` on the Responses API when `strict`
   is omitted. Nothing in lingo warns about either outcome today.
2. **No nullable/optional emulation.** `LingoObjectPropertySpec` (`LingoField | 'string' | 'number' |
   'boolean' | readonly [spec]`) has no variant for OpenAI's `type: ["T", "null"]` idiom — every
   declared property is unconditionally required.
3. **`.output()` vs `.input()` is a silent footgun, not a rejection.** `quantityField().output()`
   (`{type:"number", minimum, maximum}`) is itself strict-legal, so OpenAI accepts it with zero
   complaint if it's wired into `parameters` by mistake — quietly reverting the tool to "the model
   must emit a bare number," the exact ambiguity lingo exists to remove, with no error to catch the
   mistake.

Also from source: `zodResponseFormat`/`zodFunction`/`zodTextFormat`/`zodResponsesFunction`
(`openai/helpers/zod`) all hardcode `strict: true`. `.parse()`'s auto-population of
`parsed_arguments`/`.parsed`/`.output_parsed` only fires for tools carrying a hidden `$brand:
'auto-parseable-tool'` marker — a hand-built lingo tool never has it, so lingo integrations should
call plain `.create()` and `lingoObject.safeParse(JSON.parse(rawArgs))` manually rather than expecting
the auto-parse magic.

**Call sites** (verified against v6.45.0 types):

```ts
import OpenAI from 'openai'
import { dateField, lingoObject, quantityField } from '@pascal-app/lingo/ai'

const client = new OpenAI()
const CreateShipment = lingoObject({
  sku: 'string',
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0 }),
  deliverBy: dateField({ now: new Date() }),
})
const inputSchema = CreateShipment['~standard'].jsonSchema.input({ target: 'draft-2020-12' })

// Chat Completions
const completion = await client.chat.completions.create({
  model: 'gpt-5.5',
  messages: [{ role: 'user', content: 'Ship SKU A100, 5 kg, tomorrow.' }],
  tools: [{ type: 'function', function: {
    name: 'create_shipment', description: 'Create a shipment for one order line.',
    parameters: inputSchema, strict: true,
  } }],
})
const call = completion.choices[0]?.message.tool_calls?.[0]
if (call?.type === 'function' && call.function.name === 'create_shipment') {
  const result = CreateShipment.safeParse(JSON.parse(call.function.arguments))
  // 'value' in result ? result.value.weight === 5 : feed result.issues back as the tool result
}

// Responses API — flat tool shape
const response = await client.responses.create({
  model: 'gpt-5.5', input: 'Ship SKU A100, 5 kg, tomorrow.',
  tools: [{ type: 'function', name: 'create_shipment',
    description: 'Create a shipment for one order line.', parameters: inputSchema, strict: true }],
})
const fc = response.output.find((item) => item.type === 'function_call')
if (fc) CreateShipment.safeParse(JSON.parse(fc.arguments))

// Structured Outputs (whole reply, no tool call)
response_format: { type: 'json_schema', json_schema: { name: 'shipment', strict: true, schema: inputSchema } }
// Responses equivalent: text: { format: { type: 'json_schema', name: 'shipment', strict: true, schema: inputSchema } }
```

Because pattern/format/bounds keywords only became strict-mode-supported in May 2025 and still don't
apply to fine-tuned models, lingo's deliberate choice to never emit them on the input side (always the
bare `{type:'string', description}`) is a hedge against exactly this kind of provider-capability
churn — worth stating in docs as a design rationale rather than an accident.

Sources: [structured-outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs)
· [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling)
· [changelog](https://developers.openai.com/api/docs/changelog)
· [chat/completions.ts](https://github.com/openai/openai-node/blob/master/src/resources/chat/completions/completions.ts)
· [responses.ts](https://github.com/openai/openai-node/blob/master/src/resources/responses/responses.ts)
· [shared.ts](https://github.com/openai/openai-node/blob/master/src/resources/shared.ts)
· [helpers/zod.ts](https://github.com/openai/openai-node/blob/master/src/helpers/zod.ts)
· [lib/parser.ts](https://github.com/openai/openai-node/blob/master/src/lib/parser.ts)
· [helpers.md](https://github.com/openai/openai-node/blob/master/helpers.md).

## Anthropic

**Version pin.** `@anthropic-ai/sdk@0.110.0` (npm `latest`, published 2026-07-02, three days before
this research; `main`'s `CHANGELOG.md` matches exactly). `anthropic-version: 2023-06-01` is still the
current stable header — none of the features below bump it.

**`input_schema` needs one cast.** `Anthropic.Tool` (stable, non-beta) is:

```ts
export interface Tool {
  input_schema: Tool.InputSchema  // { type: 'object'; properties?: unknown|null; required?: Array<string>|null; [k: string]: unknown }
  name: string                    // /^[a-zA-Z0-9_-]{1,64}$/
  description?: string
  strict?: boolean                 // grammar-constrained: guarantees name+input match the schema
  input_examples?: Array<{ [key: string]: unknown }>
}
```

The index signature (`[k: string]: unknown`) lets any JSON Schema keyword lingo emits round-trip
fine, but the literal `type: 'object'` field means lingo's `Record<string, unknown>`-typed
`jsonSchema.input()` return doesn't structurally satisfy `Tool.InputSchema` — verified empirically,
not just read: compiling a minimal repro against lingo's actual return type
(`packages/lingo/src/ai/standard-schema.ts`) with `tsc --strict` fails with `TS2741: Property 'type'
is missing`. One cast is enough (no `as unknown as` double-cast needed):

```ts
import Anthropic from '@anthropic-ai/sdk'
import { lingoObject, quantityField } from '@pascal-app/lingo/ai'

const logShipmentSchema = lingoObject({
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 1000 }),
  note: 'string',
})

const logShipmentTool: Anthropic.Tool = {
  name: 'log_shipment',
  description: 'Record a shipment weight and note in the warehouse log.',
  input_schema: logShipmentSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Anthropic.Tool.InputSchema,
  strict: true, // safe: lingoObject()'s closed-object default already sets additionalProperties:false + full required
}
```

The same cast is needed anywhere else the SDK spells the identical `{type:'object'} &
{[k:string]:unknown}` shape — `BetaTool.InputSchema`, and the `betaTool()`/`jsonSchemaOutputFormat()`
helpers, whose generic is constrained `Schema extends ... & { type: 'object' }`. **Load-bearing
alignment**: [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use)
requires `additionalProperties: false` on every object plus every property listed in `required` —
exactly `lingoObject()`'s non-passthrough default, which plan 020 built for OpenAI-strict
compatibility. One schema satisfies both providers' strict modes with zero extra work. Individual
scalar fields (`quantityField`/`dateField`/`rangeField`) emit `type:'string'` schemas and must still
be wrapped in `lingoObject()` before use as a whole tool's `input_schema`.

**`is_error` tool results carry lingo's `[CODE]` message natively.** `ToolUseBlock.input`/
`ToolUseBlockParam.input` are typed **`unknown`** (also true of `ServerToolUseBlock.input`) —
TypeScript's `unknown` forbids property access without narrowing first, so the SDK's own types force
exactly the validation step a lingo field's `safeParse` performs:

```ts
async function runTool(toolUse: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  const parsed = logShipmentSchema.safeParse(toolUse.input)
  if ('issues' in parsed) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: parsed.issues.map((i) => i.message).join('; '), // already "[CODE] message. Did you mean X?"
      is_error: true,
    }
  }
  await warehouse.log(parsed.value)
  return { type: 'tool_result', tool_use_id: toolUse.id, content: `Logged ${parsed.value.weight} kg.` }
}
```

`ToolResultBlockParam` is `{ tool_use_id: string; type: 'tool_result'; cache_control?:
CacheControlEphemeral | null; content?: string | Array<TextBlockParam|ImageBlockParam|
SearchResultBlockParam|DocumentBlockParam|ToolReferenceBlockParam>; is_error?: boolean }` — a bare
string is valid `content`, confirmed against Anthropic's own documented error example. **Formatting
rule that 400s if violated**: the `tool_result` message must immediately follow the assistant's
`tool_use` turn with nothing in between, and `tool_result` blocks must be the first elements of that
user message's content array. Anthropic's own guidance backs lingo's message shape directly: write
"instructive error messages... include what went wrong and what Claude should try next," and "if a
tool request is invalid or missing parameters, Claude will retry 2-3 times with corrections before
apologizing to the user" — lingo's did-you-mean candidate front-loads the fix into round trip #1
instead of spending one of those retries blind.

**The free integration: `client.beta.messages.toolRunner()`.** Its internal `runRunnableTool` does
`tool.parse ? tool.parse(rawInput) : rawInput`, then wraps `run()` in a `try/catch` that turns any
thrown error into `{ content: 'Error: ' + e.message, is_error: true }`. Since `LingoField.parse()`
already throws a plain `Error` whose message is the `[CODE] …` string, a hand-built tool object using
a lingo field's `.parse` directly as its `parse` property gets automatic `is_error` wiring with zero
adapter code:

```ts
const tool = {
  name: 'log_shipment', description: '…', strict: true,
  input_schema: logShipmentSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
  parse: (raw: unknown) => logShipmentSchema.parse(raw), // throws "[CODE] …" — auto-caught
  run: async (input: ReturnType<typeof logShipmentSchema.parse>) => `Logged ${input.weight} kg.`,
}
const finalMessage = await client.beta.messages.toolRunner({ model: 'claude-sonnet-5', max_tokens: 1024, messages: [/*...*/], tools: [tool] })
```

This entire layer (`toolRunner`/`ToolError`/`betaTool`/`betaZodTool`) is beta-namespaced — confirmed
there is no working non-beta equivalent at 0.110.0. (`helpers.md`'s one API-reference heading that
reads `client.messages.toolRunner(...)`, dropping `.beta.`, is a stale doc heading, not a real
surface: its own declared return type is still `BetaToolRunner`, and every code sample in the file
calls `.beta.messages.toolRunner`.) The manual `safeParse`/`is_error` loop above on
`client.messages.create()` remains the portable, non-beta integration for anything meant to keep
working long-term.

**`input_examples` and native optional support.** `Tool.input_examples` — schema-validated example
inputs, ~20-50 tokens each — is new, and Anthropic's docs say it materially improves tool-call quality
for complex/nested inputs. lingo already has the raw material: `examplesForKind()` in
`packages/lingo/src/ai/quantity-fields.ts` holds per-kind example strings (`"5'11\""`, `"2 kg"`, …)
for description text, just not yet surfaced through this field. Separately, Claude's schema dialect
supports genuinely optional (non-`required`) properties — a documented "optional parameters (total):
24" ceiling implies as much — unlike OpenAI's strict mode, which forces every key into `required` and
needs the null-union hack for optionality. `lingoObject()` currently lists every key as required
unconditionally, which is compatible with both providers but stricter than Claude alone needs.

**Gotchas worth documenting, not coding around.** `output_config.format: {type:'json_schema', schema}`
(message-level structured output) and tool-level `strict: true` share one grammar-compiler pipeline
that rejects/strips `minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength`, and recursive `$ref`.
lingo never puts those in a field's *input* schema — only `.output()` carries `numberJsonSchema(...,
{minimum, maximum})` — so normal tool-calling is unaffected; only a message-level use of `.output()`
in `output_config.format` would collide, and whether `strict: true` on a tool schema silently strips
vs. rejects such a schema is unverified without a live smoke test (the `output_config.format` path is
documented to auto-strip-and-revalidate; tool schemas are not). Fine-grained tool streaming
(`fine-grained-tool-streaming-2025-05-14`) streams `input_json_delta` partials — lingo should only
`safeParse` the final assembled `tool_use.input`, matching the DOM layer's "parse on commit, not per
keystroke" posture. Scale ceilings to document: 20 strict tools per request, 24 total optional
parameters, 16 union-type parameters. Forced `tool_choice` (`any`/`tool`) — the natural way to
guarantee a lingo-validated tool fires — can't combine with extended thinking (only `auto`/`none`
there) and is rejected outright on at least one current model line, so an app wanting both reasoning
and a guaranteed tool call needs a prompting fallback, not a single code path.

Sources: [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
· [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
· [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use)
· [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
· [Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
· `github.com/anthropics/anthropic-sdk-typescript` (`helpers.md`, `CHANGELOG.md`,
`src/lib/tools/{BetaRunnableTool,BetaToolRunner,ToolError}.ts`) · shipped `messages.d.ts` via unpkg
for `@anthropic-ai/sdk@0.110.0`.

## Gemini

Three schema surfaces coexist in `@google/genai` **2.10.0** (2026-06-24), and only one of them is
safe to hand a lingo field without a target-specific adapter.

**1. Classic `generateContent` `Schema`** (`FunctionDeclaration.parameters`,
`GenerationConfig.responseSchema`) is an OpenAPI-flavored dialect: `type` is an **uppercase enum**
(`STRING`/`NUMBER`/`INTEGER`/`BOOLEAN`/`ARRAY`/`OBJECT`/`NULL`), `enum` is documented valid only for
`STRING`-type elements, `format` is decorative ("allows any value, but most do not trigger any
special functionality"), and there's a non-standard `propertyOrdering: string[]`.

A commonly repeated claim is that the SDK's client-side validator rejects lowercase JSON Schema types
like `"string"`/`"object"` outright. **That claim is stale.** It was true only for `google-genai`
≤0.5.x: [issue #11](https://github.com/googleapis/python-genai/issues/11) (filed 2024-12-12 against
v0.2.1) showed a Pydantic `literal_error` because lowercase types weren't in the allowed `Literal`.
Google fixed it with PR #151 ("Add support for case insensitive enum types," merged 2025-01-17),
shipped in **v0.6.0 (2025-01-21)**: `Type` now subclasses a `CaseInSensitiveEnum` whose `_missing_()`
hook upper-cases the value before matching. Pulling the current `v2.10.0` tag directly confirms the
fix is still in place — `Schema.model_validate({"type": "object", ...})` (and passing that same
lowercase dict as `response_schema=`/`parameters=`) succeeds silently today, coerced to `Type.OBJECT`.
**The corrected fact to document: don't build an "uppercase the type or the SDK throws"
workaround — that bug has been dead since January 2025.**

What the classic path *does* still reject — a different keyword, and still current — is
`additionalProperties`. `_raise_for_unsupported_mldev_properties()` in `google-genai`'s
`_transformers.py` raises `ValueError` client-side ("additionalProperties is only supported in Gemini
Enterprise Agent Platform mode, not in Gemini Developer API mode") for any non-Vertex client passing a
Pydantic model with `extra='forbid'` through `response_schema=`. This is not SDK lag: a Google
maintainer stated on the tracking issue (2026-01-16) that "`response_json_schema` is replacing
`response_schema` in the long term, and no new feature will be added to `response_schema`" — a
permanent product split, not a bug to wait out. (The
[tracking issue](https://github.com/googleapis/python-genai/issues/1815) itself is closed
`NOT_PLANNED`, though mechanically closed by a stale-bot nine days after that maintainer comment.) The
TypeScript SDK doesn't even error: `processJsonSchema()` in `js-genai`'s `_transformers.ts` silently
drops `additionalProperties` with an inline comment and no Vertex/Developer-API gate at all. Net: a
lingo field's closed-object (`additionalProperties: false`) schema fed into `responseSchema`/
`parameters` either hard-errors (Python, non-Vertex) or is silently weakened with no warning
(TypeScript) — never route a closed lingo schema through this surface.

**2. `parametersJsonSchema` / `responseJsonSchema`** are the sibling fields to actually target:
`FunctionDeclaration.parametersJsonSchema` and (on `GenerateContentConfig` — not `GenerationConfig`, a
real but different type used only by `CountTokensConfig`/tuning/the Live API) `responseJsonSchema`,
both typed `unknown`, accept arbitrary standard JSON Schema and bypass the classic validator's
pipeline entirely. They landed in `v1.6.0` (2025-06-21, function declarations) and `v1.7.0`
(2025-06-25, `GenerateContentConfig`), unchanged through the current `2.10.0`, and support ordinary
lowercase `"type": "string"/"object"` plus `$id`, `$defs`, `$ref`, `$anchor`, `anyOf`, `oneOf`,
`additionalProperties`, `required`, and the rest of a real JSON Schema subset — `propertyOrdering` is
optional here too, since Gemini 2.5+ preserves declared key order automatically. **This is what
lingo's `generateContent` snippets should target** — set `responseMimeType: 'application/json'` and
omit `responseSchema` when using `responseJsonSchema`.

**3. The Interactions API** (`client.interactions.create`, `POST /v1beta/interactions`) reached
general availability around **2026-06-22** and is now Google's recommended surface for all new work
("we recommend using this API for access to all the latest features and models"); `generateContent`
"remains fully supported" but new capabilities land on Interactions first. It uses plain, standard
JSON Schema natively — `TextResponseFormat.schema?: {[k:string]: any}` for output, `FunctionT.
parameters?: any` for tool calls — in a flat `tools: [{type:'function', name, description,
parameters}]` shape with no `functionDeclarations` wrapper, converging with OpenAI's Responses API
shape. One casing detail worth pinning precisely: the Interactions wrapper's own field names are
genuinely **snake_case** even in the TypeScript SDK (`previous_interaction_id`, `response_format`,
`response_mime_type`, `system_instruction`, `generation_config`) — confirmed directly in shipped `.ts`
types, and `CHANGELOG.md`'s v2.0.1 entry (2026-05-09) explicitly logs "Update `response_format` field
names to snake_case." This is a deliberate split inside one npm package: the legacy `generateContent`
surface stays idiomatic camelCase. The JSON Schema payloads nested inside `parameters`/`schema` stay
standard lowercase-typed JSON Schema regardless of which wrapper carries them.

```ts
// generateContent (still supported) — target parametersJsonSchema, NEVER classic parameters:
import { GoogleGenAI } from '@google/genai'
const ai = new GoogleGenAI({})
await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: '...',
  config: { tools: [{ functionDeclarations: [{
    name: 'create_shipment',
    description: 'Create a shipment record',
    parametersJsonSchema: {
      type: 'object',
      properties: { weight: weightField['~standard'].jsonSchema.input({}) },
      required: ['weight'],
      additionalProperties: false,
    },
  }] }] },
})

// Interactions API (GA 2026-06, recommended) — same fragment, flatter tool wrapper, snake_case wrapper keys:
await ai.interactions.create({
  model: 'gemini-3-flash-preview',
  input: '...',
  tools: [{ type: 'function', name: 'create_shipment', description: '…',
    parameters: { type: 'object',
      properties: { weight: weightField['~standard'].jsonSchema.input({}) },
      required: ['weight'] } }],
})
```

Google has now reshaped Gemini's schema surface twice within about eight months (the November 2025
JSON Schema expansion; the June 2026 Interactions GA) — any hardcoded Gemini snippet in lingo's docs
needs an explicit revisit cadence, not a ship-and-forget assumption.

Sources: [Schema / Type reference](https://ai.google.dev/api/caching#Schema)
· [FunctionDeclaration reference](https://ai.google.dev/api/caching#FunctionDeclaration)
· [structured-output guide](https://ai.google.dev/gemini-api/docs/structured-output)
· [Interactions API docs](https://ai.google.dev/gemini-api/docs/interactions/structured-output)
· [Interactions GA announcement](https://blog.google/innovation-and-ai/technology/developers-tools/interactions-api-general-availability/)
· [Nov 2025 JSON Schema announcement](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/)
· `googleapis/python-genai` issues [#11](https://github.com/googleapis/python-genai/issues/11),
[#1815](https://github.com/googleapis/python-genai/issues/1815) · `googleapis/js-genai` source
(`src/_transformers.ts`, `src/types.ts`, `CHANGELOG.md`).

## The OpenAI-compatible majority: Grok, Mistral, Cohere v2, Groq, Ollama, Hugging Face

lingo's field schema is always `{type: 'string', description}` — the most portable JSON Schema
fragment that exists. Across six more targets, that fragment needs **zero change**, because all six
speak plain, OpenAI-shaped `tools: [{type:'function', function:{name, description, parameters}}]`
JSON Schema, and `lingoObject()`'s closed shape (`additionalProperties:false` + full `required`) is
already the exact strict-mode contract most of them expect. "One schema, six providers" is an
empirically confirmed claim, not an assumption — a real selling point for the "LLM tools safer"
tagline.

- **xAI Grok**: swap `baseURL` to `https://api.x.ai/v1` on an `openai`-package client — no dialect
  change; a tool's `parameters` root must be `type:"object"` or the API 400s, and tool-call argument
  generation is documented as always schema-conformant. Finer-grained enforcement (`format`,
  `pattern`, bounds) is described inconsistently across xAI's own docs pages — don't cite a specific
  xAI enforcement guarantee beyond "tool-call types and required fields are conformant" without an
  independent live check. The first-party `xai-sdk` npm package is alpha and effectively abandoned
  (`1.0.0-alpha.0`, published 2025-07-11, no release since) — route through the `openai` package, not
  it.
- **Mistral** (`@mistralai/mistralai` 2.4.1): plain-JSON-Schema `parameters` for function calling;
  `response_format: {type:'json_schema', json_schema:{schema, strict:true}}` for structured output,
  mirroring OpenAI strict mode exactly.
- **Cohere** (`cohere-ai` 8.0.0): `ClientV2` — explicitly "recommended for new projects" — is
  OpenAI-compatible with `strict_tools: true`. Legacy v1 used Python-type-notation
  `parameter_definitions`, not JSON Schema at all; don't target it.
- **Groq** (`groq-sdk` 1.3.0): a literal OpenAI-compatible proxy (`base_url:
  api.groq.com/openai/v1`). `response_format: {type:'json_schema', json_schema:{strict:true}}` is
  gated to specific models (`openai/gpt-oss-20b`/`120b`/`safeguard-20b` get strict; `llama-4-scout` is
  best-effort only) and **cannot combine with tool use or streaming in the same request** — an
  unqualified "works on Groq" doc line will generate confusing bug reports the moment someone mixes
  tools with `response_format` or picks the wrong model.
- **Ollama** (npm `ollama` 0.6.3): `format` on `/api/chat`/`/api/generate` takes a raw JSON Schema
  object, enforced by local grammar-constrained decoding; `tools` uses the identical OpenAI nested
  shape. Ollama Cloud (hosted) does not currently support structured outputs — this only works
  local/self-hosted, and the two must not be conflated in lingo's docs.
- **Hugging Face** (`@huggingface/inference` 4.13.22): `chatCompletion({model, messages, tools,
  tool_choice})` is a thin OpenAI-shaped router across many Inference Providers with no schema dialect
  of its own — enforcement fidelity depends entirely on whichever backend engine is actually serving
  the requested model.

| Provider | Package | Gotcha |
|---|---|---|
| xAI Grok | `openai` + custom `baseURL` | first-party `xai-sdk` is alpha/abandoned; finer keyword enforcement inconsistently documented |
| Mistral | `@mistralai/mistralai` | none found — matches OpenAI strict mode exactly |
| Cohere | `cohere-ai` (`ClientV2`) | v1's `parameter_definitions` is not JSON Schema — v2 only |
| Groq | `groq-sdk` | strict mode is model-gated; can't combine `response_format` with tool use or streaming |
| Ollama | `ollama` | Cloud (hosted) has no structured-output support — local/self-hosted only |
| Hugging Face | `@huggingface/inference` | enforcement fidelity depends on the routed backend engine, not the client |

Sources: [x.ai function-calling guide](https://docs.x.ai/docs/guides/function-calling)
· [x.ai structured-outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)
· [Mistral function-calling](https://docs.mistral.ai/studio-api/conversations/function-calling)
· [Mistral structured-output](https://docs.mistral.ai/capabilities/structured_output)
· [Cohere tool-use parameter types](https://docs.cohere.com/docs/tool-use-parameter-types)
· [Cohere v1→v2 migration](https://docs.cohere.com/v2/docs/migrating-v1-to-v2)
· [Groq structured-outputs](https://console.groq.com/docs/structured-outputs)
· [Ollama structured-outputs](https://docs.ollama.com/capabilities/structured-outputs)
· [Ollama api.md](https://github.com/ollama/ollama/blob/main/docs/api.md)
· [HF function-calling guide](https://huggingface.co/docs/inference-providers/guides/function-calling).

## Implications for lingo

The recipe set worth documenting (`docs/recipes.md` + site, per plan 024): AI SDK v6/v7 direct
passthrough plus the v5 `jsonSchema()` bridge; OpenAI Chat Completions and Responses (`strict:true`,
plain `.create()` + manual `safeParse`, no Assistants); Anthropic's direct `input_schema` cast, the
manual `is_error` loop, and the beta `toolRunner` free-integration recipe; Gemini's
`parametersJsonSchema`/`responseJsonSchema`/Interactions recipes with the classic-`Schema` trap called
out explicitly; and the "one schema, six providers" OpenAI-compatible recipe with its gotcha table.
Every recipe above carries its own dated primary-source citation so it can be re-verified on a cadence
rather than trusted indefinitely — Gemini in particular has reshaped its schema surface twice in eight
months.

Three small, real gaps came out of this pass — not big enough to redesign anything, but each worth a
decision in `plans/024`:

- **`repairToolCallWith(spec)`** — the v6/v7-shaped sibling `repairTextWith` doesn't have yet. Same
  skeleton (`JSON.parse(toolCall.input)` → `canonicalizeValues`/`field.safeParse` → re-stringify),
  needed because `experimental_repairText`'s host (`generateObject`) is deprecated and has no
  migration path for the repair hook itself.
- **No optional/nullable property spec on `lingoObject`.** Every declared key is unconditionally
  required today. This blocks two independent things: emulating OpenAI's `type:["T","null"]` idiom,
  and using Claude's native (non-`required`) optional properties without the OpenAI-shaped workaround.
- **No passthrough-strict guard.** `lingoObject(shape, {passthrough:true})` silently produces
  `additionalProperties:true`, which breaks strict mode on both OpenAI and Anthropic — loudly (400) on
  OpenAI Chat Completions and on Anthropic, silently (downgraded to best-effort) on OpenAI's Responses
  API when `strict` is omitted. A runtime guard or `assertStrict()`-style helper would catch this
  before it ships, since nothing errors today.

A fourth, smaller item worth a documentation line even without new code: the `.output()`-vs-`.input()`
mixup on a tool's parameters is accepted with zero complaint by every provider surveyed (a field's
numeric `.output()` schema is itself strict-legal), so it fails silently rather than loudly — worth a
review-checklist line, if not a lint rule.
