# LLM & agent formatting failures in quantities/units/dates — evidence, taxonomy, eval design

Research pass 2026-07-04 (web research + direct verification: GitHub API, arXiv HTML,
Node.js runtime checks). Companion to
[`wiki/research/ai-structured-output.md`](ai-structured-output.md), which covers the
*integration architecture* (Standard Schema, AI SDK repair hooks); this pass covers the
*evidentiary case* — do LLMs and computer-use agents actually make quantity/unit/date
formatting mistakes, what does constrained decoding fix vs. not fix, what retries cost,
and how would we demonstrate lingo's value honestly without live API calls in CI.

**Method note**: every citation below was checked against a primary source (arXiv HTML/abstract
fetch, GitHub API, or a runtime check in this repo's Node) rather than trusted from a single
research pass. Confidence tags — **documented** (primary source, verified), **anecdotal**
(real but small-sample/vendor-interested/unconfirmed), **inferred** (our extrapolation, not
stated anywhere) — reflect that verification, not just the source type.

## Positioning sentences (verbatim-usable)

1. Constrained decoding guarantees the JSON parses; lingo guarantees the values mean what they should.
2. JSON-schema `type: number` guarantees a numeral arrives — it cannot guarantee that numeral is in the right unit, the right locale, or even the right *magnitude*.
3. Schema validation catches malformed structure; it is blind to well-formed-but-wrong values — a comma-decimal silently parsed as a thousands separator still satisfies `z.number()`.
4. Structured outputs decide the shape of the box; lingo decides whether what's inside it is honest.
5. Every retry an agent burns on a formatting mismatch is a round trip constrained decoding was supposed to make unnecessary — lingo resolves the formatting before the schema ever has to reject it, at parse-time cost, not another model call.

## 1. The failure-mode taxonomy

| # | mode | example | what JSON-mode / constrained decoding does | what it structurally cannot do | what lingo does | evidence |
|---|------|---------|---------------------------------------------|----------------------------------|------------------|----------|
| 1 | Unit omission | `"180"` in a height field — cm? in? | Guarantees a JSON number arrives (`type: number`). | Cannot know which unit the model had in mind; the ambiguity is invisible once it's a bare float. | Requires/assumes a configured unit explicitly (`UNIT_ASSUMED`, `UNIT_REQUIRED` issue codes) — the assumption becomes a visible, inspectable warning + confidence score instead of a silently accepted float. | inferred (mechanism-level; no LLM-specific incident found — see §5) |
| 2 | Unit embedded in a number-shaped field | `"2kg"`, `"5'11\""` sent where a bare number is expected | `type: number` schemas reject this at the JSON-syntax level outright (not valid JSON number); `type: string` schemas accept it syntactically. | Downstream coercion (`Number("2kg")`) → `NaN`; no path from string to typed unit exists in the schema layer. | `parseQuantity` extracts value + unit + kind, converts to the canonical unit deterministically. | **verified directly** (`Number("2kg")` → `NaN`, Node v24.15.0, this repo) + [C7] BAML "quantity: 1 vs 0.46" anecdote |
| 3 | Locale decimal separator | `"1,5"` meant as 1.5 (fr/de convention) | Nothing — JSON's own number grammar only knows `.` as a decimal point; a model choosing to write `1,5` produces a syntax error under `type: number`, or a silently-swallowed string under `type: string`. | No locale context reaches the validator. | Explicit separator policy, not locale sniffing (`1,5 kg` → 1.5 kg); genuinely ambiguous cases (`1,234`) get `AMBIGUOUS_NUMBER` with ranked alternatives. | **verified directly** (`Number("1,5")` → `NaN`) + inferred for the LLM-specific incidence rate (no citable GitHub issue/paper found — see §5) |
| 4 | Thousands-separator ambiguity | `"1.234"` — one-point-two-three-four, or one thousand two hundred thirty-four? | Same as above — JSON numbers have no grouping-separator concept at all; `1.234` is unambiguously 1.234 *to JSON*, which is exactly the trap (the ambiguity is real in the *source text* the model read, not in the JSON it emits). | Cannot recover which reading the human source intended once collapsed to a bare float. | Same `AMBIGUOUS_NUMBER` treatment as #3, with alternatives ranked by locale plausibility. | inferred (plausible, mechanism confirmed, no direct LLM incident found) |
| 5 | Date format drift / natural language in a date field | `"03/04/2025"` (MM/DD or DD/MM?), or `"next Tuesday"` landing in a field expecting ISO-8601 | `format: date` JSON-Schema annotations (where honored) force the *shape* `YYYY-MM-DD`; some providers don't even enforce `format`, only `type`. | Enforcing shape doesn't resolve which day the ambiguous numeric form meant, and doesn't help if the model writes a relative phrase instead of a date at all. | `parseDate` resolves relative dates off an explicit `now`; `dayFirst` option + `AMBIGUOUS_DATE` issue surfaces the MM/DD-vs-DD/MM fork with both candidates instead of guessing silently. | **verified directly** (`new Date("03/04/2025")` silently parses as March 4 — no error, no signal anything was ambiguous; `new Date("next Tuesday")` → `Invalid Date`) + [C2] apple-health-data-bridge PR #13 (anecdotal), [C3] pydantic-ai #245 (anecdotal, unconfirmed), [C4] opencode #12401 (anecdotal) |
| 6 | Scientific notation | `"3e5"`, `"1.5×10⁵"` | JSON's number grammar *does* permit exponents (`3e5` is valid JSON), so `type: number` schemas pass it fine — this is the one sub-case where naive coercion also survives (`Number("3e5")` → `300000`). | Regex/pattern-based validators layered on top of a schema (common in practice) often don't account for exponent form and reject values the JSON layer already accepted. | Parses scientific notation natively, including unicode superscript compounds (`×10⁵`), normalizing to plain decimal so downstream pattern validators never see the exponent form. | **verified directly** (`Number("3e5")` → `300000`) + [C6] Pydantic #13089 (documented, maintainer-confirmed — general library bug, not LLM-specific, used as a structural analog) + [C5] Outlines #1178 (documented — a *constrained* float-format decoder still emitted unparseable output) |
| 7 | Range in a scalar field | `"5-10"` where one number is expected | `type: number` cannot represent a range at all — the model must silently collapse it to one bound, an average, or fail with no diagnostic distinguishing "model error" from "the source was genuinely a range." | No representation of "this was actually a range" survives once forced into a scalar. | `lingo()`/`parseRange` detect ranges as a first-class shape (`type: 'range'`); `accept.ranges: false` rejects with `SINGLE_VALUE_EXPECTED` and attaches the range as an inspectable `candidate` rather than guessing a bound. | **verified directly** (`Number("5-10")` → `NaN`) — no LLM-specific incident found, treat prevalence as inferred (see §5) |
| 8 | Qualifier/hedge leakage | `"about 5 kg"`, `"approximately 20"`, `"at least 3"` | No mechanism to strip or flag hedge words; a `type: number` field forces the model to silently drop the qualifier (destroying the information that the source was approximate) or fail. | Cannot distinguish "exactly 5" from "about 5" once collapsed to `5`. | Qualifiers are first-class grammar (approximate ranges, "at least" as a bound); `accept.approximations: false` explicitly rejects with `APPROX_NOT_ALLOWED`, preserving *that* the source hedged instead of silently discarding it. | **verified directly** (`Number("about 5")` → `NaN`) — no LLM-specific incident found (see §5) |
| 9 | Typo'd / slang unit | `"5 meterz"`, `"5 kgs"` | An enum-of-units schema (unit as a separate field) rejects unknown tokens outright; a free-text unit embedded in a single string field just passes through as an opaque string. | No did-you-mean; the model either got the unit right or the field is simply wrong with no correction path. | Damerau–Levenshtein suggestions; unique distance-1 matches auto-accept with a `TYPO_CORRECTED` warning riding along on an otherwise successful parse. | inferred/product-internal (this is lingo's own documented behavior per README; no external LLM-specific citation located) |
| 10 | Compound/mixed-unit strings | `"5'11\""`, `"2 lb 3 oz"`, `"1h30"` | Nothing — `type: number` cannot represent a compound at all; the model would have to do the unit arithmetic itself and emit one bare number. | LLMs are documented to be weak at exactly this kind of implicit unit arithmetic. | Compound-chain grammar with a rounding-carry rule (`1.9999 m` → `6′7″`, never `5′12″`). | [C1] Gorilla/BFCL "5% → 5, not 0.05" (documented) + [C8] NUMCoT arXiv 2406.02864 (documented, peer-reviewed) |

