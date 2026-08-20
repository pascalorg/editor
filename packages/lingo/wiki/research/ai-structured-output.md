# lingo as an AI-facing layer: Vercel AI SDK + Standard Schema integration surface

Research pass 2026-07-04 (source-level study: npm registry, unpkg-served `.d.ts`,
`vercel/ai` GitHub source on `main`, `standardschema.dev`, Anthropic platform docs).
Versions pinned by direct inspection, not docs prose, because the "ai" package
carries three live major-version dist-tags at once — facts below are tied to the
exact version they were verified against.

**Versions verified**: `ai@7.0.14` (npm `latest`, 2026-07-04) · `@ai-sdk/provider-utils@5.0.5`
· `@standard-schema/spec@1.1.0` · dist-tags at time of research: `latest=7.0.14`,
`ai-v6=6.0.219`, `ai-v5=5.0.210`, `beta=7.0.0-beta.187`, `canary=7.0.0-canary.176`.
The SDK runs three majors concurrently under different tags — **pin the exact
tag/version in any lingo doc or example**, "the AI SDK" is not one API surface right now.
`experimental_refineToolInput` (see below) is confirmed present in `ai@7.0.14` and
confirmed **absent** in `ai@6.0.0` — treat anything version-sensitive the same way,
by grepping the shipped `.d.ts`, not by trusting a blog post.

## 1. Structured output today: `Output.object()`, `generateObject`, `ToolLoopAgent`

Source: `ai-sdk.dev/docs/agents/building-agents#structured-output`, `content/docs/03-ai-sdk-core/10-generating-structured-data.mdx`, `ai-index.d.ts` (ai@7.0.14).

```ts
import { ToolLoopAgent, Output } from 'ai'
import { z } from 'zod'

const analysisAgent = new ToolLoopAgent({
  model: 'xai/grok-build-0.1',       // AI Gateway "provider/model" string
  output: Output.object({
    schema: z.object({
      sentiment: z.enum(['positive', 'neutral', 'negative']),
      summary: z.string(),
      keyPoints: z.array(z.string()),
    }),
  }),
})

const { output } = await analysisAgent.generate({ prompt: '...' })
```

- `Output` factories: `Output.text()` (default) · `Output.object({ schema, name?, description? })`
  · `Output.array({ schema, ... })` (adds `elementStream` on the streaming result)
  · `Output.choice({ enum })` · `Output.json()` (unstructured JSON, no schema).
- `ToolLoopAgent` is the concrete class; `ai@7.0.14` also re-exports it as
  `Experimental_Agent` for back-compat, and a separate `Agent` symbol exists in
  the same package (narrower/generic type) — don't conflate the two when reading
  older snippets.
