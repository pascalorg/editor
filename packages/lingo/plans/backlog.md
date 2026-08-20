# Backlog — parking lot

Tangential ideas and deferred follow-ups land here so active work stays scoped.
Promote to a numbered plan when one is actually scheduled. Agents: when an idea
surfaces mid-task, add it here and keep going — don't act on it.

## Parsing & units

- **Suffix multipliers `M` (1e6) and bare `b` (1e9)** — plan 002 originally
  spec'd them; v0.1 shipped `k`/`K` and `bn` only (plan amended to match).
  Implementing them needs hazard analysis (`M` vs mega/meters, `b` vs bit) and
  corpus gating. Untyped glued `1M` is currently rejected so the concentration
  kind (D47) does not silently consume a future million suffix; use `1 M` or
  `kind: 'concentration'` for molar fields. (`packages/lingo/src/number/value.ts`)
- **Megaliter needs a disambiguation before it can ship** — `ML` is both the
  megaliter symbol and the common casual milliliter spelling ("250 ML"), so it
  currently reads as milliliter (deferred by D53). Registering megaliter safely
  needs an `AMBIGUOUS_UNIT` path (milliliter default + megaliter alternative),
  like the `oz`/byteish pattern.
- **`psig`/`psia` gauge vs absolute pressure** — deferred by D51; the symbols
  need gauge/absolute semantics, not a plain psi alias. `kg/cm2` stays deferred
  for the same review reason (`kg` is kilogram mass; `kgf/cm2` is the declared
  pressure unit).
- **Nautical-mile and ounce ambiguity** — `NM` vs nanometer and bare `oz`
  mass-vs-volume should get an explicit ambiguity policy before changing
  default parse behavior.
- **Dimensional expressions** — arbitrary unit algebra (beyond the declared
  flow_rate/concentration/torque/… kinds) needs a separate kind/model decision
  rather than ad hoc aliases (algebra deferred per D2).
- **Rates with non-unit denominators** — `£45 per night`, `50 kg per person`,
  `$12/hour`, `3 per box` all fail with `TRAILING_INPUT` today. This is *not*
  dimensional algebra (D2 stands): the denominator is a countable domain noun,
  not a unit, so no unit algebra is involved — it wants a `per` slot on the
  quantity. Covers pricing, dosing, capacity, and rate fields, and gives LLM
  tools a clean shape to emit (`{amount: 45, currency: 'EUR', per: 'night'}`).
  Ranked above the general expression grammar on form value, but it changes the
  v3 wire shape, so it needs its own plan rather than folding into 032.
  (Surfaced by the mathjs/plan-032 prior-art pass 2026-07-29.)
- **Multiplier and count words** — `twice 3 kg`, `double 3 kg`, `3 boxes of
  2 kg`, `3 @ 2.5 kg`, `5 kg each`, `a dozen eggs` all fail today. Reuses the
  existing number-word lexicon; overlaps plan 032 phase 3, but the unit-less
  count forms (`a dozen eggs`) are a quantity-grammar question, not arithmetic.
  (Same pass.)
- **Range span excludes the frame word** — `from 5 to 10 kg` and
  `between 5 and 10 kg` spans start at the first value, not at `from`/`between`.
  `buildRange` (`range.ts`) could extend the span to cover the leading frame.
- **`withFractionTail` spaced-vulgar question** — the guard was simplified to
  the provably-equivalent `t?.type === 'vulgar'`; open question whether the
  original intent was `joiner || !t.spaceBefore` (reject spaced "2 ½").
  Changing that would alter corpus-locked behavior — needs an owner decision.
  (`packages/lingo/src/number/value.ts`)
- **Resolved language-profile memoization** — `prepare()` (`parse/config.ts`)
  runs `detectLanguageProfile`/`resolveLanguageProfile` on every parse for a
  non-English instance, and detection re-`buildProfile`s (fresh grammar/number/
  date `Set`s) *and* re-normalizes+tokenizes per candidate pack. Packs are stable
  singletons, so cache the merged profile by pack-set identity, mirroring the
  existing `packAliasCache`/`englishWordCache` WeakMaps. Correctness is fine;
  this is throughput for locale-configured fields (the English hot path never
  hits it). Surfaced by the 0.2.0 locale pre-release review.

