export const parseSnippet = `import { lingo, parseQuantity, parseRange } from "@pascal-app/lingo"

const height = parseQuantity("5'11\\"", { kind: "length" })
if (height.ok) {
  height.quantity.to("m").value
  height.quantity.format({ compound: ["ft", "in"] })
}

const any = lingo("72 in to cm")
const range = parseRange("between 5 and 10 kg", { kind: "mass" })`

export const completionsSnippet = `import { completions } from "@pascal-app/lingo/complete"
import { parseDate, parseDateRange } from "@pascal-app/lingo/date"
import { lingoInput } from "@pascal-app/lingo/dom"
import { useLingoInput } from "@pascal-app/lingo/react"

// Debounce in your UI (~120–150ms) — completions() re-parses on every call
const items = completions("10 kg to 16", { kind: "mass", limit: 8 })
// range tails fan out: 10–16 kg, 10–16 lb, …

completions("10", { units: ["kg", "lb", "m", "ft"] }) // optimistic without kind

// Inject the date engine (kept out of ./complete for size) — covers
// "noon tomorrow", "next month", and "3 days starting tomorrow"
const withDates = completions("noon tomorrow", {
  date: (text) => {
    const now = new Date()
    const single = parseDate(text, { now })
    return single.ok ? single : parseDateRange(text, { now })
  },
})

lingoInput(input, {
  kind: "mass",
  complete: (text) => completions(text, { kind: "mass", limit: 8 }),
  onComplete: (list) => renderGroupedDropdown(list),
})

// React exposes the same injected list plus headless highlight/selection state
const field = useLingoInput({
  kind: "mass",
  listboxId: "mass-options",
  complete: (text) => completions(text, { kind: "mass", limit: 8 }),
})
field.completions
field.setHighlightedIndex(1)
field.selectCompletion()`

export const strictnessSnippet = `import { lingo } from "@pascal-app/lingo"

const result = lingo("5 meterz", {
  kind: "length",
  strictness: "confirm",
})

if (!result.ok && result.candidate?.type === "quantity") {
  result.candidate.quantity.format()
}`

export const formSnippet = `import { lingoInput } from "@pascal-app/lingo/dom"

const field = lingoInput(document.querySelector("#height"), {
  kind: "length",
  unit: "m",
  name: "height_m",
  errorElement: "#height-error",
  hintElement: "#height-hint",
})

field.set("6ft")
field.commit()`

export const reactSnippet = `import { useLingoInput } from "@pascal-app/lingo/react"

function HeightField() {
  const field = useLingoInput({
    kind: "length",
    unit: "m",
    name: "height_m",
  })

  return <input ref={field.ref} placeholder="5'11\\" or 180cm" />
}`

export const reactNativeSnippet = `import { Text, TextInput, View } from "react-native"
import { useLingoTextInput } from "@pascal-app/lingo/react-native"

function WeightField() {
  const field = useLingoTextInput({
    kind: "mass",
    unit: "kg",
    min: 0,
    max: "500 kg",
  })

  return (
    <View>
      <TextInput {...field.inputProps} placeholder="165 lb or 75 kg" />
      {field.errorMessage ? <Text>{field.errorMessage}</Text> : null}
    </View>
  )
}`

export const findSnippet = `import { findQuantities } from "@pascal-app/lingo"

const found = findQuantities("ship 2 boxes at 5 kg each by friday")
// [{ result, span: { start, end } }, ...] — offsets into the original text
for (const { result, span } of found) {
  if (result.type === "quantity") highlight(span, result.quantity)
}`

export const convertSnippet = `import { convert, convertDelta, tryConvert, quantity } from "@pascal-app/lingo"

convert(72, "in", "ft")            // 6            (exact legal factors)
convert(1, "gal", "L")             // 3.785411784
convertDelta(5, "C", "F")          // 9            (a difference, not 41)

const targetUnit: string = "cm"    // a dynamic ref (the escape hatch)
tryConvert(5, "kg", targetUnit)    // { ok: false, issues } instead of throwing

quantity(1500, "m").toBest().format()                    // "1.5 km"
quantity(1.8034, "m").format({ compound: ["ft", "in"] }) // "5′11″"
quantity(2, "ft").format({ style: "long" })              // "2 feet"`

