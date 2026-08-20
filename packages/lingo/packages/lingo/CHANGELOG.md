# Changelog

All notable changes to lingo are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com); versioning follows SemVer with one
sharpening: **changing the interpretation of previously-valid input is a breaking
change**, even if the API is untouched.

## [Unreleased]

## [0.4.0] - 2026-08-02

### Added

- Calendar ranges in `parseDateRange` (`@pascal-app/lingo/date`), which
  previously covered only clock slots and anchored durations:
  - Date to date — `July 1 to July 5`, `Aug 3 - Aug 9`,
    `between Aug 3 and Aug 9`, `from tomorrow to friday`, `Mon-Fri`,
    `2026-08-01 to 2026-08-05`, and open ends (`from monday`, `until august 9`).
    The end resolves against the start, so a pair never reads backwards.
  - Calendar periods — `next week` spans Mon–Sun, `next month` the 1st to the
    last, `this year` and `2027` the whole year, `August` the whole month. A
    coarse endpoint widens when it closes a span too, so `July to August` ends
    on August 31 and `until August` does the same, while `from August` still
    opens on the 1st.
  - Weekends — `this weekend`, `next weekend`, `last weekend` span Saturday
    through Sunday. `parseDate` gained the `next`/`last` weekend modifiers too.
    On a Saturday or Sunday, `this weekend` is the weekend in progress.
  - `humanizeDateRange` renders these as dates rather than clock times, so they
    round-trip. Time slots are unchanged.
  - A descending dated pair such as `2026-08-09 to 2026-08-03` is swapped and
    reported with the existing `RANGE_REVERSED` warning instead of being handed
    back backwards. Overnight clock slots (`9pm to 5am`) are untouched.
- Chinese and Japanese calendar and clock grammar: numeric dates written with
  suffixes (`2026年3月5日`, `3月5日`, and years spelled digit-by-digit as
  `二〇二六年`), weekdays (`星期三`, `周三`, `水曜日`), clocks closed by
  `点`/`時`/`分`/`秒` with day periods (`下午3点`, `午前9時半`, `3点一刻`), and
  date+time compounds written with no separating space (`明天下午3点`,
  `明日午後3時`).
- Postpositional bound phrases for scripts that put the comparator after the
  quantity: `5キロ未満`, `5キロ以上`, `5公斤以下`, `5公斤以内`, `5キロ超`.
  These previously parsed as a bare `5 kg`, silently dropping the bound, so
  they now return a `range` where they used to return a `quantity` — check any
  code that reads `.quantity` off a zh/ja parse of one of these forms.
- Chinese and Japanese default currencies, so the shared `¥`/`￥` symbol
  resolves per locale (`￥100` is CNY under `zh`, JPY under `ja`), plus the
  `元`/`圆`/`块`/`人民币` and `円`/`えん` aliases.
- Spanish `billón` (10^12), Portuguese `cento`, and Romance ordinal
  day-of-month forms (`le 1er mars`, `el 1º de marzo`).
- A per-locale benchmark suite (`bun run bench`) so multi-language throughput is
  measured rather than assumed.
- Per-locale corpus contracts gained 96 rows and the English contract 5,
  covering the grammar above plus the number-word fixes below.

### Changed

- Loading a locale pack now resolves its currency symbol instead of warning
  about it: under `zh` or `ja`, `￥100` returns CNY or JPY with no
  `AMBIGUOUS_UNIT` warning, where it previously returned JPY plus the warning
  in both. Selecting a locale is the disambiguation. Parsing without a pack
  loaded is unchanged — bare `¥`, `$`, and `cents` still warn.
- `dateRangeField()` advertises its real grammar to models. The JSON Schema
  description promised only time slots, so a model had no reason to emit
  `"next week"` or `"Aug 3 - Aug 9"` into a field that accepts them.
- Resolved language profiles and locale-detection scans are memoized per pack
  set, so repeated parses with `locale`/auto-detection no longer re-merge packs
  or re-tokenize for detection on every call.