## Currency

- **Async/historical FX rate providers** — deferred from plan 026; only
  injected static snapshots/providers ship.
- **Currency bundle placement** — currency ships in the default bundle (D28).
  If the default entry must shrink, trim the curated set or move it to an
  opt-in entry.
- **Minor-currency range distribution bug** — `5 or 6 cents` (also
  `5 to 6 cents`, `5-6 cents`, `between 5 and 6 cents`) yields `$0.06–$5.00`:
  the bare side inherits the major unit while the other is minor. Fix in
  `buildRange`, independent of the range separator.

## Dates & times

- **Approximate time forms (`~5pm`, `5ish`, `around 5pm`)** — deferred from
  plan 030 (D58). Needs an `approximate` flag on `DateResult` (and the range
  endpoints), which touches the whole date result shape and its serialization.
  Fold in with a broader "approximate/uncertain date" pass; `humanizeDate`
  would need to emit the marker back for two-way.
- **CJK compact date offsets aren't auto-detected** — `detectLocale([zh], '3天后')`
  falls back to English because `compactOffset.unitWords`/suffixes (天, 后) feed
  neither `aliasWords` nor `detectionWords` (`locale/detect.ts`), whereas
  unit-alias inputs like `5公里` detect fine. Seed detection from `compactOffset`
  vocab, or document that CJK date offsets need an explicit `locale`. Every
  locale test passes an explicit `locale`, so today this only bites auto-detect
  callers. Surfaced by the 0.2.0 locale pre-release review.
- **`/complete` hour-grain date text carries `:00` minutes** — `formatDate`
  (`complete/completions.ts`) slices `localIso` to 16 chars for `hour` grain,
  emitting `2026-07-08T15:00`, which re-parses at `minute` grain (a one-grain
  drift in the autocomplete display string, not in `format`/`humanize`). Slicing
  to 13 (`…T15`) fixes it only if the date parser accepts a bare `THH` — verify
  that round-trips before changing. Surfaced by the 0.2.0 completions review.
- **`humanizeDateRange` drops seconds** — `formatClock` (`date/humanize.ts`)
  never emits a seconds field, so `9:00:30am to 5:00:45pm` humanizes to
  `9:00 AM to 5:00 PM` and re-parses a minute off. This predates the D71
  calendar-range work (verified against the commit before it) and breaks the
  two-way guarantee for second-grain endpoints. Render seconds whenever an
  endpoint carries `second` grain; check the anchored-duration phrase at the
  same time, since it shares the clock formatter. Surfaced by the plan-032
  adversarial review pass.
- **Elliptical range right sides** — `Aug 3–9`, `July 1-5`, `July 1 through 5`
  all fail: `parseDateToDateRange` parses each endpoint independently, so a bare
  day number on the right has no month to attach to. The right side should
  inherit month and year from the left when it reads as a valid day. This is the
  Latin-script twin of the CJK `3月5日~10日` entry above — do both with one
  elliptical-endpoint rule rather than two special cases.
- **Quarters (`Q3`, `next quarter`, `Q3 2026`)** — not a `DateGrain`, so
  `periodEnd` has nothing to widen and the whole family reads as
  `UNSUPPORTED_DATE`. Fiscal-year offsets are the reason this isn't free: `Q3`
  means different months to different companies, so it needs a `fiscalYearStart`
  option before it can be more than a calendar-quarter guess.
- **`UNSUPPORTED_DATE` still suggests only a time slot** — the message hint is
  `try "2pm to 4pm"`, written before calendar ranges existed. A person typing
  `Q3` or `Aug 3-9` is asking for a date span, so the suggestion sends them the
  wrong way. The hint should reflect the shape the input looks like it wanted
  (a date span → `"Aug 3 - Aug 9"`, a period → `"next week"`). Changing the copy
  moves corpus rows, so it wants its own change rather than a docs pass.

## Wire schema & types