Rows 3, 4, 7, 8, 9 are the ones to be most honest about in any external-facing doc: the
*mechanism* (naive coercion breaks on them) is directly verifiable in any JS runtime, but we
found **no citable, LLM-specific incident report** establishing how often real models actually
produce these strings. Treat "LLMs commonly emit range/qualifier/locale-comma content in
number fields" as a plausible, mechanism-supported inference — not a documented fact — until
we run the corpus eval in §6 or find better evidence.

## 2. What constrained decoding guarantees, in its own words

The clearest primary-source statement of the syntax/semantics split, verified directly against
OpenAI's current docs (`developers.openai.com/api/docs/guides/structured-outputs`, live-fetched
2026-07-04) and corroborated via the original announcement post (Michelle Pokrass,
*"Introducing Structured Outputs in the API,"* openai.com, 2024-08-06 — page itself returns
403 to automated fetches, but its exact wording is independently corroborated by multiple
third-party write-ups quoting it verbatim, and by OpenAI's own current docs restating the same
claim):

> "Structured Outputs doesn't prevent all kinds of model mistakes. For example, the model may
> still make mistakes within the values of the JSON object (e.g., getting a step wrong in a
> mathematical equation)." — OpenAI, *Introducing Structured Outputs in the API*, 2024-08-06.
> **[documented]**

