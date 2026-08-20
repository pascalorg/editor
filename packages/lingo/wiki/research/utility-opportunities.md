# Utility opportunities: forms easier, LLM tools safer

Research synthesis, 2026-07-20. This is a prioritization pass over lingo's
shipped surface, plans, backlog, and the source-verified ecosystem research in
this directory. It does not repeat unverified market-size claims. The external
integration findings were most recently checked between 2026-07-04 and
2026-07-09; version-sensitive recipes still need a fresh check when implemented.

## Product wedge

Most libraries own one step: natural-language parsing, unit conversion,
validation, formatting, or tool-schema generation. lingo's defensible value is
the whole boundary:

`messy text -> parse -> canonicalize -> validate -> store/call -> humanize`

The same options vocabulary drives a human field and a model-facing
`LingoField`. Spans, explicit ambiguity, two-way output, Standard Schema, and
zero runtime dependencies make that shared boundary difficult to reproduce with
a stack of generic validators and conversion helpers.

The useful growth strategy is therefore not "parse every noun." It is:

1. remove integration work around the boundary that already exists;
2. expose safety information generic adapters discard;
3. add high-value language coverage as tree-shakeable data;
4. prove speed and correctness with executable examples.

## Opportunity matrix

Scores are relative: value and differentiation run from 1 (low) to 5 (high);
cost and bundle risk run from 1 (small) to 5 (large).

| Opportunity | Audience | Value | Differentiation | Cost | Bundle risk | Recommendation |
|---|---|---:|---:|---:|---:|---|
| React completion state and selection | Forms, computer-use agents | 5 | 3 | 2 | 1 | Ship first |
| React Native TextInput adapter | Mobile forms | 4 | 3 | 3 | 1 | Separate headless entry |
| Strict-schema preflight (`assertStrictSafe`) | Tool authors | 4 | 4 | 2 | 1 | Next safety slice |
| Warning-preserving direct integrations | Forms, tool authors | 5 | 5 | 2 | 1 | Design after observing adapters |
| Date/duration wire schemas | APIs, agents | 4 | 3 | 3 | 2 | Finish plan 029 |
| Date component certainty | Agents, audit pipelines | 5 | 5 | 4 | 3 | Strategic date follow-up |
| Demo MCP server | Agents, evaluators | 4 | 3 | 2 | 1 | Dogfood `lingoTool` |
| Localized humanize and issue copy | Global forms | 5 | 4 | 5 | 4 | Pack-owned, staged rollout |
| Input calculations in `./calc` | Forms | 4 | 3 | 5 | 4 | Resolve plan 032 first |
| Browser benchmark and comparisons | Evaluators | 3 | 3 | 2 | 1 | Publish proof, not core code |

No new backlog entries result from this pass: every deferred opportunity above
already appears in a numbered plan or `plans/backlog.md`.

### Addendum 2026-07-29 — input calculations re-scored

A prior-art pass over mathjs plus a probe of live parser behavior changed three
of the inputs behind the `./calc` row, and plan 032 was rewritten accordingly.

- **Audience is wrong, not just incomplete.** Scored as "Forms"; the stronger
  case is the LLM tool boundary. A model asked for `weight_kg: number` must do
  the arithmetic in its head and nothing downstream can audit it, whereas a
  field accepting `"12 * 0.75 kg"` moves the computation into deterministic
  library code. That is a `value_error` mitigation, which raises
  differentiation from 3 — no other Standard Schema library offers it.
- **Cost and bundle risk drop with the `=` escape hatch.** Borrowing the
  Excel/Sheets mode switch makes the feature purely additive instead of a
  reinterpretation of existing readings, and the injected-evaluator pattern
  (already used for `./complete` → `./date`) keeps both the main entry and
  `./ai` budgets flat. Phase 1 (percent-of only) is a much smaller first slice
  than the full expression grammar that was costed here.
- **"Resolve plan 032 first" now has a prerequisite of its own.** The probe
  found that `2+3 kg` already returns a range at `confidence: 1` with zero
  issues — a D4 violation shipping today, independent of any calc decision.
  That fix and the `AFFINE_DELTA_ASSUMED` warning land regardless of the
  go/no-go.

Two adjacent opportunities surfaced by the same pass went to `plans/backlog.md`
rather than this matrix: rates with non-unit denominators (`£45 per night`),
which ranks above input calculations on form value, and multiplier/count words
(`twice 3 kg`, `a dozen eggs`).

## Shipped first slice: React completions

