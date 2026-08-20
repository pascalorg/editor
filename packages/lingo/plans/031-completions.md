---
id: 031
title: Ranked completions (autocomplete anything)
status: approved
created: 2026-07-08
updated: 2026-07-20
goal: "Ship a ranked completions API that returns all plausible canonical interpretations of a partial or ambiguous quantity input, plus docs/showcase demos — without a library-shipped dropdown."
success_criteria:
  - "completions('2 f') returns multiple ranked QuantityResult readings -> packages/lingo/tests/complete.test.ts"
  - "Every completion text round-trips through parse -> same test file"
  - "./complete marginal size budget green -> packages/lingo/scripts/size.mjs"
  - "Docs site combobox demo renders ranked completions -> apps/site showcase section"
  - "useLingoInput exposes injected completions and headless selection state without importing ./complete at runtime -> packages/lingo/src/react/use-lingo-input.test.tsx"
---

# Ranked completions (autocomplete anything)

Driver: users want search-autocomplete UX over natural-language quantity fields — not
one best parse, but every plausible canonical reading ranked by confidence.

## Design principle

**Completions are full parses, not strings.** Each item carries a successful
`QuantityResult` / `RangeResult` / `ConversionResult` plus a canonical `text`
that `format()` emits and re-parses to the same value (hard rule 4). This is
distinct from **candidate** (failure attachment), **alternative** (success
secondary reading), and **suggestion** (issue string hint) — see `CONTEXT.md`.

## Design (locked-in 2026-07-08)

New entry `@pascal-app/lingo/complete` (not re-exported from `.` — size isolation).

```ts
export type CompletionSource =
  | 'parse'
  | 'alternative'
  | 'unit-ambiguity'
  | 'unit-prefix'
  | 'implied-unit'
  | 'range-implied'
  | 'cross-kind'
  | 'date'

export interface Completion {
  text: string
  result: QuantityResult | RangeResult | ConversionResult | DateResult | DateRange | DurationResult
  confidence: number
  source: CompletionSource
}

export interface CompletionsOptions extends LingoOptions {
  limit?: number
  /** Unit refs to fan out for bare numbers and range tails. */
  units?: readonly string[]
  impliedLimit?: number
  /** Inject `parseDate` / `parseDateRange` / `parseDuration` for date completions without bundling `./date`. */
  date?: (input: string) => DateResult | DateRange | DurationResult | DateFail | DateRangeFail
}

function completions(input: string, opts?: CompletionsOptions): Completion[]
```

Generation flow:

1. Parse with forgiving strictness (completions explore; callers escalate separately).
2. Primary ok result → `source: 'parse'`.
3. `result.alternatives` → `source: 'alternative'`.
4. `AMBIGUOUS_UNIT` on primary → fan out `matchUnitsAt` hits, rewrite `value + alias`, re-parse → `source: 'unit-ambiguity'`.
5. Primary failure with field `kind` and `KIND_MISMATCH` / `RANGE_KIND_MISMATCH` → one kind-free re-parse → `source: 'cross-kind'` so valid readings from another kind are still visible.
6. Injected `date` parser succeeds with a date/date-range/duration result → format a canonical text that the same injected parser re-accepts → `source: 'date'`. `./complete` never imports `./date` at runtime.
7. Incomplete tail (`partialState === 'incomplete'`, last token is a word prefix) → `Registry.aliasCompletions(prefix)` with a deeper candidate pool → everyday-first re-ranking from the curated per-kind unit table → rewrite + re-parse → `source: 'unit-prefix'`. Range tails use kind inferred from the left unit for prefix filtering.
8. Bare number + `kind` or `units` → curated units of kind → rewrite + re-parse → `source: 'implied-unit'`.
9. Open range with bare/partial trailing bound (`10 kg to 16`, `5 to 10`, `between 5 and 10`) → fan out units → `source: 'range-implied'`. Left-side unit kind wins over field `kind` when they differ.

Dedupe by canonical `text`, sort by `confidence` descending, cap at `limit` (default 10).

DOM: `LingoInputOptions` gains injected `complete?` and `onComplete?` hooks — no
bundled dropdown (plan 008 non-goal stands; site builds the combobox demo).

### React bridge (locked-in 2026-07-20)

`useLingoInput()` forwards the same injected completion provider and owns only
the state that every React combobox would otherwise have to rebuild:

```ts
interface UseLingoInputResult {
  completions: readonly Completion[]
  highlightedIndex: number
  setHighlightedIndex(index: number): void
  selectCompletion(index?: number): void
}
```

New completion lists reset highlighting to the first ranked result; an empty
list uses `-1`. `setHighlightedIndex()` clamps to the current list.
`selectCompletion()` defaults to the highlighted result, writes that
completion's canonical `text` through the existing controller, commits it, and
collapses the hook's list.

`Completion` remains a type-only import and the provider remains injected:
`./react` never imports the `./complete` orchestrator at runtime. Popup markup,
option ids, styling, and keyboard policy remain caller-owned.

## Changes

1. `Registry.aliasCompletions(prefix, kind?, limit?)` — ranked prefix expansion.
2. `packages/lingo/src/complete/` — `completions()` orchestrator.
3. `packages/lingo/package.json` + `tsup.config.ts` — `./complete` entry.
4. `packages/lingo/src/dom/` — injected hooks on controller.
5. `packages/lingo/src/react/` — injected provider bridge, completion state,
   and headless selection helpers.
6. `apps/site/` — combobox showcase + docs section.
7. Tests, bench case, corpus (ADDITIVE only), CHANGELOG, README, llms.txt.

## Non-goals

- Library-shipped dropdown/combobox UI.
- Cross-kind fan-out for bare numbers without `kind` (explosion risk).

## Acceptance

`bun run check` green; bench case for `completions('2 f')`; React bridge tests
green; site demo works with keyboard navigation and the existing ARIA contract.