> Comparison table, current docs: Structured Outputs "Adheres to schema" — yes; JSON mode
> "Adheres to schema" — no. Neither guarantees the factual/semantic correctness of the values
> inside a schema-conformant response. **[documented, live-verified 2026-07-04]**

Two more data points on the same crux, both independently verified:

- **The Constraint Tax** (Jaideep Ray, arXiv:2605.26128) — quantifies the tradeoff directly for
  small (<3B) models: hard answer-only schema decoding raises schema validity from **61.5% to
  100.0%**, while answer accuracy *drops* from **19.7% to 11.0%**, and "wrong-valid-schema"
  outputs rise from 49.5% to **88.9%**. Abstract/claims independently re-fetched and confirmed
  verbatim. **[documented]** — scope caveat: sub-3B models specifically; directionally relevant
  to larger models but not directly evidenced for them by this paper.
- **Outlines issue #1178** (`dottxt-ai/outlines`, confirmed open via GitHub API) — even a
  properly functioning FSM-based grammar constraint (`generate.format(llm, float)`, which is
  supposed to force float-shaped token output) produced strings like
  `'99.3926785111 3 002 16000000000000'` that raise `ValueError: could not convert string to
  float` downstream — syntax-valid-per-grammar-step but semantically unparseable.
  **[documented]**, reproduced by a second commenter on a different model.
- **ComplexFuncBench** (arXiv:2501.10132, HTML re-fetched and confirmed) — of five named error
  categories (`func_error`, `param_missing`, `hallucination`, `value_error`, `stop_early`),
  **`value_error` is the dominant category across all tested models**, reaching **78.8%** for
  Qwen2.5-72B. This is a quantified statement that *value* correctness — not structural/type
  correctness — is the thing modern function-calling still gets wrong most often.
  **[documented]**

