---
id: 032
title: Input calculations (quantity arithmetic)
status: draft
created: 2026-07-08
updated: 2026-07-29
goal: "Decide whether (and how) lingo evaluates arithmetic typed into fields — '=2+3 kg', '10% off $50', '12 * 0.75 kg' — without becoming a CAS or busting budgets, and close the operator/range collision that already ships."
success_criteria:
  - "Go/no-go decision recorded as a D-entry -> wiki/decisions.md"
  - "Bare-mode `2+3 kg` no longer silently returns a range -> packages/lingo/tests/corpus + parse tests"
  - "If go: node union and operator table locked here, corpus rows added -> this plan + tests/corpus"
  - "If go: `./calc` marginal budget assigned and green -> packages/lingo/scripts/size.mjs"
---

# Input calculations (quantity arithmetic)

Driver: owner request 2026-07-08 — users type light math into quantity fields
("2+3 kg", "half of 10 L", "10% off $50") and expect the field (and
autocomplete) to resolve it. Re-scoped 2026-07-29 after a prior-art pass over
[mathjs expressions](https://mathjs.org/docs/expressions/index.html) plus a
probe of what the current parser actually does with arithmetic. Two things
changed: the collision this plan worried about is already producing wrong
answers, and the strongest argument for the feature turned out to be the LLM
boundary, not the form field.

## Design principle

**Calculator, not CAS — and the model shows its work, lingo does the math.**

Evaluate a closed, tiny arithmetic surface over already-parsed same-kind
quantities. No symbols, no variables, no dimensional algebra (D2 stands;
kg·m/s² is out of scope), no assignment, no functions. If an expression needs a
scope object, it's out of scope.

The second half is the reason the feature is worth its bytes. An LLM asked for
`weight_kg: number` must do the multiplication and the unit conversion in its
head, and nothing downstream can tell a correct `0.907` from a hallucinated
one — the failure mode plan 019's research pass documented as `value_error`.
A field that accepts `"12 * 0.75 kg"` and evaluates it deterministically moves
the arithmetic out of the model and into the library. Models are unreliable at
computing and reliable at *setting up* a computation; this exploits exactly
that split.

## What ships today (probed 2026-07-29)

Not hypothetical future risk — current `lingo()` behavior on inputs users type:

| Input | Today | Verdict |
|---|---|---|
| `2+3 kg` | range 2–3 kg, `confidence: 1`, **zero issues** | Silent wrong answer |
| `2+4 kg` | `TRAILING_INPUT` | Inconsistent with the row above |
| `5 kg - 2 kg` | range 2–5 kg + `RANGE_REVERSED` | Wrong, but warned |
| `20°C + 5°C` | 25 °C, zero issues | Right math, unstated semantics |
| `0°C + 100°F` | 55.56 °C, zero issues | Right math, unstated semantics |

`2+3 kg` is the one that matters. It contradicts D4 more directly than anything
else in the parser: a deterministic wrong reading at full confidence with no
alternative and no warning.

The cause is `tryAdjacentCjkRange` (`parse/range.ts`), the path behind D68's
CJK adjacent-number implicit ranges (`七八天` = 7–8 days). Despite the name,
nothing in it is CJK-specific: it checks only that the next token has no
preceding space and that a re-parse from that token yields exactly `a + 1`. For
`2+3 kg` the `+` is consumed as a compound-plus sign, the re-parse returns 3,
and 3 === 2+1, so a range is built. That's why `2+3` and `3+4` become ranges
while `2+4` and `9+10` fail — the guard is `value >= 1 && value < 9`, not
anything about script. D68's own rule ("三三 stays rejected") was only ever
meant to fire on CJK juxtaposition.

The signal it should be consulting already exists one layer down:
`parseCjkNumberText` (`number/cjk.ts`) returns an explicit `adjacentRange: true`
flag on genuine CJK juxtaposition. The fix is to gate the range path on that
flag instead of on a script-blind re-parse.

**This gets fixed regardless of the go/no-go below.** Bare mode does no
arithmetic, uniformly: `2+3 kg` joins `2+4 kg` as `TRAILING_INPUT`. Corpus drift
here is a previously-`ok` row turning into a failure, so `corpus-diff.mjs` will
class it BREAKING — it needs an explicit owner acknowledgement in the same
change rather than a reclassification.

## Prior-art evaluation

### mathjs expression trees (studied 2026-07-08, revisited 2026-07-29)

- **Take:** the small typed node union as the internal representation, the
  parse-then-evaluate split (grammar produces a tree; evaluation is a separate
  pure fold), and `toString` discipline (canonical emission that re-parses —
  our hard rule 4). Also its **percentage operators**: `100 + 3%` → `103` is a
  dedicated operator distinct from modulus, and that family is the highest-value
  slice for forms (see phase 1).
- **Reject:** symbols/scopes, function nodes, matrices/objects/ranges as
  expression citizens, `compile()` codegen, implicit multiplication (`2 pi`),
  BigNumber/Fraction numeric types, symbolic simplify/derivative, physical
  constants. mathjs is ~500 kB+; the zero-deps rule (D1) means this is a study,
  never a dependency.
- **Security is a design input, not an afterthought.** mathjs ships a whole
  security page because it evaluates arbitrary code. At an LLM tool boundary
  that is an attack surface. A closed node union has none — the grammar cannot
  express a side effect, a property access, or a call. That guarantee is worth
  stating in the docs, not just holding internally.
- **Hazards mathjs documents:** case traps (`C` = coulomb — we already emit
  `AMBIGUOUS_UNIT`), unit symbols colliding with operator tokens (`in` reads as
  inches, `-` is also a range separator), and affine-unit arithmetic, on which
  its own advice is "avoid calculations using celsius and fahrenheit."

### The `=` escape hatch (Excel / Sheets / Notion / Airtable)

The most-used form software on earth resolves exactly our `-`-means-range
collision with a leading `=` mode switch. Soulver, Numi, Raycast and Spotlight
do the same thing with a dedicated surface. `=2+3 kg` currently fails with
`NO_VALUE`, so the prefix is free.

### Pint (Python) `delta_degC`

Prior art for making affine-delta semantics explicit in the type rather than
warning users off the operation. We already have the `convert`/`convertDelta`
split (from js-quantities, per `wiki/inspiration.md`); the compound path just
never said which one it was using.

## Design (proposed — not locked; gated on the go/no-go)

### The compound/arithmetic discriminator

The rule that keeps this additive:

- **Both operands carry units** → compound accumulation. Existing behavior,
  unchanged: `2 ft + 3 in`, `2 kg + 500 g`, `2 m minus 10 cm`.
- **A bare operand, or any non-additive operator** → arithmetic, which lives in
  `./calc` and never in `lingo()`.

So `lingo('2+3 kg')` fails and `calc('2+3 kg')` gives 5 kg, and no input changes
meaning based on which entries a consumer imported.

### `=` is a field-level mode switch, not grammar

`calc()` accepts an expression with or without the prefix. The prefix matters
only where one text box feeds both parsers — `completions()` and the DOM
controller — so that bare input keeps today's range-first semantics with zero
corpus churn:

```ts
interface CalcOptions extends LingoOptions {
  /** '=' (default): only treat input as an expression when prefixed. */
  trigger?: '=' | 'always'
}

function calc(input: string, opts?: CalcOptions): CalcResult | CalcFail
```

### Node union and operators

Closed union, five node types, no extension point:

```ts
type CalcNode =
  | { type: 'number';   value: number;              span: Span }
  | { type: 'quantity'; value: Quantity;            span: Span }
  | { type: 'group';    node: CalcNode;             span: Span }
  | { type: 'percent';  of: CalcNode; percent: CalcNode; mode: 'of' | 'add' | 'off'; span: Span }
  | { type: 'op';       op: '+' | '-' | '*' | '/'; left: CalcNode; right: CalcNode; span: Span }
```

Every node carries a span into the ORIGINAL input (hard rule 3), so issues point
at the offending operand and a UI can highlight it.

Operand rules, and the issue code when they're violated:

| Form | Result | Rule |
|---|---|---|
| `q + q`, `q - q` | quantity | Same kind only, else `EXPRESSION_KIND_MISMATCH` |
| `n + q`, `q + n` | quantity | Bare operand inherits the other side's unit |
| `q * n`, `n * q` | quantity | Exactly one operand may be a quantity, else `SCALAR_EXPECTED` |
| `q / n` | quantity | Divisor must be scalar |
| `q / q` | number | Same-kind division cancels to a dimensionless ratio (phase 3) |
| `q * q` | rejected | `SCALAR_EXPECTED` — this is dimensional algebra (D2) |
| `x / 0` | rejected | `DIVISION_BY_ZERO` |

`q * q` being refused is load-bearing: it's the line that keeps this a
calculator instead of the start of a unit algebra.

### Affine arithmetic — resolved, not open

The plan previously listed "refuse or delta-convert" as an open question. The
probe answers it: **lingo already delta-converts**, and correctly.
`0°C + 100°F` → 55.56 °C is 100 Fahrenheit-*degrees* of rise, not 100 °F
converted absolutely. That's the right reading and better than mathjs, which
tells you not to try.

The defect is silence, not math. Additive arithmetic on an affine unit emits a
new warning: `AFFINE_DELTA_ASSUMED` (past-tense, per the applied-forgiveness
naming convention), carrying the operand span and the delta reading in `data`.
This applies to the **existing compound path too**, so it lands even if the
go/no-go comes back no.

### Phasing

1. **Percent-of family.** `10% off $50`, `$60 + 20% tip`, `15% of 60 kg`,
   `$100 + 8.875% tax`. No collision with ranges at all — `%` plus `of`/`off`/
   `on` are unambiguous markers — and it's the arithmetic people actually type
   into money forms. Shippable without the general expression grammar.
2. **Operators + grouping.** `+ - * /`, parentheses, precedence.
3. **Ratios and word multipliers.** `q / q` → number; `half of 10 L`, `twice
   3 kg`, `double`, reusing the existing number-word lexicon.

### Where it lands

- New entry `@pascal-app/lingo/calc`. The main entry does not grow — no import,
  no re-export, budget stays flat. `./calc` gets its own marginal budget line in
  `size.mjs` at implementation time.
- `./complete` gains a `'calc'` `CompletionSource`, fed by an **injected**
  evaluator exactly like plan 031 injects `date` — `./complete` never imports
  `./calc` at runtime. Evaluated results surface as a ranked completion
  (`= 45 USD`) with the tree attached for the UI to explain, rather than
  silently committing into the field.
- `./ai`: `quantityField` and `rangeField` accept an injected `calc` evaluator
  under the same rule, so `./ai`'s budget doesn't move either:

```ts
import { calc } from '@pascal-app/lingo/calc'

quantityField({ unit: 'kg', calc })   // accepts "12 * 0.75 kg" -> 9
```

  When `calc` is injected, the emitted JSON Schema `description` must tell the
  model it may submit an expression — a capability the model can't use if it
  doesn't know it has it. `CalcResult` carries the evaluated tree so a tool can
  log or display the work; the field itself still returns a plain number
  (or `QuantityJSON` under `output: 'quantity'`), so the wire shape at the tool
  boundary is unchanged.

### Vocabulary

`expression`, `node`, and `calc` are new nouns. If this ships, `CONTEXT.md`
gains entries for them in the same change, with the *Avoid* list naming
"formula" and "AST", and an explicit note that a calc `node`'s `span` is a span
(the range/span collision `CONTEXT.md` already flags as the one that bites).

## Changes

1. `packages/lingo/src/parse/range.ts` — gate `tryAdjacentCjkRange` on the
   `adjacentRange` flag already returned by `parseCjkNumberText`
   (`number/cjk.ts`) instead of a script-blind `a + 1` re-parse (the `2+3 kg`
   fix). Keep D68's `七八天` corpus rows green.
2. `packages/lingo/src/parse/quantity.ts` — emit `AFFINE_DELTA_ASSUMED` on
   additive compounds over affine units.
3. `packages/lingo/src/core/types.ts` — new issue codes (add-only, per
   conventions): `AFFINE_DELTA_ASSUMED`, `EXPRESSION_KIND_MISMATCH`,
   `SCALAR_EXPECTED`, `DIVISION_BY_ZERO`, each with a typed `IssueDataMap` entry.
4. `packages/lingo/src/calc/` — grammar (tree), evaluator (pure fold),
   `toString` canonical emission.
5. `packages/lingo/package.json` + `tsup.config.ts` — `./calc` entry.
6. `packages/lingo/src/complete/` — `'calc'` completion source, injected.
7. `packages/lingo/src/ai/` — injected `calc` option + schema description.
8. `packages/lingo/scripts/size.mjs` — `./calc` marginal budget.
9. Tests (incl. two-way for every emitted result), corpus rows, `ai-eval.mjs`
   category for expression-valued tool arguments, CHANGELOG, README, llms.txt,
   `wiki/inspiration.md`, `CONTEXT.md`.

## Non-goals

- Dimensional algebra / compound-dimension arithmetic (D2, plan 000).
- Variables, scopes, assignment, functions, matrices, multi-statement blocks,
  constants, trig/log/statistics, arbitrary-precision numerics.
- Shipping or depending on mathjs.
- Changing any bare-input reading other than the `2+3 kg` bug fix.
- Rates with non-unit denominators (`£45 per night`, `50 kg per person`) — a
  bigger form win, but a wire-schema change and a separate plan. Parked in
  `backlog.md`.

## Open questions

- **Go/no-go on phases 2–3.** Is a general calculator inside a form field a
  feature or a trap? Owner call + a D-entry either way. Phase 1 (percent-of) and
  the two defect fixes stand on their own and could land first.
- **Corpus classification for the `2+3 kg` fix.** BREAKING by the script's
  definition; needs owner acknowledgement, not a reclassification.
- **Does `q / q` → number earn its bytes?** Useful ("how many 2 L bottles in
  10 L"), but it's the only rule that changes result *type*, which complicates
  the `./ai` field contract.

## Acceptance

Decision D-entry exists. The `2+3 kg` and `AFFINE_DELTA_ASSUMED` fixes ship with
corpus coverage regardless of that decision. If go: node union and operator
table locked here, corpus rows added, `./calc` budget assigned in `size.mjs` and
green, two-way tests for every emitted result, and an `ai-eval.mjs` category
showing expression-valued arguments beat naive number-valued ones on silent-wrong
rate.
