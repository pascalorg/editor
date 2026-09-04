---
id: 019
title: AI input — structured output & agent form filling
status: done
created: 2026-07-04
updated: 2026-07-07
---

# lingo for AI — structured output & agent form filling

Driver: in addition to the human-input benefits, lingo helps LLMs generate
structured outputs and lets computer-use/browser agents fill forms with minimal
formatting mistakes (e.g. with the Vercel AI SDK, pre-processing reduces the
error rate).

## Thesis

Constrained decoding / JSON mode guarantees output *parses*; it cannot
guarantee the values inside *mean* what the schema intends ("2kg" in a number
field, "1,5" locale decimals, "next tues" in a date field, "5-10" in a
scalar). lingo already turns exactly those strings into canonical typed
values — the AI direction is the same engine pointed at model output instead
of keyboard input. Models are better at emitting `"5'11\""` than `1.8034`
(our README already says: accept strings, not floats) — lingo makes that the
reliable path instead of the risky one.

## Research grounding

- `wiki/research/ai-structured-output.md` — exact AI SDK surface
  (generateObject/Output.object/repair hooks), Standard Schema `~standard`
  interface feasibility (zero-dep), tool-input interception points,
  computer-use form-filling reality, adjacent art. Key verified facts:
  `experimental_repairText` is client-side (no model call) — our natural hook;
  `asSchema()` requires BOTH Standard Schema halves (`StandardSchemaV1`
  validate AND `StandardJSONSchemaV1` jsonSchema converter) for non-Zod
  schemas; field input JSON Schema must be `type: "string"` for provider
  strict modes; `z.coerce.number()` turns "2 lbs" into NaN — a hard failure
  with no rescue, which is the wedge.
- `wiki/research/llm-formatting-failures.md` — 10-mode failure taxonomy with
  citations, retry economics, recorded-corpus eval design. Retry is low-yield
  (Repair@1 ≤9.6% in Tool-Reflection-Bench), so fix values before validation.

## Feature set

1. **Standard-Schema field validators (zero-dep).** `quantityField`/
   `rangeField`/`dateField` (e.g. `quantityField('length', { unit: 'm',
   strictness: 'confirm', … })`) return objects implementing BOTH Standard
   Schema halves (`~standard` validate + jsonSchema, input schemas
   `type:"string"`) plus `.parse`/`.safeParse` → they drop directly into AI SDK
   `generateObject`/tool `inputSchema` and compose inside Zod/Valibot via
   standard-schema interop. Output: canonical number (or Quantity JSON),
   issues → standard issues array. A minimal `lingoObject` combinator composes
   fields into an object schema (Zod embedding of foreign fields is blocked by
   its typing). This makes lingo a *schema citizen*, not a post-processor.
2. **Canonicalizing repair**: `repairTextWith(spec)` for
   `experimental_repairText`, plus a plain `canonicalizeValues(json, fieldSpec)`
   that walks an object and re-parses flagged string/number fields (dot-path +
   `[]` wildcard specs; uses existing parse + findQuantities).
3. **Tool-input preprocessing recipe** (docs-level): wrap tool execute with
   lingo coercion so `"weight": "2 lbs"` reaches code as 0.907.
4. **Computer-use story (existing behavior, demonstrated)**: lingoInput
   processes untrusted synthetic events, keeps the canonical value in a hidden
   input, and surfaces did-you-mean hints in ARIA — an agent typing "2 ft"
   into a meters field commits 0.61, `5'11"` commits 1.8034, and locale
   decimals like `1,5 m` commit 1.5, through plain synthetic events with zero
   agent-specific code.
5. **Eval — `scripts/ai-eval.mjs`**: recorded corpus of realistic raw model
   outputs across the failure taxonomy; measures schema-acceptance rate with
   vs without lingo preprocessing; JSON + table output; honest framing
   (canonicalization-rate demo, not an end-to-end model benchmark). Fixture
   corpus checked in; zero network in CI.

`rangeField()` keeps a compact `{ min, max }` numeric output by default;
`output:'range'` returns self-describing range JSON for tool args that need
open bounds, exclusivity, fuzzy/approximate origin, and `baseUnit`. Numeric
output rejects open-ended ranges with the structured
`RANGE_OPEN_BOUND_NOT_ALLOWED` issue.

## Eval design (locked-in 2026-07-04)

~150–200 fixtures across the 10-mode taxonomy, provenance-tagged
`documented`/`synthesized`; two receivers (naive Number()/Date() coercion +
schema validation vs. lingo-preprocessed); report **acceptance-rate delta**
AND **silent-wrong-rate delta** per category — never blended into one
number. Framing is binding: canonicalization-rate demo, not an LLM
benchmark. The eval imports the final `/ai` API from dist.

## Packaging & budget guardrails

- Zero runtime deps holds. Standard Schema is an interface (types only) — no
  dependency needed; vendor the type.
- The feature set lives in its own subpath entry `@pascal-app/lingo/ai` with
  its own marginal size budget AND a shakeability gate (a quantity-only import
  must not pull the date engine), both enforced by `scripts/size.mjs` (D18).
- Corpus contract untouched; the `/ai` surface is additive only.

## Communication

- README: a full "For AI" section — AI SDK recipe (generateObject with lingo
  fields), tool-call coercion, computer-use + lingoInput, eval numbers with
  the framing caption.
- Site: landing bento tile ("AI output → canonical value" live demo — paste a
  messy model output, watch it canonicalize) + /docs "For AI" section with AI
  SDK code tabs and the per-category eval readout; llms.txt section so agents
  discover the capability.
- Credits to adjacent art in wiki/inspiration.md.