llama.cpp's own GBNF grammar docs (`github.com/ggml-org/llama.cpp/blob/master/grammars/README.md`)
describe grammars as constraining token validity — syntax — not content correctness; this is
the load-bearing framing for every constrained-decoding tool (Outlines, Guidance, XGrammar,
OpenAI/Gemini strict modes): they move the failure point from "invalid JSON" to "valid JSON,
wrong content," they do not eliminate the second failure class. **[documented, mechanism-level]**

Caveat on tone: BAML's blog post *"Structured Outputs Create False Confidence"*
(boundaryml.com) makes the same argument with a concrete anecdote (GPT-5.2 structured output
returns `quantity: 1` for a receipt line item where free-form parsing of the same model
correctly returns `0.46`) but BAML sells a competing structured-output approach — cite the
anecdote, flag the commercial interest if quoting it externally. **[anecdotal, vendor-interested]**

## 3. Retry economics

**What's well-documented:**

- OpenAI's own before/after number for schema-following on complex JSON schemas:
  `gpt-4-0613` scores **under 40%**; `gpt-4o-2024-08-06` with Structured Outputs scores
  **100%** on their internal eval. This is schema-*shape* compliance, not value correctness —
  but it's the best available public evidence for how often naive JSON generation would have
  needed a retry before constrained decoding existed. **[documented]** (OpenAI, Aug 2024)
- **JSONSchemaBench** (arXiv:2501.10868) — unconstrained LM-only schema compliance collapses to
  **13% on "GitHub Hard"** schemas; even the best constrained-decoding framework tested
  (Guidance) reaches only **41%** empirical coverage on the same hard tier (vs. 96–98% on
  easy/simple schemas). **[documented]** — the strongest evidence that failure/retry rates are
  highly schema-complexity-dependent, not a fixed tax.
- **Tool-Reflection-Bench** (arXiv:2509.18847) measures Repair@k — the fraction of tool-call
  *failures* actually fixed by 1/3/5 retry-with-error-feedback attempts. Baseline open models:
  **Repair@1 ≤ 9.6%** — a single naive retry fixes fewer than 1 in 10 failures. Even after
  RL post-training specifically for repair, the best model/setup reaches only **~26% by the
  5th attempt**. **[documented]** — this is the single best piece of evidence that "just
  retry" is a weak, low-yield fix for structured-output failures in general, which strengthens
  the case for fixing formatting *before* validation rather than re-asking after.
- **API-Bank** (EMNLP 2023) — "False API Call Format" (unparseable call) accounts for
  **17.9%–23.7%** of errors depending on model; "Invalid Input Parameters" ≈ 7–8% across
  models — both would trigger a retry in a real pipeline. **[documented]**, though dated
  (pre-dates modern strict/structured-output modes).
- **BAML's BFCL-derived comparison** (boundaryml.com/blog/schema-aligned-parsing, using
  published Berkeley Gorilla/BFCL data, n=1000/model) shows raw function-calling accuracy
  swinging from **19.8%** (gpt-4o-mini) to **87.5%** (gpt-3.5-turbo) depending on model —
  illustrating that "retry-on-failure" cost is extremely model-dependent, not a fixed
  multiplier. **[documented underlying BFCL data; anecdotal/vendor-interested SAP-improvement
  deltas]**

**What's necessarily anecdotal or absent** — flag explicitly, do not cite as fact:

- **No vendor (OpenAI, Anthropic, Vercel AI SDK team, LangSmith) publishes an aggregate
  production retry-rate** ("N% of structured-output calls need ≥1 retry") or a cost/latency
  multiplier per retry. This is a confirmed gap in the public record, not an oversight in our
  search.
- Assorted blog claims of "2–5%" or "5–15%" structured-output failure rates in production
  trace to unattributed SEO-style posts with no stated methodology — **do not cite these
  numbers**.
- The only defensible inference on cost: a retry loop that appends the failed output + error
  message and re-prompts is *at minimum* one additional full model round trip; because failure
  context accumulates in the prompt across retries, the cost is plausibly super-linear in
  retry count, not a clean multiplier — **[inferred]**, not measured anywhere we found.

