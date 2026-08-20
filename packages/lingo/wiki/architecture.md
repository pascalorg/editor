# Architecture (as built)

Plan 001 is the forward spec; this page reflects what shipped. Two notable
amendments along the way: dates compose via `./date` instead of riding the main
entry (D11), and the compact wire JSON is flat v3 (D57).

## Data flow

```
input string
  → normalizeInput      offset-mapped NFKC + fold table (spans → original string)
  → tokenize            digits / word / vulgar-fraction atoms / sym (+spaceBefore)
  → grammar             qualifiers → value → unit → compound tails → range/± /
                        conversion → fuzzy fallback → trailing policy
  → LingoResult         schemaVersion:3 flat envelope; quantity | range |
                        conversion | number | failure (dates/durations via ./date)
       ↑ registry: alias index (ci + caseExact pools, longest-prefix,
         kind-context ranking, Damerau–Levenshtein suggestions, fuzzy vocabs)
       ↓ Quantity/QuantityRange (base = SI-anchored; affine convert + delta path)
  → format / humanize   compound carry, toBest ladders, Intl numbers — output
                        guaranteed re-parseable (round-trip tests)
```

## Modules and entries

| entry | source | contents |
|-------|--------|----------|
| `.` (main) | `src/index.ts` | batteries-included: parse, convert, format, `createLingo`, extension points |
| `./core` | `src/core/` + `src/parse/` + `src/number/` + `src/format/` | engine without bundled unit data — BYO registry, copy-free (D14) |
| `./date` | `src/date/` | NL dates, time-of-day, zones, ranges/slots, reversible humanize, ISO durations; `suffix.ts`/`numeral.ts` handle suffix-delimited CJK dates and clocks (D70) |
| `./dom` | `src/dom/` | headless input controller |
| `./element` | `src/element/` | `<lingo-input>` form-associated custom element |
| `./react` | `src/react/` | `useLingoInput` hook (`'use client'`) over the DOM controller |
| `./react-native` | `src/react-native/` | DOM-free `useLingoTextInput` for RN `TextInput`; reuses `LingoFieldFormatOptions` helpers from `dom/format.ts`, never imports `react-native` |
| `./describe` | `src/describe/` | resource views: `describeResource`, `describeResult` |
| `./catalog` | `src/catalog/` | read-only queries over built-in unit/kind/currency data (D56) |
| `./schema` | `src/schema/` | machine-readable schema for the v3 wire JSON (pure data) |
| `./ai` | `src/ai/` | Standard Schema fields for LLM structured output, eval graders, repair hooks |
| `./mcp` | `src/mcp/` | `lingoTool` MCP tool descriptor builder |
| `./complete` | `src/complete/` | ranked autocomplete: `completions`, unit suggestions (D60/D61) |
| `./locales/*` | `src/locales/` + `src/locale/` | opt-in per-language packs (en, en-gb, es, fr, pt, zh, ja) for `createLingo({ locales })` (D62–D66) |

Supporting internals: `src/units/` (33 built-in kinds, pure const data),
`src/fuzzy/` (temperature vocabularies), `src/messages/en.ts` (swappable
English message pack — `/core` ships copy-free), and `src/locale/` (locale-pack
resolver + detector; the packs themselves live in `src/locales/`).

## Key mechanisms worth knowing before touching anything

- **Spans**: every result's and issue's `{ start, end, text }` indexes the
  ORIGINAL string as half-open UTF-16 offsets, with the matched substring
  inline (`input.slice(start, end) === span.text`). The normalizer carries
  per-char start/end maps because NFKC changes lengths (℃ → °C) and invisibles
  are dropped. `toSourceSpan` translates.
- **Result envelope**: results serialize flat with `schemaVersion: 3` and a
  `type` discriminant (D57). Failures use `type:'failure'` and may carry a full
  candidate result with the same envelope. The serializer is a `toJSON()`
  attached at the parse boundary (`src/parse/serialize.ts`) — and it must stay
  **enumerable**: JavaScriptCore's `JSON.stringify` fast path skips a
  non-enumerable `toJSON` on primitive-only objects.
