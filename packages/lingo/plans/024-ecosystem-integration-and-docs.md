---
id: 024
title: Ecosystem integration & documentation enrichment
status: done
created: 2026-07-05
updated: 2026-07-07
goal: "Prove and document that one lingo field serves an LLM tool arg AND a human form field across the real 2026 ecosystem; ship the small, DX-first helpers the seam can't reach (eval graders, tool-call repair, optional args, a form-associated element, an MCP helper); and reorganize + enrich the docs with grounded vertical examples."
success_criteria:
  - "Verified integration recipes for AI SDK, OpenAI, Anthropic, Gemini, LangChain, MCP, react-hook-form, TanStack, Formik, Vue, shadcn, vanilla, Drizzle -> docs/recipes.md + site, each cited in wiki/research/"
  - "quantityMatch/dateMatch graders + repairToolCallWith + optional() + toJSONSchema() ship in ./ai, tree-shakeable, quantity-only import stays within its shake-gate budget -> bun run size"
  - "@pascal-app/lingo/element (<lingo-input>) and @pascal-app/lingo/mcp (lingoTool) ship as new tree-shakeable entries with their own budgets -> bun run size + tests"
  - "LingoField is asserted spec-conformant against @standard-schema/spec@1.1.0 (types-only devDep) + a JSON-Schema portability gate -> new tests in bun run check"
  - "bun run check + ai-eval stay green; every new public symbol has a verified TSDoc @example"
---

# Ecosystem integration & documentation enrichment

Driver: make lingo more useful and better-integrated across the LLM ecosystem and human form
libraries; give realistic AI-workflow and per-vertical form examples; reduce form complexity by
inferring units; take inspiration from Zod & related; organize and enrich the docs. Synthesis of a
verified ecosystem research pass (`wiki/research/ecosystem-*.md`, `form-ux-and-database.md`) plus the
internal design brief. Scope: all four small helpers **and** the two heavier surfaces, integrated
into the library as a good interface for DX and for AI.

## Design principle

**Standard Schema is the one seam, and it already works — so the leverage is showing it, then adding
the small, DX-first pieces the seam can't reach.** A `lingoField` is a Standard Schema whose input is
natural-language text and whose output is a canonical value; that single object is consumed unchanged by
the AI SDK / LangChain (to generate + validate) and by form-library resolvers (to validate + canonicalize
human input). Everything shipped here is small, tree-shakeable, and justified by a verified gap — never a
rewrite, never a speculative abstraction (AGENTS.md philosophy).

## Verified facts (primary source, 2026-07-05) — locked-in

1. **`StandardJSONSchemaV1` is the ratified spec** (`@standard-schema/spec@1.1.0`, 2025-12-15), not a lingo
   invention. AI SDK v6/v7 (`@ai-sdk/provider-utils@5.0.5`) and LangChain (`@langchain/core@1.2.1`) call
   `~standard.jsonSchema.input({target:'draft-07'})` for non-Zod fields → **lingo fields drop into
   `tool()`/`Output.object()`/`withStructuredOutput()` with no Zod, no wrapper.** (`wiki/research/ecosystem-standard-schema.md`.)
2. **react-hook-form** `standardSchemaResolver` returns the transformed `result.value` on submit →
   `lingoObject` validates *and* canonicalizes a form. Same field object, both audiences. (`ecosystem-form-libraries.md`.)
3. **Version/shape traps to document, not fix**: AI SDK v5 needs a `jsonSchema()` wrapper; `generateObject`/
   `experimental_repairText` are deprecated (→ `Output.object`/`experimental_repairToolCall`); the SDK's
   validate wrapper drops lingo `warnings`; OpenAI strict rejects `passthrough:true`; Gemini needs
   `parametersJsonSchema`/`responseJsonSchema` (never classic); `lingoObject` closed-default already
   satisfies OpenAI **and** Anthropic strict.

## Design (locked-in 2026-07-05) — real signatures

### Placement & budgets
- New `./ai` helpers (`grade`, `repairToolCallWith`, `optional`, `toJSONSchema`) live in `src/ai/`, exported
  from `src/ai/index.ts`, each in its own module so the **quantity-only shake gate holds**. The full
  `./ai` marginal budget recalibrates deliberately (product, not bloat — D14/D17 pattern); recorded as **D24**.
  Budget numbers live only in `scripts/size.mjs`.
- `@pascal-app/lingo/element` — new entry `src/element/index.ts` (DOM-only), own budget line.
- `@pascal-app/lingo/mcp` — new entry `src/mcp/index.ts`, own budget line (plan 021 phase 2).
- Wire each new entry in `tsup.config.ts`, `package.json` `exports`, and `scripts/size.mjs`.

