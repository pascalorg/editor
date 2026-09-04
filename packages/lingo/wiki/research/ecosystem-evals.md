# lingo as an eval grader (research 2026-07-05)

Research pass 2026-07-05, part of plan 024's ecosystem study. Frameworks: promptfoo,
Braintrust autoevals + the core `braintrust` SDK, Vitest-native runners (plain Vitest +
AI SDK, evalite, vitest-evals), LangSmith + openevals, and OpenAI's `graders`
primitive. The autoevals/braintrust claims below were re-verified today directly
against the shipped packages — `npm pack`/`npm install` and executing the real
`NumericDiff`/`JSONDiff`/`Levenshtein` functions, and reading the shipped `.d.ts` —
not taken on the strength of the earlier research brief alone. One figure from that
brief needed correcting as a result; see "the verified bug" below.

**Versions verified** (npm `latest` dist-tag, re-checked 2026-07-05): `autoevals@0.3.0`
(also PyPI `autoevals==0.3.0`) · `braintrust@3.20.0` · `promptfoo@0.121.17` (published
2026-06-16) · `ai@7.0.15` · `evalite@0.19.0` · `vitest-evals@0.14.0` · `openevals@0.2.0`.

## The framing: a normalization pass, not a fifth judge

Every framework surveyed lets you plug in an arbitrary deterministic scorer — a
promptfoo `javascript` assertion, an autoevals/braintrust function returning a
`Score`, a Vitest matcher, a LangSmith evaluator. None of them ship one that knows a
unit from a bare string, or a calendar day from an ISO timestamp. That's lingo's
actual opening here, and it's narrower than it sounds: lingo is not a **fifth judge**
competing with Factuality/G-Eval-style LLM graders. It's a **normalization pass that
runs before any diff.** Canonicalize the model's raw output *and* the fixture/expected
value through the same `quantityField`/`dateField`, then hand the comparator two
same-unit floats (or two grain-truncated date strings) instead of two incomparable
raw strings. Every scorer downstream — a relative-difference float, a Levenshtein
ratio, an LLM judge — already knows how to compare two like-shaped things; the actual
gap in every framework below is upstream of that, in the shape mismatch itself. This
is the one framing that reads identically across promptfoo, autoevals, Vitest, and
LangSmith, and it's the headline for any lingo eval documentation: not "lingo grades,"
but "lingo makes the existing grader's job well-defined."

## The verified bug: two shipped scorers that can't see units

**`NumericDiff` is unit-blind.** autoevals' `NumericDiff` (`js/number.ts`, exported
from the package root) is a symmetric relative-difference score with no unit,
dimension, or magnitude-normalization logic anywhere in the file:

```ts
export const NumericDiff: ScorerWithPartial<number, {}> = makePartial(async (args) => {
  const { output, expected } = args
  const score =
    output === 0 && expected === 0
      ? 1
      : 1 - Math.abs(expected - output) / (Math.abs(expected) + Math.abs(output))
  return { name: 'NumericDiff', score }
}, 'NumericDiff')
```