- **AI SDK 6 unified `generateObject`/`generateText`**: before, combining tool
  calling with structured output meant chaining `generateText` then `generateObject`
  by hand (the classic "answer tool" pattern: define a tool named e.g. `answer`
  with no `execute`, force it via `toolChoice: { type: 'tool', toolName: 'answer' }`,
  and read the tool call's parsed input as your structured result). AI SDK 6+
  lets `output: Output.object(...)` sit alongside `tools` in one `generateText`/
  `ToolLoopAgent` call — the model can call tools across steps, then the SDK asks
  for the final structured object as one more step. **Caveat, confirmed by community
  reports (github.com/vercel/ai issues #8354, #3944) and the docs' own troubleshooting
  page**: this costs an extra step, so `stopWhen` must budget for it, and combining
  `output` with `toolChoice: 'required'` has open rough edges. Don't assume this
  path is friction-free; the manual answer-tool pattern is still a legitimate fallback.
- `generateObject(options)` — `schema: FlexibleSchema<OBJECT>`, `schemaName?`,
  `schemaDescription?`, `output?: 'object'|'array'|'enum'|'no-schema'`,
  `experimental_repairText?: RepairTextFunction`, plus the standard model/prompt/
  telemetry/callback surface. The old `mode: 'auto'|'json'|'tool'` param from
  v3/v4 is **gone** in v7 — provider negotiation is automatic now.
- Failure mode: `NoObjectGeneratedError` (`AISDKError` subclass) exposes
  `.cause`, `.text` (raw/tool-call text the model emitted), `.response`, `.usage`,
  `.finishReason`. It fires for three distinct reasons collapsed into one type:
  no response, unparseable JSON, or schema-validation failure — check `.cause`
  (`JSONParseError` vs `TypeValidationError`) to tell them apart.

```ts
try {
  await generateText({ model, output: Output.object({ schema }), prompt })
} catch (error) {
  if (NoObjectGeneratedError.isInstance(error)) {
    console.log(error.cause, error.text, error.response, error.usage, error.finishReason)
  }
}
```

## 2. Repair and refinement hooks — exact signatures and call sites

Three **distinct** hooks exist, at three different points in the pipeline. They
are not interchangeable — mixing them up is the most likely design mistake.

### 2a. `experimental_repairText` (generateObject / `Output.object()` path)

Source: `packages/ai/src/generate-object/parse-and-validate-object-result.ts`.

```ts
type RepairTextFunction = (options: {
  text: string
  error: JSONParseError | TypeValidationError
}) => Promise<string | null>
```

Call site (verbatim, `parseAndValidateObjectResultWithRepair`):

```ts
try {
  return await parseAndValidateObjectResult(result, outputStrategy, context)
} catch (error) {
  if (
    repairText != null &&
    NoObjectGeneratedError.isInstance(error) &&
    (JSONParseError.isInstance(error.cause) || TypeValidationError.isInstance(error.cause))
  ) {
    const repairedText = await repairText({ text: result, error: error.cause })
    if (repairedText === null) throw error
    return await parseAndValidateObjectResult(repairedText, outputStrategy, context)
  }
  throw error
}
```

**This is a purely local hook** — it runs after the model call, before any retry,
and the SDK does **not** force a network round-trip: if `repairText` returns a
string, that string is re-parsed and re-validated *client-side*, no LLM call
required. Only if `repairText` returns `null` does the original error propagate.
This is the cleanest, lowest-risk seam for a deterministic canonicalizer — it
runs exactly once, on exactly the failure case, with the raw text and the typed
error handed to you. Test fixture from `generate-object.test.ts` confirms the shape:

```ts
experimental_repairText: async ({ text, error }) => {
  if (TypeValidationError.isInstance(error)) return `{ "content": "test" }`
  return null
}
```

### 2b. `experimental_repairToolCall` (tool-calling path)

Source: `packages/ai/src/generate-text/parse-tool-call.ts`.

```ts
type ToolCallRepairFunction<TOOLS extends ToolSet> = (options: {
  instructions: Instructions | undefined
  messages: ModelMessage[]
  toolCall: LanguageModelV4ToolCall
  tools: TOOLS
  inputSchema: (options: { toolName: string }) => PromiseLike<JSONSchema7>
  error: NoSuchToolError | InvalidToolInputError
}) => Promise<LanguageModelV4ToolCall | null>
```

Fires only for `NoSuchToolError` / `InvalidToolInputError` (i.e. `NoSuchToolError`
means "no such tool"; `InvalidToolInputError` means "arguments failed the tool's
`inputSchema`"). Unlike `repairText`, **both documented strategies in the official
docs cost an extra LLM call** — either "re-ask" (replay the failed call + error
message to the model) or "structured-output regeneration"
(`generateText({ output: Output.object({ schema: tool.inputSchema }) })` against
the same failed args). Nothing stops you writing a purely local repair function
here too (same signature, just skip the `generateText` call and return a
corrected `LanguageModelV4ToolCall` directly) — the docs simply don't show that
option because the SDK team's use case was "model picked the wrong tool" or
"model omitted a required field," not "field is present but in the wrong format."
On repeated failure, `ToolCallRepairError` wraps `{ cause: repairError, originalError: error }`.

### 2c. `experimental_refineToolInput` — new, narrow, exactly the right shape for canonicalization

Source: confirmed present in `ai@7.0.14`'s shipped `.d.ts` (grep-verified against
`unpkg.com/ai@7.0.14/dist/index.d.ts`), confirmed **absent** in `ai@6.0.0` — this
is a v7 addition, essentially undocumented in prose as of this research pass
(zero hits in `ai-sdk.dev` docs pages fetched; only the inline JSDoc and type exist).

```ts
/**
 * Each refinement function receives the typed input for its tool and must return
 * an input with the same type shape. Refined inputs are used for tool execution,
 * output parts, lifecycle callbacks, and telemetry.
 */
type ToolInputRefinement<TOOLS extends ToolSet> = {
  [NAME in keyof TOOLS]?: (
    input: InferToolInput<TOOLS[NAME]>,
  ) => MaybePromiseLike<InferToolInput<TOOLS[NAME]>>
}
```

Passed as `experimental_refineToolInput` to `generateText`, `streamText`, and
`ToolLoopAgent`. This runs **after** schema validation succeeds and **before**
`execute()`, tool-result recording, telemetry, or `onFinish`. It is a per-tool-name
map, keyed exactly like `tools`. This is the single best-fit hook for "the schema
already accepted a loose string, now canonicalize it before the tool body runs" —
no schema redesign required, and unlike `repairToolCall` it only runs on the
happy path (post-validation), so it has zero interaction with the SDK's error
taxonomy or repair/retry semantics.

### 2d. Streaming (`streamObject`) and `onFinish`

`streamObject` accepts the same `experimental_repairText`; failure surfaces via
`onError?: StreamObjectOnErrorCallback` and `onFinish?: Callback<GenerateObjectEndEvent<RESULT>>`.
There is no separate streaming-only validation hook — the parse/repair/validate
pipeline is shared with `generateObject`.

## 3. Standard Schema — the exact interfaces AI SDK actually calls

Sources: `@standard-schema/spec@1.1.0` (`unpkg.com/@standard-schema/spec@1.1.0/dist/index.d.ts`,
byte-identical to `standardschema.dev`'s published spec block), `@ai-sdk/provider-utils@5.0.5`
source (`packages/provider-utils/src/schema.ts`, `validate-types.ts`).

**`@standard-schema/spec` is types-only — zero runtime bytes.** `package.json`
declares `"sideEffects": false`, no runtime `dependencies`, and the published
`dist/index.js`/`.cjs` contain no executable code (the package is pure
`interface`/`declare namespace`, erased at compile time). A zero-dep library can
depend on it as a dev/type-only import with **zero cost to the "zero runtime
deps" claim** — this is a genuinely free win, not a compromise.

There are actually **two related specs**, and AI SDK requires *both* for a
schema to work as a tool `inputSchema` or `generateObject`/`Output.object` schema:

```ts
// packages/spec — StandardSchemaV1 (validation)
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}
namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> extends StandardTypedV1.Props<Input, Output> {
    readonly validate: (
      value: unknown,
      options?: Options,
    ) => Result<Output> | Promise<Result<Output>>
  }
  type Result<Output> = SuccessResult<Output> | FailureResult
  interface SuccessResult<Output> { readonly value: Output; readonly issues?: undefined }
  interface FailureResult { readonly issues: ReadonlyArray<Issue> }
  interface Issue { readonly message: string; readonly path?: ReadonlyArray<PropertyKey | PathSegment> }
  interface PathSegment { readonly key: PropertyKey }
}
// shared base
namespace StandardTypedV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly types?: { readonly input: Input; readonly output: Output }
  }
}
```

```ts
// packages/spec — StandardJSONSchemaV1 (a *separate*, newer spec: "Standard JSON Schema")
interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardJSONSchemaV1.Props<Input, Output>
}
namespace StandardJSONSchemaV1 {
  interface Props<Input, Output> extends StandardTypedV1.Props<Input, Output> {
    readonly jsonSchema: Converter
  }
  interface Converter {
    readonly input: (options: Options) => Record<string, unknown>   // may throw if unsupported
    readonly output: (options: Options) => Record<string, unknown>
  }
  interface Options {
    readonly target: 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | ({} & string)
    readonly libraryOptions?: Record<string, unknown>
  }
}
```

Note the shape of `validate`'s return: `Input` and `Output` can differ. This is
the load-bearing detail — **Standard Schema was designed to allow transforms,
not just yes/no validation.** A "field" implementing it can accept `unknown`
(e.g. the raw string a model emitted) and return a *different, canonicalized*
`Output` type (e.g. a number in a fixed unit). This is exactly the shape lingo
needs and gets for free from the spec's own design intent — no special pleading
required to justify coercion inside `validate()`.

### How AI SDK actually consumes it (source-verified, not docs-summarized)

`@ai-sdk/provider-utils`'s `asSchema()` (used by `generateObject`, `tool()`,
`Output.object()` — every schema-accepting entry point funnels through this):

```ts
type StandardSchema<SCHEMA = any> = StandardSchemaV1<unknown, SCHEMA> & StandardJSONSchemaV1<unknown, SCHEMA>
type FlexibleSchema<SCHEMA = any> = Schema<SCHEMA> | LazySchema<SCHEMA> | ZodSchema<SCHEMA> | StandardSchema<SCHEMA>

export function asSchema<OBJECT>(schema: FlexibleSchema<OBJECT> | undefined): Schema<OBJECT> {
  return schema == null
    ? jsonSchema({ type: 'object', properties: {}, additionalProperties: false })
    : isSchema(schema)
      ? schema
      : '~standard' in schema
        ? schema['~standard'].vendor === 'zod'
          ? zodSchema(schema as ZodSchema<OBJECT>)      // hardcoded Zod fast path
          : standardSchema(schema as StandardSchema<OBJECT>)
        : schema()

function standardSchema<OBJECT>(standardSchema: StandardSchema<OBJECT>): Schema<OBJECT> {
  return jsonSchema(
    () => addAdditionalPropertiesToJsonSchema(
      standardSchema['~standard'].jsonSchema.input({ target: 'draft-07' }) as JSONSchema7,
    ),
    {
      validate: async value => {
        const result = await standardSchema['~standard'].validate(value)
        return 'value' in result
          ? { success: true, value: result.value }
          : { success: false, error: new TypeValidationError({ value, cause: result.issues }) }
      },
    },
  )
}
```

Three consequences that matter for design, none of which are stated plainly in
the prose docs:

1. **`~standard.jsonSchema.input()` is called unconditionally** for any non-Zod
   Standard Schema. If a schema implements only `StandardSchemaV1` (validate) and
   not `StandardJSONSchemaV1` (jsonSchema), `asSchema()` throws (`.jsonSchema` is
   `undefined`, `.input` access fails) the moment AI SDK needs to build the
   provider payload. **Implementing `validate()` alone is not enough to be usable
   as a tool/object schema in AI SDK** — you need the JSON Schema half too, even
   though it's a logically separate spec.
2. **Zod gets a special-cased bypass** straight to Zod's own JSON-schema
   converter (skips `StandardJSONSchemaV1` entirely) — so Zod schemas work
   regardless of whether a given Zod version has caught up to `StandardJSONSchemaV1`.
   Every other vendor goes through the generic path and must supply
   `~standard.jsonSchema.input()`.
3. **Ecosystem reality check (as of this research pass)**: ArkType implements
   `StandardJSONSchemaV1` natively (`Type#toJsonSchema()`, exposed via `~standard`).
   Valibot's *core* package does not by default — it ships a separate
   `@valibot/to-json-schema` package exposing `toStandardJsonSchema()`; without
   installing it, a plain Valibot schema will validate fine anywhere that only
   needs `validate()` (tRPC, TanStack Form/Router) but **will throw inside AI
   SDK's `asSchema()`** if used as a `generateObject`/`tool()` schema. AI SDK 6's
   own release notes claim "any schema library that implements the Standard JSON
   Schema interface" works — true, but narrower in practice than the phrasing
   suggests. **This is good news for lingo**: implementing both spec halves
   ourselves puts lingo ahead of where much of the Standard-Schema-adjacent
   ecosystem currently sits for this specific integration, not behind it.
4. Validation failures are wrapped as `TypeValidationError({ value, cause: result.issues })`
   — the Standard Schema `issues` array survives as `.cause`, so lingo's own
   `{ code, severity, message, span, suggestions }` issue shape (README/llms.txt)
   can ride through as `issue.message` (lingo's human message) with `path`
   mapped from the field key — nothing is lost in translation.

## 4. Tool-call argument coercion — what happens today, exactly

Source: `packages/ai/src/generate-text/parse-tool-call.ts` (`ai@7.0.14`, mirrors `main`).

```ts
async function doParseToolCall({ toolCall, tools }) {
  const tool = tools[toolCall.toolName]
  const schema = asSchema(tool.inputSchema)
  const parseResult = toolCall.input.trim() === ''
    ? await safeValidateTypes({ value: {}, schema })
    : await safeParseJSON({ text: toolCall.input, schema })   // JSON.parse, then schema.validate
  if (parseResult.success === false) {
    throw new InvalidToolInputError({ toolName, toolInput: toolCall.input, cause: parseResult.error })
  }
  return { type: 'tool-call', ..., input: parseResult.value }
}
```

So: the model's raw tool-call argument string is `JSON.parse`d, then run through
whatever `validate()` the `inputSchema` provides. **There is no coercion beyond
what the schema itself does.** If a Zod field is `z.number()` and the model emits
`"weight": "2 lbs"`, `JSON.parse` succeeds (it's valid JSON — a string), but Zod's
`validate()` rejects a string where a number is expected → `InvalidToolInputError`
→ either `experimental_repairToolCall` fires (if configured, costing a second LLM
call in both documented strategies) or the whole `generateText`/`streamText` call
throws.

`z.coerce.number()` does not rescue this case the way it looks like it should:
it runs the value through JS `Number(x)` before validating. `Number("2 lbs")` is
`NaN`; Zod special-cases `NaN` as its own reported type (`"nan"`, distinct from
`"number"`), so the coercion still ends in an `invalid_type` failure — it never
reaches lingo-style parsing territory. `z.coerce.number()` also has zero locale
awareness: `Number("1,5")` is also `NaN` in JS (comma isn't a valid JS numeric
separator), so a French-formatted decimal fails identically. Native coercion in
this ecosystem is JS-type coercion, not unit- or locale-aware parsing — this is
the gap lingo already exists to fill on the human-input side, and it's an
identical gap on the model-output side.

**Cleanest interception points, ranked**:

1. **Field-level Standard Schema `validate()`** (declare the field as accepting
   a string, coerce+canonicalize inside `validate`) — catches the value before
   it's ever "invalid," so no error path, no repair call, no retry cost. Requires
   the tool schema to type the field as `string` in the JSON Schema sent to the
   provider (see §5 below for why that's also necessary, not just convenient).
2. **`experimental_refineToolInput`** — if the schema must stay a plain
   `z.string()` for other reasons (back-compat, shared schema, non-lingo
   consumers), refine post-validation, pre-execution, per tool name.
3. **`experimental_repairText` / `experimental_repairToolCall`** — last resort
   for values that *did* fail validation (e.g. a provider emitted `type: number`
   from its own JSON-schema-strict mode and the model wrote something JSON can't
   even parse as a bare number) — a deterministic, local repair function here
   avoids the SDK's own documented (LLM-cost) repair strategies entirely.
4. **`wrapLanguageModel({ middleware: { transformParams } })`** — lowest-level,
   most invasive: rewrite the outgoing tool JSON Schema (e.g. force `type: number`
   fields to `type: string` with a description hint) before the provider ever
   sees it, or inspect/rewrite raw provider output in `wrapGenerate`/`wrapStream`
   before `parseToolCall` runs. Built-in middlewares in the same family
   (`extractJsonMiddleware`, `extractReasoningMiddleware`, `addToolInputExamplesMiddleware`,
   `simulateStreamingMiddleware`, `defaultSettingsMiddleware`) show this is an
   accepted pattern, not a hack — but it operates on the whole model, not a
   single field, so it's a blunter instrument. Worth prototyping, not the primary
   recommendation.

## 5. Computer-use / browser form-filling — where formatting mistakes actually happen

Sources: `platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool`,
`ai-sdk.dev/cookbook/guides/computer-use`.

The Anthropic `computer_20251124`/`computer_20250124` tool's action set is:
`screenshot`, `left_click`, `type`, `key`, `mouse_move`, `left_click_drag`,
`scroll`, `cursor_position`, `hold_key`, `wait`, `zoom` (`computer_20251124` only,
needs `enable_zoom: true`). The `type` action's payload is a bare string:

```json
{ "action": "type", "text": "2,5" }
```

There is **no schema, no locale parameter, no unit field** anywhere in this tool
— the model decides, purely from pixels in a screenshot and its own judgment,
what character sequence to send to whatever field the cursor happens to be
focused on. AI SDK's own cookbook wraps this identically:
`anthropic.tools.computer_20250124({ execute: async ({ action, coordinate, text }) => ... })`
— `text` is forwarded to the execute function verbatim; the SDK adds no
validation layer over the string content.

Anthropic's own docs name the failure mode directly: *"Claude sometimes assumes
outcomes of its actions without explicitly checking their results."* Their
documented mitigation is a prompt-engineering patch, not a structural one:
tell the model *"After each step, take a screenshot and carefully evaluate if
you have achieved the right outcome... If not correct, try again."* — i.e. the
only feedback loop is another (expensive, unreliable) vision pass over a
screenshot, repeated until the model's own visual judgment says the pixels look
right. Locale decimals (`2,5` vs `2.5`), unit mismatches (typing `70` into a `kg`
field when the source said `154 lb`), and date-format ambiguity (`03/07/2026`)
are exactly the class of error this loop cannot catch — the field can render a
wrong-but-plausible-looking value with no visual signal that anything is off.

**This is precisely the gap lingo's DOM layer already closes**, and it's worth
being explicit that this was not designed for AI agents but happens to solve
their exact failure mode (per README.md / llms.txt, verified against this repo):

- `lingoInput(el, opts)` parses on every input event, **explicitly including
  untrusted/synthetic events** — the docs state plainly "untrusted events
  honored — automation just works." A computer-use `type` action fires normal
  DOM input events; lingo does not distinguish trusted-user keystrokes from
  synthetic ones, so it already treats agent-typed text the same as human-typed text.
- `field.set('6ft')` is an explicit **programmatic** API "agents welcome" per
  the README — a Playwright-driven or MCP-driven agent doesn't need to simulate
  keystrokes at all; it can call `.set()` directly and get the same parse/validate
  path.
- Canonicalization happens **on blur/Enter/submit**, not while typing — so an
  agent's next screenshot (or, better, its next DOM read) sees either the
  canonical value or an explicit invalid state, never a silently-wrong number.
- State is exposed as `data-state` (`idle`/`incomplete`/`invalid`/`valid`) and
  `aria-invalid`/`aria-describedby` — an agent reading the accessibility tree
  (which is exactly what Claude's computer-use and most browser-automation
  agents do to locate elements) gets a structured, cheap-to-check signal instead
  of having to re-screenshot and visually judge correctness.
- Invalid results with `strictness: 'confirm'` attach a `candidate` and can drive
  `formatCandidate` hint text — this is a ready-made "did-you-mean" surface an
  agent could read and act on (`retype the suggested value`) without needing a
  second LLM vision call to figure out what went wrong.

**What lingo does not yet have, worth flagging as a gap/opportunity**: no
explicit "agent-readable" summary of field state beyond DOM attributes (e.g. no
single JSON blob a tool-calling agent could request describing "here is what
this field expects, here is its current parsed value, here is why it's invalid"),
and no documented recipe for wiring `lingoInput` state into an AI SDK tool
`execute()` result so a browser-driving agent's tool call returns lingo's
validation feedback directly instead of the agent re-deriving it from a screenshot.

## 6. Positioning vs. adjacent art

- **instructor-js** (`567-labs/instructor-js`) — wraps the OpenAI SDK via a
  `Proxy`, injects schema instructions, picks a `Mode` (`TOOLS`/`JSON`/`MD_JSON`)
  and validates the response against a Zod `response_model`; on failure it
  retries up to `max_retries`, appending the validation error to message history
  so the model can self-correct. Ported from the Python `instructor` (Jason Liu).
  **Every retry is a full LLM round-trip** — it has no concept of deterministic,
  local repair; it treats "model got the type wrong" and "model got the *value*
  wrong" identically, both solved by asking again. This is the clearest contrast
  with lingo's proposed `repairText`/Standard-Schema-field approach, which fixes
  the unit/locale/format class of error **without another model call**.
- **`zod .coerce` / `z.coerce.number()`** — JS-native type coercion
  (`Number(x)`, `String(x)`, `Boolean(x)`, `new Date(x)`) applied before Zod's
  own type check. No unit awareness, no locale awareness, fails closed on
  anything that isn't already a bare numeral in JS's own number grammar (see §4).
  It solves "the model sent `"42"` instead of `42`," not "the model sent `"2 lbs"`."
- **zod-gpt** (`dzhng/zod-gpt`) — gets typed/validated JSON from OpenAI/Anthropic
  by coercing the model to respond via function calls against a Zod schema;
  functionally a thinner, single-purpose predecessor to what AI SDK's
  `generateObject` now does natively. No canonicalization layer of its own.
- **LangChain.js `StructuredOutputParser`** — format-instructions-in-prompt +
  Zod-schema-parse-on-output; same "hope the model's JSON matches, validate
  after the fact" shape as the others, no coercion beyond Zod's own.
- **TypeChat** (Microsoft, mentioned for completeness) — generates the *schema
  itself* as TypeScript source and asks the model to produce a matching literal,
  validating with the TS compiler API rather than a runtime schema library.
  Different mechanism (compile-time types as the contract, not Standard Schema),
  same "no semantic coercion" gap.
- **Guardrails AI / Outlines** (Python ecosystem, noted cautionary/adjacent, not
  JS) — constrained decoding / output-guardrail approaches that restrict what
  the model can generate at the token level (grammars, regex-constrained
  sampling) rather than validating after the fact. Orthogonal to lingo: they
  constrain *shape*, not *unit/locale semantics* — a grammar can force `type: number`
  but can't know that `70` in a weight field means lb vs kg without external
  context, which is exactly the ambiguity lingo's `kind`/`unit` options resolve.

None of the above do unit- or locale-aware coercion of LLM-emitted values. The
closest conceptual relative is Zod's own `.transform()`/`.coerce`, and it stops
at JS-native type coercion. This is genuine white space, not a crowded field —
the credits ledger entry below reflects "positioning" rather than "borrowed code/API."

## 7. Recommended integration architectures for lingo

Three viable, complementary (not mutually exclusive) architectures, ranked by
how directly they extend the existing `LingoResult`/`issues`/`strictness` model
already documented in README.md/llms.txt.

### A. Standard Schema field factories — `lingoField()` (primary recommendation)

```ts
import type { StandardSchemaV1, StandardJSONSchemaV1 } from '@standard-schema/spec' // type-only import, 0 runtime bytes

function lingoField(opts: { kind: Kind; unit?: string; strictness?: Strictness; description?: string }) {
  return {
    '~standard': {
      version: 1,
      vendor: 'lingo',
      validate(value: unknown): StandardSchemaV1.Result<number> {
        const r = parseQuantity(String(value), opts)
        return r.ok
          ? { value: r.quantity.to(opts.unit ?? r.quantity.unit).value }
          : { issues: r.issues.map(i => ({ message: i.message, path: [] })) }
      },
      jsonSchema: {
        // type: 'string' is load-bearing — see §4/§7 note below
        input: () => ({ type: 'string', description: opts.description ?? `A ${opts.kind} value, e.g. "2 kg" or "5 lbs"` }),
        output: () => ({ type: 'number' }),
      },
    },
  } satisfies StandardSchemaV1<unknown, number> & StandardJSONSchemaV1<unknown, number>
}

// usage — drops straight into tool()/Output.object() top-level schemas today:
tool({ inputSchema: z.object({ weight: lingoField({ kind: 'mass', unit: 'kg' }) }) })  // ← does NOT work: see caveat
```

**Requires from lingo's API**: nothing new at the parse layer — `parseQuantity`/
`parseDate`/`parseRange` already return everything needed (`ok`, `.quantity`/`.date`,
`.issues` with `{ code, message, span }`). New surface needed: the `lingoField()`/
`lingoDateField()` factory functions themselves (implementing both spec halves),
one JSON-schema-emission decision per kind (what `description` hint teaches the
model to write parseable strings — this is genuinely new work, closer to prompt
engineering than parsing), and an issue→Standard-Schema-`Issue` mapper.

**Critical caveat, confirmed by §3's source reading**: a bare `lingoField()`
cannot be nested as a property inside a `z.object({...})` — Zod's `z.object()`
property values must be `ZodType` instances; embedding a foreign Standard Schema
requires either (a) lingo shipping its own minimal `object()`/`array()`
combinators that are themselves `StandardSchemaV1 & StandardJSONSchemaV1` (a
"nano schema builder," maybe 30-40 lines, zero-dep, only need to compose
`~standard.validate`/`~standard.jsonSchema` recursively), so the **whole** tool
`inputSchema` or `Output.object` schema is a lingo-built object schema, or (b) a
documented `z.custom<number>(v => field['~standard'].validate(v))`-style escape
hatch for users who need to mix lingo fields into an existing Zod object. (a) is
more work but is the only path to a truly ergonomic "drop lingo fields into your
existing schema" story; (b) ships faster and is enough for v1.

**Also load-bearing**: the JSON Schema emitted for `input` must be `type: 'string'`,
never `type: 'number'`, precisely so the model is free to write `"2 lbs"` — if
the field were typed `number` in strict-mode providers (OpenAI Structured
Outputs, Gemini's schema-constrained decoding), the model would either be
constrained to emit a bare JSON number (defeating the entire point — a bare `2`
loses the unit) or rejected outright before lingo ever sees the string. This
"type it as string, canonicalize on the way out" trick is the crux of the whole
architecture and should be called out explicitly in lingo's own docs, since it's
counter-intuitive (a "quantity" field being JSON-Schema-`string`).

**Zero-dep feasibility**: full. `@standard-schema/spec` is types-only (§3); no
runtime import needed at all if lingo just shapes plain objects matching the
interface structurally (TypeScript is structurally typed — you don't even need
the type package, though importing it `import type` costs nothing and buys
better inference/tooling for consumers).

### B. Deterministic `experimental_repairText`/`repairToolCall` canonicalizer

Ship a `lingoRepairText(schemaFieldKinds: Record<string, Kind>)` helper that,
given the raw JSON text and a `TypeValidationError`, walks the parsed-but-invalid
object, re-runs lingo's parsers on the offending string fields (matched by path/key
against the caller-supplied kind map), and re-serializes — entirely client-side,
matching the exact `RepairTextFunction` signature from §2a. Same idea for
`experimental_repairToolCall`, operating on `toolCall.input` (a JSON string) and
`error: NoSuchToolError | InvalidToolInputError`.

**Requires from lingo's API**: nothing beyond what exists — this is purely an
integration adapter, `findQuantities`/`parseQuantity` already do the substantive
work. New surface: the repair-function factory itself, and a convention for
telling it which object paths are which `kind` (a schema-shaped hint map, since
the JSON-Schema/Standard-Schema object being repaired doesn't necessarily carry
lingo `kind` metadata unless architecture A's field factories were also used —
these two architectures compose well together: A for new schemas, B as a safety
net for schemas lingo doesn't own).

**Zero-dep feasibility**: full — pure function operating on strings/JSON, no
AI SDK import required (the function signature can be typed structurally, same
as Standard Schema).

**Positioning note**: this is lingo's sharpest differentiation from instructor-js's
retry loop (§6) — repair here costs zero tokens and zero latency beyond a regex/parse
pass, versus instructor's mandatory re-ask.

### C. `experimental_refineToolInput` canonicalizer map

A `lingoRefineToolInput(fieldKinds)` helper matching `ToolInputRefinement<TOOLS>`'s
shape exactly (`(input) => MaybePromiseLike<input>`), for teams who want to keep
existing `z.string()` tool schemas untouched and bolt on canonicalization purely
via this AI-SDK-v7-specific hook. Lowest lock-in (no schema changes at all), but
narrowest applicability (tool-calling only — no equivalent hook exists for
`generateObject`/`Output.object`, confirmed in §2d) and newest/least-stable
surface (undocumented in prose as of `ai@7.0.14`, could still change shape).

**Recommendation**: document architecture A as the primary integration (it's
spec-level, not AI-SDK-version-specific — it'll keep working if AI SDK's own
internals shift, since Standard Schema is the interoperability layer, not an AI
SDK API). Ship B alongside it as the "you can't change the schema" escape hatch.
Treat C as an optional cookbook recipe, not a documented core API, given its
newness and AI-SDK-only scope.

## 8. Sources

- `ai-sdk.dev/docs/agents/building-agents`, `ai-sdk.dev/docs/reference/ai-sdk-core/{generate-object,tool}`,
  `ai-sdk.dev/docs/ai-sdk-core/{middleware,tools-and-tool-calling,generating-structured-data}`,
  `ai-sdk.dev/cookbook/guides/computer-use`, `vercel.com/blog/ai-sdk-6`
- `github.com/vercel/ai` source on `main` (`packages/ai/src/{generate-object,generate-text,tool,error}/*`,
  `packages/provider-utils/src/{schema,validate-types,standard-schema}.ts`) and the shipped
  `ai@7.0.14` / `ai@6.0.0` `.d.ts` via unpkg, cross-checked against npm registry dist-tags
- `standardschema.dev`, `github.com/standard-schema/standard-schema`, `@standard-schema/spec@1.1.0` on npm/unpkg
- `platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool`
- `github.com/567-labs/instructor-js`, `js.useinstructor.com`, `github.com/dzhng/zod-gpt`

## Addendum: AI SDK v7.0.18 integration surface (2026-07-09)

Multi-agent web research pass 2026-07-09. Claims are agent-reported; versions
not re-pinned against npm dist-tags (the SDK moves fast — re-verify before
acting).

New findings beyond the v7.0.14 pass above:

1. **`inputExamples` on `tool()`.** AI SDK v7's `tool()` accepts an
   `inputExamples` array that guides model tool-call quality. Anthropic's Tool
   interface has `input_examples` which "materially improves tool-call quality for
   complex/nested inputs." Lingo's `examplesForKind()` already generates per-kind
   example strings — these could be emitted as structured `inputExamples` objects
   (e.g., `{weight: '2 kg'}`) on `lingoTool`. (agent-researched, 2026-07-09)

2. **`lingoMiddleware` via `wrapLanguageModel`.** The SDK's middleware system
   (`transformParams`/`wrapGenerate`/`wrapStream`) could host a `lingoMiddleware`
   that auto-canonicalizes tool call arguments before `execute()`, giving
   infrastructure-level quantity/date normalization. Zero runtime dep on AI SDK
   (type-only import of `LanguageModelV4Middleware`). (agent-researched, 2026-07-09)

3. **Telemetry metadata.** AI SDK records `execute_tool` spans under OpenTelemetry
   GenAI Semantic Conventions. `lingoTool`/`lingoObject` could emit metadata
   (which fields were canonicalized, corrections applied, parse duration) into the
   tool `metadata` field, making lingo's value visible in production observability.
   (agent-researched, 2026-07-09)

4. **`assertStrictSafe` utility.** When AI SDK's `tool({ strict: true })` is
   used, OpenAI/Anthropic require `additionalProperties:false` on every nested
   object. `lingoObject({ passthrough: true })` emits `additionalProperties:true`,
   which silently breaks strict mode. A pre-flight `assertStrictSafe(field)` that
   walks the emitted JSON Schema would catch this at definition time.
   (agent-researched, 2026-07-09)

5. **Default JSON Schema target mismatch.** AI SDK's `asSchema()` hardcodes
   `target: 'draft-07'` in its call to `~standard.jsonSchema.input()`. Lingo's
   `toJSONSchema()` currently defaults to `'draft-2020-12'`. All real consumers
   (AI SDK, OpenAI, Anthropic, MCP) use draft-07. Since lingo's emitted keywords
   are target-portable, changing the default to `'draft-07'` would eliminate a
   subtle mismatch. (agent-researched, 2026-07-09)