- Size budgets recalibrated twice for this wave — once for the locale idiom
  engine and once for calendar ranges (D70 and D71 in `wiki/decisions.md` carry
  the measured numbers and rationale); `scripts/size.mjs` remains the source of
  truth. Every corpus row pinned at 0.3.0 is byte-for-byte unchanged — this
  release only adds rows. Five readings outside the pinned set do change, all
  of them silent wrong answers being corrected, and each is called out in its
  own entry: postpositional bounds, `￥` under a loaded pack, French
  `mille cinq cents`, French `billion`, and Spanish `dos mil millones`. If you
  depend on any of those, read them before upgrading.
- README (npm): repo-relative links (`docs/recipes.md`, `plans/`, `wiki/`) now
  point at absolute GitHub URLs so they resolve on npmjs.com, and the docs
  site plus the agent `llms.txt` index are linked from the top.
- Root README: links the docs site, the npm package, and the agent `llms.txt`
  index directly, with an install one-liner.
- Docs site: every markdown section now also renders as a standalone,
  indexable HTML page at `/docs/<section>` (agent markdown stays at
  `/docs/<section>.md`); legacy demo redirects (`/forms`, `/escalation`,
  `/coverage`, `/integrations`) became permanent (308); the landing page
  gained server-rendered parse-example, forms-vs-LLM, tool-boundary, and FAQ
  content (FAQPage/TechArticle/BreadcrumbList structured data included); docs
  section headings no longer leak kicker text into the extracted HTML outline.
- Docs site: three demos show what a canonical reading is worth downstream —
  one date field that picks its own picker (day, two-month range, or time slot)
  from the shape `parseDateRange` returns, a LaTeX view that typesets a reading
  as real notation because the unit id and the value are separate fields, and a
  data grid whose columns are `quantityField`s, so mixed cell notation
  normalizes into one unit and the totals row can just add numbers. All three
  are keyboard-operable and the LaTeX view renders MathML for screen readers.

### Fixed

- Agent-facing docs now cover calendar ranges. `llms.txt`, the package README,
  the `skills/lingo` skill, the site's markdown mirror, and the `parseDateRange`
  / `dateRangeField` TSDoc all described time slots only, so an agent reading
  any of them would not have found the feature. Each now states the three
  shapes, the closing-side widening rule, the `RANGE_REVERSED` swap, and what
  is deliberately absent (quarters, `Aug 3-9`, dash-joined ISO dates).
- `/docs/dates.md` (and therefore `/llms-full.txt` and `/llms.md`) documented
  `2026-08-03..2026-08-09` as a supported span. `..` is not a separator in the
  grammar and that input returns `UNSUPPORTED_DATE`; the example now uses a
  form that parses.
- `/llms.txt` never advertised `@pascal-app/lingo/react-native`, and the site's
  markdown mirror never mentioned `@pascal-app/lingo/complete`, hiding two
  published entry points from agents that read only those files.
- The docs gates now catch that class of drift: `check-docs-sync.mjs` asserts
  both `llms.txt` copies against `package.json` exports and every issue code
  and verifies the served copy is not stale, and `check-llms-index.mjs` asserts
  the generated index advertises every published entry point.
- The `/docs` sidebar no longer contradicts the page it scrolls: it listed
  `Find values in text` before `Autocomplete anything`, and `Two-way slider`
  after the two framework entries, in both cases the reverse of the document
  order the same nav highlights while scrolling.
- `/docs` heading levels are visually distinct again. `SectionHeading` (h2) and
  `SubHeading` (h3) both rendered at 14px, so the outline read flat and
  disagreed with the 16px/15px scale the standalone `/docs/<section>` pages use
  for the same content. `Autocomplete anything` also appeared twice in a row
  (section heading, then demo panel title), and `Kinds` hand-rolled its own h3,
  leaving `#coverage-kinds` as the only depth-3 anchor with no anchor link.
- Docs sidebar group labels and their subtitles met WCAG AA: at
  `text-muted-foreground/75` and `/55` on 11px text they measured 2.9:1 and
  2.1:1 in light mode (3.0:1 dark). Both now use the unmodified
  `--muted-foreground` token — 4.5:1 light, 7.1:1 dark.