Run directly against the installed `autoevals@0.3.0` package:
`NumericDiff({ output: 5000, expected: 5 })` scores **0.0020**. Grams and kilograms of
the identical physical mass — a semantically perfect extraction — reads as almost
total disagreement, because the scorer has no notion that `5000` and `5` might carry
different units. The formula has been unchanged since it was introduced (PR #16,
2023-09-13); its only later touch was a dependency-only refactor (#146, 2025-09-08) —
this isn't a stale corner case, it's the scorer's whole design.
(https://github.com/braintrustdata/autoevals/blob/main/js/number.ts)

**`JSONDiff` silently downgrades to string similarity on a type mismatch.**
`JSONDiff`'s recursive comparator (`js/json.ts`) branches on each leaf's JS runtime
type: string-vs-string uses its `stringScorer` (default `Levenshtein`), number-vs-number
uses its `numberScorer` (default `NumericDiff`) — but any pairing that matches neither,
including a string against a number, falls to an `else` branch that `JSON.stringify`s
both sides and runs the *string* scorer on the stringified pair:

```ts
} else {
  return (await stringScorer({
    output: JSON.stringify(o1, replacer),
    expected: JSON.stringify(o2, replacer),
  })).score
}
```

That's exactly the shape of a raw, not-yet-canonicalized model completion graded
against a canonical numeric fixture. Run directly: `JSONDiff({ output: '2 lbs',
expected: 0.907 })` — a raw completion against its correct value in kilograms — scores
**exactly 0**, not just "near zero." `JSON.stringify('2 lbs')` is `'"2 lbs"'` (7
characters) and `JSON.stringify(0.907)` is `'0.907'` (5 characters); the two share no
characters at all, so Levenshtein distance hits the maximum possible (7) and the
similarity score bottoms out at 0. This is the corrected figure — the source research
brief this doc is based on verified the same fallback with a different fixture value,
`JSONDiff({ output: '2 lbs', expected: 2 })`, and got **0.143** (`JSON.stringify(2)` is
`'2'`, one character, which happens to appear inside `'"2 lbs"'`, so distance drops to
6 of 7). Both numbers are real and both are worthless as correctness signals: the score
is an artifact of how many digits/characters the two stringified forms coincidentally
share, not a measure of numeric equivalence. A lingo integration piping a raw NL
quantity string into a `JSONDiff`-scored eval against a canonicalized fixture (or vice
versa) gets a plausible-looking but semantically meaningless number instead of a
numeric-equivalence check or an error.
(https://github.com/braintrustdata/autoevals/blob/main/js/json.ts)

The fix in both cases is the same: canonicalize both sides through the same field
*before* either scorer runs, so `numberScorer`/`NumericDiff` only ever sees two
same-unit floats.

## Framework call-sites

**promptfoo** loads custom assertions as ordinary Node modules —
`file://path.js:exportName`, receiving `(output, context)` where `context.vars` carries
per-test fixture data and `context.config` carries the assertion's static config —
confirmed against the shipped `examples/eval-javascript-assert-external/` files, not
just docs prose. A lingo grader drops in directly:

```js
// lingo-grader.js
const { quantityField } = require('@pascal-app/lingo/ai')

module.exports = {
  quantityMatch: (output, context) => {
    const { kind, unit, tolerance = 0.02 } = context.config
    const field = quantityField({ kind, unit })
    const got = field.safeParse(output)
    const want = field.safeParse(context.vars.expected)
    if (!('value' in got)) return { pass: false, score: 0, reason: got.issues[0].message }
    if (!('value' in want)) return { pass: false, score: 0, reason: `bad fixture: ${want.issues[0].message}` }
    const relErr = Math.abs(got.value - want.value) / Math.max(Math.abs(want.value), 1e-9)
    return { pass: relErr <= tolerance, score: Math.max(0, 1 - relErr), reason: `${got.value} vs ${want.value} ${unit}` }
  },
}
```

```yaml
defaultTest:
  assert:
    - type: javascript
      value: file://lingo-grader.js:quantityMatch
      config: { kind: mass, unit: kg, tolerance: 0.02 }
tests:
  - vars: { expected: "2 lbs 3 oz" }
```

Return type is `JavascriptAssertionResult = boolean | number | GradingResult`,
`GradingResult = { pass, score, reason, componentResults? }` — exactly `{ pass, score,
reason }`. (https://github.com/promptfoo/promptfoo/blob/main/examples/eval-javascript-assert-external/,
https://www.promptfoo.dev/docs/configuration/expected-outputs/)

**Braintrust autoevals — write a plain function; a common type import is wrong.** The
natural instinct is to type a custom scorer against autoevals' exported `Scorer` type
(`type Scorer<Output, Extra> = (args: {output: Output; expected?: Output} & Extra) =>
Score | Promise<Score>`, `Score = {name, score, metadata?}`). That type is real and
current — defined in `autoevals/js/score.ts`, re-exported from `autoevals`'s root — but
it is **not** what `Eval()`'s `scores` array actually wants. Re-verified directly
against the shipped `braintrust@3.20.0` `.d.ts` and `package.json` `exports` map:
`Evaluator.scores?: EvalScorer<Input, Output, Expected, Metadata>[]`, where

```ts
type EvalScorerArgs<Input, Output, Expected, Metadata> =
  EvalCase<Input, Expected, Metadata> & { output: Output; trace?: Trace }
type OneOrMoreScores = Score | number | null | Array<Score>
type EvalScorer<Input, Output, Expected, Metadata> =
  (args: EvalScorerArgs<Input, Output, Expected, Metadata>) => OneOrMoreScores | Promise<OneOrMoreScores>
```

`EvalScorer` is exported from `braintrust`'s package root; `Scorer`/`Score`/`ScorerArgs`
are not — they live only in `autoevals`, or behind the separate `braintrust/util`
subpath that package declares in its own `exports` map. The differences are
load-bearing, not cosmetic: `EvalScorer`'s callback also receives dataset
`input`/`metadata`/`tags`/`trace`, not a free `& Extra` bag, and its return type
additionally accepts a bare `number`, `null`, or `Array<Score>`. The fix is simpler
than picking the "right" type: write a plain function and let TypeScript's contextual
typing against `scores: EvalScorer<...>[]` do the work — no import needed at all, the
same pattern Braintrust's own quickstart uses internally.

```ts
import { Eval } from 'braintrust'
import { quantityField } from '@pascal-app/lingo/ai'

const lingoQuantity = (kind: string, unit: string, tolerance = 0.02) => {
  const field = quantityField({ kind, unit })
  // Plain function — no `Scorer` import. Contextual typing against
  // `scores: EvalScorer<...>[]` infers the shape from here.
  return ({ output, expected }: { output: string; expected?: string }) => {
    const got = field.safeParse(output)
    const want = field.safeParse(expected)
    if (!('value' in got) || !('value' in want)) return { name: 'LingoQuantityMatch', score: 0 }
    const relErr = Math.abs(got.value - want.value) / Math.max(Math.abs(want.value), 1e-9)
    return { name: 'LingoQuantityMatch', score: relErr <= tolerance ? 1 : Math.max(0, 1 - relErr) }
  }
}

Eval('weight-extraction', {
  data: () => [/* … */],
  task: callModel,
  scores: [lingoQuantity('mass', 'kg', 0.02)],
})
```

(https://www.braintrust.dev/docs/platform/experiments/write,
https://www.braintrust.dev/docs/reference/autoevals). For tool-*argument* grading via
`JSONDiff` specifically, canonicalize with `canonicalizeValues()` before scoring —
overriding `numberScorer` can't fix this, since `numberScorer` never fires on the
string-vs-number branch that caused the bug above; only pre-normalizing both sides
does.

**Vitest-native — the same helper, three ways.** Three live options in mid-2026, all
accepting an arbitrary scorer/judge function, so the identical `quantityMatch`/
`dateMatch` (below) works unmodified in each: plain Vitest + the AI SDK
(`describe.concurrent`, real model calls, no mocking — pattern verified at
https://xata.io/blog/llm-evals-with-vercel-ai-and-vitest, `ai@7.0.15`), `evalite`
(custom scorers over a local trace UI — https://github.com/mattpocock/evalite,
`evalite@0.19.0`), and `vitest-evals` (`describeEval(name, { data, task, scorers })` —
https://github.com/getsentry/vitest-evals, `vitest-evals@0.14.0`). Once both sides are
canonicalized to the same unit, plain Vitest doesn't even need a custom scorer:
`expect(got).toBeCloseTo(want, digits)`.

**LangSmith.** `langsmith/vitest` gives `ls.describe`/`ls.test({ inputs,
referenceOutputs }, fn)` plus `expect()`, and `ls.wrapEvaluator(fn)` for a custom
`{ key, score }` evaluator (https://docs.langchain.com/langsmith/vitest-jest).
`openevals@0.2.0` (https://github.com/langchain-ai/openevals) adds `createLLMAsJudge`
for the cases that actually need judgment — which, per OpenAI's own guidance below,
should stay out of the numeric-equality path.

## OpenAI: a graders gap, and a sunsetting product

OpenAI's `graders` primitive (`string_check`, `text_similarity`, `score_model`,
`python`, `multi`; https://developers.openai.com/api/docs/guides/graders) has no
numeric-tolerance or date-grain grader either — `text_similarity`'s metrics
(fuzzy_match, bleu, rouge, cosine) are all string metrics and would mis-grade
`"5'11\""` against `"180 cm"` exactly as badly as autoevals' `Levenshtein` does above.
OpenAI's own best-practices guide recommends a *strong* judge model for `score_model`
and validating it against human labels
(https://developers.openai.com/api/docs/guides/evaluation-best-practices) — i.e. even
OpenAI steers away from LLM-judging anything a deterministic check could settle, and
numeric/unit/date equality is exactly that.

That gap is worth documenting but not worth building product-specific tooling
against: OpenAI is deprecating the Evals *product* outright. Re-verified directly
2026-07-05: **"Evals will become read-only for existing users on October 31, 2026, and
the platform is scheduled to shut down on November 30, 2026"**
(https://developers.openai.com/api/docs/guides/evals). Any bespoke OpenAI-Evals-specific
plumbing has under five months of remaining lifespan as of this pass — deprioritize it
in favor of the frameworks above, which are either established and actively maintained
(promptfoo, autoevals/braintrust, LangSmith) or, for evalite/vitest-evals, young enough
that a documented recipe costs little to keep current.

## The recommendation: two pure functions, not a dependency

Ship — or, pending the decision below, document as a recipe — two tiny,
framework-agnostic functions rather than importing any of the above as a dependency;
the zero-deps hard rule (AGENTS.md) applies here exactly as everywhere else in lingo:

```ts
function quantityMatch(
  actual: string | number,
  expected: string | number,
  opts: { kind?: Kind; unit: string; tolerance?: number },
): { pass: boolean; score: number; reason: string }

function dateMatch(
  actual: string,
  expected: string,
  opts: { grain: DateGrain; timeZone?: string },
): { pass: boolean; score: number; reason: string }
```

Both parse `actual` and `expected` through the same `quantityField`/`dateField` (the
normalization pass above), then compare the canonical values — a relative-tolerance
check for quantities, a grain-truncated string compare for dates. `{ pass, score,
reason }` is duck-typed on purpose: it's already promptfoo's `GradingResult` verbatim,
needs only a `name` rename for autoevals'/braintrust's `Score`, drops straight into a
plain Vitest `expect(result.pass).toBe(true)`, and maps onto LangSmith's `{ key, score
}` with one field rename. No framework type gets imported; neither function becomes a
peer dependency of anything.

`dateMatch`'s grain-awareness is the genuinely novel half. Every quantity-comparison
gap above is at least partly addressable by hand (round both sides, eyeball a
relative-difference score) — but no framework surveyed grades "got the right day."
lingo already has `grain` as a first-class concept (`DateGrain = 'year' | 'month' |
'week' | 'day' | 'hour' | 'minute' | 'second'`, the same vocabulary `humanize*()` uses
internally to round-trip within one display-grain of the original instant); reusing it
here lets a delivery-estimate or appointment-booking eval assert "same calendar day in
`America/New_York`" against a model that said "in 3 business days," instead of failing
on inherent minute-level clock drift or demanding exact-ISO-instant equality.

## Implications for lingo

The normalization-pass framing and the two-function shape are the durable findings of
this pass. Two calls remain genuinely open, and both belong to the owner, not to this
document:

- **Ship vs. recipe.** Whether `quantityMatch`/`dateMatch` become an exported
  `@pascal-app/lingo/ai` surface (own entry, own size budget) or stay copy-paste docs
  recipes is an explicit owner decision, not a default — plan 024 tracks it as an open
  question.
- **Tolerance defaults are caller-supplied.** There is no universally correct default
  relative tolerance (2%? an absolute epsilon? unit-dependent?), and shipping one
  risks false confidence when a caller forgets to override it — the same reasoning
  that already keeps `quantityField`'s own `min`/`max` caller-supplied rather than
  defaulted.

Both decisions live in `plans/024-ecosystem-integration-and-docs.md`; this document's
job is the verified "why" behind them, not the "whether."

## Sources

- Braintrust autoevals — `js/number.ts` (`NumericDiff`), `js/json.ts` (`JSONDiff`,
  `jsonDiff`), `js/string.ts` (`Levenshtein`): https://github.com/braintrustdata/autoevals
  (re-run directly against the installed `autoevals@0.3.0` package, 2026-07-05)
- Braintrust SDK — `EvalScorer`/`Evaluator` types, shipped `braintrust@3.20.0` `.d.ts`
  and `exports` map: https://github.com/braintrustdata/braintrust-sdk-javascript ·
  https://www.braintrust.dev/docs/platform/experiments/write ·
  https://www.braintrust.dev/docs/reference/autoevals
- promptfoo custom JS assertions:
  https://github.com/promptfoo/promptfoo/blob/main/examples/eval-javascript-assert-external/
  · https://www.promptfoo.dev/docs/configuration/expected-outputs/
- Vitest-native runners — https://xata.io/blog/llm-evals-with-vercel-ai-and-vitest ·
  https://github.com/mattpocock/evalite · https://github.com/getsentry/vitest-evals
- LangSmith — https://docs.langchain.com/langsmith/vitest-jest ·
  https://github.com/langchain-ai/openevals
- OpenAI — https://developers.openai.com/api/docs/guides/graders ·
  https://developers.openai.com/api/docs/guides/evaluation-best-practices ·
  https://developers.openai.com/api/docs/guides/evals (deprecation dates, fetched
  2026-07-05)

Cross-reference: `plans/024-ecosystem-integration-and-docs.md` (the plan this research
feeds); `wiki/research/ai-structured-output.md` (the companion pass on the AI SDK /
Standard Schema surface `quantityField`/`dateField` already implement).
