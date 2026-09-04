---
id: 031
title: Locale packs
status: in-progress
created: 2026-07-08
updated: 2026-07-27
goal: "Ship Phase 0 multi-language infrastructure: loaded locale packs, resolved language profiles, and parser plumbing with zero English corpus drift."
success_criteria:
  - "English parsing is unchanged -> packages/lingo/src/parse/corpus.test.ts and corpus-diff gate"
  - "Locale profile resolution and detection are covered -> packages/lingo/tests/locale.test.ts"
  - "Published locale subpaths build -> packages/lingo/tsup.config.ts and package exports"
---

# Locale packs

Driver: plan 013 reserved additive locale packs after 0.1. Phase 0 makes the
parser data-driven for grammar and number words without translating unit alias
tables or bundling every language into the main path.

## Design principle

**Locale packs are additive data, language profiles are resolved runtime state.**
Parser code reads a fully merged `LanguageProfile`; pack files stay tree-shakeable
modules that callers opt into with `createLingo({ locales })`.

## Design (locked-in 2026-07-08)

New infrastructure under `packages/lingo/src/locale/`:

```ts
export interface LocalePack {
  locale: string
  aliases?: readonly string[]
  extends?: string
  defaults?: LocaleDefaults
  unitAliases?: readonly LocaleUnitAliases[]
  fuzzy?: readonly LocaleFuzzyVocab[]
  grammar?: Partial<GrammarWordsInput>
  numberWords?: Partial<NumberWordTablesInput>
  date?: Partial<DateVocabPack>
  numerals?: Record<string, number>
}

export interface LanguageProfile {
  locale: string
  aliases: readonly string[]
  defaults: LocaleDefaults
  grammar: GrammarWords
  numberWords: NumberWordTables
  date?: DateVocabPack
  numerals?: Record<string, number>
}
```

`resolveLanguageProfile(packs, locale?)` includes English as the base profile,
matches BCP-47 aliases case-insensitively, and merges overlays such as `en-gb`
onto `en`. Non-English Phase 0 packs extend English so untranslated grammar
remains usable until each language graduates to a complete pack.

`detectLocale(packs, input)` and `detectLanguageProfile(packs, input)` score
English plus the packs already loaded by the instance. Scoring is deterministic:
number words, grammar words, date vocabulary, and CJK `numerals` all add fixed
weights; ties keep candidate order, so inherited English grammar stays English
unless the input contains pack-specific signal.

Parser integration:

1. `ParseOptions.locale?: string` chooses a loaded profile.
2. `CreateLingoOptions.locales?: readonly LocalePack[]` installs opt-in packs on
   an isolated instance, including any pack-owned unit aliases or fuzzy vocab.
3. `ParserState.profile` is the single parser-facing locale object.
4. Grammar reads from `p.profile.grammar`, not module-level English constants.
5. `ValueCtx.profile` supplies number-word tables to `number/words.ts`.
6. Successful `LingoResult`s carry `locale?: string` at runtime; serialized v3
   JSON stays stable for Phase 0.

Published packs:

- `@pascal-app/lingo/locales/en`
- `@pascal-app/lingo/locales/en-gb`
- `@pascal-app/lingo/locales/es`
- `@pascal-app/lingo/locales/fr`
- `@pascal-app/lingo/locales/pt`
- `@pascal-app/lingo/locales/zh`
- `@pascal-app/lingo/locales/ja`

## Changes

1. Locale infrastructure: types, English pack, resolver, detector, index exports.
2. Parser plumbing: `ParseOptions.locale`, `ParserState.profile`, grammar lookup
   via profile, number-word tables via `ValueCtx.profile`, locale on successes.
3. Factory plumbing: `createLingo({ locales })` stores packs on instance defaults.
4. Tokenizer groundwork: Han, Hiragana, and Katakana runs emit word tokens;
   `LocalePack.numerals` reserves future CJK numeric parsing.
5. Packaging: tree-shakeable locale entry points and exports.
6. Explicit unloaded locales return `LOCALE_NOT_LOADED` instead of silently using
   English.
7. Tests: profile resolution, overlay merge, detector basics, parser locale
   selection, CJK tokenization.
8. Date vocabulary: `LocalePack.date` now carries pack-owned deictics
   (`demain`, `mañana`, `明天`), day-part/time phrases (`midi demain`,
   `mañana por la mañana`, `明天中午`), relative offset frames (`dans N jours`,
   `hace N días`), calendar period words (`le mois prochain`,
   `el mes que viene`, `下个月`), localized month/weekday names, filler words for
   dates like `12 de julio de 2026`, and compact CJK offset units/suffixes.
   The date parser reads those tables through `LanguageProfile.date`; language
   strings do not live in the core date grammar.
9. Suffix-delimited date/clock vocabulary (D70): `DateVocabPack` gained
   `numericDateSuffixes` (年/月/日), `clockSuffix` (点/時/分/秒 plus minute words
   such as 半/一刻), `dayPeriods` (上午/下午, 午前/午後), and `ordinalSuffixes`
   (Romance `1er`/`1º`). `date/suffix.ts` consumes them; `date/numeral.ts` reads
   locale numerals (positional `十`-tens plus digit-run years like `二〇二六`).
   A pack that declares none of these fields never enters those paths.
10. Glued-script tokenization and postpositional bounds (D70): the tokenizer
   splits word tokens at the profile's non-Latin grammar vocabulary so glued
   grammar is visible to the parser, suppressed inside unit aliases (`一時間半`
   stays one hour-and-a-half, not a range at `間`). `GrammarBoundPhrase.suffix`
   marks comparators that follow the quantity (`以上`, `未満`), read by
   `parseTrailingBound` in the quantity and range paths.

## Date locale policy

- Spanish `mañana` is **tomorrow** when it stands alone. Morning requires an
  explicit frame such as `en la mañana` / `por la mañana`; `mañana por la
  mañana` means tomorrow morning. Those bare morning frames forward-bias to the
  next morning (the mañana policy), so at 3pm they resolve to tomorrow 9am.
- Bare midday phrases (`mediodía`, `midi`, `meio-dia`, `中午`, `正午`) anchor to
  **today**, matching English `noon` — they carry `dayOffset: 0`. Midnight
  (`minuit`) has no such pin and forward-rolls to the next `00:00`, matching
  English `midnight` (a `TIME_ALIAS`, not a pinned day-time phrase).
- French, Spanish, and Portuguese packs cover the owner-requested date examples
  end-to-end. Chinese and Japanese cover compact offsets plus the requested
  tomorrow-noon and next-month phrases without a broader segmentation rewrite.
- `humanizeDate()` remains English-only in this phase. Because non-English
  packs still inherit English parser support only partially in date space,
  localized humanized date output is a follow-up before claiming full per-locale
  two-way natural-language rendering. Parser tests round-trip via ISO canonical
  dates until locale humanization ships.

## Non-goals

- Translating the built-in English unit tables.
- Shipping all locale packs through the default `.` entry.
- Localized `humanizeDate()` / `humanizeDuration()` output in Phase 0.
- Full CJK segmentation or compound numeral grammar. (D70 splits word tokens at
  pack-declared grammar vocabulary; that is targeted grammar-boundary cutting,
  not general segmentation — there is still no dictionary or statistical model.)
- Changing serialized result JSON in the v3 contract.

## Acceptance

Run from `packages/lingo/`:

```sh
bun run typecheck
bun run test
```

English corpus output must remain unchanged. Any future translated unit aliases
or non-English date parsing need additive corpus rows and a follow-up plan update.