### 1. Spec fidelity + drift gate (`src/ai/standard-schema.ts` + tests)
- Change `StandardSchemaV1Options` to exactly `{ readonly libraryOptions?: Record<string, unknown> | undefined }`.
- Add `@standard-schema/spec@^1.1.0` to **devDependencies** (types-only; zero runtime — dist is a 0-byte file).
- `src/ai/spec-conformance.test.ts` (a `.test.ts`, so the zero-deps gate exempts it): `import type` the real
  `StandardSchemaV1`/`StandardJSONSchemaV1` and assert each field satisfies both halves (compile-checked by
  tsc) + a runtime shape check (`version===1`, `vendor==='lingo'`).
- `src/ai/schema-portability.test.ts`: walk every field/object `.input`/`.output` for `draft-07`,
  `draft-2020-12`, `openapi-3.0`; assert only a portable keyword allowlist appears (no `prefixItems`,
  `$dynamicRef`, `unevaluatedProperties`, `dependentSchemas`) — guards the currently-safe target-agnostic emit.
- Code comment in `quantity-fields.ts`/`date-field.ts` noting the deliberate target-portable keyword set.

### 2. Eval graders (`src/ai/grade.ts` → `./ai`)
```ts
export interface GradeResult { pass: boolean; score: number; reason: string }
export interface QuantityMatchOptions extends LingoOptions { unit: string; tolerance?: number } // rel, default 1e-9
export function quantityMatch(actual: unknown, expected: unknown, opts: QuantityMatchOptions): GradeResult
export type DateGrain = 'year'|'month'|'day'|'hour'|'minute'|'second'
export interface DateMatchOptions extends DateFieldOptions { grain?: DateGrain; timeZone?: string } // grain default 'day'
export function dateMatch(actual: unknown, expected: unknown, opts?: DateMatchOptions): GradeResult
```
Canonicalize both sides through the same field; fail (`score 0`) with the issue message if either won't parse;
else compare (relative error for quantity; grain-truncate both ISO instants in `timeZone` via `Intl` for date).
Duck-typed `{pass,score,reason}` = promptfoo `GradingResult`; recipes adapt to autoevals/LangSmith/Vitest.

