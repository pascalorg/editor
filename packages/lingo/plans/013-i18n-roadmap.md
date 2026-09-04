---
id: 013
title: i18n roadmap
status: in-progress
created: 2026-07-03
updated: 2026-07-03
---

# i18n roadmap (post-0.1)

Architecture reserves the seams now; Phase 0 locale-pack infrastructure is
specified in [`031-locale-packs.md`](031-locale-packs.md).

## Already-locale-aware in 0.1

- Number *formatting* via Intl (any locale).
- Number *parsing* separator policy is locale-independent-deterministic with
  `numberFormat` option (`'comma-decimal'` etc.) — a de-DE form works today by
  setting one option.
- Unit aliases include metric spellings (metre/litre) and unicode symbols shared
  across languages.

## The date-fns lesson (locale packs)

Locale data must be additive modules, never bundled: `@pascal-app/lingo/locales/de`
exporting `{ numberWords, unitAliases, dateVocab, messages, fuzzyVocab }` fed to
options/registry. Parser core stays language-neutral: all English vocab already
lives in data tables (number words, qualifier words, date vocab, fuzzy terms), NOT
in parser logic — this is enforced in 0.1 code review so locale packs are pure data.

## Order of attack

1. Message copy maps (already an option in 0.1).
2. de/fr/es/nl number words + date vocab (largest user ask, well-bounded).
3. CLDR-derived unit alias packs (script-generated from cldr-json, tree-shaken per
   locale — investigate licensing = Unicode permissive).
4. RTL + Eastern Arabic numerals (parser already NFKC-normalizes digits; needs corpus).

Non-goal ever: shipping all locales in the main bundle.