- **`./schema` does not yet cover date-module wire shapes** — `parseDate`/
  `parseDateRange`/`parseDuration` serialize v3 (flat, ISO dates,
  self-describing spans) but the machine-readable JSON Schema in
  `src/schema/index.ts` only describes the main-entry result union. Extend it
  (and the generated site artifacts) when the date wire shape is next touched.
- **v3 wire: conversion `source` omits `parts`/`fuzzy`/`approximate` (minor)** —
  a conversion source is a deliberately minimal `{type,value,unit,base,baseUnit}`
  (or range bounds), so `5 ft 11 in to cm` loses the compound `parts` in the
  serialized `source`, and fuzzy/approximate range sources drop those flags.
  Asymmetric with standalone quantity/range serialization; add them if source
  fidelity matters.
- **`LingoResult.toJSON` is typed optional** — attached at the parse boundary and
  always present at runtime (enumerable), but the interface declares it optional
  (so the parser's result literals type-check), so `lingo(x).toJSON()` needs
  `?.`/`!`. `JSON.stringify(lingo(x))` is unaffected. A finalized public return
  type could make it required.
- **Custom registry type inference** — top-level helpers and built-in
  `createLingo()` instances are typed (plan 027); deriving safe literal refs
  from arbitrary caller-owned registries remains a later
  `LingoInstanceFor<Kinds>` pass.
- **Type-level lowercase-alias collisions** — `KindOfUnit<'c'>`/`<'r'>` resolve
  to `never` (lowercase Celsius/Rankine are runtime-only case-folds, not
  declared refs), so `convert(5,'c','mAh')` compiles then throws while
  `quantity(5,'c')` over-strictly type-errors (surfaced by the D54 review).
  Closing it means case-insensitive type refs, which plan 027 rules out for
  editor perf — needs a targeted approach, not a blanket expansion.

## Testing & tooling

- **canonicalizeValues root-spec ('') ordering semantics** — the root-path
  branch now assigns the parsed root and keeps processing (order-independent,
  covered by tests). Open question: should a root spec compose with sibling
  path specs at all, or should mixing them be rejected as a configuration
  error? No plan text covers it. (`packages/lingo/src/ai/canonicalize.ts`)
- **Extract the fake-DOM harness from `dom.test.ts`** — its first ~290 lines are
  a hand-rolled fake DOM (TestElement/TestInputElement/installDom/typeInto/…)
  before the first behavior test. Moving it to `tests/fixtures/fake-dom.ts`
  (and absorbing the ~15 `el as unknown as HTMLInputElement` casts into typed
  helpers) would make the file read as pure `lingoInput` behavior and give the
  future react-hook test a host. Pure reorganization — do deliberately rather
  than rushed. (`packages/lingo/src/dom/dom.test.ts`)
- **Corpus/test sync guard** — `breadthRows`/`dateRows` in
  `tests/corpus/source.mjs` hand-mirror the inputs in `corpus.test.ts` /
  `date.test.ts`; a case added to one silently escapes the other. Add an
  assertion that every tested input+opts pair exists in the corpus rows
  (normalizing opts via `JSON.stringify` across the `.ts`/`.mjs` boundary, date
  opts through the same `FIXED_NOW` serialization). First reconcile the one
  known gap: `'this Sunday'` is tested in `date.test.ts` but absent from
  `dateRows` (append it as an ADDITIVE row). Deferred: the cross-boundary opts
  normalization needs care to avoid false positives.
  (`packages/lingo/tests/corpus/source.mjs`)
- **Supply-chain release-age gating** — minimum-release-age install protections
  were dropped with the bun switch (D22 — the bun siblings don't gate). If
  wanted back, configure bun's install security options intentionally.
- **`format.ts` Intl cache vs full-entry headroom** — needs a D-entry either
  way.

## Site & docs

- **`next.config.ts` has `ignoreBuildErrors: true`** — tsgo runs separately so
  type safety exists, but the flag deserves an intentional decision.
- **Site single-linter endgame** — the site keeps `eslint.config.mjs` alongside
  biome; decide whether eslint stays. Also: verify whether the ultracite pass
  re-sorted Tailwind classes anywhere visual (production build is green; a
  visual spot-check of the docs pages before first deploy would close this).
- **README badges** (npm version, CI, min+gz size, zero deps) — add to
  `packages/lingo/README.md` once the package is published and CI is public.

## Packaging & ecosystem

- **`packages/mcp`** — plan 021 phase 3's demo MCP server has a natural home in
  the monorepo; still pending go.
- **Locale packs as packages** (`@pascal-app/lingo-locale-*`) — plan 013 can
  target sibling packages instead of subpath data modules; decide when i18n
  work starts.
- **`plans/archive/` protocol** — adopt an `archive/YYYY-MM/` convention if the
  plans index ever outgrows one screen. Not needed at the current count.
- **CHANGELOG contributor attribution** — adopt a
  `**title** — description ([#PR](url)) by [@handle]` format once external
  contributions exist.

## From research pass 2026-07-09 (deferred)

Items surfaced by the multi-agent library/competitive research pass. Each is
recorded here as a parking-lot idea, not a commitment. See
`wiki/research/library-craft.md`, `wiki/research/competitive-landscape.md`,
`wiki/research/base-ui-headless-patterns.md` for full context.

- **chrono-node-style known/implied component certainty model** — add a
  `certainty` map per date component (`'explicit'|'inferred'|'default'`) to
  `DateResult`. Helps LLM tool consumers distinguish what the user said from what
  was assumed. (competitive-landscape.md, lesson 0)
- **Confidence scores on parse results** — a numeric `confidence: 0-1` field on
  `QuantityResult`/`DateResult`, computed from exact-vs-fuzzy match, typo
  distance, and alternatives presence. Helps tool callers decide accept-vs-clarify.
  (competitive-landscape.md, lesson 8)
- **AI SDK cookbook recipe + `lingoSchema()` adapter docs** — submit an MDX recipe
  to `github.com/vercel/ai` showing `quantityField` as `tool()` inputSchema,
  `lingoObject` composing fields, and `repairToolCallWith`. Highest-leverage
  external discovery surface. (ai-structured-output.md addendum, 2026-07-09)
- **`repairToolCallWith` v7 signature alignment check** — verify and document
  that `repairToolCallWith()` can be passed directly as
  `experimental_repairToolCall` on `ToolLoopAgent` without an adapter function.
  (ai-structured-output.md addendum, 2026-07-09)
- **Telemetry metadata for `lingoTool`** — emit which fields were canonicalized,
  corrections applied, and parse duration into AI SDK tool `metadata` for
  OpenTelemetry `execute_tool` spans. (ai-structured-output.md addendum,
  2026-07-09)
- **Locale message packs inside LocalePack** — bundle issue-code copy per locale
  inside the locale pack data module so non-English fields get localized error
  messages without a separate message-pack import. (library-craft.md, Drizzle
  multi-bridge pattern)
- **Cross-kind alias collision whitelist validation** — plan 003 spec gap:
  validate at `registerKind`/`registerUnits` time that new aliases do not collide
  with existing aliases in other kinds, unless explicitly whitelisted. Currently
  silent; `registerUnitAliases` also silently drops unknown unitRefs.
  (audit: extensibility, finding 3)
- **`defineLocalePack` type-checking helper** — an identity function
  `defineLocalePack<const T extends LocalePack>(pack: T): T` (same pattern as
  `defineKind`) for type-safe locale pack authoring with literal preservation.
  (audit: extensibility, finding 4)
- **React peerDependency range widening** (`^19` to `>=18.2.0 || ^19`) — the
  hook uses only React 16.8+ APIs (`useRef`, `useState`, `useCallback`,
  `useEffect`). The `^19` constraint excludes React 18 users (still widely
  deployed). Needs owner decision on whether to support 18's `RefObject` type
  shape. (audit: integration, finding 2)
- **Vue/Svelte/Solid adapters** — the DOM controller is framework-agnostic; thin
  adapter hooks for Vue (`useLingoInput` composable), Svelte (action), and Solid
  (directive) would expand reach without new core deps. Low urgency until React
  adoption proves the pattern. (competitive-landscape.md, positioning)
- **Per-function docs pages** — evolve `docs-catalog.ts` to generate individual
  routes (`/docs/parseQuantity`, `/docs/convert`, etc.) from existing JSDoc
  `@example` blocks. Top-20 exports first. (library-craft.md, lodash lesson 1)
- **Competitor benchmark comparisons** (`bench-compare`) — measure lingo parse
  operations against chrono-node (dates), convert-units (conversion), and ms
  (durations) on shared inputs; publish in docs. (library-craft.md, es-toolkit
  lesson 0; competitive-landscape.md throughput section)
- **DOM paste handling** — detect `inputType === 'insertFromPaste'` in `onInput`,
  skip debounce, strip newlines/formatting, parse immediately. Currently pasted
  text is debounced like typing. (audit: integration, finding 4)
- **React hook completions integration** — expose `completions[]` and
  `highlightedIndex` in `UseLingoInputResult` so React consumers can render a
  combobox popup with the ARIA contract from Base UI research.
  (base-ui-headless-patterns.md)
- **`partialState` double-parse** — the DOM controller parses once for
  `partialState` classification and again on commit; if the debounced parse
  result is still current at commit time, reuse it. (audit: performance, implied)
- **IssueCode extensibility for third-party kinds** — add `| (string & {})` to
  `IssueCode` (matching the `Kind` pattern) so custom kinds can define
  domain-specific issue codes without forking. Adjust `Messages` type to allow
  partial mapping. (audit: extensibility, finding 0)
- **`lingoMiddleware` for AI SDK** — a `wrapLanguageModel()` middleware that
  runs `canonicalizeValues` on tool call arguments before `execute()`, giving
  infrastructure-level quantity/date normalization without per-tool boilerplate.
  (ai-structured-output.md addendum, 2026-07-09)
- **`assertStrictSafe(field)` utility** — walk a LingoField's emitted JSON
  Schema and throw if any object has `additionalProperties:true` or missing
  `required`; catches the `passthrough:true` footgun at definition time for
  OpenAI/Anthropic strict mode. (ai-structured-output.md addendum, 2026-07-09)

## From locale idiom research pass 2026-07-09 (wave 2, deferred)

Items deferred from plan 033 wave 1. See `wiki/research/locale-idioms.md` for
full context.

- **New locales de/it/nl/ko/ar + RTL/Eastern-Arabic numerals** — the five
  highest-demand missing locales after the shipped six. Arabic requires RTL text
  handling in spans and Eastern-Arabic digit normalization (٠-٩ -> 0-9). German
  needs 'halb sieben' = 6:30 (half-before semantics). Korean shares CJK scale
  structure. (competitive-landscape.md: chrono has 14 locales vs lingo's 7)
- **CLDR-generated unit-alias packs at scale** — use `cldr-units-full` JSON to
  auto-generate unitAliases entries (singular + plural + gender variants) for all
  locale packs instead of manual curation. Requires a build-time script and a
  decision on which CLDR unit subset to include per pack (all ~300 units is too
  large for size budgets).
- **Localized humanize/format output** — `humanizeDate` and `format` currently
  emit English text regardless of locale. Producing locale-appropriate output
  ("hace 3 dias", "il y a 3 jours") requires either CLDR pattern templates or
  per-locale format strings in the date vocab pack. Deferred by D66; the two-way
  guarantee means locale humanize output must also re-parse in that locale.
- **Height/weight elliptical speech** — 'uno ochenta' (es, 1.80m), 'one eighty'
  (en, 180), 'un metre quatre-vingts' (fr, 1.80m). Implied-unit compound numbers
  where the speaker drops the unit and uses a decimal-shorthand convention. Deeply
  ambiguous without domain context (height vs generic number); needs a
  context-hint or dedicated compound-height mode.
- **Currency slang multipliers** — 'a grand' / 'five grand' (en, x1000), '5
  lucas' (es-CL, x1000 CLP), 'un baton' (fr slang, x10000). These are
  kind-scoped scale words that only apply to currency. The current
  numberWords.scales is kind-agnostic; needs either kind-scoped scales or
  dedicated currency-multiplier entries.
- **Counters/classifiers as first-class concept** — Japanese 個/人/本/匹 and
  Chinese 个/只/条 are mandatory between numbers and nouns. Currently treated as
  unknown tokens or fillers. Elevating them to a `classifierWords` pack field
  consumed by the quantity parser would let CJK expressions with counters parse
  cleanly (三個, 五人, 二匹).
- **`excludePatterns` / ambiguity-filter pack field** — per-locale list of
  strings where numeral characters appear in non-numeric words (Chinese: 十足,
  大陆, 放肆; Japanese: 一応, 二度手間). Prevents false-positive number matches
  in free text. Pattern from Microsoft/Recognizers-Text AmbiguityFiltersDict.
- **Script to mine duckling Corpus.hs into corpus rows** — a build-time tool
  that parses Duckling's Haskell corpus files and emits TypeScript
  `tests/corpus/locale-<id>-source.mjs` arrays. Priority: ZH/JA Numeral, FR
  Time, EN Quantity. BSD-3 requires copyright notice in generated files.

## Wave-1 idiom deferrals (2026-07-09, D69)

Delivered by wave 2 (D70): no-space CJK trailing approx (`五公斤左右`,
`五キロぐらい`, `五公斤上下`) via profile-driven splitting of glued grammar
words, and the CJK spoken clock (`午後3時半`, `三点一刻`, `下午三点半`) via the
suffix clock grammar. Still open:

- **Unit-first implied-1 quantities** — `kilo y medio`, `hora y media`,
  `metro e meio`: unit-before-number with implied quantity 1; needs a
  quantity-grammar seam, was cut from D69 for size.
- **CJK decimal-word composition** — `三点五公斤` (3.5 kg): the 点 decimal word
  needs to work inside the CJK number walker, not just as a spaced token.
- **`个` classifier before duration units in ranges** — `三四个小时` composes
  adjacent-number range + classifier + unit; blocked on the classifier field
  (see counters/classifiers item above).

## Wave-2 idiom deferrals (2026-07-27, D70)

- **Japanese era years** — `令和8年3月5日` / `平成30年`: the numeric-suffix date
  path reads `年` but not an era prefix. Needs an `eraNames` pack field mapping
  era → Gregorian offset, and a policy for the transition year. `Intl` knows the
  Japanese calendar, but using it would make date parsing environment-dependent
  (D5-adjacent: determinism is the guarantee).
- **CJK numeric-suffix date ranges** — `3月5日から3月10日` / `3月5日~10日`: the
  suffix date parser is single-date; a range needs the same
  `から`/`~` separator handling the quantity range path has, plus elliptical
  right sides (`10日` inheriting the month from the left).
- **Weekday + numeric-suffix date agreement** — `3月5日(木)` is the standard
  written form on Japanese schedules; the parenthesized weekday is currently
  trailing input. Cheap to accept, but it should *validate* agreement (warn when
  the weekday contradicts the date) rather than silently ignore it, which needs
  a new issue code.
- **Glued splitting for spaced scripts** — the D70 splitter deliberately only
  runs on non-Latin vocabulary (`!/[a-z]/i`). A pack for a spaced script that
  still glues grammar (Finnish/Turkish agglutination, German compounds) would
  need a different filter and a much stronger alias guard.
- **`readLocaleNumber` positional coverage** — the CJK numeral reader handles
  bare numerals, `十`-based tens, and digit runs (for years), but not
  `百`/`千` positional composition (`三百五十日` as a day-of-month is nonsense,
  yet `二千二十六年` is a legal year spelling). Unify with the CJK number
  walker in `number/` instead of growing a second reader.

## Test-suite maintenance

- **`suggest.test.ts` alias-probe timeout** — "matches an unpruned reference
  across generated alias probes" builds a full registry and walks every alias in
  `allKinds`, taking ~7 s against vitest's 5 s default. It fails in isolation on
  a mid-range laptop and intermittently under a loaded pool, so `bun run check`
  is flaky through no fault of the change under test. Either sample the alias
  space, hoist the registry out of the timed body, or give the case its own
  timeout — pick one deliberately rather than raising the global default.