export const currencySnippet = `import { lingo, quantity, fromMinor, convertCurrency } from "@pascal-app/lingo"

lingo("$5", { currency: "CAD" }).quantity.unit   // "CAD"
lingo("3 quid 50").quantity.value                 // 3.5   (GBP)
quantity(5, "USD").format()                       // "$5.00"
quantity(5, "USD").toMinor()                      // 500   (Stripe minor units)
fromMinor(500, "USD").value                       // 5

// Convert with YOUR rates — lingo never bundles or fetches FX.
convertCurrency(100, "USD", "EUR", {
  rates: { base: "USD", rates: { EUR: 0.92 } },
})                                                // 92`

export const datesSnippet = `import {
  parseDate,
  parseDateRange,
  humanizeDate,
  humanizeDateRange,
  parseDuration,
  humanizeDuration,
} from "@pascal-app/lingo/date"

parseDate("three days ago", { now }).date       // exact Date, grain "day"
parseDate("17h30", { now })                      // 17:30 today (grain "minute")
parseDate("quarter past 5", { now })             // 05:15
humanizeDate(d, { now })                         // "3 days ago" — re-parseable

// Timezones: exposed by default; opt in to resolve the instant
parseDate("3pm EST", { now }).zone               // { source: "abbrev", offsetMinutes: -300 }
parseDate("3pm EST", { now, applyZone: true })   // the real UTC instant, not host-local

// Time slots, two-way
const slot = parseDateRange("2pm to 4pm", { now }) // { start, end } endpoints
parseDateRange("9-5", { now })                   // workday shift → 09:00–17:00
humanizeDateRange(slot)                          // "2:00 PM to 4:00 PM"

// Calendar ranges: dated spans and whole periods, first day to last
parseDateRange("Aug 3 - Aug 9", { now })         // dated span, grain "day"
parseDateRange("August", { now })                // Aug 1 → Aug 31, not just the 1st

parseDuration("1h30").duration.base              // 5400 (seconds)
humanizeDuration(5400, { style: "natural" })     // "an hour and a half"`

export const localeSnippet = `import { createLingo } from "@pascal-app/lingo"
import { es } from "@pascal-app/lingo/locales/es"
import { fr } from "@pascal-app/lingo/locales/fr"
import { ja } from "@pascal-app/lingo/locales/ja"
import { zh } from "@pascal-app/lingo/locales/zh"

const lingo = createLingo({ locales: [es, fr, ja, zh] })

lingo.parseQuantity("dos kg")                    // auto-detected as es
lingo.parseRange("entre 5 et 10 kg", { locale: "fr" })
lingo.parseQuantity("5公斤", { locale: "zh" })
lingo.parseQuantity("mille cinq cents metres", { locale: "fr" })  // 1500 m

// Comparators that follow the quantity, as CJK writes them.
lingo.parseRange("5キロ未満", { locale: "ja" })    // < 5 kg
lingo.parseRange("5公斤以上", { locale: "zh" })    // >= 5 kg

// Success results expose the resolved profile.
lingo.parse("dos kg").locale                      // "es"`

export const extendSnippet = `import { registerUnits, defineFuzzyVocab, createLingo } from "@pascal-app/lingo"

registerUnits("length", [
  { id: "smoot", symbol: "smoot", name: "smoot", factor: 1.702, system: "us" },
])

defineFuzzyVocab("mass", {
  profile: "parcels",
  unit: "kg",
  terms: { light: [0, 5], heavy: [20, 70] },
})

// Isolated instance for SSR / multi-tenant / tests — no global leaks.
const tenant = createLingo({ messages: { UNKNOWN_UNIT: "Metric units only." } })
tenant.parse("5 kg")`