- Number words: hundreds now multiply only the 1..99 group in front of them, so
  French `mille cinq cents` is 1500 (was 100500). A banked smaller scale
  multiplies the next one, so Spanish `dos mil millones` is 2×10^9 (was
  1,002,000). Both were silent wrong answers.
- French `billion` is 10^12, the long scale French actually uses; it read as
  10^9 before, a silent factor-of-1000 error. `milliard` was already correct.
- Scale words joined by `de`/`e` parse instead of failing on the connector:
  Spanish `mil millones de metros`, French `un milliard de mètres`, Portuguese
  `mil e quinhentos`.
- `between A and B` now keeps the and-word for the range when both sides are
  spelled scale words: `between one thousand and two thousand meters`,
  `entre mille et deux mille`, `entre mil y dos mil` (all previously failed to
  parse). `between five and a half and ten kg` still reads 5.5..10 — the
  fraction tail binds tighter than the range separator.
- Portuguese `cento e vinte` (120) and `mil e quinhentos` (1500) parse; the
  and-word after a bare scale word links it to its remainder.
- Portuguese locative contractions are date fillers, so
  `na proxima segunda-feira` resolves.
- Scripts written without word spaces no longer swallow grammar words glued to a
  quantity (`三至五天`, `5公斤左右`). Unit aliases stay atomic through the split,
  so `一時間半` remains 1.5 hours rather than splitting at the range word `間`.

## [0.3.0] - 2026-07-21

### Added

- `@pascal-app/lingo/react-native`: DOM-free `useLingoTextInput()` for React
  Native `TextInput`, including parse-as-you-type partial states, blur/submit
  canonicalization, required/bounds validation, backend-ready `submitValue`,
  and injected ranked completions. The entry imports React only—no
  `react-native` runtime dependency.
- `useLingoInput()` now forwards an injected ranked-completion provider and
  exposes `completions`, `highlightedIndex`, `setHighlightedIndex()`, and
  `selectCompletion()` for headless React comboboxes. `./complete` remains an
  explicit, tree-shakeable import; no popup UI or runtime dependency is added.

### Changed

- Shared field format helpers (`toLingoOptions`, `materialize`, commit/hint
  formatting) now take a DOM-free `LingoFieldFormatOptions` surface so the React
  Native adapter reuses them without casting through `LingoInputOptions`.
- The npm `llms.txt` reference now includes full inline React and React Native
  adapter recipes (completions, capture-phase keyboard notes, `inputProps`,
  submit/canonical fields) so offline agents can integrate without fetching the
  site.
- The docs autocomplete showcase now separates ranked completions, loaded-locale
  examples, and caller-controlled unit suggestions into three focused,
  keyboard-navigable demos instead of one control-heavy panel.

### Fixed

- The docs autocomplete showcase now handles Enter during React's capture phase,
  so selecting a highlighted completion wins over the input controller's native
  primary-parse commit.

## [0.2.1] - 2026-07-09

### Added

- **Locale idiom coverage wave 1** (plan 033, D68/D69): parse how people
  actually write and speak quantities and dates across all shipped locales.
  - CJK number engine: multi-character number words inside CJK tokens
    (`三公斤`, `三十五キロ`), 万/亿/億 scale grouping (`三百五十万` = 3.5M),
    elliptical shorthands (`一百五` = 150, `三万五` = 35 000), mixed
    digit+scale (`3万5千`, `1億2千万`), wave-dash ranges (`5〜10キロ`),
    adjacent-number ranges (`七八天` = 7–8 days), and post-unit 半
    (`两公斤半` = 2.5 kg).
  - Romance number composition via new pack fields: tens + and-word + ones
    (`treinta y cinco`), `bareScales` (`cien gramos`, `mil metros`),
    `composed` exact compounds (`quinientos`, exhaustive French vigesimal
    `quatre-vingt-dix`), and spoken decimals via `decimalWords`
    (`dos coma cinco`, `trois virgule quatorze`; English gains
    `two point five` through the same table).
  - Localized date grammar via new pack fields: spoken clock
    (`las tres menos cuarto`, `quinze para as tres`, `deux heures et quart`,
    US `quarter of five`), period edges (`fin juillet`, `a finales de mes`,
    `月底`), weekday offsets (`lundi en huit`, `Monday week`,
    `Tuesday fortnight`), after-next/before-last modifiers (`再来週`,
    `先々週`, `the week after next`), day + day-part compounds
    (`tomorrow morning`), and duration parsing that honors pack unit words
    (`2 horas`).
  - Multi-word leading approximants (`más o menos`, `à peu près`,
    `por volta de`) and trailing approximants (`y pico`, `e pouco`).
  - Deepened es/fr/pt/zh/ja packs (day offsets like `pasado mañana`,
    `avant-hier`, `前天`, `一昨日`; fuzzy amounts `une vingtaine`;
    duration words `个小时`, `時間`; `円` → JPY) — ~190 new locale corpus
    rows.
  - Per-locale corpus gates: `tests/corpus/locale-<id>-source.mjs` →
    checked-in contracts, discovered generically and enforced by
    `bun run check`, so locale behavior can no longer silently regress.