- **Two registries by design**: the main entry's `defaultRegistry` is mutable
  via `registerKind`/`registerUnits`/`defineFuzzyVocab`; `./catalog` reads a
  private frozen snapshot of the built-in data only, so catalog answers stay
  deterministic (documented in `src/catalog/index.ts`).
- **Vulgar-fraction atoms**: NFKC expands `1½` to `11/2` in place; the tokenizer
  detects same-origin `d/d` runs (all chars map to one source index) and emits a
  dedicated token — otherwise 1½ would read as eleven halves.
- **Prime folding**: U+2033 ″ NFKC-decomposes into TWO primes, so ″→`"` and
  ′→`'` are folded *before* NFKC. All apostrophe-alikes (´ ` ’ ʹ) fold too.
- **Alias matching** is longest-prefix over normalized text (not token equality):
  aliases may contain spaces/dots/slashes ('fl. oz.', 'sq ft', 'km/h'). Exact-case
  pool beats case-insensitive at equal length (Mb vs mb). Boundary rule blocks
  letters after a match but allows digits (compound tails: 1m80).
- **Glued-digits demotion**: '6ft2' prefers the height idiom over the ft² alias;
  '6 ft2' and '2m2' stay areas. Kind context overrides both ways.
- **Typo auto-accept**: unique distance-1 candidate within the expected kind →
  TYPO_CORRECTED warning; otherwise UNKNOWN_UNIT with ranked suggestions
  (bare-value + single unknown word also routes here, not to TRAILING).
- **Temperature deltas**: `convertDelta`/`widthIn` use factors only. Range widths
  in °C↔°F would be silently wrong through the affine path.
- **5K guard**: the k/bn suffix multiplier is disabled under kind 'temperature'
  (5K is kelvin, 70k is 70 000).
- **Registry refs are liberal**: `.to('L')`, `convert(1,'gal','L')` resolve
  through aliases; `Quantity.unit` canonicalizes to the id ('l').
- **Glued-grammar splitting is alias-guarded** (D70): scripts without word spaces
  glue grammar to content (`5キロ未満`), so `prepare()` cuts word tokens at the
  profile's non-Latin grammar vocabulary before parsing. The cut must be
  suppressed *inside a unit alias* — `間` is a range word but `時間` is the hour
  unit, so `一時間半` would otherwise split into a range. That is why
  `splitGluedWords` takes an alias-length callback: tokenization has to consult
  the unit matcher. If a CJK unit ever parses as a range, look here first.
- **`noAnd` is threaded, not global** (D70): inside `between A and B` the and-word
  belongs to the range, so `range.ts` passes `noAnd` through `QtyFlags` →
  `ValueCtx` → the number-word engine, where it suppresses the scale link
  (`one thousand and two thousand`) and the tens+ones link. It deliberately does
  NOT suppress the fraction tail, so `between five and a half and ten kg` reads
  5.5..10. Blanking `andWords` wholesale looks equivalent and breaks that case.
- **No hidden clock**: `parseDate()` reads no wall clock; reference-dependent
  inputs without `now` fail with `NOW_REQUIRED` (D36). The `/ai` date fields'
  `requireNow: false` is the one explicit opt-in to the host clock, at field
  validation only.
- **NUL-byte incident**: template literals in registry.ts once contained literal
  U+0000 separators (from a generation artifact), making tooling treat the file
  as binary while TypeScript compiled it happily. If grep ever "can't find" text
  that's visibly there, run `file` on it. Separator is now '|'.

## Verification

`bun run check` is the gate: tsc strict + `noUncheckedIndexedAccess`, the full
vitest suite (1,000+ tests), build, size budgets (`scripts/size.mjs` — the only
place budget numbers live), corpus compatibility across the English and
per-locale contracts (`scripts/corpus-diff.mjs`), llms.txt docs sync
(`check-docs-sync.mjs`, both copies), entry-point coverage in the generated
agent index (`check-llms-index.mjs`), zero-dependency check, and schema
artifact sync. CI runs the same gates plus a built-dist smoke test on every
supported Node version.