export const describeSnippet = `import { lingo } from "@pascal-app/lingo"
import { describeResult } from "@pascal-app/lingo/describe"

describeResult(lingo("72 in to cm")).data
// {
//   object: "lingo.conversion",
//   source: { object: "lingo.quantity", value: { amount: 72, unit: { id: "in", ... } } },
//   target: { unit: { id: "cm", name: "centimeter" } },
//   converted: { object: "lingo.quantity", value: { amount: 182.88, unit: { id: "cm", ... } } },
// }
// Keep toJSON() for compact wire storage; describe* is the readable view.`

export const typeSafetySnippet = `import { convert, quantity } from "@pascal-app/lingo"

convert(5, "in", "cm")    // ✅ number
quantity(5, "kg")         // ✅ Quantity<"mass"> — kind inferred from the unit

// @ts-expect-error 'kg' is mass, 'cm' is length — caught before you run
convert(5, "kg", "cm")
// @ts-expect-error 'nope' isn't a unit
quantity(5, "nope")

const u: string = userInput
quantity(5, u)            // ✅ dynamic strings still compile (validated at runtime)`

export const schemaTabs = [
  {
    value: 'result',
    label: 'Result',
    lang: 'ts',
    filename: 'result.ts',
    code: `// lingo() / parse*() return a discriminated union on \`type\`, serialized
// flat (v3). JSON.stringify(result) or result.toJSON() emits this shape.

interface Result {              // success — ok: true
  schemaVersion: 3
  ok: true
  type: "quantity" | "range" | "conversion" | "number"
  text: string                 // the original input
  span: Span                   // the slice the parse consumed
  confidence: number           // 0 to 1
  issues: Issue[]              // warnings and infos ride along on success
  // ...plus the value fields for its \`type\` (see the Quantity / Range tabs)
}

interface Failure {            // ok: false
  schemaVersion: 3
  ok: false
  type: "failure"
  text: string
  issues: Issue[]              // at least one has severity: "error"
  candidate?: Result           // "what it would have been", when recoverable
}`,
  },
  {
    value: 'quantity',
    label: 'Quantity',
    lang: 'ts',
    filename: 'quantity.ts',
    code: `// One value in one unit, stored canonically as \`base\`. Quantity.toJSON():
interface QuantityJSON {
  schemaVersion: 3
  type: "quantity"
  kind: Kind                   // "length" | "mass" | "currency" | ...
  value: number                // amount in \`unit\` (the 72 in "72 in")
  unit: string                 // "in"
  base: number                 // canonical amount (1.8288) — the source of truth
  baseUnit: string             // the kind's SI-anchored base ("m")
  parts?: { value: number; unit: string }[]   // compound input: "5 ft 11 in"
  approximate?: boolean        // "about 5 kg"
}`,
  },
  {
    value: 'range',
    label: 'Range',
    lang: 'ts',
    filename: 'range.ts',
    code: `// A min/max, plus-or-minus, or fuzzy range. QuantityRange.toJSON():
interface QuantityRangeJSON {
  schemaVersion: 3
  type: "range"
  kind: Kind
  baseUnit: string
  min?: { value: number; unit: string; base: number; exclusive?: boolean }
  max?: { value: number; unit: string; base: number; exclusive?: boolean }
  plusMinus?: {                // "10 ± 0.5 mm"
    center: { value: number; unit: string; base: number }
    delta: { value: number; unit: string; base: number }
  }
  fuzzy?: { term: string; profile: string }   // { term: "hot", profile: "weather" }
  approximate?: boolean        // "a few minutes"
}`,
  },
  {
    value: 'issue',
    label: 'Issue & span',
    lang: 'ts',
    filename: 'issue.ts',
    code: `// The one error / warning / info shape on every result's issues[].
interface Issue {
  code: IssueCode              // stable SCREAMING_SNAKE, e.g. "UNKNOWN_UNIT"
  severity: "error" | "warning" | "info"
  message: string              // human copy — override with the \`messages\` option
  span?: Span                  // where in the input; absent for /ai bound issues
  suggestions?: string[]       // did-you-mean, most likely first (max 3)
  data?: object                // code-specific payload, typed via IssueDataMap
}

// A half-open [start, end) character range into the ORIGINAL input string.
interface Span {
  start: number
  end: number
  text: string                 // input.slice(start, end) — reads for itself
}`,
  },
] as const