**Framing for lingo's docs**: don't claim "lingo cuts retry rates by X%" without our own
measurement (see §6) — the honest claim is "the dominant published fix for structured-output
failures (re-ask and hope) has a documented low per-attempt yield (Repair@1 ≤ 9.6%); resolving
formatting deterministically before validation sidesteps that economics entirely, for the
subset of failures that are formatting, not reasoning, errors."

## 4. Computer-use / browser-agent form-filling: an instrumentation gap, not an absence of the problem

This is the most important honesty finding from this research pass. Every browser/computer-use
agent benchmark with a published failure taxonomy is dominated by **grounding** (misclicking,
wrong element) and **navigation/planning** failures — none currently isolates "typed the right
value in the wrong format" as its own measured category:

- **WebVoyager** (arXiv:2401.13919, Table 4, re-verified via HTML fetch): Navigation Stuck
  44.4%, Visual Grounding Issue 24.8%, Hallucination 21.8%, Prompt Misalignment 9.0%. No
  formatting category. **[documented]**
- **OSWorld** (arXiv:2404.07972): *"more than 75% [of failed examples] exist mouse click
  inaccuracies, which is the most common error"* — grounding, not formatting.
  **[documented]**
- **AgentBench**'s "Invalid Format" category and **Workspace-Bench**'s "Format Error" category
  are both about the agent's own **action/output syntax** (malformed JSON/SQL, wrong document
  structure) — not about a value typed into a form field being in the wrong human convention.
  Easy to conflate by name; they are a different failure surface. **[documented, explicitly
  flagged as a different surface]**
- **FormFactory** (arXiv:2506.01520, re-verified via HTML fetch) is the closest benchmark to
  our exact question — it purpose-builds Date and Numeric Input field types. Its own headline
  numbers: click accuracy **below 10%** across field types, end-to-end form completion **under
  2%**. But the authors themselves admit their "Value" metric only checks whether the correct
  value appears *anywhere in the model's output*, "regardless of whether it was actually
  entered into the correct UI location" — and predict stricter scoring "would likely be
  significantly lower." **The benchmark purpose-built to measure this isn't yet instrumented
  to detect wrong-format entry, only wrong-field entry.** **[documented — verified quote]**
- **UI-CUBE** (arXiv:2511.17131) deliberately tests Date Picker and Time Picker tasks and
  reports agents "clicking correct day numbers in wrong months" and, when fields are left
  empty, "invent[ing] plausible but spurious values rather than preserving the emptiness" —
  again, grounding and hallucination mechanisms, not format-convention mismatches.
  **[documented, single-pass-verified]**
- Anthropic's Oct 2024 computer-use post and OpenAI's Operator system card (Jan 2025) both
  name "calendars" and general UI complexity as challenge areas but give no formatting-specific
  example (MM/DD vs DD/MM, unit confusion). The Jul 2025 ChatGPT Agent system card has **no**
  content on this at all — a targeted keyword search came up empty. **[confirmed gap, not an
  inconclusive search]**

**Honest framing**: we found no benchmark reporting "X% of form-filling failures are formatting
errors" — but that is because *no existing taxonomy is built to see this failure mode*, not
because researchers checked and found it rare. The one benchmark closest to measuring it
(FormFactory) explicitly flags its own metric as too lenient to detect it. This is a legitimate,
citable claim ("the literature isn't instrumented to see this yet") — it is not the same claim
as "agents commonly fail this way," which we cannot currently support with published numbers.
Complementary detail already captured in `ai-structured-output.md` §5: Anthropic's own
`computer_20250124` tool's `type` action is a bare, schema-free string with no locale/unit
field at all, and the documented mitigation (re-screenshot and visually judge) cannot catch a
wrong-but-plausible-looking value — a mechanism-level argument for the same conclusion.

## 5. Explicit non-findings (do not overstate these in external docs)

- No citable incident of an LLM emitting a **locale-comma decimal** into a structured field
  specifically (mechanism confirmed via `Number("1,5")` → `NaN`; incidence rate not
  established).
  - No citable incident of **hedge/qualifier leakage** ("about 5") into a value field.
