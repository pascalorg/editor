# Decisions (ADR-lite)

One entry per consequential decision. Format: number, date, decision, why,
revisit-when. An entry can be a single paragraph — that is enough.

**The offer-gate:** something earns a D-number only if **all three** hold —
(1) hard to reverse, (2) surprising without context, (3) the result of a real
trade-off. If any is false it's a convention, not a decision: put it in
`wiki/conventions.md` or AGENTS.md instead. When useful, note the trade
considered ("rejected: …") and the reverse trigger ("revisit if …").

Entries are appended in the order decided; numbers are stable IDs, not
positions (D11 was amended after D13 — that's fine). Budget numbers quoted in
entries are historical snapshots; `packages/lingo/scripts/size.mjs` is the
single source of truth.

**D1 · 2026-07-03 · Zero runtime dependencies.** Droppability is the product. Intl is
allowed (platform). Revisit: never.

**D2 · 2026-07-03 · SI-anchored canonical layer with affine conversions.** Every kind
has one base unit; units are (factor, offset) pairs. No dimensional algebra — we're an
input library, not a CAS. Revisit if compound-unit parsing (kg/m²) becomes a top ask.

**D3 · 2026-07-03 · Hand-rolled recursive descent, no grammar engine, no monolithic
regexes.** Spans, error recovery, alternatives, and typo tolerance need parser state;
regexes can't say *why* they failed. Token scanner stays linear-time.

**D4 · 2026-07-03 · Honest ambiguity over silent guessing.** Ambiguous inputs return a
deterministic best interpretation + ranked alternatives + warning issue. Changing an
interpretation later is semver-MAJOR.

**D5 · 2026-07-03 · English parsing v0.1; vocab as data, never logic.** All English
words (numbers, qualifiers, date vocab, fuzzy terms) live in data tables so locale
packs are additive data modules (date-fns lesson). Formatting is locale-aware via Intl
from day one.

**D6 · 2026-07-03 · The DOM layer never rewrites text while typing.** Natural language
can't be character-masked; we parse live, preview, and normalize on commit only.
Rejected: mask-style live reformatting — caret engines exist to patch a self-inflicted
wound.

**D7 · 2026-07-03 · Main entry = batteries included; `/core` for BYO-registry
minimalists.** One mental model beats config; tree-shaking + subpath entries serve the
size-obsessed. (Bundling scope amended by D11.)

**D8 · 2026-07-03 · No `Date.now()` in library logic.** `now` is an explicit option;
only the DOM/React boundary defaults it. Determinism is an agent-facing feature.
(Tightened further by D36.)

**D9 · 2026-07-03 · Duration base unit = second (SI), not millisecond.** JS interop via
`toMilliseconds()` helper. The canonical layer speaks SI uniformly.

**D10 · 2026-07-03 · Size adjectives ("big", "heavy") are NOT parsed by default.**
No defensible universal bands; users register domain vocabularies via
`defineFuzzyVocab`. Temperature words ARE parsed (defensible shared bands, profiled).

**D12 · 2026-07-03 · Hint slots are visual-only in v0.1 (aria-hidden).** Per-keystroke
polite announcements are contested UX; the commit-time role="alert" announcement is the
accessible signal. A dedicated polite live region is a 0.2 candidate.

**D13 · 2026-07-03 · Registry inspection returns live UnitDef objects — documented,
not frozen.** Freezing/copy-on-read would tax every parse and break the registerUnits
extension idiom. `unitsOf()` mutation is an advanced escape hatch at the caller's risk.

**D11 · 2026-07-03 · Main entry stays quantity-only; dates compose via `./date`.**
Supersedes the D7 sketch of bundling dates into `.`: dates would push the main entry
far past its budget. Also accepted: `Quantity`'s chainable methods couple
format/convert into every entry — DX over maximal tree-shaking (plan 001). Revisit if
a `/full` convenience entry is requested.

**D14 · 2026-07-03 · Human error copy is product, not bloat.** A size-golfing pass
gutted DEFAULT_MESSAGES to raw codes; reverted. English copy ships as a swappable
message pack (`src/messages/en.ts`, `setDefaultMessages`) and `/core` stays copy-free
for BYO-i18n. Budgets recalibrate rather than degrading copy — the recurring "product,
not bloat" pattern later entries cite.

**D15 · 2026-07-03 · Date determinism via the strictness dial.** `strictness:'strict'`
fails RELATIVE inputs without an explicit `now` using `NOW_REQUIRED` + implicit-now
candidate. Absolute dates never require it. Offset phrases with absolute anchors
("3 days from March 3") count as relative — strict stays conservative.

**D16 · 2026-07-03 · No IIFE in the npm package for v0.1.** The demo bundle stays a
repo-local artifact outside `files`; CDN distribution deferred to 0.2 if requested.

**D17 · 2026-07-04 · Perf beats fractional kilobytes: suggestion-path pruning
accepted.** Alias-length index + character-mask prescreen + row-bailout OSA
Damerau–Levenshtein made did-you-mean 11.6× faster with 2–6× side-wins on every
suggest-touching path; output parity proven against an unpruned reference over 1.97M
alias/probe pairs. Costs a few hundred gzip bytes — accepted.

**D18 · 2026-07-04 · `/ai` entry ships both Standard Schema halves, with a
shakeability gate.** AI SDK's `asSchema()` requires `StandardSchemaV1` (validate) AND
`StandardJSONSchemaV1` (jsonSchema) for non-Zod schemas — lingo implements both, with
field input schemas typed `string` so strict provider modes let models emit natural
language for lingo to canonicalize. The full `./ai` marginal legitimately includes the
date engine for `dateField`; a separate quantityField-only size gate stops a future
refactor from silently re-coupling the date graph.

**D19 · 2026-07-04 · Budget overruns stop and escalate — never land silently.** A
parser hot-path optimization once landed without budget escalation; accepted after the
fact (verified corpus-clean and 2.5–3.6× faster) but recorded as the one process
breach. The protocol since: escalate before landing.

**D20 · 2026-07-04 · Tool-boundary safety defaults in `/ai`.** The tagline makes `/ai`
the safety boundary, so its fields ship stricter defaults than human fields (plan 020):
AMBIGUOUS_NUMBER escalates to error with a did-you-mean candidate; `dateField`
escalates TZ_IGNORED and requires an explicit `now` for relative dates
(`requireNow: false` opts out); field-level `min`/`max` bounds mirrored into JSON
Schema; `lingoObject` closed by default (`additionalProperties: false`, OpenAI-strict
compatible, `passthrough` opt-in); success-path `warnings` channel; float-safe
canonical numbers. Deliberately NOT escalated (pinned by eval gates): UNIT_ASSUMED,
TYPO_CORRECTED/SLANG_UNIT, AMBIGUOUS_DATE — absorbing model sloppiness is the product.
Companion vocab: percent gained "percentage point(s)" and basis points (bps = 0.01%).

**D21 · 2026-07-04 · shadcn-style monorepo: `packages/lingo` + `apps/site`, turbo at
the root.** Everything npm ships or gates lives in `packages/lingo`
(`repository.directory` set for provenance); the root README is a repo map.
(Package manager superseded by D22.)

**D22 · 2026-07-04 · Bun is the package manager; house lint stack adopted.** One root
`bun install` covers library + site; the site consumes the library as a live workspace
link. Releases are `workflow_dispatch` bumps publishing from packages/lingo (still
`npm publish --provenance`). Lint: Biome via Ultracite, pinned in devDeps + lefthook;
parser idioms that fight the presets are config-off in `biome.jsonc` with reasons —
never inline suppressions. Trade accepted: no bun equivalent of pnpm's
minimumReleaseAge supply-chain gate yet.

**D23 · 2026-07-05 · CI Node split.** vitest 4 requires Node ≥ 20, so the full suite
runs on Node 20/24 and a separate `node-support` matrix (18/20/24) imports and
smoke-runs the *built* dist — the honest ship-target check (the published package is
zero-dep ES2020, not vitest).

**D24 · 2026-07-05 · Ecosystem integration surface.** `./ai` gains
`quantityMatch`/`dateMatch` eval graders, `repairToolCallWith` (AI SDK v6/v7
`experimental_repairToolCall` shape), `optional()` (nullable tool args, matching
OpenAI/Anthropic optionality idioms), and `toJSONSchema(field, { io, target })`. Two
new entries: `@pascal-app/lingo/mcp` (`lingoTool`) and `@pascal-app/lingo/element`
(`<lingo-input>` via ElementInternals). `@standard-schema/spec` added as a TYPES-ONLY
devDependency behind a spec-conformance test, so lingo is a spec citizen, not a
guesser.

**D25 · 2026-07-05 · Field input schemas never emit `format`/`pattern`; emitted JSON
Schema stays draft-07 / draft-2020-12 / openapi-3.0-portable.** Verified across seven
providers: string `format`/`pattern` is decorative or inconsistently enforced, and no
JSON Schema keyword can express "valid natural-language quantity/date" anyway — that's
the seam lingo fills. A portability test fails CI if a non-portable keyword appears.
(The date OUTPUT schema carries the standard `format:'date-time'` — descriptive only,
never sent for generation.)

**D26 · 2026-07-06 · Wire-schema overhaul opens (plan 025); correctness batch
lands.** Nothing is released, so shapes may break freely and the corpus is an internal
regression contract updated deliberately. First slice: `QuantityRange.contains()`
throws on kind mismatch; non-finite base guards at construction and `fromJSON`;
negative superscript exponents (`1×10⁻³ kg`) parse.

**D27 · 2026-07-06 · Self-describing wire schema v2.** `span` became `{ start, end }`
everywhere; `Quantity.toJSON()` gained `value`/`unit`/`base`/`baseUnit` so a reader
needs no registry; range JSON hoisted `baseUnit` and fixed the mislabeled `plusMinus`
base-factor numbers; `fromJSON` validates schemaVersion, finiteness, and reversed
bounds with field-named errors. Wire ids stay compact strings — symbol/name/formatted
belong to `./describe`. (Superseded by v3, D57.)

**D28 · 2026-07-06 · Currency is a first-class, in-library, rate-based kind (plan
026).** Currency doesn't fit the affine factor+offset model, so `KindDef.rateBased`
marks kinds whose units are self-canonical (`$5` → `{ value: 5, unit: 'USD', base: 5,
baseUnit: 'USD' }`); cross-currency conversion needs injected rates
(`convertCurrency`). Shipped with prefix-symbol parsing (`$5`, `€10` — lingo's first
before-the-number unit) and Intl-backed currency formatting whose output re-parses.

**D29 · 2026-07-06 · Compile-time type inference (plan 027), zero runtime cost.**
Literal unit ids are preserved by `defineKind<const T>` on every unit table; derived
type-only exports (`BuiltinKind`, `UnitRefByKind`, `KindOfUnit`, …) give
`convert`/`convertDelta`/`quantity` single-generic validation-type signatures — NOT
escape-hatch overloads, which would let bad calls match the broad overload and never
error. `convert(5,'kg','cm')` is a compile error; dynamic `string` refs still compile.
A `type-inference.test-d.ts` gate fails CI on regressions.

**D30 · 2026-07-06 · Scientific units + notation.** Added `force`, `power`,
`frequency` kinds and `FormatOptions.notation: 'standard'|'scientific'|'engineering'`
with `exponentStyle: 'e'|'times'|'superscript'` — all three exponent styles re-parse
(two-way guarantee). Electric charge was initially skipped for the `C`/Celsius
collision (resolved in D43). Dimensional algebra stays deferred per D2.

**D31 · 2026-07-06 · Rate-based parse hardening: text returns issues, never
exceptions.** `lingo('5 EUR to USD')` threw from parsing and mixed-currency ranges
(`€5-$10`) compared self-canonical numbers as if they shared a base. New public issue
code `RATE_REQUIRED` with typed `{ from, to }` data; cross-currency conversion text,
mixed-currency ranges, and mixed-currency `±` tolerances return `ok:false` with
original-input spans.

**D32 · 2026-07-06 · Parse-result envelope is versioned.** All core `LingoResult`s
carry `schemaVersion`; successes keep their value-specific `type`, failures gain
`type:'failure'` plus an optional recursively versioned `candidate`. Makes
`JSON.stringify(lingo(...))` self-identifying without a parallel serializer API.

**D33 · 2026-07-06 · Type inference extends to built-in instances and currency
helpers.** Built-in `createLingo()` returns `BuiltinLingoInstance` with the same
literal-unit checks; `fromMinor()`/`convertCurrency()` reject unknown literal currency
codes while accepting dynamic strings. Custom `createLingo({ kinds })` intentionally
stays broad; a `LingoInstanceFor<Kinds>` pass is future work.

**D34 · 2026-07-06 · `/ai` failures carry structured issues.** Standard Schema
requires `message`/`path` but allows extras, so field failures add structured `code`,
`severity`, `span`, `data`, `suggestions`, and `candidate`. Provider adapters that
discard extras still get `[CODE]` messages for model repair; direct `safeParse()`
callers no longer parse copy.

**D35 · 2026-07-06 · `rangeField` gets an explicit self-describing output mode.**
Default stays the compact numeric `{ min, max }`; `output:'range'` returns full
`QuantityRangeJSON`. Numeric output can't represent open bounds ("under 10 kg"), so it
fails with `RANGE_OPEN_BOUND_NOT_ALLOWED` + typed `{ missing }` data instead of a
message-only failure.

**D36 · 2026-07-06 · Date parsing has no hidden clock.** `parseDate()` uses no live
clock when `now` is absent: reference-dependent inputs fail with `NOW_REQUIRED` and no
candidate. Fully absolute dates parse without `now`. `humanizeDate()` requires
`{ now }`. `dateField({ requireNow: false })` is the explicit tool-boundary escape
hatch, resolving the wall clock at field validation rather than inside core parsing.

**D37 · 2026-07-06 · Rich value descriptions live behind an opt-in entry.** The lean
wire shape uses canonical unit ids; callers who need self-evidence import from
`@pascal-app/lingo/describe`. A separate published entry rather than a class method,
so default parse/JSON bundles don't pay for rich metadata.

**D38 · 2026-07-06 · Alternatives are discriminated.** Quantity alternatives carry
`type:'quantity'`; date alternatives `type:'date'`. Ranking and payloads unchanged.

**D39 · 2026-07-06 · Code-side conversion gets a non-throwing result.** `convert()`
remains the small throwing numeric helper; `tryConvert()` returns a versioned
discriminated result with structured `UNKNOWN_UNIT` / `CONVERSION_KIND_MISMATCH` /
`RATE_REQUIRED` / `NONFINITE` issues instead of exceptions.

**D40 · 2026-07-06 · Bare currency symbols are honest assumptions.** `$5` as silent
USD is too US-centric for the ambiguity policy: bare ambiguous prefix symbols emit
`AMBIGUOUS_UNIT` with the assumed code and candidates (`$` → USD, suggesting CAD, AUD,
…). `currency: 'CAD'` disambiguates without a warning; unambiguous symbols like `€`
stay clean.

**D41 · 2026-07-07 · Readable parse-result resources; first idiom slice.** Compact
`toJSON()` remains the storage contract; the richer shape is `describeResult()` in
`./describe` — stable `object` names, `resourceSchemaVersion`, grouped
`value`/`canonical` amounts, source substrings on spans. The parser gained additive
idioms (approx., polite lead-ins, inclusive bounds, spoken quotient units, µL/cL/dL,
cubic feet). Ambiguous follow-ups were parked in `plans/backlog.md` rather than becoming
silent semantic changes.

**D42 · 2026-07-07 · Resource schema hardening; hazardous abbreviation guards.** The
resource view uses `resourceSchemaVersion: 1` (not a successor to compact wire
versions), amount-bearing `canonical` only where an amount exists, range-level
`canonicalUnit`, conversion `target:{unit}`, and resource-shaped alternatives.
Uppercase `NM` is no longer nanometers; bare `oz` keeps the mass default but emits
`AMBIGUOUS_UNIT` with a fluid-ounce suggestion unless kind context disambiguates.

**D43 · 2026-07-07 · Electrical and substance scientific kinds.** Added `voltage`,
`current`, `resistance`, `charge` (C + Ah/mAh), `substance` (mol). Hazards explicit:
spaced bare `C` stays Celsius with an `AMBIGUOUS_UNIT` coulomb suggestion;
`kind:'charge'` resolves `C` to coulombs; dimensional expressions (`V/A`, `C/s`,
`Ω*m`) stay failures.

**D44 · 2026-07-07 · Currency minor-unit idioms stay canonical.** `cent`/`cents`/`¢`
are currency-only minor-unit sugar, not registered units — `50 cents` → 0.5 USD (with
`AMBIGUOUS_UNIT` unless `{ currency }` disambiguates), `five dollars and fifty cents`
collapses to one USD quantity. Keeps JSON self-explanatory (`unit:'USD'`, never
`unit:'cent'`).

**D45 · 2026-07-07 · Data rates are their own kind; bare `bps` stays finance.**
`data_rate` kind with `bit/s` base (`5 Mbps`, `20 MB/s`, `2 MiB/s`). Bare `bps`
remains percent basis points; `kind:'data_rate'` rejects it with `KIND_MISMATCH`.
Lowercase `mbps` is accepted; byte forms stay uppercase-sensitive so bits and bytes
never collapse silently.

**D46 · 2026-07-07 · Flow rates ship as declared units, not unit algebra.**
`flow_rate` kind with `m3/s` base and a finite table (`L/s`, `L/min`, `gpm`, `cfm`,
`m³/h`, …). US `gpm` is the default; `system:'imperial'` or explicit wording selects
imperial gallons. No arbitrary dimensional expression parsing.

**D47 · 2026-07-07 · Concentration is a declared amount-concentration kind.**
`concentration` kind with `mol/m3` base and a finite chemistry table (`M`, `mM`, `µM`,
`mol/L`, …). Shorthand aliases are exact-case, so `5 mM` is concentration while `5 mm`
stays millimeters. Glued `1M` remains a failure (future suffix-multiplier hazard).

**D48 · 2026-07-07 · GBP pence idioms stay canonical.** `50p` / `50 pence` → 0.5 GBP;
`3 quid 50` → one GBP quantity. In currency context `5 pounds 25` reads as GBP;
outside it `pounds` keeps its mass meaning. Bare `p`/`pence` are GBP-specific, so no
USD-cent ambiguity warning.

**D49 · 2026-07-07 · Advanced scientific units stay explicit-table only.** Added
acceleration, torque, luminous intensity/flux, illuminance, luminance, radiation
absorbed/equivalent dose, radioactivity. Hazards in data/tests: bare `g` stays grams,
`Nm`/`kNm` exact-case vs lowercase `nm` nanometers, `rad` stays angle-only,
`Gy`/`Sv`/`Bq`/`Ci` exact-case unless written as words.

**D50 · 2026-07-07 · Resource views cover date and duration results.**
`describeResult()` accepts `parseDate()`/`parseDuration()` results: `lingo.date`
exposes `{ iso, epochMilliseconds }` + `calendar`/`grain`/`known`; `lingo.duration`
exposes displayed value, canonical seconds, `formatted`, compound `parts`. Failure
resources emit a full-input `input.span` while issue spans stay precise.

**D51 · 2026-07-07 · Pressure coverage is finite and ambiguity-first.** Added
`cmH2O`, `inH2O`, `mH2O`, `kgf/cm2`, technical atmosphere with conventional exact
factors. `psig`/`psia` stay rejected (gauge/absolute semantics need a model decision);
`kg/cm2` deferred (kg is mass, the unit is kilogram-force); lowercase `mb` remains
byte-ish — weather pressure should use `mbar`/`hPa`.

**D52 · 2026-07-07 · `describeResource()` is the standalone value resource.** It
returns the same `lingo.quantity`/`lingo.range` primitives `describeResult()` nests,
so a standalone value and a parse result read with one vocabulary. A runtime guard
makes `describeResource()` on a non-value throw a clear "use describeResult() instead"
error. (The transitional flat `describe()` view was removed pre-release — resource
views are the one vocabulary.)

**D53 · 2026-07-07 · Metric-prefix case hazards resolve by magnitude, never silently
wrong.** Case-folding made `Mg`/`Mm`/`mHz`/`mPa`/`mJ`/`mWh` silently read their
opposite-magnitude sibling. Fix: register the missing counterparts with `caseExact` on
the unambiguous mixed-case spelling and no `best` rank, so `Mg` → megagram while `mg`
→ milligram and sloppy `100 mhz` → megahertz keep working; best-fit never emits the
new units. **Megaliter is deliberately NOT registered:** `ML` is also casual
milliliter, so there's no safe silent default.

**D54 · 2026-07-07 · Cross-kind unit refs resolve to one kind at the type level.**
`KindOfUnit<U>` walks the `allKinds` tuple in registration order and returns the FIRST
claiming kind, mirroring runtime priority — so colliding refs (`oz`, `C`) narrow to
the kind the runtime picks and cross-kind conversions on them are compile errors. The
type-test gate covers all kinds plus collision proofs and a drift gate.

**D55 · 2026-07-07 · Size budgets carry small headroom.** Measured gzip sizes drift
~100–240 B with esbuild/zlib environment differences, so budgets in `size.mjs` sit
slightly above measured rather than razor-thin. Overruns still stop and escalate (D19).

**D56 · 2026-07-07 · `./catalog` — a read-only query surface over built-in data.**
`listKinds()`, `listUnits(kind)`, `getUnit(ref)`, `kindOf(ref)`, `relatedUnits(ref)`,
`listCurrencies()`, `currencyForCountry(iso)` return rich self-describing
`UnitInfo`/`CurrencyInfo` (resolved plural + aliases, base flag, `toBase`, currency
minor-unit). A thin wrapper over the already-bundled built-in data (deliberately NOT
the mutable default registry — catalog answers stay deterministic). A test asserts
every listed unit id parses, so the catalog can't drift from the parser.

**D57 · 2026-07-07 · Compact wire JSON is v3 — flat, self-evident, de-duplicated.**
`schemaVersion` bumps 2→3: (1) every span is `{ start, end, text }` where
`text = input.slice(start, end)`, so spans read for themselves; (2) results are FLAT —
one `schemaVersion`/`type`, `kind` at top, no `{ type, quantity: { … } }` nesting;
(3) conversions drop `targetUnit` (`converted.unit` IS the target) and
`converted.base`/`baseUnit` (`source.base`/`baseUnit` is the one authoritative
canonical pair). Implemented serialization-only: runtime result objects keep every
accessor; a `toJSON()` attached at the parse boundary (`parse/serialize.ts`) changes
what serializes. `fromJSON()` reads v3 with no v2 shim (nothing was ever released).
Gotcha worth remembering: the `toJSON` must be **enumerable** — JavaScriptCore's
`JSON.stringify` fast path skips a non-enumerable `toJSON` on primitive-only objects;
a structural guard test pins this.

**D58 · 2026-07-07 · Time-of-day, timezones, and time slots (plan 030).** Three
slices, all in the date module: (1) expanded clock forms in `parseTimeCore` —
`17h`/`17h30`, `5 o'clock`, British `quarter/half past|to`, dot separators, military
`0900 hours`, `midi`/`minuit`, number-word minutes. (2) A zone module (`date/zone.ts`):
`detectZone` reads explicit offsets, ~35 abbreviations (all flagged ambiguous), IANA
names (offset resolved DST-correctly via `Intl.DateTimeFormat…longOffset` — zero-dep);
zones are detected by default but civil time is kept — opt-in `applyZone` resolves the
real UTC instant; detected-not-applied emits `TZ_IGNORED`, ambiguous emits
`AMBIGUOUS_TIMEZONE`. (3) `parseDateRange` → `{ ok, type:'date-range', start?, end?,
… }` (NOT a polymorphic `parseDate`, NOT the numeric `QuantityRange`): `2pm to 4pm`,
`between 9 and 5`, the `9-5` shift idiom, am/pm inference across the pair,
cross-midnight rollover, open-ended `from 3pm`/`until 5`; endpoints are
reference-dependent so an absent `now` fails `NOW_REQUIRED`. A trailing zone binds to
the WHOLE slot; per-endpoint zones resolve independently. `humanizeDateRange`
round-trips; `/ai` gains `dateRangeField` with the same tool-boundary defaults as
`dateField`.

**D59 · 2026-07-08 · The date module serializes v3 like everything else.** The
owner read `"span": { "start": 0, "end": 11 }` in the docs and couldn't tell
what it meant — because `parseDate`/`parseDateRange`/`parseDuration` results
had NO wire serializer at all: `JSON.stringify` leaked the raw runtime shape
(bare spans without `text`, no `schemaVersion`, `Date` objects via default ISO
coercion). `date/serialize.ts` now attaches the same enumerable-`toJSON`
contract as `parse/serialize.ts`: flat `schemaVersion: 3` shapes, ISO date
strings, self-describing `{ start, end, text }` spans, `type:'failure'`
envelopes with typed candidates. The site docs' "Raw JSON" views switched from
a hand-built approximation to the real `JSON.stringify(result)` output — the
wire shape reading for itself is the product claim, so the demos must show the
actual wire. Cost: ~0.9 kB in the date module (budgets recalibrated for
`./date` standalone/marginal and `./ai`, which bundles the date engine —
self-evident output is product, not bloat, D14 pattern). Deferred: `./schema`
JSON Schema coverage of the date shapes (backlog).

**D60 · 2026-07-08 · Completions are a separate entry, not bundled into `.`.**
Ranked autocomplete (`completions()`) fans out unit ambiguity and prefix matches
into full parse results with canonical `text` — a fourth vocabulary noun distinct
from candidate/alternative/suggestion. Shipped as `@pascal-app/lingo/complete` so
the main entry budget stays untouched; DOM integration is injected hooks
(`complete`/`onComplete`) with no library dropdown (plan 008 non-goal holds).
Revisit if a `/full` convenience entry bundles completions. Registry
`aliasCompletions()` recalibrated full/core/date standalone budgets (+~100 B each,
see `size.mjs` D60 comment).

**D61 · 2026-07-08 · Range-tail completions and `units` override.**
Open ranges with a bare trailing bound (`10 kg to 16`, `5 to 10`) fan out to
curated per-kind units (`range-implied` source); left-side unit kind wins over
field `kind` when they differ so mass input in a length field still completes.
`units?: string[]` lets callers pin optimistic suggestions without `kind`. `./complete`
marginal budget recalibrated 1.8 → 2.2 kB (measured 2.15 kB; see `size.mjs`).
Everyday-first prefix tiering later reused the same curated table with a deeper
alias pool so duration/currency/common length readings beat obscure scientific
symbols; the `./complete` gate moved to 2.25 kB (measured 2.21 kB). Date
completions use an injected parser option instead of importing `./date`, keeping
D60's entry isolation while letting callers opt into date/date-range/duration
readings; the `./complete` gate moved to 2.6 kB for that opt-in UX, then 2.8 kB
when the D65 review made anchored date-range completions emit the canonical
"N days starting YYYY-MM-DD" text instead of echoing the raw input.

**D62 · 2026-07-08 · Locale packs are explicit data entries, shared locale
infrastructure is product.** Multi-language parsing needs resolved language profiles,
pack inheritance/merge, deterministic auto-detection, diacritic folding, CJK token
support, and a date bridge for caller-loaded packs. English-only parsing now uses a
prebuilt singleton and the English core tables no longer import date vocab, but the
public `createLingo({ locales })` / `locale` API still lives in the shared parser so
BYO-registry callers get the same behavior. Budgets recalibrate for that engine cost,
and `size.mjs` adds standalone + marginal gates for es/fr/pt/zh/ja/en-gb so future
pack growth is visible. Revisit if locale support can move behind an async/plugin
boundary without breaking the synchronous parser contract.

**D63 · 2026-07-08 · Locale correctness beats silent fallback.** Locale overlays
must not claim inherited English grammar during auto-detection, CJK unit/fuzzy
vocabulary must only appear when the zh/ja packs are loaded, and an explicit
unloaded locale must return a structured `LOCALE_NOT_LOADED` issue instead of
silently parsing as English. The fix adds a small registry alias hook and one
issue code; after trimming, the main-entry gate and `./complete` marginal gate
move by ~0.1 kB to reflect the correctness path and gzip interaction. Locale pack
standalone/marginal gates stay unchanged except the newly measured published
`./locales/en` entry.

**D64 · 2026-07-08 · Locale showcases require real unit vocab.** The multi-language
showcase cannot be credible if locale packs understand number/range words but not
localized unit names (`pulgadas`, `pouces`, `公斤`, `メートル`). The fix keeps aliases
pack-owned and tree-shakeable, uses compact grouped unit tables, and hardens
auto-detection with unit/detection signals plus an English retry. Rejected: keeping
the old budgets by dropping required aliases or letting showcase examples fail.
Budgets recalibrate for the measured locale data and the shared detector path; revisit
if locale packs move to generated compressed data or an async/plugin boundary.

**D65 · 2026-07-08 · Date-grammar weight in /ai stays proportionate to the feature.**
Plan 005's named-month periods (`last/next <month>` as strict month-grain shifts) and
duration-starting date ranges (`N <duration> starting <anchor>`, incl. glued
`3days starting tomorrow`) are shared date grammar, so they cascade into `./ai` through
`dateRangeField`. The anchored-range path only needs a unit duration, so it reaches a
split-out `parseUnitDuration` helper instead of the full `parseDuration`; the ISO 8601
and clock-form machinery tree-shakes out of `/ai` (the `./date` entry still bundles the
whole parser via its own export, so that marginal is unchanged). `humanizeDateRange`
renders the "N days starting …" phrasing only for ranges carrying an internal `anchored`
flag (never serialized) — not by pattern-matching midnight boundaries — so
externally-built whole-day ranges keep their clock phrasing and the two-way corpus is
unaffected. `./ai` marginal recalibrates 14.9 → 15.7 kB (measured 15.55) for the genuine
unit-duration weight; the D64 detector grows `full`, so it cancels in this marginal.
Rejected: reimplementing a mini duration parser inline (reinvention) or keeping the
16.4 kB gate that bundled the unused ISO/clock paths.

**D66 · 2026-07-08 · Locale date words live in packs; Spanish `mañana` is date-first.**
Natural-language dates in shipped locale packs are data, not parser branches:
`LocalePack.date` carries day offsets, day-part/time phrases, relative offset frames,
period modifier words, date filler words, localized month/weekday names, and compact
CJK offset suffixes. The shared date parser reads those tables through
`LanguageProfile.date`, so adding phrases like `midi demain`, `hace 3 días`, `明天中午`,
or `来月` grows the relevant pack row instead of the English grammar vocabulary.
Spanish ambiguity is resolved deliberately: bare `mañana` means tomorrow; morning needs
`en la mañana` / `por la mañana`, and `mañana por la mañana` means tomorrow morning.
Budgets recalibrate for the shared profile merge/detector surface, the locale data rows,
and the date parser layers that consume the new tables. Deferred: localized
`humanizeDate()` output; current humanization remains English-only until date rendering
gets pack-owned phrase tables too.

**D67 · 2026-07-09 · Anchored ranges round-trip at every grain; property tests are
the two-way gate.** A seeded property-based round-trip suite (plan 010 layer 2,
finally implemented — 41k+ cases over every kind × unit × format style) and an
adversarial review pass exposed three two-way-guarantee breaches: (1) scientific
coefficients with three decimal digits (`3.493e-4 m`) failed to re-parse because the
European-thousands `AMBIGUOUS_NUMBER` reading stranded the exponent — an attached
exponent now clears both the issue and its alternative (nobody writes `3.493e-4`
meaning 3493×10⁻⁴); plain `1.234 kg` keeps its warning. (2) Narrow style glued five
hazard units (`5K`, `5M`, `5ft³`, `5ft²`, `5kΩ`) into strings that re-parse as
different kinds — those five keep the space in narrow mode rather than teaching the
parser hazardous glued forms (D47/D53 stay intact). (3) `humanizeDateRange` rendered
time-grain anchored ranges (`3 hours starting 2026-03-01 9am`) with clock-only
phrasing that re-parses relative to `now` — the D65 `anchored` flag now renders
re-parseable "N <unit> starting <anchor>" phrasing at day, hour, and minute grain,
and the anchored path threads the trailing range zone through `finishRange`'s
zone/escalation logic (absolute anchors still need no `now`, D36). `./date`
standalone recalibrates 38.2 → 38.3 kB (measured 38.26 after golfing) for the
humanize + zone correctness weight — correctness is product, not bloat (D14
pattern). The corpus gained only additive entries; the property suite keeps one
documented exclusion (bare `C` charge-vs-Celsius, D43).

**D68 · 2026-07-09 · Wave-1 idiom engine: new pack-data seams, no language
branches.** The locale idiom research pass (335 gap idioms across es/fr/pt/zh/ja/en,
`wiki/research/locale-idioms.md`, plan 033) showed whole idiom classes blocked by
engine assumptions no pack data could reach. The fix follows D5 strictly — new
OPTIONAL pack fields consumed by shared grammar, zero per-language parser code:
`numberWords.bareScales` (bare `cien`/`mil`/`cem` open a number; English
`hundred` deliberately still requires `a`), `numberWords.composed`
(longest-match exact compounds: `quinientos`, exhaustive French vigesimal per
CLDR RBNF), `numberWords.decimalWords` (`dos coma cinco`, `trois virgule
quatorze`; English gains `point` via the same table), tens+andWords+ones
composition (`treinta y cinco` — guarded so `entre cinco y diez` stays a range),
and `grammar.approximatePhrases` (`más o menos`, `à peu près`). CJK gets a
profile-table-driven number walker (`number/cjk.ts`): sub-token segmentation
(三公斤 → 3 kg, the tokenizer's merged-CJK-token blocker), 万/亿 group algebra
(三百五十万 = 3.5M), elliptical shorthands (一百五 = 150, 三万五 = 35 000),
mixed digit+scale (3万5千), wave-dash range folding (5〜10), adjacent-number
implicit ranges (七八天 = 7–8 days; 三三 stays rejected), and post-unit 半
(两公斤半 = 2.5 kg). D47's glued-`1M` rejection holds — digit+scale composition
fires only on CJK scale characters. Chosen over chrono-node's imperative
per-locale parser classes (14 locales and still no vigesimal or `en huit` —
imperative locale code demonstrably doesn't scale idiom coverage). Cost after a
golf pass: `full` 36.9 → 38.3 kB (measured 38.19), `./core` 24.2 → 25.6
(measured 25.46), `./date` standalone 38.3 → 39.7 (measured 39.51) — the
engine mechanisms live in the shared number/parse layer so BYO-registry cores
get them; capability is product (D14). Pack data itself stays tree-shakeable in
per-locale entries (their budgets unchanged). Corpus: zero changes to existing
entries.

**D69 · 2026-07-09 · Wave-1 idiom data + localized date grammar + per-locale
corpus gates.** Completing plan 033's wave 1 on top of D68: (1) the date module
gains pack-owned spoken-clock vocabulary (`clockPastWords`/`clockToWords`/
`clockMinuteWords` — `las tres menos cuarto`, `quarter of five`, `half seven`),
`periodEdgePhrases` (start=day 1, mid=15, end=last day: `fin juillet`, 月底,
`end of the month`), `weekdayOffsetPhrases` (`lundi en huit`, `Monday week`,
`Tuesday fortnight`), `afterNext`/`beforeLast` modifier slots (再来週, 先々週,
`the week after next`), `dayPartWords` compounds (`tomorrow morning`), and
duration parsing that honors pack unit words (`2 horas`) — English defaults
preserved behavior-identically. (2) The es/fr/pt packs fill the D68 fields
(exhaustive French vigesimal from CLDR RBNF, ES/PT compound hundreds, `coma`/
`virgule`/`virgula` decimals, `y pico`/`e pouco` trailing approx, `más o menos`
class phrases, `pasado mañana`/`avant-hier`/`anteontem` offsets) and zh/ja fill
the CJK walker tables (两/幺/点/半, duration counters 个小时/時間, trailing
左右/上下, 前天/一昨日/大後天 offsets, 月底/年初 edges, 円→JPY). Traditional
units 斤/两/里/坪 are deliberately NOT registered: locale aliases map words to
EXISTING unit ids only, 斤=500g needs a real unit definition and 两 collides
with the numeral 2 (D4 honesty; backlog). (3) Locale behavior is now
corpus-gated like English: `tests/corpus/locale-<id>-source.mjs` →
`locale-<id>-contract-v1.json` per pack (184 rows: es 42, fr 37, pt 42, zh 30,
ja 34 at landing), discovered generically by `corpus-diff.mjs` and enforced in
`bun run check`. Budgets recalibrate once for the wave: packs es 1.8/fr 1.9/
pt 1.7/zh 1.3/ja 1.4 kB standalone (romance marginal 3.9, cjk 2.0, all 5.8),
`./date` standalone 39.7 → 41.0 (measured 40.85), `./date` marginal 13.1 →
14.4, `./ai` 16.1 → 17.4 (the /ai entry bundles the date engine). Main-entry
and `./core` D68 budgets hold. Deferred to wave 2 (backlog): no-space CJK
trailing approx (五公斤左右 needs suffix-stripping in the unit matcher), CJK
spoken clock (午後3時半), unit-first implied-1 (`hora y media`, `kilo y
medio`), 三点五 CJK decimal composition, `uno ochenta` elliptical heights.

**D70 · 2026-07-27 · Wave-2 locale depth: glued-script tokenization, suffix
date/clock grammar, and number-word arithmetic corrections.** Four mechanisms,
each a real trade-off:

(1) **Profile-driven splitting of glued grammar words.** Scripts without word
spaces write grammar and content as one token (`5キロ未満`, `三至五天`), so the
tokenizer now cuts word tokens at the profile's non-Latin grammar vocabulary
(range separators, bound phrases, trailing approximants) before the grammar sees
them. The cut is *suppressed inside a unit alias* — `間` is a range word but
`時間` is the hour unit, so `一時間半` must not split. That guard needs the unit
matcher during tokenization, which is why `prepare()` passes an alias-length
callback into `splitGluedWords`. Rejected: teaching each grammar rule to match
mid-token (the same ambiguity re-litigated at a dozen call sites).

(2) **Postpositional bounds are declared, not inferred.** `GrammarBoundPhrase`
gained `suffix?: boolean`, because `以上`/`未満` follow the quantity while
`大于`/`最低` precede it, and a phrase that reads as both would silently pick
one. Marked phrases are skipped by the prefix scanner and picked up by
`parseTrailingBound`. Before this, `5キロ未満` parsed as a bare `5 kg` — a
silent wrong answer, the worst failure mode for a validation library.

(3) **Suffix-delimited dates and clocks** (`date/suffix.ts`, `date/numeral.ts`):
`2026年3月5日`, `3時15分`, `下午3点半`, plus unspaced date+time compounds
(`明天下午3点`) split at day-period and clock-suffix anchors rather than at every
offset. Years spelled digit-by-digit (`二〇二六年`) read as a digit run, since
positional reading would give 2+0+2+6. All of it is pack-data-gated: a pack that
declares no `numericDateSuffixes`/`clockSuffix` never enters the path.

(4) **Number-word arithmetic was wrong in three ways**, all silent: hundreds
multiplied the whole running total instead of the 1..99 group in front of them
(`mille cinq cents` = 100500, not 1500); a banked smaller scale added instead of
multiplying (`mil millones` = 1,001,000, not 10^9); and the and-word linking a
scale to its remainder was not offered after bare scales (`cento e vinte`
failed). Fixing the third exposed the mirror bug — inside `between A and B` the
and-word belongs to the range, so the existing `noAnd` flag now threads from
`range.ts` through `ValueCtx` into the word engine. It suppresses the scale and
tens links but deliberately NOT the fraction tail, so `between five and a half
and ten kg` still reads 5.5..10.

Budgets recalibrate once for the wave (D19 escalation honored, owner approved):
main entry 38.3 → 39.4, `./core` 25.6 → 26.8, `./date` standalone 41.0 → 43.3
and marginal 14.4 → 15.7, `./ai` 17.4 → 18.6 (cascade only, no `/ai` code
changed), zh/ja packs 1.3/1.4 → 2.0 each, cjk marginal 2.0 → 3.0, all-locales
6.3 → 6.9. Every existing corpus contract row is unchanged — the whole wave is
additive (+96 locale rows, +5 English rows). Also landed: zh/ja default
currencies so the shared `¥` resolves per locale, Portuguese `cento` and
locative fillers (`na proxima segunda-feira`), and a per-locale benchmark suite
so multi-language throughput is tracked rather than assumed. Revisit if a pack
wants glued splitting for a *Latin* script — the current filter is deliberately
`!/[a-z]/i`, on the theory that spaced scripts already tokenize correctly.

**D71 · 2026-07-29 · Calendar ranges reuse the single-date parser instead of
growing a date-range grammar.** `parseDateRange` covered clock slots and
anchored durations; every calendar phrasing failed `UNSUPPORTED_DATE` —
`July 1 to July 5`, `next week`, `this weekend`. The implementation is a second
pass, not a second grammar: the clock pass runs unchanged, and only when it
declines do the same `RANGE_SPLITS` separators get retried with
`parseWithOptionalTime` on each side. Ordering is load-bearing — `2pm` parses as
a date too (time-only), so a date-first pass would silently reclassify every
existing slot.

Three trade-offs worth recording:

(1) **The end anchors to the start, not to `now`.** Endpoints resolved
independently read `July 1 to July 5` on a July-3 reference as 2027-07-01 →
2026-07-05: descending, because `forwardDates` rolls the start into next year
and leaves the end in this one. Parsing the end against the start as its
reference makes the pair always read left to right. Rejected: emitting a
reversed-range issue, which describes a defect the parser caused itself.

(2) **A period is a coarse-grained date, so it needs no period grammar.**
`next week` already resolves to its Monday at `week` grain and `August` to the
1st at `month` grain. Spanning them is a widening of a date the parser already
produces, which is why the whole calendar-period feature is one `periodEnd`
switch rather than a parallel set of range phrases — and why `2027` and
`next August` work without being enumerated anywhere. Weekends are the
exception: they resolve at `day` grain, so they widen explicitly. `weekend` also
gained `next`/`last` modifiers, which it had never had.

(3) **The lazy dash rule is disabled by ISO dates, not repaired.**
`(.+?)\s*[-–—]\s*(.+)` splits `2026-08-01 - 2026-08-05` at the first ISO dash.
When the input contains a `\d{4}-\d{2}` run the pass demands a *spaced* dash
instead, which no ISO date contains. `2026-08-01-2026-08-05` stays unparseable —
four dashes with no way to know which one splits, and guessing is exactly the
silent wrong answer this library exists to avoid. `Mon-Fri` and `9-5` keep the
lazy rule.

`humanizeDateRange` gained a `dated` provenance flag alongside the existing
`anchored` one, for the same reason it exists: without it a calendar range
renders `"12:00 AM to 12:00 AM"` and re-parses to today, breaking the two-way
guarantee. Runtime-only, never serialized.

Budgets recalibrate for the capability (D19 escalation honored): `./date`
standalone 43.3 → 43.8, `./date` marginal 15.7 → 16.2, `./ai` marginal
18.6 → 19.1 (cascade only, no `/ai` code changed — `dateRangeField` gains the
capability for free). The main entry is untouched at 39.18: the date module is
not in it. Total cost 450 B gzip for date-to-date ranges, period spans,
weekends, and the humanize branch. Every existing corpus row is unchanged; the
18 new rows are additive. Revisit if multi-date lists (`today and tomorrow`)
land — those need a new result type rather than a third endpoint, and the
`dated` flag would likely generalize into it.

**D72 · 2026-07-29 · A weekend contains the Sunday it ends on, a coarse endpoint
widens on the closing side, and a descending dated pair swaps.**

Three semantics D71 left wrong, all found by an adversarial review pass against
the plan-032 branch and all fixed with tests before shipping.

(1) **`this weekend` on a Sunday meant *next* weekend.** The Saturday was found
by rounding `now` forward (`forwardDiff(day, 6)`), which on Sunday skips the
weekend in progress. The reader standing in a weekend could only reach it as
`last weekend` — the one phrasing nobody would try. Sunday now looks back a day;
every other weekday still rounds forward. This is why the round-trip matrix now
runs the full seven references instead of a single Friday.

(2) **A coarse endpoint only meant its first day inside a compound range.**
D71 widened `August` standing alone but not `July to August`, which ended on
August 1 — the whole-period promise held for one shape and quietly failed for
the other. `widenToPeriodEnd` is now shared by the standalone path, the closing
side of a split range, and the `until X` open form. The opening side is
deliberately left alone: `from August` starts on the 1st, `until August` ends on
the 31st, and that asymmetry is the point.

(3) **Descending dated pairs came back descending.** `2026-08-09 to
2026-08-03` returned `start > end` with no issue, while D71's own prose claimed
"a pair never reads backwards". Dated pairs now swap and warn with the existing
`RANGE_REVERSED` code — the same treatment `10-5 kg` already gets, so no new
vocabulary. The swap is scoped to the dated path on purpose: `9pm to 5am` is a
legitimate overnight slot, not a typo, and clock ranges keep passing through
untouched.

Not fixed here, logged in `plans/backlog.md`: `humanizeDateRange` drops seconds
(pre-existing, verified against the commit before D71), elliptical right sides
(`Aug 3–9`), and quarters (needs a `fiscalYearStart` option to mean anything).