export const aiSnippets = [
  {
    value: 'ai-sdk',
    label: 'AI SDK',
    lang: 'ts',
    filename: 'extract-shipment.ts',
    code: `import { generateText, Output, tool } from "ai" // ai@^6 or ai@^7
import {
  dateField,
  lingoObject,
  optional,
  quantityField,
  rangeField,
} from "@pascal-app/lingo/ai"

const schema = lingoObject({
  weight: quantityField({ kind: "mass", unit: "kg", min: 0, max: 500 }),
  height: quantityField({ kind: "length", unit: "m" }),
  deliverBy: dateField({ now }),
  boxWeight: rangeField({ kind: "mass", unit: "kg" }),
  tareWeight: optional(quantityField({ kind: "mass", unit: "kg", min: 0 })),
  carrier: "string",
})

const createShipment = tool({
  description: "Create a shipment record.",
  inputSchema: schema,
  execute: async (input) => warehouse.create(input),
})

const { output } = await generateText({
  model,
  tools: { createShipment },
  output: Output.object({ schema }),
  prompt: "Extract shipment details from this note.",
})
// output.weight is kg, deliverBy is ISO, tareWeight is number | null.
// AI SDK v5 needs the SDK's jsonSchema() wrapper around this schema.`,
  },
  {
    value: 'repair',
    label: 'Repair',
    lang: 'ts',
    filename: 'repair-tool-call.ts',
    code: `import { generateText, tool } from "ai"
import {
  lingoObject,
  quantityField,
  repairToolCallWith,
} from "@pascal-app/lingo/ai"

const shipSchema = lingoObject({
  weight: quantityField({ kind: "mass", unit: "kg", min: 0 }),
})
const repairToolCall = repairToolCallWith({ ship: shipSchema })

await generateText({
  model,
  tools: {
    ship: tool({
      description: "Create a shipment.",
      inputSchema: shipSchema,
      execute: async ({ weight }) => ({ ok: true, kg: weight }),
    }),
  },
  prompt,
  experimental_repairToolCall: repairToolCall,
})
// experimental_repairText is the deprecated v5 generateObject path.`,
  },
  {
    value: 'tool-call',
    label: 'Tool call',
    lang: 'ts',
    filename: 'execute-tool.ts',
    code: `import {
  canonicalizeValues,
  dateField,
  quantityField,
  rangeField,
} from "@pascal-app/lingo/ai"

const repaired = canonicalizeValues(toolCall.args, {
  weight: quantityField({ kind: "mass", unit: "kg" }),
  height: quantityField({ kind: "length", unit: "m" }),
  deliverBy: dateField({ now }),
  boxWeight: rangeField({ kind: "mass", unit: "kg" }),
})

// severity: "error" blocked the path; warnings rode along on applied values.
const errors = repaired.issues.filter((issue) => issue.severity === "error")
if (errors.length > 0) {
  return { ok: false, issues: errors }
}

return createShipment(repaired.value)`,
  },
  {
    value: 'mcp',
    label: 'MCP',
    lang: 'ts',
    filename: 'mcp-tool.ts',
    code: `import { dateField, quantityField } from "@pascal-app/lingo/ai"
import { lingoTool } from "@pascal-app/lingo/mcp"

const createShipment = lingoTool({
  name: "create_shipment",
  description: "Create a shipment; natural-language values welcome.",
  input: {
    weight: quantityField({ kind: "mass", unit: "kg", min: 0, max: 500 }),
    deliverBy: dateField({ min: "2026-01-01" }),
  },
  handler: ({ weight, deliverBy }) =>
    "Shipment logged: " + weight + " kg, deliver by " + deliverBy,
})

server.registerTool(createShipment.name, {
  description: createShipment.description,
  inputSchema: createShipment.inputSchema,
}, createShipment.callback)`,
  },
  {
    value: 'openai',
    label: 'OpenAI',
    lang: 'ts',
    filename: 'openai-tool.ts',
    code: `import OpenAI from "openai"
import { dateField, lingoObject, quantityField, toJSONSchema } from "@pascal-app/lingo/ai"

const client = new OpenAI()
const schema = lingoObject({
  sku: "string",
  weight: quantityField({ kind: "mass", unit: "kg", min: 0 }),
  deliverBy: dateField({ now: new Date() }),
})

const completion = await client.chat.completions.create({
  model: "gpt-5.5",
  messages: [{ role: "user", content: "Ship SKU A100, 5 kg, tomorrow." }],
  tools: [{
    type: "function",
    function: {
      name: "create_shipment",
      description: "Create a shipment for one order line.",
      parameters: toJSONSchema(schema),
      strict: true,
    },
  }],
})

const call = completion.choices[0]?.message.tool_calls?.[0]
if (call?.type === "function" && call.function.name === "create_shipment") {
  const parsed = schema.safeParse(JSON.parse(call.function.arguments))
  if (!("value" in parsed)) return reportToolError(parsed.issues)
  await warehouse.create(parsed.value)
}`,
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    lang: 'ts',
    filename: 'anthropic-tool.ts',
    code: `import Anthropic from "@anthropic-ai/sdk"
import { lingoObject, quantityField, toJSONSchema } from "@pascal-app/lingo/ai"

const schema = lingoObject({
  weight: quantityField({ kind: "mass", unit: "kg", min: 0, max: 1000 }),
  note: "string",
})

const toolDef: Anthropic.Tool = {
  name: "log_shipment",
  description: "Record a shipment weight and note.",
  input_schema: toJSONSchema(schema) as Anthropic.Tool.InputSchema,
  strict: true,
}

async function runTool(toolUse: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  const parsed = schema.safeParse(toolUse.input)
  if ("issues" in parsed) {
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: parsed.issues.map((issue) => issue.message).join("; "),
      is_error: true,
    }
  }
  await warehouse.log(parsed.value)
  return { type: "tool_result", tool_use_id: toolUse.id, content: "Logged." }
}`,
  },
  {
    value: 'gemini',
    label: 'Gemini',
    lang: 'ts',
    filename: 'gemini-tool.ts',
    code: `import { GoogleGenAI } from "@google/genai"
import { quantityField, toJSONSchema } from "@pascal-app/lingo/ai"

const weight = quantityField({ kind: "mass", unit: "kg", min: 0 })
const ai = new GoogleGenAI({})

await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "Ship 5 kg tomorrow.",
  config: {
    tools: [{
      functionDeclarations: [{
        name: "create_shipment",
        description: "Create a shipment record.",
        // Use parametersJsonSchema; never classic parameters/responseSchema.
        parametersJsonSchema: {
          type: "object",
          properties: { weight: toJSONSchema(weight) },
          required: ["weight"],
          additionalProperties: false,
        },
      }],
    }],
  },
})`,
  },
  {
    value: 'langchain',
    label: 'LangChain',
    lang: 'ts',
    filename: 'langchain.ts',
    code: `import { ChatOpenAI } from "@langchain/openai"
import { createAgent, toolStrategy } from "langchain"
import { canonicalizeValues, lingoObject, quantityField } from "@pascal-app/lingo/ai"

const weight = quantityField({ kind: "mass", unit: "kg", min: 0 })
const schema = lingoObject({ weight })

const extract = new ChatOpenAI({ model: "gpt-4o-mini" }).withStructuredOutput(schema)
const result = await extract.invoke("about 40 lbs")
// result.weight is canonical kg when the model override validates Standard Schema.

const agent = createAgent({
  model: "gpt-4o-mini",
  tools: [],
  responseFormat: toolStrategy(schema, { handleError: true }),
})
const { structuredResponse } = await agent.invoke({ messages })
// createAgent + toolStrategy validate shape only; canonicalize values yourself.
const { value, issues } = canonicalizeValues(structuredResponse, { weight })`,
  },
  {
    value: 'evals',
    label: 'Evals',
    lang: 'ts',
    filename: 'lingo-grader.ts',
    code: `import { dateMatch, quantityMatch } from "@pascal-app/lingo/ai"

quantityMatch("2 lbs", "0.90718474 kg", {
  kind: "mass",
  unit: "kg",
  tolerance: 0.02,
})
// { pass: true, score: 1, reason: "Values match within relative tolerance 0.02." }

dateMatch("July 4 2026", "2026-07-04", {
  grain: "day",
  timeZone: "UTC",
})
// { pass: true, score: 1, reason: "Dates match at day grain." }`,
  },
  {
    value: 'computer-use',
    label: 'Computer use',
    lang: 'ts',
    filename: 'agent-form-fill.ts',
    code: `import { lingoInput } from "@pascal-app/lingo/dom"

const input = document.querySelector<HTMLInputElement>("#height")!
const field = lingoInput(input, {
  kind: "length",
  unit: "m",
  name: "height_m",
})

// Verified on the docs form: 5'11" commits hidden height_m=1.8034.
field.set("5'11\\"")
field.commit()

field.value // 1.8034
new FormData(input.form!).get("height_m") // "1.8034"`,
  },
] as const