`@pascal-app/lingo/complete` already returns ranked, fully parsed completions,
and `lingoInput()` accepts an injected completion provider. `useLingoInput()`
now forwards that provider and surfaces the resulting list, highlighted index,
and selection helpers without bundling the completion engine.

The first slice should expose completion list and highlighted-index state from
`useLingoInput()`, plus a selection helper. The completion engine remains an
explicit caller import, so React-only consumers do not pay for it. Popup markup,
option ids, styling, and keyboard policy remain headless and caller-owned.

This closes a real integration gap without changing parser behavior, adding a
dependency, or turning the library into a component kit. It also improves
computer-use-agent fields: partial inputs can expose ranked, canonical choices
before commit, while the existing `data-state` and ARIA attributes remain the
machine-readable feedback channel.

## High-leverage applications

### One value, one field

Collapse a value and unit selector into one text field, not an entire form into
a sentence:

- health intake: `5'11"` and `165 lb` into canonical height and mass;
- shipping and listings: dimensions and weight in the units printed on a label;
- finance: `25 bps`, `0.25%`, or `a quarter point`;
- IoT: `68F`, `20 C`, or an approved fuzzy temperature profile;
- lab and construction: mixed source units canonicalized before storage;
- cooking: volume-to-volume and mass-to-mass only; ingredient density remains
  outside lingo's scope.

Completions are especially useful where bare numbers or short aliases would
otherwise hide an assumption. The UI can show full parsed readings instead of
inventing a second suggestion vocabulary.

### Progressive enhancement

Use `lingoInput()` on a normal text input, submit the canonical hidden value when
JavaScript runs, and re-parse server-side either way. A form-associated
`<lingo-input>` gives design systems the same path without a framework adapter.
This is a stronger adoption route than shipping a styled field component.

### One field specification on both sides

Keep a shared options object for the browser field and the tool argument:

- the browser gets partial-state UX, commit formatting, bounds, and ARIA;
- `quantityField()` or `dateField()` gets closed JSON Schema, deterministic
  reference time, coded issues, and canonical output;
- the database stores one canonical value and optionally the raw input for
  audit;
- `format()` or `humanize*()` renders the value back under the two-way
  guarantee.

This is the shortest demonstration of the product thesis because it removes
duplicated validation policy rather than merely sharing types.

### Tool-call firewall

Use `lingoObject()` or `lingoTool()` at the execution boundary even when the
agent framework only consumes plain JSON Schema. Generic shape validation cannot
decide whether `"1,234"`, `"next Friday"`, or `"70"` is semantically safe.
lingo can reject ambiguity, require an explicit `now`, return a candidate, or
canonicalize locally without another model call.

The next small safety utility should walk a field's emitted schema and fail
definition-time checks when strict-provider invariants are violated. It should
not import an AI SDK or provider package.

### Human confirmation as a first-class branch

Candidates and warnings are ready-made inputs for review:

- a form can show the candidate in its hint or description slot;
- a LangGraph-style workflow can interrupt on ambiguity and resume with the
  confirmed canonical value;
- an extraction pipeline can keep full quantity output and route warning-bearing
  records to review;
- evals can compare canonical values instead of brittle strings.

Generic Standard Schema adapters intentionally retain only `value` or `issues`,
so success warnings need a direct-lingo integration path rather than a claim
that generic resolvers preserve them.

## Recommended sequence

1. Keep the React completion bridge dogfooded in the accessible site combobox.
2. Ship the separate DOM-free React Native TextInput adapter without importing
   `react-native`.
3. Add strict-schema preflight as a tiny, provider-neutral `./ai` helper.
4. Design a warning-preserving integration pattern using evidence from the DOM,
   React, form recipes, and tool callbacks; do not mutate validation into a
   side-effect.
5. Finish date/duration machine schemas, then add per-component date certainty
   when the date result shape is next revised.
6. Publish a demo MCP server and comparative browser benchmarks as executable
   adoption proof.
7. Continue locale work through pack-owned humanize templates and message copy,
   preserving two-way tests and entry budgets.

## Sources in this repository

- `plans/000-vision-and-scope.md`
- `plans/021-mcp-integration.md`
- `plans/029-schema-reference-and-adapters.md`
- `plans/031-completions.md`
- `plans/031-locale-packs.md`
- `plans/032-input-calculations.md`
- `plans/backlog.md`
- `wiki/research/ai-structured-output.md`
- `wiki/research/base-ui-headless-patterns.md`
- `wiki/research/competitive-landscape.md`
- `wiki/research/ecosystem-agent-frameworks.md`
- `wiki/research/ecosystem-form-libraries.md`
- `wiki/research/form-ux-and-database.md`