- No citable incident of a **range leaking into a scalar field** as an LLM-specific,
  documented failure.
- No published aggregate **production retry-rate** or **cost-per-retry multiplier** for
  structured-output validation failures, from any major vendor.
- No benchmark isolating **browser-agent input-formatting failures** from grounding/navigation
  failures (see §4).

These gaps are themselves useful: they're exactly what the fixture eval in §6 is designed to
probe in a way that's honest about being a canonicalization-rate demo, not a claim about
real-world LLM failure frequency.

## 6. Eval design: a recorded-corpus canonicalization-rate demo

**Why not live LLM calls in CI**: non-deterministic, costly, rate-limited, and — per §5 —
we don't have solid public data on how often real models produce each failure mode, so an
end-to-end "ask an LLM, see if it validates" eval would conflate model choice/prompt quality
with the thing we actually want to measure (does canonicalization help once a given string
exists). A fixture corpus isolates the one variable that matters.

### Fixture corpus

One row per fixture: `{ id, category, raw, expected_kind, expected_canonical, provenance }`.

- `category` — one of the ten taxonomy rows in §1 (unit omission, embedded unit, locale comma,
  thousands separator, date drift, scientific notation, range-in-scalar, qualifier leakage,
  typo/slang unit, compound/mixed unit).
- `provenance` — **documented** (lifted or lightly adapted from a cited real incident — e.g.
  the BFCL "5% → 5" pattern, the mg/dL-vs-mmol/L unit-confusion shape from
  apple-health-data-bridge #14, the MM/DD ambiguity from opencode #12401) vs. **synthesized**
  (hand-authored, representative of the mechanism-verified failure class but not tied to a
  specific real incident — most of rows 3/4/7/8/9 in §1, per the gaps in §5). Every fixture
  ships its provenance tag in the corpus file itself so nobody downstream mistakes a
  synthesized example for a documented one.
- Target size: ~15–20 fixtures per category (~150–200 total) — enough to report a stable
  percentage per category without pretending to statistical significance for a rare
  real-world frequency claim we aren't making.

### Pipeline under test

Two candidate "receivers" get the exact same fixture strings:

1. **Baseline** — the realistic naive pipeline most codebases actually run downstream of JSON
   mode / function calling today: `Number(x)` / `parseFloat(x)` / `new Date(x)` coercion, then
   a schema validator (e.g. `z.number()`, `z.coerce.number()`, `z.date()`). This is deliberately
   *not* a constrained-decoding strawman — constrained decoding solves a different problem
   (getting `type: number` to parse at all); the baseline represents what happens the instant a
   provider allows `type: string` for a quantity/date field (which is common practice, per
   `ai-structured-output.md` §4 — `type: string` is in fact *required* if you want the model
   free to write `"2 lbs"` at all).
2. **lingo-preprocessed** — the same fixture strings routed through `parseQuantity` /
   `parseDate` / `lingo()` first, canonical value handed to the *same* schema validator.

### Metrics

- **Acceptance rate** — % of fixtures per category where the receiver produces a value that
  validates against the schema at all. Reports the "does it even get through" delta.
- **Silent-wrong rate** — % of fixtures where the receiver's output *validates* but is
  numerically/semantically wrong (e.g., baseline's `new Date("03/04/2025")` silently returns
  March 4 with zero error signal — verified directly in §1 row 5 — vs. the correct reading
  depending on locale). This is the metric that matters most: a rejection at least triggers a
  visible retry; a silent wrong value trains nobody to notice. Report this **separately from**
  acceptance rate, never blended into one "accuracy" number, since the two failure shapes have
  very different downstream costs.
- **Category breakdown**, not just an aggregate — an aggregate number invites exactly the kind
  of "lingo fixes 95% of LLM formatting errors" overclaim this whole exercise is trying to
  avoid; a category table lets a reader see exactly which failure classes move and by how much.

### Honest framing rules (bind these into the eval's own README when built)

1. This is a **canonicalization-rate demo on a hand-curated fixture corpus**, not an
   end-to-end LLM benchmark and not a claim about how often real LLMs produce these exact
   strings in production (§5 documents that we don't have that number from anyone, including
   us).
2. Every fixture is tagged **documented** or **synthesized** provenance, visibly, in the
   corpus file — no silent blending of "a real GitHub issue" with "a string we made up that
   looks plausible."
3. Report acceptance-rate delta **and** silent-wrong-rate delta, never a single blended
   "accuracy" number — the two are different failure shapes with different real-world costs.
4. Compare against a **realistic baseline** (naive coercion + schema validation, the thing
   codebases actually run), not against a strawman ("no validation at all") or a moving target
   ("whatever the newest constrained-decoding framework does") — constrained decoding is
   solving a different, complementary problem (see §2), not a competing one.
5. Do not extrapolate the fixture corpus's category percentages into a claim about aggregate
   LLM output quality, retry-rate reduction, or cost savings in production — those claims
   require the production data flagged as missing in §3 and §5, which this eval does not
   supply.
6. Keep the corpus small enough to read end-to-end and auditable for cherry-picking — publish
   it alongside the result, not just the summary percentages.

This design is a **proposal**, not implemented in this pass — per scope, `src/`, `site/`, and
`plans/` were left untouched; building the actual fixture file and harness is follow-up work
(a natural home would be a `scripts/eval-corpus/` or `test/fixtures/llm-formatting/` tree plus
a small report script, mirroring the existing `scripts/size.mjs` pattern of a standalone,
CI-runnable check with a clear pass/fail plus a printed table).

## Sources

| id | source | confidence | date |
|----|--------|------------|------|
| C1 | [Berkeley Function-Calling Leaderboard blog](https://gorilla.cs.berkeley.edu/blogs/8_berkeley_function_calling_leaderboard.html) — GPT-4 "annual_interest_rate: 5" vs 0.05 | documented | 2024, updated 2024-08-19 |
| C2 | [apple-health-data-bridge PR #13](https://github.com/stephenfeather/apple-health-data-bridge/pull/13) — calendar-invalid FHIR date rejection guard | anecdotal (small repo, confirmed real via GitHub API) | 2026 |
| C3 | [pydantic-ai issue #245](https://github.com/pydantic/pydantic-ai/issues/245) — date-unawareness report, maintainer could not reproduce | anecdotal, unconfirmed | Dec 2024 |
| C4 | [opencode issue #12401](https://github.com/anomalyco/opencode/issues/12401) — MM/DD/YYYY vs DD/MM/YYYY vs ISO ambiguity, fixed | anecdotal (confirmed real) | 2026 |
| C5 | [Outlines issue #1178](https://github.com/dottxt-ai/outlines/issues/1178) — float-format grammar constraint still yields unparseable output | documented, confirmed open via GitHub API | Sept 2024 |
| C6 | [Pydantic issue #13089](https://github.com/pydantic/pydantic/issues/13089) — Decimal scientific-notation output rejected by Pydantic's own generated regex pattern | documented, maintainer-confirmed, confirmed real via GitHub API | 2026 |
| C7 | [BAML blog — "Structured Outputs Create False Confidence"](https://boundaryml.com/blog/structured-outputs-create-false-confidence) | anecdotal, vendor-interested | 2026 (references GPT-5.2) |
| C8 | [NUMCoT, arXiv:2406.02864](https://arxiv.org/abs/2406.02864) — numeral/unit-conversion difficulty in chain-of-thought reasoning | documented, peer-reviewed (ACL 2024 Findings) | Jun 2024 |
| C9 | [apple-health-data-bridge issue #14](https://github.com/stephenfeather/apple-health-data-bridge/issues/14) — wrong-but-valid unit hallucination (mg/dL vs mmol/L) | anecdotal, confirmed real via GitHub API | 2026 |
| C10 | [OpenAI — Structured Outputs docs](https://developers.openai.com/api/docs/guides/structured-outputs) | documented, live-verified 2026-07-04 | current |
| C11 | OpenAI — [*Introducing Structured Outputs in the API*](https://openai.com/index/introducing-structured-outputs-in-the-api/) (blocked to automated fetch; quote corroborated via independent third-party citations + current docs restating the same claim) | documented (corroborated, not directly fetched) | 2024-08-06 |
| C12 | [The Constraint Tax, arXiv:2605.26128](https://arxiv.org/abs/2605.26128) — schema-validity/answer-accuracy tradeoff in <3B models | documented, re-verified | ~May 2026 |
| C13 | [ComplexFuncBench, arXiv:2501.10132](https://arxiv.org/html/2501.10132v1) — value_error 78.8% for Qwen2.5-72B | documented, HTML re-verified | Jan 2025 |
| C14 | [llama.cpp GBNF grammar docs](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md) | documented (official repo) | current |
| C15 | [JSONSchemaBench, arXiv:2501.10868](https://arxiv.org/abs/2501.10868) — 13% unconstrained / 41% best-constrained compliance on hard schemas | documented | Jan 2025 |
| C16 | [Tool-Reflection-Bench, arXiv:2509.18847](https://arxiv.org/abs/2509.18847) — Repair@1 ≤ 9.6% baseline retry-fix rate | documented | Sept 2025 |
| C17 | [API-Bank, EMNLP 2023](https://ar5iv.labs.arxiv.org/html/2304.08244) — 17.9–23.7% "false API call format" errors by model | documented, dated (pre strict-mode era) | 2023 |
| C18 | [BAML — Schema-Aligned Parsing blog](https://boundaryml.com/blog/schema-aligned-parsing) — BFCL-derived FC accuracy 19.8–87.5% by model | documented (underlying BFCL data), anecdotal (SAP-improvement deltas, vendor-interested) | 2026 |
| C19 | [WebVoyager, arXiv:2401.13919](https://arxiv.org/abs/2401.13919), Table 4 — Navigation Stuck 44.4% / Visual Grounding 24.8% / Hallucination 21.8% / Prompt Misalignment 9.0% | documented, HTML re-verified | Jan 2024 |
| C20 | [OSWorld, arXiv:2404.07972](https://arxiv.org/abs/2404.07972) — >75% of failures are mouse-click inaccuracies | documented | Apr 2024 |
| C21 | [FormFactory, arXiv:2506.01520](https://arxiv.org/html/2506.01520) — click accuracy <10%, completion <2%, Value-metric leniency admission | documented, HTML re-verified | Jun 2025 |
| C22 | [UI-CUBE, arXiv:2511.17131](https://arxiv.org/abs/2511.17131) — date/time picker grounding failures, empty-field hallucination | documented, single-pass-verified | Nov 2025 |
| C23 | [AgentBench, arXiv:2308.03688](https://arxiv.org/abs/2308.03688) — "Invalid Format" (own output syntax, not form-field values) | documented | 2023, ICLR 2024 |
| C24 | Anthropic — [*Developing a computer use model*](https://www.anthropic.com/research/developing-computer-use) | documented (official), anecdotal in content | Oct 22, 2024 |
| C25 | OpenAI — [Operator system card](https://cdn.openai.com/operator_system_card.pdf) | documented (official) | Jan 23, 2025 |
| C26 | Node.js `Number()`/`Date()` coercion behavior on locale-comma, embedded-unit, range, qualifier, and scientific-notation strings | **verified directly** in this repo, Node v24.15.0 | 2026-07-04 |
| C27 | Gorilla — [*Large Language Model Connected with Massive APIs*, arXiv:2305.15334](https://arxiv.org/abs/2305.15334) | documented, peer-reviewed | May 2023 |

Cross-reference: `wiki/research/ai-structured-output.md` (integration architecture: Standard
Schema field factories, AI SDK repair hooks, computer-use `type`-action analysis) is the
companion doc to this one — that pass covers *how* lingo would plug in; this pass covers
*whether the problem it solves is real and how to prove it*.