### 3. Tool-call repair for AI SDK v6/v7 (`src/ai/canonicalize.ts`)
```ts
export interface ToolCallToRepair { toolCallId: string; toolName: string; input: string /* JSON */ }
export type RepairToolCallFunction =
  (o: { toolCall: ToolCallToRepair; error: unknown }) => Promise<ToolCallToRepair | null>
export function repairToolCallWith(
  specsByTool: Record<string, CanonicalizeSpec | LingoField<unknown>>
): RepairToolCallFunction
```
Structurally matches `experimental_repairToolCall`; `JSON.parse(input)` → canonicalize by the tool's spec →
`{...toolCall, input: JSON.stringify(fixed)}`, or `null` if no matching spec / any error-severity issue remains.
Mirrors the shipped `repairTextWith`; `repairTextWith` stays (still valid on v5's `generateObject`).

### 4. Optional / nullable tool args (`src/ai/optional.ts` + `canonicalize.ts` handling)
```ts
export function optional<Output>(field: LingoField<Output>): LingoField<Output | null>
```
`validate`: `null`/`undefined` → `{ value: null }`; else delegate. `jsonSchema.input/output`: nullable form —
scalar `{type:'string'}` → `{type:['string','null']}`; otherwise `{ anyOf: [<schema>, { type:'null' }] }`
(OpenAI-strict pattern: key stays in `required`, type admits null; Anthropic accepts it too). Composes inside
`lingoObject` shapes as any other `LingoField`; a missing key validates to `null`.

### 5. `toJSONSchema` DX helper (`src/ai/standard-schema.ts` or `grade`-adjacent)
```ts
export interface ToJSONSchemaOptions { target?: 'draft-2020-12'|'draft-07'|'openapi-3.0'|(string & {}); io?: 'input'|'output' }
export function toJSONSchema(field: LingoField<unknown>, opts?: ToJSONSchemaOptions): Record<string, unknown>
```
Thin named wrapper over `field['~standard'].jsonSchema[io]({target})` (default `io:'input'`, `target:'draft-2020-12'`)
— the friendly path for raw provider SDKs (OpenAI `parameters`, Anthropic `input_schema`, MCP `inputSchema`).
Does **not** replace passing the field itself to AI SDK/LangChain (that dispatch needs the `~standard` object).

### 6. `<lingo-input>` form-associated element (new entry `./element`)
```ts
export class LingoInputElement extends HTMLElement { static formAssociated: true; readonly field: LingoField | null; readonly value: number | null }
export function defineLingoInput(tag?: string): void  // default 'lingo-input'
```
Attributes → `LingoInputOptions` (`kind`,`unit`,`min`,`max`,`system`,`strictness`,`display`,`name`,`required`,
`inputmode`). Holds a light-DOM `<input type=text>`; wraps `lingoInput(el, …)` (no hidden-input `name` — the
element itself is the form control) and mirrors state via `ElementInternals.setFormValue(field.value)` /
`setValidity(...)`; implements `formResetCallback`/`formDisabledCallback`. Framework-agnostic (Vue/Svelte/vanilla).

### 7. `lingoTool` MCP helper (new entry `./mcp`, plan 021 phase 2)
```ts
export interface McpTool { name: string; description: string; inputSchema: Record<string, unknown>;
  callback: (raw: unknown) => Promise<{ content: { type:'text'; text:string }[]; isError?: boolean }> }
export function lingoTool<Shape extends LingoObjectShape>(def: {
  name: string; description: string; input: Shape; passthrough?: boolean;
  handler: (args: InferLingoObject<Shape>) => unknown | Promise<unknown>
}): McpTool
```
`inputSchema = lingoObject(input,{passthrough})['~standard'].jsonSchema.input({target:'draft-2020-12'})`; the
callback `safeParse`s raw args → `{isError:true, content:[{type:'text', text:'[CODE] …'}]}` on failure so the
model self-corrects, else runs `handler(value)`. Zero-dep (MCP SDK stays the consumer's). Shaped for
`server.registerTool(t.name, {description:t.description, inputSchema:t.inputSchema}, t.callback)`.

## Changes (by surface)
1. **src/ai/**: standard-schema.ts (Options type, `toJSONSchema`), grade.ts, optional.ts, canonicalize.ts
   (`repairToolCallWith`, optional-in-object handling), index.ts re-exports; comments on target portability.
   New tests: spec-conformance, schema-portability, grade, repair-tool-call, optional. package.json devDep.
2. **src/element/**, **src/mcp/**: new entries + tests; tsup.config.ts, package.json exports, size.mjs budgets.
3. **wiki/research/**: 6 consolidated cited docs; wiki/inspiration.md credits
   (Standard Schema spec, Zod `.meta`/`toJSONSchema`, Effect Schema decode/encode, Baymard/GoodUI).
4. **docs/recipes.md** + **site**: categorized recipes — AI SDK (direct + v5 wrapper + repairToolCall),
   OpenAI/Anthropic/Gemini/"one schema, six providers", LangChain (+ createAgent canonicalize gap + HITL),
   MCP, evals (canonicalize-before-diff), RHF/TanStack/Formik/Vue/Angular/shadcn/vanilla, DB two-stage,
   and a per-vertical form-UX gallery (health/dosing/fitness/logistics/IoT/cooking/e-commerce/lab/finance)
   with the scoped claim + real unit-disaster citations. "One schema, both sides" hero.
5. **README + llms.txt**: the unified narrative; version-pinned AI-SDK guidance; new-entry pointers; CHANGELOG.
6. **wiki/decisions**: **D24** (./ai budget recalibration + new entries + `@standard-schema/spec` devDep) +
   **D25** (fields never emit `format`/`pattern` — validated decorative/inconsistent across 7 providers).

## Non-goals
- No parser/DOM/React rewrite (verified sound). No per-provider runtime adapter classes (recipes instead).
- No fluent/chain field builder, no `.catch()`-style silent fallback (contradicts "LLM tools safer").
- No new runtime dependency; the quantity-only `./ai` import must hold its shake-gate budget. No dropping a LingoField into a
  drizzle-zod column override (not a ZodType — the two-stage boundary recipe is the answer).
- Don't cite `NPSG.01.05.01` (a hallucinated source); scope the form-UX claim to "one value+unit pair."

## Test environment
- Element tests prefer extending the hand-rolled fake DOM with an `ElementInternals` stub over adding
  jsdom/happy-dom, unless a stub proves infeasible (then add happy-dom as a scoped devDep — closes the
  deferred React-mount-test gap too).

## Acceptance
- `bun run check` green (typecheck + test + build + size + corpus ADDITIVE/zero + zero-deps); `ai-eval` holds.
- Every new public symbol has a verified TSDoc `@example`; docs-surface table (conventions) fully updated.