- `isNumber()` result guard, completing the `isQuantity`/`isRange`/`isConversion`
  family for the bare-number branch of `LingoResult`.
- DOM completion fields now ship the headless half of the WAI-ARIA combobox
  pattern: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`
  toggling, and a `listboxId` option wired to `aria-controls`. Author-set
  attributes are respected and restored on `destroy()`.
- Compile-time unit checking on `Quantity.to()` / `QuantityRange.to()`:
  cross-kind literal targets (`quantity(5, 'kg').to('cm')`) are now compile
  errors while dynamic `string` refs still pass (plan 027 / D29 pattern).
- Seeded property-based round-trip suite (plan 010 layer 2): every built-in
  kind × unit × format style across five magnitude regimes — 41k+ cases
  asserting `parse(format(q)) ≈ q` and wire-JSON span integrity.
- Performance: `Intl.NumberFormat` instance caching for locale formatting,
  binary-search token lookup, allocation-free unit-match dedupe, and
  regex-free locale-detection scoring (+3–8% across parse suites).

### Changed

- `LOCALE_NOT_LOADED` and `NOW_REQUIRED` message copy now names the fix
  (import the locale pack / pass an explicit reference time).
- Narrow-style formatting keeps the number–unit space for the five units
  whose glued form re-parses differently (`K`, `M`, `ft²`, `ft³`, `kΩ`),
  preserving the two-way guarantee.

### Fixed

- `/ai` output JSON Schemas for `output: 'quantity'`/`'range'` declared
  `schemaVersion` enum `[2]` while the runtime emits `3`; strict providers
  validating tool output against the declared schema would reject conformant
  results.
- Scientific/engineering coefficients with three decimal digits
  (`3.493e-4 m`, `1.234×10^5 kg`) now parse: an attached exponent
  disambiguates the coefficient, so the European-thousands `AMBIGUOUS_NUMBER`
  reading (and its stale alternative) no longer strands the exponent as
  trailing input.
- Anchored duration ranges (`3 days starting tomorrow`): offset bookkeeping
  now survives normalization shifts (unicode quotes, invisible characters),
  absolute anchors (`3 days starting 2026-03-01`) no longer demand `now`,
  and relative anchors without `now` fail with `NOW_REQUIRED` (D36).
- Time-grain anchored ranges now humanize to re-parseable phrasing
  (`3 hours starting 2026-03-01 9:00 AM` instead of clock-only output that
  re-parsed against `now`), and a trailing timezone on an anchored range is
  applied/escalated with the same semantics as other date ranges (D67).
- `lingoTool()` MCP callbacks accept both bare arguments and the
  `{ params: { arguments } }` request envelope, matching how
  `@modelcontextprotocol/sdk` actually invokes `registerTool` callbacks.

## [0.2.0] - 2026-07-08

### Added

- Locale-pack infrastructure (plan 031): `createLingo({ locales })`,
  `locale` parse option, resolved `LanguageProfile` parser state, deterministic
  pack detection, CJK tokenizer groundwork, and tree-shakeable
  `@pascal-app/lingo/locales/*` pack entry points for English, en-GB, Spanish,
  French, Portuguese, Chinese, and Japanese.
- Spanish, French, Portuguese, Chinese, Japanese, and en-GB packs now cover the
  v0.1 locale examples: Romance number words/ranges/bounds (`dos kg`,
  `entre 5 et 10 kg`, `al menos 2 m`), localized relative dates (`mañana`,
  `il y a trois jours`, `há três dias`, `三天前`, `3日前`), CJK kg aliases
  (`公斤`, `キロ`), CJK temperature words (`很热`, `暑い`), and en-GB defaults
  for imperial/GBP parsing.
- Locale packs now own date vocabulary for natural-language dates: deictics and
  day parts (`midi demain`, `mañana por la mañana`, `明天中午`), relative frames
  (`dans 3 jours`, `hace 3 días`), localized month-date fillers
  (`12 de julio de 2026`), calendar periods (`le mois prochain`,
  `el mes que viene`, `下个月`, `来月`), and compact CJK offsets.
- Date grammar now accepts strict named-month modifiers (`last July`,
  `next July`) and duration-anchored ranges such as
  `3 days starting tomorrow` / `3days starting tomorrow`.
- `@pascal-app/lingo/complete`: `completions()` returns ranked canonical
  interpretations of partial or ambiguous quantity input (prefix fan-out, unit
  ambiguity forks, number alternatives, implied units, range-tail unit fan-out).
  `Registry.aliasCompletions()` powers prefix expansion. `units` option overrides
  suggested units for bare numbers and open ranges; curated per-kind defaults
  (m/ft/cm before nm) also re-rank prefix fan-out so everyday readings like
  `min`, `mi`, and `mL` beat obscure scientific shorthands. Kind-mismatch
  failures now surface one optimistic cross-kind reading, and callers can inject
  the date parser for date completions without bundling `@pascal-app/lingo/date`
  into `@pascal-app/lingo/complete`. DOM `lingoInput` accepts injected
  `complete` / `onComplete` hooks (no library dropdown). Docs showcase combobox
  demo.
- Agent docs tiers: site `/llms.txt` is now a spec-compliant index (llmstxt.org);
  `/llms-full.txt` serves the complete docs narrative; `/llms-small.txt` mirrors
  the npm-shipped compressed reference; `/docs/<section>.md` serves self-contained
  per-topic markdown slices. Enriched `packages/lingo/llms.txt` with nested
  headings, fenced examples per entry, and issue-code remedies.

### Fixed

- Locale auto-detection now keeps inherited English grammar as English, so
  English inputs do not get mislabeled as Spanish/French when only overlay packs
  are loaded. Explicit unloaded locales now return `LOCALE_NOT_LOADED`.
- CJK kg aliases and temperature fuzzy words are pack-owned (`zh`/`ja`) instead
  of leaking into the default English unit and fuzzy vocabularies.
- Locale packs now install localized unit aliases, score range/bound words and
  pack-owned unit/detection signals during auto-detection, and retry English
  when a detected locale fails so auto mode is not worse than English parsing.
- Localized half-unit tails such as `dos kg y medio` and
  `deux kilos et demi` now use the active locale's fraction words.

## [0.1.0] - 2026-07-08

### Positioning

- **"Make forms easier, LLM tools safer."** is the tagline and the product
  thesis: one parser powers forgiving human fields and safe-by-default tool
  schemas, serving humans, LLMs, API developers, and MCP integrations.

### Added

- Core engine: offset-mapped unicode normalization, tokenizer, numeric-literal
  parsing (separator policy, fractions incl. unicode, scientific notation, number
  words, fuzzy amounts), unit registry with longest-prefix alias matching,
  case-exact rules, kind-context ranking and did-you-mean suggestions.
- Thirty-three built-in kinds with exact legal conversion factors — length,
  mass, temperature, duration, volume, area, speed, data, pressure, energy,
  angle, percent, currency, and the scientific set (frequency, power, force,
  and friends).
- Quantity grammar: compounds (5'11", 1m80, 1h30, 2 lb 3 oz), ranges (5–10 kg,
  between/±/open bounds), qualifiers, conversion requests (72 in to cm),
  confidence + alternatives, structured issues with input spans.
- Fuzzy temperature vocabulary (weather/water/oven profiles), two-way via
  `describeTemperature`.
- Formatting: compound output with rounding carry (6′7″), best-fit unit selection,
  Intl-backed locale number formatting; format→parse round-trip invariants.
- Date & duration module (`@pascal-app/lingo/date`): natural-language dates, reversible
  humanization, ISO-8601 durations.
- Headless DOM controller (`@pascal-app/lingo/dom`) and React hook (`@pascal-app/lingo/react`).
- llms.txt, demo playground, size budgets, CI.
- Strictness & escalation: `strictness: 'forgiving' | 'confirm' | 'strict'`,
  `accept` switches (ranges/conversions/compounds/fuzzy/numberWords/
  approximations/bareNumbers), `tolerance` (typos fix/suggest/off), per-code
  `escalate` severity map, and `candidate` on failed results (did-you-mean UX).
  New codes: APPROX_NOT_ALLOWED, UNIT_REQUIRED, CONVERSION_NOT_ALLOWED.
- Mixed-unit additive chains: "20in and 10cm", "1 m + 3 ft", "2 m minus 10 cm",
  humanize-duration lists ("1 day, 3 hours, 2 minutes") — any order, delta-safe,
  faithful re-formatting.
- Colloquial idioms: "in 2d", "2w ago", "3min from tmrw" (implied-time anchors),
  "next tues", "@ 3pm", filler words (like/maybe/gimme) as approximate markers,
  duration primes (12' / 45'') under duration context.
- Message packs: English copy as swappable data (`englishMessages`,
  `setDefaultMessages`) — `/core` ships copy-free for BYO-i18n.
- Demo website (`apps/site/`): Next.js App Router + Tailwind + shadcn (Base UI),
  five interactive pages incl. a runnable server action.
- `createLingo({ registry?, kinds?, messages?, fuzzy? })` factory: isolated
  instances (own registry, messages, fuzzy vocab — inputs snapshotted, zero
  cross-instance leaks); the global `lingo()` is now a `createLingo()`
  singleton internally.
- Typed issue payloads: `IssueDataMap` + generic `LingoIssue<Code>`; result
  helpers `firstError`, `isQuantity`/`isRange`/`isConversion`, `candidateOf`,
  `formatIssue`.
- `NOW_REQUIRED` (strict mode): relative date inputs without an explicit `now`
  fail with a candidate computed from the implicit now; absolute dates are
  unaffected.
- Corpus compatibility contract: `tests/corpus/contract-v1.json` (431 entries),
  exact-replay test, and `scripts/corpus-diff.mjs` classifying drift as
  ADDITIVE vs BREAKING — a blocking gate in `bun run check` and CI.
- Recipes (README + `docs/recipes.md`), TSDoc `@example` on every public
  symbol (143 verified examples), npm provenance release workflow.
- Benchmark harness (`scripts/bench.mjs`, plan 018): backend + browser suites,
  baseline compare; first capture shows microsecond-scale interactive paths
  (simple parse 2.7 µs, mixed grammar 4.9 µs on Apple Silicon/Node 24).
- Suggestion-path pruning (D17): did-you-mean 326.9 → 28.1 µs/op (11.6×) with
  2–6× side-wins on typo-fix, strict-confirm and `partialState`; output parity
  proven over 1.97M alias/probe pairs. Size budgets 23.25/16.75 kB.
- `@pascal-app/lingo/ai` (plan 019, D18): `quantityField`/`rangeField`/
  `dateField` implementing BOTH Standard Schema halves (validate + JSON
  Schema) so they drop into AI SDK `generateObject`/tool schemas without Zod;
  `lingoObject` combinator; `repairTextWith` (`experimental_repairText`-
  compatible, client-side); `canonicalizeValues` for arbitrary payloads.
  Input JSON Schemas are `type:"string"` so strict provider modes let models
  emit natural language for lingo to canonicalize. Tree-shakeable:
  quantityField-only ≈1.2 kB marginal (CI-gated at 1.5 kB; grew from ≈0.85 kB
  with the D20 safety defaults), full entry ≤8.0 kB with the date engine.

- Tool-boundary safety defaults in `@pascal-app/lingo/ai` (plan 020, D20):
  `AMBIGUOUS_NUMBER` escalates to error with a did-you-mean candidate;
  `dateField` escalates `TZ_IGNORED` and requires an explicit `now` for
  relative dates (`requireNow: false` opts out); `min`/`max` bounds on
  quantity/range/date fields (RANGE_MIN/RANGE_MAX + JSON Schema
  `minimum`/`maximum` + input-description hints); `lingoObject` closed by
  default (`additionalProperties: false`, unknown keys fail, OpenAI-strict
  compatible; `{ passthrough: true }` opts out); success results carry
  `warnings: [{ code, severity, message }]` so absorbed forgiveness is never
  silent; `canonicalizeValues` issues gain `severity` + `code` (warnings ride
  along on applied values; `repairTextWith` only blocks on errors); canonical
  numbers are float-safe (`1.36077711`, never `1.3607771100000001`).
  Eval: lingo accepts 96.9% with 0% silent-wrong (naive: 17.5% / 6.3%);
  the 3.1% delta is honest rejection-with-candidate on genuinely ambiguous
  separators. `/ai` budget recalibrated 8.0 → 8.9 kB (D20).
- MCP integration, phase 1 (plan 021): MCP tool recipe (`docs/recipes.md`),
  README "MCP tools" section, site docs MCP snippet tab, llms.txt guidance —
  lingo fields as MCP `inputSchema` + `safeParse` in handlers with
  `[CODE]`-prefixed issues as self-correction tool errors.
- Percent vocabulary: "percentage point(s)" aliases and basis points
  (`bps`/`bp`/"basis points", 0.01%) — finance tools speak pct/pp/bps
  (owner directive; no other kind claims `bps`).
- DOM fields advertise their configured `data-kind` before any parse (plan
  012 completion) — browser agents can discover field semantics from an idle
  DOM (`data-lingo` + `data-kind` + `data-unit`).
- Site SEO/social/agent infrastructure: `metadataBase`, OpenGraph + Twitter
  cards with a generated 1200×630 image, canonical URLs, `robots.txt`,
  `sitemap.xml`, per-page metadata; docs IA moves "For AI" directly after
  Forms; `/llms.md` gains the tool-boundary defaults, the MCP pattern, and
  the missing `NOW_REQUIRED` code.
- `@pascal-app/lingo/ai` ecosystem-integration helpers (plan 024): eval
  graders `quantityMatch`/`dateMatch` (canonicalize both sides through one
  field, then compare — relative-error tolerance for quantities, grain-
  truncated ISO comparison for dates — and return `{ pass, score, reason }`,
  duck-typed to promptfoo's `GradingResult`); `repairToolCallWith(specsByTool)`
  (the AI SDK v6/v7 `experimental_repairToolCall`-shaped repair hook
  `repairTextWith` didn't have — v6/v7 deprecated `generateObject`/
  `experimental_repairText` with no tool-call-shaped successor); `optional(field)`
  (nullable tool arguments — the key stays `required`, the type admits
  `null`, matching OpenAI/Anthropic's own optionality idiom); `toJSONSchema(field,
  { io?, target? })` (a named wrapper over a field's `~standard.jsonSchema`
  half, for raw provider SDKs).
- `@pascal-app/lingo/mcp` (new entry, plan 021 phase 2 + plan 024):
  `lingoTool({ name, description, input, passthrough?, handler })` builds a
  complete MCP tool descriptor from a `lingoObject` shape — closed JSON
  Schema `inputSchema`, and a `callback` that runs `safeParse` before the
  handler, returning `[CODE]`-prefixed issue messages as an `isError` tool
  result so the model self-corrects. Zero-dep; bring your own MCP SDK.
- `@pascal-app/lingo/element` (new entry, plan 024): `defineLingoInput(tag?)`
  registers a form-associated `<lingo-input>` custom element — a light-DOM
  `<input type=text>` wired through `lingoInput()` and `ElementInternals`
  (`setFormValue`/`setValidity`, `formResetCallback`/`formDisabledCallback`)
  instead of a hidden input, so it works unmodified from Vue, Svelte,
  Angular, and plain HTML.

### Fixed

- The AI-eval gate is host-timezone-independent: the corpus's expected date
  instants are civil times recorded in Europe/Paris, so the test now pins that
  zone before the date engine loads (it previously failed on UTC CI runners).

- llms.txt drift: the entries list now includes `@pascal-app/lingo/ai`; the
  `"3min from tmrw"` canonical example now matches the implementation
  (tomorrow, same time-of-day +3 min — the corpus-locked behavior), and the
  blockquote leads with the tagline.
- Site `llms.txt`/`llms.md` links now use plain `<a>` instead of `next/link`
  (client-side navigation 404s on non-app routes — header, footer, and the
  docs For-AI tiles were all affected).
- Landing hero readout no longer claims "safe for forms/tools" for
  warning-bearing parses — it shows "review warnings" instead; the AI
  canonicalizer demo distinguishes `warn:` badges from `error:` badges.

### Changed

- Parser internals split into focused modules (`parse/config`, `unit-match`,
  `quantity`, `range`, `conversion`, `finish`) behind an unchanged facade —
  zero behavior change, corpus-locked. The same treatment later applied to the
  date parser (`date/parse` → `relative`/`time`/`range`/`absolute`/`state`),
  the DOM controller (`dom/index` → `controller`/`format`/`attributes`), and
  the main entry (`createLingo` extracted to `src/factory.ts`).
- The transitional flat `describe()` view was removed from
  `@pascal-app/lingo/describe` before first release — `describeResource()` and
  `describeResult()` are the one resource vocabulary.
- Date-module results (`parseDate`, `parseDateRange`, `parseDuration`) now
  serialize with the same v3 wire contract as `lingo()` results:
  `schemaVersion: 3`, ISO date strings, and self-describing
  `{ start, end, text }` spans. Previously `JSON.stringify` on a date result
  emitted the raw runtime shape (bare `{ start, end }` spans, `Date` objects
  via default ISO coercion, no version). The site docs' "Raw JSON" views now
  show the real wire JSON instead of a hand-built approximation.
- DOM developer errors are now actionable (name the element/option and the
  fix); React adapter uses real `@types/react` typings.
- Issue ranking: a unit-slot typo now wins over the disabled-compound shape
  error (`"5 meterz"` with `accept.compounds:false` reports `UNKNOWN_UNIT`,
  not `SINGLE_VALUE_EXPECTED`).
- `StandardSchemaV1Options` narrowed to exactly `{ readonly libraryOptions?:
  Record<string, unknown> | undefined }` to match the ratified
  `@standard-schema/spec@1.1.0` (added as a types-only devDependency, zero
  runtime cost — its published `dist/index.js` is a 0-byte file); new
  spec-conformance and JSON-Schema-portability tests guard against drift from
  the published spec (plan 024).
- `./ai` marginal budget recalibrated 8.9 → 9.9 kB for the plan-024 DX
  helpers (grade, repair-tool-call, optional, toJSONSchema) — product, not
  bloat (D14/D17 pattern, D24); `./element` and `./mcp` ship as new
  tree-shakeable entries with their own line in `bun run size`.

### Docs

- Ecosystem integration recipes (plan 024): verified, cited recipes for AI
  SDK (v6/v7 direct + the v5 wrapper + `repairToolCall`), OpenAI, Anthropic,
  Gemini, the OpenAI-compatible tier (Grok/Mistral/Cohere v2/Groq/Ollama/
  Hugging Face), LangChain, MCP, evals, form libraries (React Hook Form,
  TanStack Form, Formik, Vue, Angular, shadcn, vanilla), database input, and
  a per-vertical form-UX gallery with real unit-error citations — landed in
  `docs/recipes.md`, README, and llms.txt.
