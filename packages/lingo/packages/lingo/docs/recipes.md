# Recipes

Copy-paste-runnable snippets for every way lingo shows up in a real app: LLM tool
schemas and agent workflows, human forms across the major libraries, the
per-vertical case for dropping a unit dropdown, and the field shapes underneath
all of it. Each snippet uses only the public API. See the
[README](../README.md) for the tour, [`src/index.ts`](../src/index.ts) for the
core exports, and [`src/ai/index.ts`](../src/ai/index.ts) for the `/ai` exports.
Provider and framework surfaces move fast; load-bearing claims below cite the
`wiki/research/` doc or primary source they were verified against. Re-check
before you ship against an old pin.

## Contents

1. [One schema for tools and forms](#1-one-schema-for-tools-and-forms)
2. [AI: structured output and tool calling](#2-ai-structured-output-and-tool-calling)
   - [Vercel AI SDK](#vercel-ai-sdk)
   - [OpenAI](#openai)
   - [Anthropic](#anthropic)
   - [Gemini](#gemini)
   - [Provider portability](#provider-portability)
   - [LangChain](#langchain)
   - [MCP tools](#mcp-tools)
   - [Evals: quantityMatch and dateMatch](#evals-quantitymatch-and-datematch)
   - [Agent workflows](#agent-workflows)
3. [Forms: human input](#3-forms-human-input)
   - [React Hook Form](#react-hook-form)
   - [shadcn/ui](#shadcnui)
   - [TanStack Form](#tanstack-form)
   - [Formik](#formik)
   - [Vue and vee-validate](#vue-and-vee-validate)
   - [Angular](#angular)
   - [Vanilla HTML](#vanilla-html)
   - [The `<lingo-input>` web component](#the-lingo-input-web-component)
4. [Drop the unit dropdown](#4-drop-the-unit-dropdown)
5. [Database input](#5-database-input)
6. [Field shapes](#6-field-shapes)
   - [Height field](#height-field-feetinches-to-meters)
   - [Recipe-ingredient field](#recipe-ingredient-field-mass-or-volume)
   - [Shipment weight](#shipment-weight-strict-ranges-rejected)
   - [Fuzzy temperature field](#fuzzy-temperature-field)
   - [Strict scientific field](#strict-scientific-field)
   - [Server-side validation](#server-side-validation)

## 1. One schema for tools and forms

`lingoObject` is a [Standard Schema](https://standardschema.dev) object. Define it
once and it drops into an AI SDK tool call **and** a react-hook-form resolver
unmodified. You do not need an adapter, Zod, or a second copy of the validation
logic.

```ts
// shipment.ts. Defined once
import { lingoObject, quantityField, dateField } from '@pascal-app/lingo/ai'

export const ShipmentDetails = lingoObject({
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 500 }),
  deliverBy: dateField({ now: new Date() }),
  carrier: 'string',
})
```

```ts
// agent.ts. The same object as an AI SDK tool schema (ai@^6/^7).
// asSchema() detects '~standard' and reads jsonSchema.input()/validate() directly.
import { tool } from 'ai'
import { ShipmentDetails } from './shipment'

const createShipment = tool({
  description: 'Create a shipment record.',
  inputSchema: ShipmentDetails,
  execute: async (input) => warehouse.create(input), // input.weight is kg, deliverBy is ISO
})
```

```tsx
// ShipmentForm.tsx. The same object as a react-hook-form resolver.
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useForm } from 'react-hook-form'
import { ShipmentDetails } from './shipment'

useForm({ resolver: standardSchemaResolver(ShipmentDetails) })
// handleSubmit(onValid) receives { weight: 18.14, deliverBy: '<ISO>', carrier: 'ups' }.
// canonical values, not the raw text a human typed or a model emitted.
```

`ShipmentDetails` is closed by default (`additionalProperties:false`), which is
exactly what makes it strict-mode-safe as a tool schema. If your form ever submits
a field the schema doesn't declare (a CSRF token, a honeypot), add
`{ passthrough: true }`. See [Forms](#3-forms-human-input) below for the full
rule. (Mechanism verified against `@ai-sdk/provider-utils@5.0.5` and
`@hookform/resolvers@5.4.0`: [`wiki/research/ecosystem-standard-schema.md`](../../../wiki/research/ecosystem-standard-schema.md).)

## 2. AI: structured output and tool calling

Every lingo field (`quantityField`, `rangeField`, `dateField`, and `lingoObject`
compositions) implements both [Standard Schema](https://standardschema.dev)
(`~standard.validate()`) and its [Standard JSON Schema](https://standardschema.dev/json-schema)
sibling (`~standard.jsonSchema.input()`/`.output()`, `@standard-schema/spec@1.1.0`).
That one fact is the whole mechanism behind every recipe below. No per-provider
adapter package, no Zod, unless a specific SDK version forces a bridge (called out
where it does). `toJSONSchema(field, opts?)` is the friendly wrapper over the
JSON Schema half for raw provider SDKs that want a plain object, not the field
itself.

Versions verified 2026-07-05. Full citations and correction notes:
[`ecosystem-ai-providers.md`](../../../wiki/research/ecosystem-ai-providers.md),
[`ecosystem-agent-frameworks.md`](../../../wiki/research/ecosystem-agent-frameworks.md),
[`ecosystem-evals.md`](../../../wiki/research/ecosystem-evals.md). `ai@7.0.15`
(v5/v6/v7 dist-tags all current) · `openai@6.45.0` · `@anthropic-ai/sdk@0.110.0` ·
`@google/genai@2.10.0` · `langchain@1.5.2` / `@langchain/core@1.2.1`. This surface
moves fast. Re-check before shipping against an older pin.

### Vercel AI SDK

**v6/v7** detect `'~standard' in schema` and call a lingo field's
`jsonSchema.input()`/`validate()` directly for any non-Zod vendor. Confirmed
byte-identical across `@ai-sdk/provider-utils@4.0.0` to `5.0.5`. `tool()`,
`Output.object()`, and `ToolLoopAgent` all take a lingo schema as-is:

```ts
import { tool, generateText, Output, ToolLoopAgent, isStepCount } from 'ai' // ^6 or ^7
import { lingoObject, quantityField, dateField } from '@pascal-app/lingo/ai'

const logWeight = tool({
  description: 'Log a package weight.',
  inputSchema: lingoObject({ weight: quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 200 }) }),
  execute: async ({ weight }) => ({ ok: true, kg: weight }),
})

const { output } = await generateText({
  model,
  tools: { logWeight },
  output: Output.object({
    schema: lingoObject({
      weight: quantityField({ kind: 'mass', unit: 'kg' }),
      loggedAt: dateField({ now: new Date() }),
    }),
  }),
  prompt: 'Log: 12 lbs at 3pm yesterday',
})
// output.weight is a kg number, output.loggedAt is an ISO string

const agent = new ToolLoopAgent({ model, tools: { logWeight }, stopWhen: isStepCount(4) })
```

**v5** has no `'~standard'` branch in `asSchema()`. Wrap with the SDK's own public
`jsonSchema()` escape hatch (a ~10-line bridge built entirely from AI SDK's own API):

```ts
import { generateObject, jsonSchema } from 'ai' // ^5
import { lingoObject, quantityField, repairTextWith, type LingoField } from '@pascal-app/lingo/ai'

function forAiSdkV5<T>(field: LingoField<T>) {
  return jsonSchema<T>(
    () => field['~standard'].jsonSchema.input({ target: 'draft-07' }),
    {
      validate: (v) => {
        const r = field['~standard'].validate(v)
        return 'value' in r
          ? { success: true, value: r.value }
          : { success: false, error: new Error(r.issues.map((i) => i.message).join('; ')) }
      },
    },
  )
}

const schema = lingoObject({ weight: quantityField({ kind: 'mass', unit: 'kg', min: 0 }) })
const { object } = await generateObject({
  model,
  schema: forAiSdkV5(schema),
  experimental_repairText: repairTextWith(schema), // still valid on v5's generateObject
  prompt: 'Log 12 lbs',
})
```

**`generateObject`/`streamObject` are deprecated** since AI SDK 6, in favor of
`generateText`/`streamText` with `output: Output.object({schema})` (also
`Output.array()`/`Output.choice()`/`Output.json()`). `experimental_repairText`,
the hook `repairTextWith()` targets, has no direct successor on that new path;
`experimental_repairToolCall` is tool-shaped instead, which is what
`repairToolCallWith()` is for:

```ts
import { quantityField, repairToolCallWith } from '@pascal-app/lingo/ai'

const repair = repairToolCallWith({
  ship: { weight: quantityField({ kind: 'mass', unit: 'kg' }) },
})
const fixed = await repair({
  toolCall: { toolCallId: 'call_1', toolName: 'ship', input: '{"weight":"2kg"}' },
  error: new Error('schema validation failed'),
})
fixed?.input // '{"weight":2}'
```

Wire `repair` in as `experimental_repairToolCall` on `generateText`, `streamText`,
or `ToolLoopAgent` (v6/v7). Same `{ toolCall, error } => Promise<ToolCallToRepair | null>`
shape either way. Repair only fixes
benign forgiveness (typos, assumed units). A genuinely ambiguous number
(`AMBIGUOUS_NUMBER`) still fails, on purpose, since there's no safe guess to repair.

**Warnings vanish on the generic path.** AI SDK's schema adapter reads only
`{success, value}`/`{success, error}` from a field's `validate()` result. Lingo's
`warnings` (typo-fixed, unit-assumed) are silently dropped once routed through the
default `tool`/`Output` plumbing. To read them, keep the wire type a plain string
and call `safeParse()` yourself:

Direct `safeParse()` failures are structured too: issues keep Standard Schema
`message`/`path`, plus lingo `code`, `severity`, field-input `span`, `data`,
`suggestions`, and did-you-mean `candidate` when available. Messages still start
with `[CODE]` for model self-repair; application code should read the fields.

```ts
import { tool } from 'ai'
import { lingoObject, quantityField } from '@pascal-app/lingo/ai'

const weight = quantityField({ kind: 'mass', unit: 'kg', min: 0 })

// Default: AI SDK validates through the field directly. Warnings never reach your code.
const logWeight = tool({
  inputSchema: lingoObject({ weight }),
  execute: async ({ weight }) => recordWeightKg(weight), // can't see TYPO_CORRECTED here
})

// To read warnings, keep the argument a raw string and safeParse it yourself
// (the model also loses the field's own natural-language description this way.
// Restate it in the tool's own `description` if that matters):
const logWeightWithWarnings = tool({
  inputSchema: lingoObject({ weight: 'string' }),
  execute: async ({ weight: raw }) => {
    const parsed = weight.safeParse(raw)
    if (!('value' in parsed)) throw new Error(parsed.issues[0].message)
    if (parsed.warnings) logSoftIssues(parsed.warnings) // e.g. TYPO_CORRECTED, UNIT_ASSUMED
    return recordWeightKg(parsed.value)
  },
})
```

### OpenAI

OpenAI has two wire shapes for "a tool". Chat Completions nests it under
`function`; the Responses API is flat. But both take the identical JSON Schema
for `parameters`. Set `strict:true` explicitly: omitting it degrades silently to
best-effort on the Responses API instead of failing loudly, and OpenAI's own docs
recommend always enabling it. **The Assistants API sunsets 2026-08-26**. Target
Chat Completions or Responses, never Assistants.

```ts
import OpenAI from 'openai'
import { lingoObject, quantityField, dateField, toJSONSchema } from '@pascal-app/lingo/ai'

const client = new OpenAI()
const CreateShipment = lingoObject({
  sku: 'string',
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0 }),
  deliverBy: dateField({ now: new Date() }),
})
const parameters = toJSONSchema(CreateShipment)

// Chat Completions. Nested `function` key
const completion = await client.chat.completions.create({
  model: 'gpt-5.5',
  messages: [{ role: 'user', content: 'Ship SKU A100, 5 kg, tomorrow.' }],
  tools: [{ type: 'function', function: {
    name: 'create_shipment', description: 'Create a shipment for one order line.',
    parameters, strict: true,
  } }],
})
const call = completion.choices[0]?.message.tool_calls?.[0]
if (call?.type === 'function' && call.function.name === 'create_shipment') {
  const result = CreateShipment.safeParse(JSON.parse(call.function.arguments))
  // 'value' in result ? result.value.weight === 5 : feed result.issues back as the tool result
}

// Responses API. Flat, no nested `function` key. Prefer this for new integrations.
await client.responses.create({
  model: 'gpt-5.5', input: 'Ship SKU A100, 5 kg, tomorrow.',
  tools: [{ type: 'function', name: 'create_shipment',
    description: 'Create a shipment for one order line.', parameters, strict: true }],
})
```

Two traps worth a review-checklist line: `lingoObject(shape, { passthrough: true })`
sets `additionalProperties: true`, which strict mode never allows on either API.
And a field's `.output()` schema (for example, `quantityField().output()`, a legal
`{type:'number', minimum, maximum}` shape) is accepted with zero complaint if
wired into `parameters` by mistake. It just quietly reverts the tool to "the
model must already know the canonical number," the exact ambiguity lingo exists
to remove. Always wire the `.input()` side (`toJSONSchema`'s default) into
`parameters`. (Verified against `openai@6.45.0`:
[`ecosystem-ai-providers.md`](../../../wiki/research/ecosystem-ai-providers.md).)

### Anthropic

`Anthropic.Tool.InputSchema` types `type` as the literal `'object'`, so lingo's
`Record<string, unknown>` return needs one cast. Safe, because `lingoObject`'s
closed default already satisfies Anthropic's [strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use)
requirement (`additionalProperties:false` + every property in `required`), the
same contract plan 020 built for OpenAI strict compatibility. The same closed
shape works for both providers' strict modes.

```ts
import Anthropic from '@anthropic-ai/sdk'
import { lingoObject, quantityField, toJSONSchema } from '@pascal-app/lingo/ai'

const logShipmentSchema = lingoObject({
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 1000 }),
  note: 'string',
})

const logShipmentTool: Anthropic.Tool = {
  name: 'log_shipment',
  description: 'Record a shipment weight and note in the warehouse log.',
  input_schema: toJSONSchema(logShipmentSchema) as Anthropic.Tool.InputSchema,
  strict: true, // safe: lingoObject's closed default already sets additionalProperties:false + full required
}

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

`ToolUseBlock.input` is typed `unknown`, so the SDK's own types force exactly the
`safeParse` step above. Lingo's `[CODE] message. Did you mean X?` string is
already the "instructive error message" Anthropic's own tool-use guidance
recommends returning as `is_error` content. (Verified against
`@anthropic-ai/sdk@0.110.0`: [`ecosystem-ai-providers.md`](../../../wiki/research/ecosystem-ai-providers.md).)

### Gemini

Three schema surfaces coexist in `@google/genai`; only two are safe for a closed
lingo schema. **Never** route a lingo field through the classic `generateContent`
`parameters`/`responseSchema` path. It either hard-errors (Python) or silently
drops `additionalProperties` (TypeScript) on a closed object, because
`additionalProperties` is only supported in Gemini's Enterprise Agent Platform
mode. Target `parametersJsonSchema`/`responseJsonSchema` instead, or the
Interactions API (general availability since 2026-06, Google's recommended
surface for new work). Both accept plain, lowercase-typed JSON Schema unmodified:

```ts
import { GoogleGenAI } from '@google/genai'
import { quantityField, toJSONSchema } from '@pascal-app/lingo/ai'

const weightField = quantityField({ kind: 'mass', unit: 'kg', min: 0 })
const ai = new GoogleGenAI({})

// generateContent. Target parametersJsonSchema, NEVER classic `parameters`
await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'Ship 5 kg tomorrow.',
  config: { tools: [{ functionDeclarations: [{
    name: 'create_shipment',
    description: 'Create a shipment record.',
    parametersJsonSchema: {
      type: 'object',
      properties: { weight: toJSONSchema(weightField) },
      required: ['weight'],
      additionalProperties: false,
    },
  }] }] },
})

// Interactions API (GA 2026-06). Flatter tool wrapper, snake_case wrapper keys,
// same JSON Schema fragment nested inside `parameters`.
await ai.interactions.create({
  model: 'gemini-3-flash-preview',
  input: 'Ship 5 kg tomorrow.',
  tools: [{ type: 'function', name: 'create_shipment', description: 'Create a shipment record.',
    parameters: { type: 'object', properties: { weight: toJSONSchema(weightField) }, required: ['weight'] } }],
})
```

Google has reshaped this surface twice in eight months. Treat any hardcoded
Gemini snippet, this one included, as due for a revisit, not a ship-and-forget
assumption. (Verified against `@google/genai@2.10.0`:
[`ecosystem-ai-providers.md`](../../../wiki/research/ecosystem-ai-providers.md).)

### Provider portability

A lingo field's input schema is always `{ type: 'string', description }`, which
is the most portable JSON Schema fragment here. `lingoObject()`'s closed shape
(`additionalProperties:false` + full `required`) is already the strict-mode
contract most OpenAI-compatible APIs expect. The same `toJSONSchema()` call drops
into six more providers unchanged:

```ts
import { toJSONSchema, lingoObject, quantityField } from '@pascal-app/lingo/ai'

const CreateShipment = lingoObject({ weight: quantityField({ kind: 'mass', unit: 'kg', min: 0 }) })
const parameters = toJSONSchema(CreateShipment)

const tools = [{ type: 'function', function: { name: 'create_shipment', description: '...', parameters } }]
```

| Provider | Client | Gotcha |
|---|---|---|
| xAI Grok | `openai` + `baseURL: 'https://api.x.ai/v1'` | first-party `xai-sdk` is alpha/unmaintained. Route through `openai` |
| Mistral | `@mistralai/mistralai` | plain-JSON-Schema `parameters`; `response_format` mirrors OpenAI strict mode |
| Cohere | `cohere-ai` `ClientV2` | v1's `parameter_definitions` is not JSON Schema. V2 only |
| Groq | `groq-sdk` | strict `response_format` is model-gated and can't combine with tool use or streaming |
| Ollama | `ollama` | structured output is local/self-hosted only. Ollama Cloud has no support |
| Hugging Face | `@huggingface/inference` | OpenAI-shaped router; enforcement depends on the routed backend engine |

(Full gotcha detail per provider: [`ecosystem-ai-providers.md`](../../../wiki/research/ecosystem-ai-providers.md).)

### LangChain

`model.withStructuredOutput(schema)` runs real validation on `ChatOpenAI` and
`ChatAnthropic` specifically. Both override the base method and call
`~standard.validate()` for real (through different parser plumbing under the
hood). A generic `BaseChatModel` subclass without a confirmed override only
consumes the JSON-Schema half and returns a bare cast. Call `safeParse()`
yourself there defensively.

```ts
import { ChatOpenAI } from '@langchain/openai'
import { lingoObject, quantityField, dateField } from '@pascal-app/lingo/ai'

const ShipmentInfo = lingoObject({
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 1000 }),
  arrivesBy: dateField({ now: new Date('2026-07-05T00:00:00Z') }),
})

const extract = new ChatOpenAI({ model: 'gpt-4o-mini' }).withStructuredOutput(ShipmentInfo)
const result = await extract.invoke('about 40 lbs, needs to land by next Friday')
// { weight: 18.14, arrivesBy: '2026-07-10T00:00:00.000Z' }. Real canonical values
```

**`createAgent` + `toolStrategy`/`providerStrategy` validate JSON *shape* only**.
They never call `~standard.validate()`, because the strategy constructor keeps
only the converted plain JSON Schema, never the original field or its `validate`
closure.
Nothing throws, so this is the easiest silent correctness bug in the whole
surface: always run `canonicalizeValues()` on `structuredResponse` yourself.

```ts
import { createAgent, toolStrategy } from 'langchain'
import { lingoObject, quantityField, canonicalizeValues } from '@pascal-app/lingo/ai'

const weight = quantityField({ kind: 'mass', unit: 'kg' })
const agent = createAgent({
  model: 'gpt-4o-mini',
  tools: [],
  responseFormat: toolStrategy(lingoObject({ weight }), { handleError: true }),
})

const { structuredResponse } = await agent.invoke({ messages: [{ role: 'user', content: "it's 40 lbs" }] })
// structuredResponse = { weight: '40 lbs' }. RAW STRING; toolStrategy only checked shape.
const { value } = canonicalizeValues(structuredResponse, { weight })
// value.weight -> 18.14
```

**LangGraph `interrupt()`** turns a lingo did-you-mean candidate into a
human-in-the-loop check. `ToolNode` always re-throws `GraphInterrupt`, so a node
can pause mid-parse instead of guessing:

```ts
import { interrupt } from '@langchain/langgraph'
import { quantityField } from '@pascal-app/lingo/ai'

const weight = quantityField({ kind: 'mass', unit: 'kg' })

function extractWeightNode(state: { rawWeight: string }) {
  const result = weight.safeParse(state.rawWeight)
  if (!('value' in result)) {
    // e.g. '[AMBIGUOUS_NUMBER] "1,234" could mean 1234 or 1.234. Assuming 1234. Did you mean 1234 kg?'
    const decision = interrupt({ question: result.issues[0].message, raw: state.rawWeight })
    return { weightKg: decision.correctedKg }
  }
  return { weightKg: result.value }
}
// Requires a checkpointer + a stable thread_id to actually resume. Resume with
// new Command({ resume: chosenValue }). Skipping the checkpointer looks correct
// in a single-turn smoke test and silently fails to resume in any real deployment.
```

(Verified against `langchain@1.5.2` / `@langchain/core@1.2.1`:
[`ecosystem-agent-frameworks.md`](../../../wiki/research/ecosystem-agent-frameworks.md).)

### MCP tools

`@pascal-app/lingo/mcp`'s `lingoTool()` builds a complete MCP tool from a
`lingoObject` shape: it emits the closed JSON Schema as `inputSchema`, and its
`callback` canonicalizes arguments with `safeParse`. It either returns the
`[CODE]`-prefixed issue messages as the tool error so the model self-corrects on
the next call, or runs your `handler` on the canonical values.

```ts
import { quantityField, dateField } from '@pascal-app/lingo/ai'
import { lingoTool } from '@pascal-app/lingo/mcp'

const createShipment = lingoTool({
  name: 'create_shipment',
  description: 'Create a shipment. Natural-language values welcome',
  input: {
    weight: quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 500 }),
    deliverBy: dateField({ min: '2026-01-01' }),
  },
  handler: ({ weight, deliverBy }) => `Shipment logged: ${weight} kg, deliver by ${deliverBy}.`,
})

// Any MCP SDK that accepts JSON Schema tool input:
server.registerTool(createShipment.name, {
  description: createShipment.description,
  inputSchema: createShipment.inputSchema,
}, createShipment.callback)
```

Under the hood that's the same hand-rolled contract. Reach for it directly when
you need custom result shaping:

The same field is a complete MCP tool contract: emit its input JSON Schema as the
tool's `inputSchema`, validate arguments with `safeParse` in the handler, and
return the `[CODE]`-prefixed issue messages as the tool error so the model
self-corrects on the next call.

```ts
import { lingoObject, quantityField, dateField, toJSONSchema } from '@pascal-app/lingo/ai'

const args = lingoObject({
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 500 }),
  deliverBy: dateField({ min: '2026-01-01' }),
})

// Any MCP SDK that accepts JSON Schema tool input:
server.registerTool('create_shipment', {
  description: 'Create a shipment. Natural-language values welcome',
  inputSchema: toJSONSchema(args),
}, async (raw) => {
  const result = args.safeParse(raw)
  if (!('value' in result)) {
    return {
      isError: true,
      content: [{ type: 'text', text: result.issues.map((i) => i.message).join('\n') }],
    }
  }
  return createShipment(result.value) // canonical kg + ISO date, bounds enforced
})
```

Closed schemas (`additionalProperties: false`) mean unexpected arguments are
rejected, and `requireNow` (on by default) means `"tomorrow"` bounces back with
the implicit-now reading attached instead of silently drifting with the server
clock across a retried call.

### Evals: quantityMatch and dateMatch

**Canonicalize both sides before you diff.** autoevals' `NumericDiff` is a plain
relative-difference score with no unit awareness: grading `5000` (g) against `5`
(kg), the same physical mass, scores **0.002**, nearly total disagreement,
verified directly against the installed `autoevals@0.3.0` package
([`ecosystem-evals.md`](../../../wiki/research/ecosystem-evals.md)). `quantityMatch`/
`dateMatch` parse both the model's answer and the fixture through the same field
first, so whatever runs downstream compares two same-unit floats instead of two
incomparable raw strings.

```ts
import { quantityMatch, dateMatch } from '@pascal-app/lingo/ai'

quantityMatch('2 lbs', '0.90718474 kg', { kind: 'mass', unit: 'kg' })
// { pass: true, score: 1, reason: 'Values match within relative tolerance 1e-9.' }

dateMatch('July 4 2026', '2026-07-04', { grain: 'day', timeZone: 'UTC' })
// { pass: true, score: 1, reason: 'Dates match at day grain.' }
```

**promptfoo**. `{ pass, score, reason }` is its `GradingResult` verbatim:

```js
// lingo-grader.js
const { quantityMatch } = require('@pascal-app/lingo/ai')

module.exports.quantityMatch = (output, context) => {
  const { kind, unit, tolerance } = context.config
  return quantityMatch(output, context.vars.expected, { kind, unit, tolerance })
}
```

```yaml
defaultTest:
  assert:
    - type: javascript
      value: file://lingo-grader.js:quantityMatch
      config: { kind: mass, unit: kg, tolerance: 0.02 }
tests:
  - vars: { expected: '2 lbs 3 oz' }
```

**autoevals / Braintrust**. Write a plain function; contextual typing against
`scores: EvalScorer<...>[]` does the work, no `Scorer` import needed:

```ts
import { Eval } from 'braintrust'
import { quantityMatch } from '@pascal-app/lingo/ai'

Eval('weight-extraction', {
  data: () => [/* ... */],
  task: callModel,
  scores: [
    ({ output, expected }) => {
      const { score } = quantityMatch(output, expected, { kind: 'mass', unit: 'kg', tolerance: 0.02 })
      return { name: 'LingoQuantityMatch', score }
    },
  ],
})
```

**Plain Vitest**. Once both sides are canonicalized, you don't need a custom
matcher at all:

```ts
import { expect, test } from 'vitest'
import { quantityField } from '@pascal-app/lingo/ai'

test('extracts the shipment weight', () => {
  const kg = quantityField({ kind: 'mass', unit: 'kg' })
  expect(kg.parse(modelOutput)).toBeCloseTo(kg.parse('2 lbs 3 oz'), 3)
})
```

### Agent workflows

**Structured extraction with an audit trail**. `output: 'quantity'` keeps the
full canonical shape (unit actually printed, approximate flag) instead of a bare
number, distinguishing a clean auto-accept from one that needs a human look:

```ts
import { quantityField } from '@pascal-app/lingo/ai'

const height = quantityField({ kind: 'length', unit: 'm', output: 'quantity' })
height.parse(`5'11"`)
// { v: 1, type: 'quantity', kind: 'length', base: 1.8034, unit: 'm' }
```

**RAG-to-structured**. Each source document may use a different unit, locale, or
date convention; batch-canonicalize before a warehouse write:

```ts
import { canonicalizeValues, quantityField, dateField } from '@pascal-app/lingo/ai'

const canonical = records.map((record) =>
  canonicalizeValues(record, {
    weight: quantityField({ kind: 'mass', unit: 'kg', output: 'quantity' }), // provenance kept
    reportedOn: dateField({ now: new Date() }),
  }),
)
const clean = canonical.filter((r) => r.issues.every((i) => i.severity !== 'error'))
await warehouse.insertMany(clean.map((r) => r.value))
```

**Computer-use and browser agents**. Fields wired with `lingoInput` already
canonicalize whatever a synthetic event types; no agent-specific code needed:

```ts
import { lingoInput } from '@pascal-app/lingo/dom'

lingoInput(document.querySelector('#height'), { kind: 'length', unit: 'm', name: 'height_m' })
// a Playwright/computer-use agent typing 5'11" -> hidden input carries "1.8034"
```

(R2/R4/R7: [`ecosystem-agent-frameworks.md`](../../../wiki/research/ecosystem-agent-frameworks.md).)

## 3. Forms: human input

Every recipe below leans on one fact: a lingo field only needs the `validate()`
half of Standard Schema to work as a form validator. No library here touches the
JSON Schema half at all. Versions verified 2026-07-05:
`react-hook-form@7.81.0` / `@hookform/resolvers@5.4.0` ·
`@tanstack/react-form@1.33.0` · `formik@2.4.9` · `vee-validate@4.15.1`
(`5.0.0-beta.1` beta) · `@angular/forms@22.0.5` · `shadcn@4.13.0`
([`ecosystem-form-libraries.md`](../../../wiki/research/ecosystem-form-libraries.md)).

> **`lingoObject` is closed by default.** Unknown keys fail validation
> (`additionalProperties:false`, a tool-boundary default from plan 020). Used as a
> whole-form resolver, either pass `lingoObject(shape, { passthrough: true })` or
> declare every field the form actually submits. Otherwise a form with one extra
> field (a CSRF token, a honeypot) fails validation on every single submit.

Per-library recipes below reuse two fields, defined once:

```ts
import { quantityField } from '@pascal-app/lingo/ai'

const heightField = quantityField({ kind: 'length', unit: 'm', min: 0.3, max: 2.5 })
const weightField = quantityField({ kind: 'mass', unit: 'kg', min: 0 })
```

### React ranked completions

Inject `completions()` into the hook and render the listbox yourself. The hook
owns only ranked-list state and selection; popup markup, option ids, styling,
and keyboard policy stay in your component:

```tsx
import { completions } from '@pascal-app/lingo/complete'
import { useLingoInput } from '@pascal-app/lingo/react'

function HeightInput() {
  const field = useLingoInput({
    kind: 'length',
    unit: 'm',
    listboxId: 'height-options',
    complete: (text) => completions(text, { kind: 'length', limit: 6 }),
  })

  return (
    <>
      <input
        ref={field.ref}
        aria-activedescendant={
          field.highlightedIndex >= 0
            ? `height-option-${field.highlightedIndex}`
            : undefined
        }
        onKeyDownCapture={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            field.setHighlightedIndex(field.highlightedIndex + 1)
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            field.setHighlightedIndex(field.highlightedIndex - 1)
          }
          if (event.key === 'Enter' && field.highlightedIndex >= 0) {
            event.preventDefault()
            event.stopPropagation()
            field.selectCompletion(field.highlightedIndex)
          }
        }}
      />
      <div id="height-options" role="listbox">
        {field.completions.map((item, index) => (
          <button
            aria-selected={index === field.highlightedIndex}
            id={`height-option-${index}`}
            key={`${item.source}-${item.text}`}
            onClick={() => field.selectCompletion(index)}
            role="option"
            type="button"
          >
            {item.text}
          </button>
        ))}
      </div>
    </>
  )
}
```

The `Completion` type is shared through the DOM layer, but the completion
engine is not: importing `./react` alone never pulls in `./complete`.
Handle Enter in React's capture phase so completion selection runs before the
controller's native Enter-to-commit listener.

### React Native `TextInput`

The native adapter owns display text and returns the four props `TextInput`
needs. It does not import React Native or emulate browser validation:

```tsx
import { Text, TextInput, View } from 'react-native'
import { useLingoTextInput } from '@pascal-app/lingo/react-native'

function PackageWeight({ onWeight }: { onWeight: (kg: number | null) => void }) {
  const field = useLingoTextInput({
    kind: 'mass',
    unit: 'kg',
    min: 0,
    max: '500 kg',
    onValueChange: onWeight,
  })

  return (
    <View>
      <TextInput
        {...field.inputProps}
        accessibilityLabel="Package weight"
        accessibilityHint="Enter a weight in kilograms or pounds"
        placeholder="165 lb or 75 kg"
      />
      {field.errorMessage ? <Text accessibilityLiveRegion="polite">{field.errorMessage}</Text> : null}
      {!field.errorMessage && field.hint ? <Text>{field.hint}</Text> : null}
    </View>
  )
}
```

`field.text` is display text; `field.value` is the canonical number in `unit`;
`field.submitValue` is the backend-ready string. Typing never rewrites text.
Blur, `onSubmitEditing`, and `commit()` apply canonical formatting. Inject
`completions()` exactly as on web and render the returned items with a
`FlatList`; the completion engine remains an explicit import.

### React Hook Form

For a whole form, `lingoObject` drops straight into the resolver:

```ts
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useForm } from 'react-hook-form'
import { lingoObject, quantityField, dateField } from '@pascal-app/lingo/ai'

const schema = lingoObject(
  { weight_kg: quantityField({ kind: 'mass', unit: 'kg', min: 0 }), visit_date: dateField({ now: new Date() }) },
  { passthrough: true }, // the form may submit fields (CSRF tokens, etc.) the schema doesn't declare
)

useForm({ resolver: standardSchemaResolver(schema) })
// handleSubmit(onValid) receives canonical numbers/ISO strings, not raw text
```

One field, independent of whatever validates the rest of the form. RHF's
resolver is a whole-form slot, so a bare `quantityField()` can't be passed as
`resolver` the way `zodResolver(z.object({...}))` might suggest:

```tsx
register('height_m', {
  validate: (v) => {
    const r = heightField.safeParse(v)
    return r.issues ? r.issues[0].message : true
  },
})
// Don't mix with a resolver on the same field. Once a resolver governs a form,
// register-level validate/required/min rules on resolver-covered fields are overridden.
```

Controlled bridge for live partial-state UX ("2 f" reads incomplete, not
invalid). Merge `useLingoInput`'s ref with `Controller`'s, and make
`onValueChange` the single write path:

```tsx
import { Controller } from 'react-hook-form'
import { useLingoInput } from '@pascal-app/lingo/react'

<Controller
  name="height_m"
  control={control}
  render={({ field }) => {
    const { ref, state } = useLingoInput({
      kind: 'length',
      unit: 'm',
      value: field.value ?? null,
      onValueChange: (v) => field.onChange(v),
    })
    return (
      <input
        ref={(el) => { ref(el); field.ref(el) }}
        onBlur={field.onBlur}
        data-state={state}
        placeholder={`5'11" or 180cm`}
      />
    )
  }}
/>
```

Seed `defaultValues: { height_m: null }`, not `''`. `useLingoInput`'s controlled
`value` is `number | null`. Never let both `lingoInput`'s own DOM writes and
`Controller` mutate the input independently.

### shadcn/ui

`ui.shadcn.com/docs/forms` teaches `Field`/`FieldLabel`/`FieldDescription`/
`FieldError` composed with whichever form library owns state. `FieldError` is
Standard-Schema-agnostic. It reads `error?.message` with no RHF- or Zod-specific
branching, so a lingo field's failure issues satisfy it with zero adapter code:

```tsx
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Controller, useForm } from 'react-hook-form'
import { lingoObject, quantityField } from '@pascal-app/lingo/ai'
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

const schema = lingoObject({ height: quantityField({ kind: 'length', unit: 'm', min: 0.3, max: 2.5 }) })

const form = useForm<{ height: string }, unknown, { height: number }>({
  resolver: standardSchemaResolver(schema),
  defaultValues: { height: '' },
})

<form onSubmit={form.handleSubmit((data) => { /* data.height === 1.8034 */ })}>
  <Controller
    name="height"
    control={form.control}
    render={({ field, fieldState }) => (
      <Field data-invalid={fieldState.invalid}>
        <FieldLabel htmlFor={field.name}>Height</FieldLabel>
        <Input {...field} id={field.name} aria-invalid={fieldState.invalid}
               placeholder={`5'11" or 180cm`} autoComplete="off" />
        <FieldDescription>Any format: imperial or metric.</FieldDescription>
        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
      </Field>
    )}
  />
</form>
```

The only lingo-specific line is `resolver`. The legacy `Form`/`FormField`
registry item (still shipped, not removed) takes the same `resolver`. Swap
`Controller` for `FormField` and the rest matches shadcn's standard React Hook
Form guide.

### TanStack Form

Pass a lingo field straight through as a validator. `standardSchemaValidator.ts`
calls `schema['~standard'].validate(value)` with zero vendor branching:

```tsx
<form.Field name="height_m" validators={{ onChange: heightField }}>
  {(field) => <input value={field.state.value ?? ''} onChange={(e) => field.handleChange(Number(e.target.value))} />}
</form.Field>
```

**"The value passed to `onSubmit` will always be the input data"** (TanStack Form
docs). Wired only as `validators.onChange`, this validates correctly but submits
the *raw string*, not the canonical number. Fix it by funneling
`useLingoInput`'s `onValueChange` into `field.handleChange`, so the value in form
state is already canonical and the documented limitation never bites:

```tsx
import { useLingoInput } from '@pascal-app/lingo/react'

<form.Field name="height_m">
  {(field) => {
    const { ref, state } = useLingoInput({
      kind: 'length',
      unit: 'm',
      onValueChange: (v) => field.handleChange(v),
    })
    return <input ref={ref} data-state={state} onBlur={field.handleBlur} />
  }}
</form.Field>
```

### Formik

No Standard Schema hook exists, and none is coming. Formik ships Yup-shaped
`validationSchema`, and the maintainer has said publicly he hasn't maintained it
since 2020. Any integration here is permanently a manual `validate` prop:

```tsx
import { Field } from 'formik'

<Field name="height_m" validate={(v) => heightField.safeParse(v).issues?.[0]?.message} />
```

Controlled bridge via `setFieldValue`:

```tsx
import { useFormikContext } from 'formik'
import { useLingoInput } from '@pascal-app/lingo/react'

const { values, setFieldValue } = useFormikContext<{ height_m: number | null }>()
const { ref } = useLingoInput({
  kind: 'length',
  unit: 'm',
  value: values.height_m,
  onValueChange: (v) => setFieldValue('height_m', v),
})
```

### Vue and vee-validate

v4 (stable, production-safe today) has no `StandardSchemaV1` member in its
published types. Wrap manually:

```ts
import { useField } from 'vee-validate'

useField('height_m', (v) => {
  const r = heightField.safeParse(v)
  return r.issues ? r.issues[0].message : true // GenericValidateFunction: true | string
})
```

v5 (`5.0.0-beta.1`, beta since 2025-08-02, no announced stable date) imports
`StandardSchemaV1` directly. Drop-in once it stabilizes, not the default
recommendation yet:

```ts
import { useField, useForm } from 'vee-validate'
import { lingoObject } from '@pascal-app/lingo/ai'

useField('height_m', heightField)
// or
useForm({ validationSchema: lingoObject({ height_m: heightField, weight_kg: weightField }) })
```

Vue has no React-style hooks, so the controlled bridge goes through the DOM
controller against a template ref instead:

```ts
import { lingoInput } from '@pascal-app/lingo/dom'

lingoInput(el, {
  kind: 'length',
  unit: 'm',
  onCommit: (f) => { value.value = f.value },
})
```

### Angular

Signal Forms (stable since v22, 2026-06-03). `validateStandardSchema` accepts a
nested field path as well as the form root:

```ts
import { signal } from '@angular/core'
import { form, validateStandardSchema } from '@angular/forms/signals'

const patientForm = form(signal({ height_m: null as number | null }), (schemaPath) => {
  validateStandardSchema(schemaPath.height_m, heightField)
})
```

Classic Reactive Forms still cover most production Angular code, since Signal
Forms only went stable a month before this doc. Reactive Forms have no Standard
Schema adapter at all;
wrap a `ValidatorFn`:

```ts
import type { ValidatorFn } from '@angular/forms'

const lingoValidator: ValidatorFn = (control) => {
  const r = heightField.safeParse(control.value)
  return r.issues ? { lingo: r.issues[0].message } : null
}
```

Ship both recipes together, because a guide that only shows `validateStandardSchema` is
inapplicable to most Angular codebases shipping today.

### Vanilla HTML

`lingoInput()` layers onto the platform's own Constraint Validation rather than
replacing it. Pair `validationBehavior: 'aria'` with `<form novalidate>` if you
want only lingo's own error text. The browser's own pre-submit validation pass
still fires on `customError` inside a real `<form>` otherwise, even in `'aria'`
mode. The underlying element must be `type="text"` (or unset): `type="number"`'s
value-sanitization blanks any non-numeric keystroke before lingo's handler ever
runs, so `"5'11\""` never reaches the parser.

```html
<form method="post" action="/signup" novalidate>
  <label for="height">Height</label>
  <input id="height" name="height" inputmode="text" placeholder="5'11&quot; or 180cm" required>
  <p id="height-error" role="alert"></p>
  <p id="height-hint" aria-hidden="true"></p>
  <button>Continue</button>
</form>
<script type="module">
  import { lingoInput } from '@pascal-app/lingo/dom'
  lingoInput(document.querySelector('#height'), {
    kind: 'length', unit: 'm', name: 'height', min: '0.3m', max: '2.5m', required: true,
    validationBehavior: 'aria',
    errorElement: '#height-error', hintElement: '#height-hint',
  })
</script>
```

No-JS tier: the form posts `height=5'11"` (raw text) under the field's own name.
JS tier: `lingoInput` strips `name` off the visible input and moves it to a
synthesized hidden input carrying the canonical decimal, so the server always
reads one key (`height`) whose *shape* depends on whether JS ran. Re-parse
server-side regardless (see [Server-side validation](#server-side-validation)).

### The `<lingo-input>` web component

`@pascal-app/lingo/element` ships a form-associated custom element. Call
`defineLingoInput()` once, then use `<lingo-input>` anywhere: Vue, Svelte,
Angular, or plain HTML, with no framework adapter. It owns a light-DOM
`<input type="text">` (so native labels and CSS keep working) and submits the
canonical number as its own form value via `ElementInternals`.

```ts
import { defineLingoInput } from '@pascal-app/lingo/element'

defineLingoInput() // registers <lingo-input>; no-op if already defined, and import-safe under SSR
```

```html
<form>
  <label for="height">Height</label>
  <lingo-input id="height" name="height_m" kind="length" unit="m"></lingo-input>
</form>
<!-- after the user commits 5'11", the form submits height_m=1.8034 -->
```

`<lingo-input>` reads `kind`/`unit`/`min`/`max`/`system`/`strictness`/`display`/
`required`/`inputmode`/`placeholder` from attributes, mirrors validity + value
through `ElementInternals.setFormValue`/`setValidity`, and exposes `.field` and
`.value`. It creates its own light-DOM `<input>` if you don't provide one.

## 4. Drop the unit dropdown

**The scoped claim**: lingo collapses one value-plus-unit-dropdown pair into one
text field. That's the case the evidence favors. Baymard's checkout research
puts the average form at 14.88 fields (7 or fewer in fully optimized flows, correlated
with +25 to 35% conversion), and GoodUI's "Fewer Form Fields" pattern is broadly
positive across 13 A/B tests. GoodUI's "Natural Language Forms" pattern is
genuinely mixed by comparison. Several +12 to 40% wins, but Kalzumeus's **-22%**
and an Airbnb host-signup variant the company tested and rejected. Every win
above replaces a **short, simple** input; every loss replaces a **long,
complex** form or surprises a user expecting a familiar control. Say "replaces
one value + unit pair". Never "replace your whole form with a sentence."
([`wiki/research/form-ux-and-database.md`](../../../wiki/research/form-ux-and-database.md), §1;
[baymard.com/research/checkout-usability](https://baymard.com/research/checkout-usability);
[goodui.org/patterns/8](https://goodui.org/patterns/8/))

| # | Vertical | Before | After | Error prevented |
|---|---|---|---|---|
| 1 | Health intake | `Height ft[__] in[__]` + `Weight [__] (lb▾/kg▾)` | Two fields taking `5'11"` / `180cm`, `165 lb` / `75 kg` | BMI-invalidating mass-unit mix-ups |
| 2 | Medication dosing | Dose amount + unit ▾ (mL/mg/tsp) | `quantityField({ kind: 'volume', unit: 'mL', max })` parsing "1.5 teaspoons" | ISMP/FDA-documented 3-5x tsp/tbsp-vs-mL dose errors |
| 3 | Shipping dimensions | 4 dims × unit ▾ = 8 controls | 4 `lingoInput` fields (length, mass) taking "12in" / "30cm" / "2.5kg" | Dimension/weight-mismatch fee disputes from a silently-wrong-unit picker |
| 4 | IoT / smart-home | `Set to [__] (C▾/F▾)` per rule | One `lingoInput({ kind: 'temperature', unit: 'C' })` taking "68F" / "20C" / "warm" | Cross-account C/F automation mismatch bugs |
| 5 | Cooking / recipes | Per-ingredient amount + unit ▾ (cup/g/oz) | One `lingoInput` per row (volume, mass) | Silent unit-mismatch entry (cup-to-gram density conversion is out of scope, below) |
| 6 | E-commerce listings | Weight (lb▾/kg▾) + Dims (in▾/cm▾) | Per-field `lingoInput` canonicalizing to the marketplace's storage unit | Cross-catalog inconsistency from mixed default-unit assumptions |
| 7 | Lab / construction | Qty + unit ▾ (mm/cm/m, mL/L/g/kg) per BOM line | One `lingoInput` accepting what's printed on the spec sheet | Mixed-unit-standard BOM math errors |
| 8 | Finance | Rate `[__]` + mode toggle `(%▾/bps▾)` | `lingoInput({ kind: 'percent', unit: '%' })` taking "25 bps" / "0.25%" / "a quarter point" | 100x order-of-magnitude slip from a mis-set %/bps toggle |

The live `/docs#forms-ux` gallery turns that table into editable before/after
forms for finance, recipes, engineering, fitness, and medical intake. The
finance card uses built-in currency, while the engineering card deliberately uses
custom force and torque kinds via `createLingo({ kinds: [...allKinds, customKind] })`:
lingo handles the parser and canonical value; your app still owns live FX policy
and any domain-specific dimensional model.

Unit confusion isn't a hypothetical UX nitpick; it has taken down a spacecraft
and forced a jetliner into a dead-stick glide:

- **Mars Climate Orbiter** (1999): ground software computed thruster impulse in
  pound-force-seconds; JPL's navigation software consumed the same file assuming
  newton-seconds. The resulting 4.45x trajectory error put the spacecraft's first
  periapsis at ~57 km against an 80 km survivable minimum. It was lost on entry.
  (The often-cited $327M figure is NASA's combined accounting for this mission
  *and* Mars Polar Lander, not this mission alone.)
  [Wikipedia](https://en.wikipedia.org/wiki/Mars_Climate_Orbiter)
- **Gimli Glider** (Air Canada Flight 143, 1983): a fuel calculation used a
  specific gravity of 1.77. Correct for pounds per liter, not the kilograms per
  liter the airline's first all-metric 767 required. Loading 45% of the fuel
  actually needed and forcing both engines to flame out at 41,000 ft. The Board
  of Inquiry found it a joint flight-crew-and-ground-crew error, not a
  ground-crew-only mistake. [Wikipedia](https://en.wikipedia.org/wiki/Gimli_Glider)
- **Insulin units vs. ML**: ISMP documents a recurring harm class from measuring
  an insulin dose (in *units*) on a standard mL syringe, including a fatal case
  (50 units given instead of 5). U-500 insulin's fivefold-concentration variant
  is separately flagged by the Pennsylvania Patient Safety Authority as still
  producing 5x dosing errors as of 2025. (ISMP Medication Safety Alert, Acute
  Care, Vol. 23 Issue 3, 2018-02-08; PA-PSRS, *Patient Safety* 2025;7(2):144287.)

Full citations, sourcing corrections, and the eight-row attribution notes:
[`wiki/research/form-ux-and-database.md`](../../../wiki/research/form-ux-and-database.md), §2, §4.

## 5. Database input

Two stages, not one column-level validator. Lingo canonicalizes natural-language
input to a canonical numeric value at the API/tool boundary; the database stores
one plain numeric column in that canonical unit; a row-shape validator
(drizzle-zod) checks the row shape only and never sees natural language.

```ts
// db/schema.ts. One column, one unit, no ambiguity
import { pgTable, uuid, doublePrecision, text, timestamp } from 'drizzle-orm/pg-core'

export const shipments = pgTable('shipments', {
  id: uuid().defaultRandom().primaryKey(),
  weightKg: doublePrecision('weight_kg').notNull(), // lingo's mass base unit. Always kg
  weightRaw: text('weight_raw').notNull(),           // exact text sent, for audit + redisplay
  createdAt: timestamp().defaultNow().notNull(),
})
```

```ts
// write path. Lingo canonicalizes at the API boundary; Drizzle/zod only check row shape
import { quantityField } from '@pascal-app/lingo/ai'
import { createInsertSchema } from 'drizzle-zod'

const weightField = quantityField({ kind: 'mass', unit: 'kg', min: 0, output: 'quantity' })
const insertShape = createInsertSchema(shipments)

export async function createShipment(weightText: string) {
  const parsed = weightField.safeParse(weightText) // "2500 lb" -> { value: { base: 1133.98, unit: 'kg', ... } }
  if (parsed.issues) throw new Error(parsed.issues[0].message)
  await db.insert(shipments).values(insertShape.parse({ weightKg: parsed.value.base, weightRaw: weightText }))
}
```

```ts
// read path. Format() re-renders the one stored number in any unit, two-way guaranteed
import { eq } from 'drizzle-orm'
import { quantity } from '@pascal-app/lingo'

const row = await db.query.shipments.findFirst({ where: eq(shipments.id, id) })
quantity(row.weightKg, 'kg').format({ unit: 'lb', significant: 4 }) // "5,512 lb"
```

Don't drop a `LingoField` into a `drizzle-zod` column override.
`createInsertSchema(table, { col: override })` expects an actual Zod schema (or a
callback over one), not a generic Standard Schema object; a `LingoField` is a
Standard Schema but not a `ZodType`. Generic column-level Standard Schema support
is an open, unshipped Drizzle feature request
([drizzle-orm#5167](https://github.com/drizzle-team/drizzle-orm/issues/5167)).
The two-stage boundary above is the portable answer today, not a column adapter.
([`wiki/research/form-ux-and-database.md`](../../../wiki/research/form-ux-and-database.md), §6.)

## 6. Field shapes

These plain core-API recipes do not use `/ai` or a form library. They cover the
field shapes that come up often enough to be worth naming.

### Height field (feet/inches to meters)

A height field should accept `5'11"`, `180cm`, and `1.8m`, then hand your
backend a single number in meters.

```ts
import { parseQuantity } from '@pascal-app/lingo'

function heightMeters(input: string): number | null {
  const r = parseQuantity(input, { kind: 'length', strictness: 'confirm' })
  return r.ok ? r.quantity.to('m').value : null
}

heightMeters(`5'11"`) // 1.8034
heightMeters('180cm') // 1.8
heightMeters('tall')  // null
```

### Recipe-ingredient field (mass or volume)

Ingredient fields take either a mass (`"200 g"`) or a volume (`"2 cups"`). Don't
force a `kind`. Parse freely and read the kind back off the result.

```ts
import { lingo } from '@pascal-app/lingo'

function parseIngredient(input: string) {
  const r = lingo(input)
  if (!r.ok || r.type !== 'quantity' || (r.quantity.kind !== 'mass' && r.quantity.kind !== 'volume')) {
    return { error: `"${input}" isn't a mass or volume, e.g. "200 g" or "2 cups"` }
  }
  return { kind: r.quantity.kind, base: r.quantity.base } // kg or m³, SI-anchored
}

parseIngredient('2 cups') // { kind: 'volume', base: 0.000473176473 }
parseIngredient('200 g')  // { kind: 'mass', base: 0.2 }
```

### Shipment weight (strict, ranges rejected)

Shipping needs one exact weight, not `"20-25 kg"`. Reject ranges outright, but
keep the reading around as a `candidate` so the UI can offer a did-you-mean.

```ts
import { lingo } from '@pascal-app/lingo'

const shipmentOpts = { kind: 'mass', strictness: 'strict', accept: { ranges: false } } as const

lingo('20 kg', shipmentOpts)
// { ok: true, type: 'quantity', quantity: 20 kg }

lingo('20-25 kg', shipmentOpts)
// { ok: false, issues: [{ code: 'SINGLE_VALUE_EXPECTED', ... }],
//   candidate: { type: 'range', range: 20-25 kg } }
```

### Fuzzy temperature field

Weather copy talks in words, not degrees. Parse the vocabulary band, then read it
back in whatever unit you display.

```ts
import { lingo } from '@pascal-app/lingo'

const r = lingo("it's hot", { kind: 'temperature', profile: 'weather' })
if (r.ok && r.type === 'range') {
  r.range.fuzzy                 // { term: 'hot', profile: 'weather' }
  r.range.min()!.to('F').value  // 80.6
  r.range.max()!.to('F').value  // 95
}
```

### Strict scientific field

A scientific field wants exact numbers: no typo autocorrect, no ranges, no fuzzy
words, no "about". `strictness: 'strict'` plus turning off `ranges`/`fuzzy` gets
you there. Rejections of parseable shapes (ranges, approximations) still carry a
`candidate` for a confirm-to-use UI, but an unknown unit under strict does not:
typo fixing is off, so there's nothing to offer.

```ts
import { lingo } from '@pascal-app/lingo'

const strictLength = { kind: 'length', strictness: 'strict', accept: { ranges: false, fuzzy: false } } as const

lingo('5 m', strictLength)        // ok: true. Exact input passes untouched
lingo('5 meterz', strictLength)   // ok: false, UNKNOWN_UNIT. No silent fix, no candidate
lingo('about 5 m', strictLength)  // ok: false, APPROX_NOT_ALLOWED, candidate: 5 m (approximate)
```

### Server-side validation

The same `parseQuantity` call validates on the server. Never trust a
client-side parse alone. A Next.js Server Action and a plain Node request
handler look the same.

```ts
// app/actions.ts
'use server'
import { parseQuantity } from '@pascal-app/lingo'

export async function submitHeight(formData: FormData) {
  const r = parseQuantity(String(formData.get('height')), { kind: 'length', strictness: 'confirm' })
  if (!r.ok) return { error: r.issues[0]?.message ?? 'Invalid height' }
  return { meters: r.quantity.to('m').value }
}
```

```ts
// Any Node framework (Express, Fastify, http). Same validation, no framework glue
import { parseQuantity } from '@pascal-app/lingo'
import type { ServerResponse } from 'node:http'

export function heightHandler(body: { height: string }, res: ServerResponse) {
  const r = parseQuantity(body.height, { kind: 'length', strictness: 'confirm' })
  if (!r.ok) {
    res.writeHead(400, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ error: r.issues[0]?.message }))
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ meters: r.quantity.to('m').value }))
}
```