export const integrationSnippets = [
  {
    value: 'vanilla',
    label: 'Vanilla',
    lang: 'html',
    filename: 'index.html',
    code: `<form method="post" action="/signup" novalidate>
  <label for="height">Height</label>
  <input
    id="height"
    name="height"
    inputmode="text"
    placeholder="5'11&quot; or 180cm"
    required
  />
  <p id="height-error" role="alert"></p>
  <p id="height-hint" aria-hidden="true"></p>
  <button>Continue</button>
</form>

<script type="module">
  import { lingoInput } from "@pascal-app/lingo/dom"

  lingoInput(document.querySelector("#height"), {
    kind: "length",
    unit: "m",
    name: "height",
    min: "0.3m",
    max: "2.5m",
    required: true,
    validationBehavior: "aria",
    errorElement: "#height-error",
    hintElement: "#height-hint",
  })
</script>`,
  },
  {
    value: 'react',
    label: 'React',
    lang: 'tsx',
    filename: 'HeightField.tsx',
    code: reactSnippet,
  },
  {
    value: 'react-hook-form',
    label: 'React Hook Form',
    lang: 'tsx',
    filename: 'ShipmentForm.tsx',
    code: `import {
  standardSchemaResolver,
} from "@hookform/resolvers/standard-schema"
import { useForm } from "react-hook-form"
import {
  dateField,
  lingoObject,
  quantityField,
} from "@pascal-app/lingo/ai"

const shape = {
  weight_kg: quantityField({
    kind: "mass",
    unit: "kg",
    min: 0,
  }),
  visit_date: dateField({ now: new Date() }),
}

const form = useForm({
  resolver: standardSchemaResolver(
    lingoObject(shape, { passthrough: true }),
  ),
})

form.handleSubmit((data) => {
  // data.weight_kg is a number in kg.
  // data.visit_date is an ISO string.
})`,
  },
  {
    value: 'tanstack',
    label: 'TanStack',
    lang: 'tsx',
    filename: 'HeightField.tsx',
    code: `import { quantityField } from "@pascal-app/lingo/ai"
import { useLingoInput } from "@pascal-app/lingo/react"

const heightField = quantityField({
  kind: "length",
  unit: "m",
  min: 0.3,
  max: 2.5,
})

function HeightBridge({ field }) {
  const { ref, state } = useLingoInput({
    kind: "length",
    unit: "m",
    value: field.state.value ?? null,
    onValueChange: (value) => field.handleChange(value),
  })
  return (
    <input
      ref={ref}
      data-state={state}
      onBlur={field.handleBlur}
    />
  )
}

<form.Field
  name="height_m"
  validators={{ onChange: heightField }}
>
  {(field) => <HeightBridge field={field} />}
</form.Field>`,
  },
  {
    value: 'shadcn',
    label: 'shadcn/ui',
    lang: 'tsx',
    filename: 'height-field.tsx',
    code: `import {
  standardSchemaResolver,
} from "@hookform/resolvers/standard-schema"
import { Controller, useForm } from "react-hook-form"
import {
  lingoObject,
  quantityField,
} from "@pascal-app/lingo/ai"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const schema = lingoObject({
  height: quantityField({
    kind: "length",
    unit: "m",
    min: 0.3,
    max: 2.5,
  }),
})
const form = useForm({
  resolver: standardSchemaResolver(schema),
  defaultValues: { height: "" },
})

<Controller
  name="height"
  control={form.control}
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={field.name}>Height</FieldLabel>
      <Input
        {...field}
        id={field.name}
        aria-invalid={fieldState.invalid}
        placeholder="5'11&quot; or 180cm"
      />
      <FieldDescription>
        Any format - imperial or metric.
      </FieldDescription>
      {fieldState.invalid ? (
        <FieldError errors={[fieldState.error]} />
      ) : null}
    </Field>
  )}
/>`,
  },
  {
    value: 'web-component',
    label: 'Web component',
    lang: 'html',
    filename: 'lingo-input.html',
    code: `<script type="module">
  import { defineLingoInput } from "@pascal-app/lingo/element"

  defineLingoInput()
</script>

<form>
  <label for="height">Height</label>
  <lingo-input
    id="height"
    name="height_m"
    kind="length"
    unit="m"
  ></lingo-input>
</form>
<!-- after committing 5'11", -->
<!-- the form submits height_m=1.8034 -->`,
  },
  {
    value: 'next',
    label: 'Next action',
    lang: 'ts',
    filename: 'actions.ts',
    code: `"use server"

import { parseQuantity } from "@pascal-app/lingo"

export async function validateLength(_prev, formData) {
  const input = String(formData.get("length") ?? "")
  const result = parseQuantity(input, {
    kind: "length",
    unit: "m",
    strictness: "confirm",
    accept: { ranges: false, conversions: false },
  })

  if (!result.ok) {
    return { ok: false, issues: result.issues }
  }

  return {
    ok: true,
    canonicalMeters: result.quantity.base,
    formatted: result.quantity.format({ unit: "m" }),
  }
}`,
  },
  {
    value: 'vue',
    label: 'Vue',
    lang: 'vue',
    filename: 'HeightField.vue',
    code: `<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue"
import { lingoInput } from "@pascal-app/lingo/dom"

const el = ref(null)
let field

onMounted(() => {
  field = lingoInput(el.value, {
    kind: "mass",
    unit: "kg",
    name: "weight_kg",
  })
})

onBeforeUnmount(() => field?.destroy())
</script>

<template>
  <input ref="el" placeholder="2 lb 3 oz" />
</template>`,
  },
  {
    value: 'svelte',
    label: 'Svelte',
    lang: 'svelte',
    filename: 'lingo-action.svelte',
    code: `<script>
  import { lingoInput } from "@pascal-app/lingo/dom"

  export function lingo(node, options) {
    const field = lingoInput(node, options)
    return {
      update(next) { field.update(next) },
      destroy() { field.destroy() },
    }
  }
</script>

<input use:lingo={{ kind: "length", unit: "m", name: "height_m" }} />`,
  },
  {
    value: 'node',
    label: 'Node',
    lang: 'ts',
    filename: 'validate-payload.ts',
    code: `import { parseQuantity } from "@pascal-app/lingo"

export function validatePayload(payload) {
  const result = parseQuantity(payload.length, {
    kind: "length",
    unit: "m",
    strictness: "confirm",
    accept: { ranges: false, conversions: false },
  })

  if (!result.ok) {
    return {
      ok: false,
      issues: result.issues,
      candidate: result.candidate,
    }
  }

  return { ok: true, meters: result.quantity.base }
}`,
  },
  {
    value: 'agents',
    label: 'Agents',
    lang: 'js',
    filename: 'browser-agent.js',
    code: `// llms.txt tells agents to pass strings, not floats.
// A browser automation agent can fill the field either way:

lingoInput.get(document.querySelector("#height"))?.set("5'11\\"")

// Or it can type natural language. The hidden input named height_m
// carries the canonical value for normal form submission.`,
  },
] as const
