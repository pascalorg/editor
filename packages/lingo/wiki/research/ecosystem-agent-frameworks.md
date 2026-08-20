# Agent frameworks & workflows for lingo (research 2026-07-05)

Verified multi-agent research pass: two independent briefs (a source-level study of
LangChain.js/LangGraph.js; a survey of agentic-workflow recipes across the wider
2026 agent-framework ecosystem), each adversarially fact-checked against primary
sources — GitHub source on `main`, published npm dists, live-fetched vendor docs —
before being folded into this doc. Scope is deliberately narrow: **agent frameworks
and agentic workflows**, not Standard Schema/AI SDK mechanics (that's
[`wiki/research/ai-structured-output.md`](ai-structured-output.md)) and not the
evidentiary case for LLM formatting failures (that's
[`wiki/research/llm-formatting-failures.md`](llm-formatting-failures.md)). Both are
companions, cited below, not repeated.

lingo's `/ai` fields (`quantityField`, `rangeField`, `dateField`, `lingoObject` —
`packages/lingo/src/ai/`) are plain [Standard Schema](https://standardschema.dev)
objects that also implement the newer
[Standard JSON Schema](https://standardschema.dev/json-schema) extension
(`packages/lingo/src/ai/standard-schema.ts`): every field is simultaneously a
`~standard.validate()` function and a `~standard.jsonSchema.input()/.output()`
converter. `canonicalizeValues(value, spec)` walks a dot-path spec over an
arbitrary JSON payload and applies fields in place
(`packages/lingo/src/ai/canonicalize.ts`, dot paths, `[]` fan-out over arrays);
`repairTextWith(spec)` wraps the same machinery into an AI-SDK-shaped
`experimental_repairText` function. Every version number below was checked against
the npm registry or GitHub source at research time, not trusted from docs prose —
several of the mechanisms described are weeks old and docs pages lag source.

## LangChain.js and LangGraph.js

Versions pinned for every claim in this section, checked against
`langchain-ai/langchainjs` + `langchain-ai/langgraphjs` `main` and the published npm
dists: `langchain@1.5.2` (2026-06-23), `@langchain/core@1.2.1` (2026-06-22),
`@langchain/langgraph@1.4.7`, `@langchain/openai@1.5.3`, `@langchain/anthropic@1.5.1`,
`@standard-schema/spec@1.1.0`.

### Four call sites, two different validation stories

| Call site | Accepts a bare Standard Schema (a lingo field)? | Runs `~standard.validate()`? |
|---|---|---|
| `tool()` / `DynamicStructuredTool` (per-tool arg schema) | **No** — typed only to `InteropZodObject \| InteropZodType<string> \| JSONSchema` ([tools/index.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/tools/index.ts)) | n/a |
| `chatModel.withStructuredOutput(schema)` | **Yes** — `SerializableSchema<RunOutput>` overload ([chat_models.ts#L1193](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/language_models/chat_models.ts#L1193)) | **Yes on `ChatOpenAI`/`ChatAnthropic`; a bare type cast on the generic `BaseChatModel` path** — see below |
| `createAgent({responseFormat: toolStrategy(schema)})` | **Yes**, plus an explicit `SerializableSchema[]` overload ([responses.ts#L484-488](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain/src/agents/responses.ts)) | **No — shape only**, via `@cfworker/json-schema` |
| `createAgent({responseFormat: providerStrategy(schema)})` | **Yes**, single schema (or `{schema, strict?}`) only — **no array overload** ([responses.ts#L614-618](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain/src/agents/responses.ts)) | **No — shape only**, via `@cfworker/json-schema` |

"`SerializableSchema`" is LangChain's internal name for `StandardSchemaV1 &
StandardJSONSchemaV1` — a Standard Schema that also implements
`~standard.jsonSchema.input()/.output()`. Every `lingoObject({...})`,
`quantityField(...)`, `dateField(...)`, and `rangeField(...)` already satisfies this
type as-is (`packages/lingo/src/ai/standard-schema.ts`'s `createField()` sets
`vendor: 'lingo'`, `validate`, and `jsonSchema` unconditionally) — zero adapter code
needed for the two call sites that accept it directly.

### The mechanism, and why `draft-07` is the only target you will ever see

`@standard-schema/spec` (maintained by Zod's and Valibot's authors) shipped
`StandardJSONSchemaV1` in v1.1.0 (~Jan 2026): `~standard.jsonSchema.input(options)`/
`.output(options)`, `options: {target: 'draft-2020-12'|'draft-07'|'openapi-3.0'|string}`
— byte-for-byte the interface lingo already ships. `@langchain/core`'s `toJsonSchema()`
consumes it directly, and it backs every one of the four call sites above:

```ts
export function toJsonSchema(
  schema: StandardJSONSchemaV1 | InteropZodType | JSONSchema,
  params?: ToJSONSchemaParams
): JSONSchema {
  if (isStandardJsonSchema(schema) && !isZodSchemaV4(schema)) {
    result = schema["~standard"].jsonSchema.input({
      target: "draft-07",
    }) as JSONSchema               // `params` is never read on this branch
  } else if (isZodSchemaV4(schema)) {
    // ... only Zod v4 forwards `params` into its own toJSONSchema(schema, params)
  }
  // ...
}
```

For a lingo field — a Standard Schema that isn't a Zod v4 schema — this is
**structurally impossible to override**, not just unexercised: `params` is forwarded
only on the `isZodSchemaV4` branch. Across roughly 58 production call sites of
`toJsonSchema(` in the langchain/langchainjs monorepo (every `withStructuredOutput`
override, every provider's `bindTools`, both `ToolStrategy.fromSchema`/
`ProviderStrategy.fromSchema`), none pass a second argument; the only two call sites
anywhere that pass `params` are Zod-v4-only paths (a unit test and
`interopZodResponseFormat`, explicitly gated on `isZodSchemaV4`). LangChain's own
test suite locks the behavior in verbatim (`describe("with Standard JSON Schema")
→ it("should pass target draft-07 to the input function")`).

Practical upshot: `target: 'draft-07'` is the only target LangChain.js will ever
request from a lingo field, with no escape hatch, on `withStructuredOutput`,
`toolStrategy`, `providerStrategy`, or `createAgent` alike. lingo's own field
builders (`stringJsonSchema`, `numberJsonSchema`, `objectJsonSchema`, and the
quantity/range JSON builders in `quantity-fields.ts`/`canonicalize.ts`) don't branch
on `options.target` and only emit baseline keywords valid under every target
(`type`, `description`, `minimum`/`maximum`, `properties`/`required`/
`additionalProperties`) — draft-07-safe today, no changes needed, but load-bearing
enough (any future 2020-12-only keyword, e.g. `prefixItems`, would silently break
every LangChain caller) to deserve a pinned regression test rather than resting on
"we never implemented target-branching."

Timing: this whole subsystem is brand new. `@standard-schema/spec` is absent from
`@langchain/core@1.1.0`'s dependencies (published 2025-11-24) and present from
`1.2.0` (published 2026-06-17) — it shipped roughly three weeks before this
research. One caching gotcha worth documenting alongside any recipe: `toJsonSchema()`
caches conversions in a `WeakMap` keyed by schema object identity, so lingo fields
should be instantiated once at module scope, not per-request — a fresh field on
every call silently defeats the cache across a multi-step agent loop.

### Pattern 1 — `withStructuredOutput()`: real validation, but only where a provider overrides it

```ts
import { ChatOpenAI } from "@langchain/openai"
import { lingoObject, quantityField, dateField } from "@pascal-app/lingo/ai"

const ShipmentInfo = lingoObject({
  weight: quantityField({ kind: "mass", unit: "kg", min: 0, max: 1000 }),
  arrivesBy: dateField({ now: new Date("2026-07-05T00:00:00Z") }),
})

const extract = new ChatOpenAI({ model: "gpt-4o-mini" }).withStructuredOutput(ShipmentInfo)
const result = await extract.invoke("about 40 lbs, needs to land by next Friday")
// result = { weight: 18.14, arrivesBy: "2026-07-10T00:00:00.000Z" } — real canonical values
```

`ChatOpenAI`'s default `method: "functionCalling"` builds
`createFunctionCallingParser(schema, functionName)` → `JsonOutputKeyToolsParser`,
whose `_validateResult()` does `await this.serializableSchema["~standard"].validate(result)`
verbatim ([json_output_tools_parsers.ts#L289-304](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/output_parsers/openai_tools/json_output_tools_parsers.ts#L289)).
On failure it throws `OutputParserException` with lingo's `issues`
JSON-stringified into `.message` (structure is lost — call `field.safeParse()`
yourself if you need the real array). No retry happens here — it's a plain
`Runnable`; `.withRetry()` is a blind (non-schema-aware) retry, not a substitute.

A nuance worth stating precisely, because one working example invites
over-generalizing: `BaseChatModel.withStructuredOutput()`'s TYPE signature accepts a
bare `SerializableSchema` — but the **base class's own implementation**, the code
path used by any provider subclass that hasn't overridden the method, never calls
`~standard.validate()` at all. It uses `toJsonSchema(schema)` to build the tool
definition, then returns the model's raw tool-call arguments via a bare
`toolCall.args as RunOutput` — a type assertion, not a runtime check. `ChatOpenAI`
and `ChatAnthropic` both override the method and do validate for real by default,
but through different parser plumbing, not "the identical code path" one might
assume from symmetry: `ChatAnthropic`'s default `functionCalling` path calls
`createFunctionCallingParser(schema, functionName, AnthropicToolsOutputParser)` — a
third argument that swaps in Anthropic's own parser class, which independently
reimplements the same `await this.serializableSchema["~standard"].validate(parsedResult)`
check. `JsonOutputKeyToolsParser` itself is never invoked for Anthropic's default
tool-calling path — only for its `jsonSchema`/`jsonMode` fallback methods, which
share `createContentParser()` → `StandardSchemaOutputParser` with OpenAI's
equivalent fallback. Net effect: a `LingoField` gets real, automatic
canonicalization for free via `ChatOpenAI`/`ChatAnthropic`'s `withStructuredOutput()`
specifically (current: `@langchain/openai@1.5.3`, `@langchain/anthropic@1.5.1`); on
any other/generic `BaseChatModel` subclass whose override isn't independently
verified, only the JSON-Schema half of the field is consumed and the model's raw
string comes back via a bare cast, never through `validate()` — lingo's LangChain
docs should recommend `field.safeParse(result)` defensively unless the specific
provider's override is confirmed.

### Pattern 2 — a tool argument schema: convert once, validate in the handler

`tool()`/`DynamicStructuredTool` never accepts a bare Standard Schema — confirmed at
both the type and runtime level: the factory's overloads are typed to
`InteropZodObject | InteropZodType<string> | JsonSchema7Type`, and
`StructuredTool.call()` branches only on `isInteropZodSchema(this.schema)`; anything
else is treated as a raw JSON-Schema document and validated structurally via
`@cfworker/json-schema`. There is no `~standard`/`isStandardSchema` handling
anywhere in `tools/index.ts` (grepped both source and the compiled npm dist).
LangChain's own JSDoc says so plainly: "The tool will not validate input if JSON
schema is passed" — so convert once for the advertised schema, and validate for
real inside the handler, which is also where LangChain's retry loop naturally lives:

```ts
import { tool } from "@langchain/core/tools"
import { lingoObject, quantityField } from "@pascal-app/lingo/ai"

const Args = lingoObject({ weight: quantityField({ kind: "mass", unit: "kg", min: 0 }) })
const recordWeight = tool(
  async (raw) => `Recorded ${Args.parse(raw).weight} kg.`, // .parse() throws an Error w/ .issues on failure
  { name: "record_weight", description: "Record a package weight.",
    schema: Args["~standard"].jsonSchema.input({ target: "draft-07" }) as Record<string, unknown> },
)
```

The advertised schema is just `{type:"object", properties:{weight:{type:"string",...}}}`
— LangChain's own boundary check only confirms shape; `Args.parse()` does the
semantic work. When it throws, `ToolNode`
([tool_node.ts](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/prebuilt/tool_node.ts))
catches it (`handleToolErrors` defaults `true`) and returns
`new ToolMessage({status:"error", content:"Error: " + e.message + "\n Please fix your mistakes.", ...})`
— lingo's own `[AMBIGUOUS_NUMBER] "1,234" could mean 1234 or 1.234 — assuming 1234.
Did you mean 1234 kg?` becomes literally what the model reads to retry. This is
LangChain's nearest analogue to `repairTextWith()` — but reprompt-based (costs a
model turn), not lingo's silent local-substitution shape. No attempt cap exists at
this layer; bound it via `recursionLimit` on `.invoke()`, and say so explicitly in
any lingo+LangChain example — a persistently ambiguous failure can spin the ReAct
loop until the step budget is exhausted, burning tokens, so "benign forgiveness"
should never read as "free infinite retries."

### Pattern 3 — `createAgent` + `toolStrategy`/`providerStrategy`: the gap `canonicalizeValues()` closes

```ts
import { createAgent, toolStrategy } from "langchain"
import { lingoObject, quantityField, canonicalizeValues } from "@pascal-app/lingo/ai"

const weight = quantityField({ kind: "mass", unit: "kg" })
const Extraction = lingoObject({ weight })
const agent = createAgent({ model: "gpt-4o-mini", tools: [],
  responseFormat: toolStrategy(Extraction, { handleError: true }) })

const { structuredResponse } = await agent.invoke({ messages: [{ role: "user", content: "it's 40 lbs" }] })
// structuredResponse = { weight: "40 lbs" } — RAW STRING; toolStrategy validates JSON *shape* only.
const { value } = canonicalizeValues(structuredResponse, { weight })
// value.weight -> 18.14
```

`ToolStrategy.parse()`/`ProviderStrategy.parse()` validate with a plain
`@cfworker/json-schema` `Validator` (re-exported verbatim from `@langchain/core`'s
`json_schema.ts`), never `~standard.validate()`. The mechanism is precise, not
incidental: `toJsonSchema(schema)` converts a `SerializableSchema` to a plain JSON
Schema object once at strategy-construction time, and only that converted object —
never the original schema or its `validate` closure — is stored on the resulting
`ToolStrategy`/`ProviderStrategy` instance. It is **structurally impossible** for
`~standard.validate()` to run later; this isn't an oversight that could get patched
in a minor release, it's a consequence of what the constructor keeps a reference to.
`handleError` (default `true`, or a callback receiving
`StructuredOutputParsingError | MultipleStructuredOutputsError`) only fires on JSON
parse/shape failures — a structurally-valid-but-uncanonicalized string sails
through silently. One asymmetry worth naming precisely: `toolStrategy()` has an
explicit overload for an array of `SerializableSchema`s (a model can pick a shape by
tool name); `providerStrategy()` has no array overload — native JSON-mode
structured output can't let a model choose among multiple schemas the way a tool
name can.

This is, plainly, the one gap in LangChain's own structured-output story that
`canonicalizeValues()` exists to fill — and arguably the riskiest failure mode in
the whole integration surface, because nothing throws. A team that reaches for
`createAgent` + `toolStrategy`/`providerStrategy` first (the most-documented "easy"
path) can ship a silent correctness bug — a `"$1,234.00"` reimbursement string
posting straight through to a finance system — rather than a crash that gets
noticed in testing. Always run `canonicalizeValues()` (or a field's own
`safeParse()`) on `structuredResponse`; never assume `createAgent` canonicalized it.

### Human-in-the-loop: `interrupt()` and `GraphInterrupt`

`ToolNode` special-cases `GraphInterrupt`: it is always re-thrown even with
`handleToolErrors: true`, so a tool body can call `interrupt()` mid-parse to hand a
lingo did-you-mean candidate to a human, then resume with
`new Command({resume: chosenValue})` against a `MemorySaver` (or a persistent
checkpointer in production) and a stable `thread_id`
([docs.langchain.com/oss/javascript/langgraph/interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)).
`langchain`'s `humanInTheLoopMiddleware({interruptOn: {...}})` generalizes this to
approve/edit/reject gates per tool name (medium-confidence on the exact option
names — sourced from the reference doc, not raw TS, in this pass). Both mechanisms
require the checkpointer-plus-`thread_id` setup; an example that skips it will look
correct in a single-turn smoke test and then silently fail to resume in any real
multi-turn deployment — worth stating explicitly in any lingo cookbook page built on
this, since it's an easy detail to omit from a minimal repro.

## What JSON Schema enforces today — and the seam that's left

It's commonly assumed that JSON-Schema content keywords — `pattern`, `format`,
`minimum`/`maximum`, `minItems`/`maxItems` — are simply ignored once a provider's
strict mode is on, and that only shape (`required`, `additionalProperties: false`)
is enforced. That stopped being fully true on **2025-05-20**: OpenAI's changelog
entry for that date ("Added new schema features, including string validation for
email and other patterns and specifying ranges for numbers and arrays") is still
live in the current docs, and the current "Supported schemas → Supported
properties" table
([developers.openai.com/api/docs/guides/structured-outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
live-fetched July 2026) lists as genuinely enforced, for non-fine-tuned models on
`v1/chat/completions` and `v1/responses`: strings — `pattern` (regex) and `format`
(a closed set only: `date-time`, `time`, `date`, `duration`, `email`, `hostname`,
`ipv4`, `ipv6`, `uuid` — not arbitrary formats); numbers — `minimum`, `maximum`,
`exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`; arrays — `minItems`,
`maxItems`. Supplying an unsupported keyword under `strict: true` is a
**request-time rejection**, not a silent no-op. The one keyword pair that still
isn't enforced: `minLength`/`maxLength` for strings — the string "minLength"
appears exactly once in the current doc, only inside the "not yet supported"
callout. Content-keyword enforcement is entirely absent for fine-tuned models, and
schema-composition keywords (`allOf`, `not`, `dependentRequired`,
`dependentSchemas`, `if`/`then`/`else`) remain unsupported for every model. Azure
OpenAI has not shipped any of this: its most recent docs update
(`learn.microsoft.com/.../structured-outputs`, `ms.date` 2026-05-13, updated
2026-06-05) still tables `pattern`/`format`/`minLength`/`maxLength`/`minimum`/
`maximum`/`multipleOf`/`minItems`/`maxItems` as unsupported type-specific keywords
across the board — on Azure deployments specifically, the older "nothing but shape
is enforced" framing is still accurate.

This matters for how precisely lingo should state its own value proposition. Don't
claim OpenAI "never enforces content" on native OpenAI endpoints — as of mid-2025 it
enforces real numeric ranges, regex patterns, and a fixed `format` enum. What
survives, narrower and sharper than the blanket claim:

1. **No JSON-Schema keyword can express "valid natural-language quantity/date."**
   No regex matches `5'11\"`; no `format` value matches "three days ago"; no schema
   shape captures "between 5 and 10 kg."
2. **Using OpenAI's now-enforced `number` type (`minimum`/`maximum`) requires the
   model itself to have already converted the phrase to a canonical unit in its own
   head** before it emits the numeral — the exact unreliable arithmetic step lingo
   removes by keeping the wire type `string` (the tool-boundary default recorded in
   `plans/020`) and canonicalizing/bounds-checking server-side on the *parsed*
   value, never on the raw token stream.
3. **The semantic checks lingo actually performs have no JSON-Schema equivalent at
   all, enforced or not, on any provider**: `AMBIGUOUS_NUMBER`'s did-you-mean
   candidate, `dateField`'s `requireNow` guard against wall-clock drift, and
   `TZ_IGNORED` rejection are not expressible as `pattern`, `format`, or any
   combination of numeric bounds.

Schema enforcement decides the shape of the box; it still cannot decide whether
what's inside it is honest (the same point `llm-formatting-failures.md` makes as
its fourth positioning sentence — this pass confirms it holds even after OpenAI's
2025-05-20 enforcement expansion, not just in the pre-expansion world that doc was
written against).

## Seven recipes for canonicalization in agentic workflows

Anthropic's own framework for this space
(["Building Effective Agents"](https://www.anthropic.com/engineering/building-effective-agents))
names five composable workflow patterns — prompt chaining, routing,
parallelization, orchestrator-workers, evaluator-optimizer — plus autonomous agents
that "gain 'ground truth' from the environment at each step (tool call results…)"
and "pause for human feedback at checkpoints." Every one of those checkpoints is a
place a natural-language value can be silently wrong while still being
schema-valid. lingo's `/ai` surface already covers the single-SDK case for Vercel AI
SDK — the site's AI docs tabs (AI SDK, Repair, Tool call, MCP;
`apps/site/src/lib/code-snippets.ts`). The seven recipes below extend that coverage
across the wider agent-framework ecosystem, each flagging what's already shipped as
a doc/demo versus genuinely new ground found in this pass.

### R1 — Tool-call repair and self-correcting retries

Already shipped for Vercel AI SDK (`ai@7.x` — `experimental_repairToolCall`/
`experimental_repairText`; `repairText` is purely local/client-side with no forced
model call, while both documented `repairToolCall` strategies cost an extra LLM
round trip —
[ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)).

One durability caveat worth recording, since it affects how lingo should describe
`repairTextWith()` going forward: `generateObject`/`streamObject` — the only two
functions that carry `experimental_repairText` — are **deprecated** as of AI SDK 6
(`vercel/ai#10754`, merged 2025-12-01) in favor of `generateText`/`streamText` with
`output: Output.object({schema})`. The replacement path has no repair-text
equivalent yet: issue `vercel/ai#10973` ("repairText for generateText and output")
has been open since 2025-12-08, and AI SDK lead maintainer @lgrammel wrote on
2026-01-27, "Ideally we would not have this any more. `repairText` turned out to be
too complex for what it is," pointing instead at the "Extract JSON"
`wrapLanguageModel` middleware. `repairTextWith()` should not be pitched as *the*
AI SDK repair integration going forward — a middleware-shaped variant matching the
"Extract JSON" pattern would target where the SDK is actually headed, and would
fill a real, currently open gap (no repair hook exists yet on the `generateText`+
`Output` path at all).

New: `@openai/agents` (TypeScript; verified against the shipped `0.11.6` package,
latest tag `0.12.0` as of 2026-07-05) has an equivalent, structurally distinct seam
— tool-level guardrails. The mechanism isn't new to `0.11.6`: it shipped in
`@openai/agents-core@0.3.8` (2026-01-14, PR #812) and has since been refined
(`0.11.2` fixed tripwire-vs-sibling-completion ordering; `0.11.8` added an opt-in
pre-approval variant). It's a genuinely separate integration surface from AI SDK's
repair hooks — a different SDK's own tool-execution-loop interception at the call
boundary, not a hook for repairing malformed generation text before parsing:

```ts
import { Agent, defineToolInputGuardrail, ToolGuardrailFunctionOutputFactory, tool } from '@openai/agents'
import { z } from 'zod'
import { quantityField } from '@pascal-app/lingo/ai'

const weight = quantityField({ kind: 'mass', unit: 'kg', min: 0 })

const canonicalizeWeight = defineToolInputGuardrail({
  name: 'canonicalize_weight',
  run: async ({ toolCall }) => {
    const args = JSON.parse(toolCall.arguments) as { weight?: string }
    const result = weight.safeParse(args.weight)
    if (!('value' in result)) {
      // lingo's specific "[AMBIGUOUS_NUMBER] … Did you mean 1234 kg?" beats the
      // SDK's generic type-mismatch error as retry-feedback text (Tool-Reflection-
      // Bench: specific error content is what moves Repair@k above baseline).
      return ToolGuardrailFunctionOutputFactory.rejectContent(result.issues[0].message)
    }
    toolCall.arguments = JSON.stringify({ ...args, weight: result.value })
    return ToolGuardrailFunctionOutputFactory.allow()
  },
})

const logShipment = tool({
  name: 'log_shipment_weight',
  parameters: z.object({ weight: z.string() }),
  inputGuardrails: [canonicalizeWeight],
  execute: ({ weight }) => recordWeightKg(weight),
})
```

Source (verbatim):
[`toolGuardrails.ts`](https://github.com/openai/openai-agents-js/blob/main/examples/docs/guardrails/toolGuardrails.ts).
One caveat to carry into any lingo cookbook built on this: mutating
`toolCall.arguments` in place before `allow()` (shown above) mirrors AI SDK's
zero-cost refine path, but it is an **implementation detail, not a documented
contract** — only `allow()`/`rejectContent()`/`throwException()` are named
behaviors. Don't ship the mutation as a documented recipe without an integration
test pinned to a specific version; the confirmed-stable fallback is
`rejectContent(result.issues[0].message)`, which still costs a model turn but
already improves retry yield over the SDK's generic type-mismatch error text.

### R2 — Structured extraction with an audit trail

Already shipped: the site's `extract-shipment.ts` AI SDK tab —
`generateObject({schema: lingoObject({...})})`. New: extraction pipelines are
increasingly scored on "cost per accepted document," where retries, escalations,
and correction time dominate the bill
([unstract.com, 2026](https://unstract.com/blog/comparing-approaches-for-using-llms-for-structured-data-extraction-from-pdfs/))
— use `quantityField({output: 'quantity'})` to keep the full canonical
`QuantityJSON` instead of a bare number:

```ts
import { quantityField } from '@pascal-app/lingo/ai'

const height = quantityField({ kind: 'length', unit: 'm', output: 'quantity' })
height.parse(`5'11"`)
// { v: 1, type: 'quantity', kind: 'length', base: 1.8034, unit: 'm' }
```

This preserves which unit was actually printed on the source (`parts`), the
approximate flag, and the converted `base` in one payload — an audit trail
distinguishing which extraction needed a human look from which was a clean
auto-accept, without giving up the canonical value the downstream system needs.

### R3 — Multi-turn form-filling without clock drift

Distinct from R2: a conversational agent collects slots **across turns**, then
calls a booking tool. The risk is clock drift between when a relative date was
spoken and when the tool actually fires. `dateField`'s `requireNow` (default
`true`) makes this concrete: when `now` is omitted, it does not fall back to the
wall clock — it fails loudly with `NOW_REQUIRED` instead. That forces the calling
flow to capture one explicit `now` and thread it through every turn and retry, so
"day after tomorrow" resolved at turn 2 can't silently re-resolve against a later
instant if the tool call retries at turn 6 (hard rule: no `Date.now()` inside
parsing logic, ever — reference time is always an explicit option):

```ts
import { tool } from 'ai'
import { z } from 'zod'
import { dateField, quantityField } from '@pascal-app/lingo/ai'

const checkIn = dateField({ now })                                    // now: captured once, threaded through every turn
const stay = quantityField({ kind: 'duration', unit: 'day', min: 1, max: 30 })

const bookTrip = tool({
  description: 'Book a trip once dates are confirmed.',
  inputSchema: z.object({ checkInText: z.string(), stayText: z.string() }),
  execute: async ({ checkInText, stayText }) => {
    const checkInResult = checkIn.safeParse(checkInText)
    if (!('value' in checkInResult)) return { error: checkInResult.issues[0].message } // tool RESULT, not throw — model relays this to the human, not itself
    const stayResult = stay.safeParse(stayText)
    if (!('value' in stayResult)) return { error: stayResult.issues[0].message }
    return createBooking({ checkIn: checkInResult.value, nights: stayResult.value })
  },
})
```

### R4 — Computer-use and browser agents: extract-then-canonicalize

Two verified facts and one new. lingo's DOM layer already canonicalizes
untrusted/synthetic input events regardless of who typed them — a
Playwright-synthetic `5'11"` producing display "1.8 m" and `data-canonical=1.8034`
was verified live in this repo on 2026-07-04 against `/docs` forms (`plans/019`).
New: [Stagehand](https://docs.stagehand.dev/v2/references/extract)'s
`page.extract<T extends z.AnyZodObject>` is **Zod-typed with no Standard Schema
escape hatch** — a lingo field cannot be embedded in the extract schema itself. The
recipe is extract-permissively-then-canonicalize:

```ts
import { z } from 'zod'
import { canonicalizeValues, quantityField, dateField } from '@pascal-app/lingo/ai'

const raw = await page.extract({
  instruction: 'extract the shipment weight and delivery date from this page',
  schema: z.object({ weight: z.string(), deliverBy: z.string() }),
})
const { value, issues } = canonicalizeValues(raw, {
  weight: quantityField({ kind: 'mass', unit: 'kg' }),
  deliverBy: dateField({ now }),
})
```

Also motivational, not just mechanical: Anthropic's computer-use tool
(`computer_20251124`, beta header `computer-use-2025-11-24`, per
[platform.claude.com docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool))
ships a bare-string `type` action with zero locale/unit/schema of any kind; a March
2026 desktop research-preview for Claude Pro/Max on macOS
([reported](https://siliconangle.com/2026/03/23/anthropics-claude-gets-computer-use-capabilities-preview/),
medium-confidence secondary source) means this exact failure surface — typing a
wrong-but-plausible-looking value with no visual signal anything is off — is now
consumer-facing, not just an API-sandbox concern.

### R5 — Human-in-the-loop confirmation of ambiguous values

LangGraph's `interrupt()` (mechanism described above) pauses a node, surfaces a
JSON-serializable payload, and resumes via `Command` — the documented HITL
middleware supports approve/edit/reject/respond decisions
([LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts),
[LangChain HITL guide](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)).
lingo's failure messages already carry a ranked did-you-mean candidate — a
ready-made interrupt payload:

```ts
import { interrupt } from '@langchain/langgraph'
import { quantityField } from '@pascal-app/lingo/ai'

const weight = quantityField({ kind: 'mass', unit: 'kg' })

function extractWeightNode(state: { rawWeight: string }) {
  const result = weight.safeParse(state.rawWeight)
  if (!('value' in result)) {
    // e.g. '[AMBIGUOUS_NUMBER] "1,234" could mean 1234 or 1.234 — assuming 1234. Did you mean 1234 kg?'
    const decision = interrupt({ question: result.issues[0].message, raw: state.rawWeight })
    return { weightKg: decision.correctedKg }
  }
  return { weightKg: result.value }
}
```

OpenAI's Agents SDK has the same shape via
["guardrails and human review"](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)
tripwires — R1's `ToolGuardrailFunctionOutputFactory.throwException()` is the
equivalent escalation path in that SDK.

### R6 — Multi-agent handoffs

`@openai/agents`' `handoff(agent, {inputType, onHandoff})` guide states a
preference for "a Zod schema when you want the SDK to validate the parsed payload
before `onHandoff` runs; a raw JSON Schema only defines the tool contract."
**Open question, not confirmed by this pass**: whether a bare, non-Zod `LingoField`
is accepted the same way a Zod schema is. The safe, verified pattern uses lingo's
JSON-Schema half for the model-facing contract and validates manually inside
`onHandoff`:

```ts
import { lingoObject, dateField, quantityField } from '@pascal-app/lingo/ai'

const stay = lingoObject({ checkIn: dateField({ now }), nights: quantityField({ kind: 'duration', unit: 'day', min: 1 }) })

const toBooking = handoff(bookingAgent, {
  inputType: stay['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
  onHandoff: (_ctx, rawInput) => {
    const result = stay.safeParse(rawInput)
    if (!('value' in result)) throw new Error(result.issues[0].message)
    // result.value.checkIn is ISO, nights is a number — the booking agent never re-interprets "next Friday."
  },
})
```

Also relevant at the protocol level rather than the SDK level: Google's
[Agent2Agent (A2A) protocol](https://cohorte.co/blog/googles-agent2agent-a2a-protocol-a-new-era-of-ai-agent-interoperability)
defines a `DataPart` for structured JSON exchanged between agents — the same
canonicalize-before-handoff argument applies regardless of which agent framework is
on either end.

### R7 — RAG-to-structured

"Agentic Document Workflows" (the LlamaIndex framing) parse heterogeneous source
documents into one schema; each source may use a different unit, locale, or date
convention. Batch `canonicalizeValues` before a warehouse write:

```ts
import { canonicalizeValues, quantityField, dateField } from '@pascal-app/lingo/ai'

const canonical = records.map((record) =>
  canonicalizeValues(record, {
    weight: quantityField({ kind: 'mass', unit: 'kg', output: 'quantity' }), // provenance kept
    reportedOn: dateField({ now }),
  }),
)
const clean = canonical.filter((r) => r.issues.every((i) => i.severity !== 'error'))
await warehouse.insertMany(clean.map((r) => r.value))
```

### Gaps this pass found, not yet documented anywhere in lingo

No documented recipe for OpenAI Agents SDK guardrails/handoffs, LangGraph
`interrupt()`, Stagehand, or Mastra existed anywhere in `wiki/`, `plans/`, or
`apps/site/` before this pass (grep-confirmed across `.md`/`.ts`/`.tsx` for
`openai-agents`, `openai/agents`, `ToolGuardrail`, `defineToolInputGuardrail`,
`interrupt`, `stagehand`, and `mastra` — zero hits) — R1 and R4–R7 above are new
ground, not restatements of an existing doc.
[Mastra](https://mastra.ai) documents accepting "Standard JSON Schema (Zod,
Valibot, ArkType, etc.)" for workflow/agent schemas, which would make it a likely
direct-drop-in candidate for lingo fields — unverified at primary-source depth in
this pass, worth a follow-up check before it's promoted to an eighth recipe.

## Sources

**LangChain.js / LangGraph.js** —
[tools/index.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/tools/index.ts) ·
[chat_models.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/language_models/chat_models.ts) ·
[json_output_tools_parsers.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/output_parsers/openai_tools/json_output_tools_parsers.ts) ·
[utils/standard_schema.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/utils/standard_schema.ts) ·
[utils/json_schema.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/utils/json_schema.ts) ·
[langchain-openai chat_models/base.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-openai/src/chat_models/base.ts) ·
[langchain-anthropic chat_models.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-anthropic/src/chat_models.ts) ·
[langchain/src/agents/responses.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain/src/agents/responses.ts) ·
[langchain/src/agents/middleware.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain/src/agents/middleware.ts) ·
[langgraphjs tool_node.ts](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/prebuilt/tool_node.ts) ·
[docs.langchain.com structured-output](https://docs.langchain.com/oss/javascript/langchain/structured-output) ·
[docs.langchain.com interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) ·
[humanInTheLoopMiddleware reference](https://reference.langchain.com/javascript/functions/langchain.index.humanInTheLoopMiddleware.html) ·
[standardschema.dev/json-schema](https://standardschema.dev/json-schema).

**Agentic workflows & ecosystem** —
[Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) ·
[AI SDK tools/tool-calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) ·
[OpenAI Agents JS guardrails guide](https://openai.github.io/openai-agents-js/guides/guardrails/) +
[toolGuardrails.ts source](https://github.com/openai/openai-agents-js/blob/main/examples/docs/guardrails/toolGuardrails.ts) ·
[handoffs guide](https://openai.github.io/openai-agents-js/guides/handoffs/) ·
[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) ·
[OpenAI guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals) ·
[LangGraph interrupts (Python docs)](https://docs.langchain.com/oss/python/langgraph/interrupts) ·
[LangChain HITL](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) ·
[Stagehand extract reference](https://docs.stagehand.dev/v2/references/extract) ·
[Claude computer-use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) ·
[Claude desktop computer-use preview report](https://siliconangle.com/2026/03/23/anthropics-claude-gets-computer-use-capabilities-preview/) ·
[Tool-Reflection-Bench arXiv:2509.18847](https://arxiv.org/abs/2509.18847) (vetted in `wiki/research/llm-formatting-failures.md`) ·
[Google A2A protocol overview](https://cohorte.co/blog/googles-agent2agent-a2a-protocol-a-new-era-of-ai-agent-interoperability) ·
[unstract.com extraction-pipeline economics](https://unstract.com/blog/comparing-approaches-for-using-llms-for-structured-data-extraction-from-pdfs/) ·
[Mastra](https://mastra.ai).

**lingo repo** — `packages/lingo/src/ai/{standard-schema,quantity-fields,date-field,
canonicalize,index}.ts` · `plans/019-ai-structured-output.md` ·
`plans/020-tool-boundary-safety.md` · `plans/024-ecosystem-integration-and-docs.md` ·
`apps/site/src/lib/code-snippets.ts`.

## Implications for lingo

**Recipe set.** This pass adds seven documented, source-cited recipes spanning
tool-call repair (including `@openai/agents` guardrails), structured extraction
with an audit trail (`output: 'quantity'`), multi-turn form-filling
(`requireNow`), computer-use/browser agents (Stagehand extract-then-canonicalize),
human-in-the-loop confirmation (`interrupt()`), multi-agent handoffs, and
RAG-to-structured (batch `canonicalizeValues`). None require new library code —
every recipe reuses the existing `@pascal-app/lingo/ai` surface
(`quantityField`, `dateField`, `rangeField`, `lingoObject`, `canonicalizeValues`,
`repairTextWith`) exactly as it ships today.

**LangChain-specific documentation opportunities**, all docs-only and low-risk:
a `toLangChainTool(name, description, lingoObjectSchema, handler)` helper wrapping
Pattern 2's boilerplate; documenting the `createAgent` + `toolStrategy`/
`providerStrategy` shape-only-validation gap prominently, since it is currently
undocumented anywhere in LangChain's own docs and is the easiest correctness trap
in this whole surface to miss; a `lingoHandleError(spec)` adapter mapping
`StructuredOutputParsingError`/`MultipleStructuredOutputsError` into a corrective
retry message using lingo's own coded-message vocabulary; a pinned test asserting
lingo's `jsonSchema.input()` never emits a draft-2020-12-only keyword under any
target; and a LangGraph HITL cookbook wiring an `AMBIGUOUS_NUMBER`/date-ambiguity
candidate straight into `interrupt()` + `Command({resume})`, since `ToolNode`
already special-cases `GraphInterrupt` for exactly this purpose.

**Three code-level gaps this pass surfaced, beyond docs:**

- **`toZodCustom(field)`** — a bridge wrapping
  `z.custom(v => field['~standard'].validate(v))` — to unblock the Zod-only
  integration points this pass newly identified: Stagehand's
  `z.AnyZodObject`-typed `extract()` (R4), and `@openai/agents`' `handoff()`,
  whose documented validation path is described in terms of "a Zod schema" (R6).
  Without it, lingo's "implements Standard Schema, drops into anything" pitch has
  real, named exceptions in this ecosystem.
- **`refineToolInputWith(spec)`** — mirroring `repairTextWith` but shaped for AI
  SDK v7's `experimental_refineToolInput` (post-validation, pre-execute, zero
  interaction with the SDK's error/retry taxonomy). Flagged in
  `ai-structured-output.md` as "Architecture C" and left as a cookbook-only
  recipe there; this pass's finding that `repairText`/`generateObject` are
  deprecated with no forward port (R1) makes a refine-shaped or middleware-shaped
  helper more, not less, relevant going forward.
- **`toolGuardrailFor(lingoField)`** — an adapter wrapping
  `field['~standard'].validate(...)` inside a `defineToolInputGuardrail` `run`
  callback, returning `rejectContent(issueMessage)` on failure or `allow()` on
  success. A clean, additive integration surface for `@openai/agents`, distinct
  from the AI-SDK-shaped `repairTextWith()` — a different SDK's interception
  point, not a restyling of the same one.

None of this is decided here. Whether any of these three ship as their own
tree-shakeable code, stay cookbook-only recipes, or don't proceed at all is a
`plans/024-ecosystem-integration-and-docs.md` decision — that plan already tracks
its own open questions (`grade` scorer, a `toJsonSchema` ergonomic alias, the
gated `lingoTool`) under the same design-candidate-plus-offer-gate process (D19);
this pass's three findings should be folded into that list, not pre-decided in a
research doc.
