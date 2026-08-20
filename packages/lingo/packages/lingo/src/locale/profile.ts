import { enCore, englishLanguageProfile } from './en-core'
import type {
  DateClockSuffixVocab,
  DateNumericSuffixVocab,
  DateVocabPack,
  GrammarBoundPhrase,
  GrammarWords,
  GrammarWordsInput,
  LanguageProfile,
  LocalePack,
  NumberWordTables,
  NumberWordTablesInput,
  WordSetInput,
} from './types'

export const DEFAULT_LOCALE_PACKS: readonly LocalePack[] = [enCore]

const GRAMMAR_SET_KEYS = [
  'approximateWords',
  'compoundJoinWords',
  'compoundMinusWords',
  'compoundPlusWords',
  'conversionWords',
  'exactWords',
  'globalFillers',
  'qualifierArticleFollowers',
  'qualifierArticleWords',
  'qualifierFillers',
  'qualifierSkipAfterApprox',
  'qualifierSoftenerWords',
  'rangeAlternativeWords',
  'rangeAndWords',
  'rangeBetweenWords',
  'rangeFromWords',
  'rangeSeparatorWords',
  'trailingApproxWords',
  'trailingOkWords',
] as const

const GRAMMAR_LIST_KEYS = [
  'approximatePhrases',
  'phraseWords',
  'qualifierSoftenerPhrases',
  'trailingApproxPhrases',
] as const

const LONGEST_FIRST_PHRASE_KEYS: readonly (keyof GrammarWords)[] = [
  'approximatePhrases',
  'qualifierSoftenerPhrases',
  'trailingApproxPhrases',
]

const NUMBER_SET_KEYS = ['andWords', 'articles', 'dozenWords', 'negativeWords', 'ofWords'] as const
const NUMBER_RECORD_KEYS = ['fractionWords', 'fuzzyAmounts', 'ones', 'scales', 'tens'] as const
const DATE_MODIFIER_KEYS = ['this', 'next', 'last', 'afterNext', 'beforeLast'] as const
const DATE_PERIOD_KEYS = ['week', 'month', 'year'] as const
const DATE_RELATIVE_KEYS = [
  'anchorWords',
  'futurePrefixes',
  'pastPrefixes',
  'pastSuffixes',
] as const

/**
 * Merging a profile allocates ~40 Sets/Records, so doing it per parse dominates
 * the parse itself. Packs are module-level constants held for the lifetime of a
 * `createLingo()` instance, so the merge result is cached per pack-array
 * identity (weakly) and per requested locale.
 */
const profileCache = new WeakMap<readonly LocalePack[], Map<string, LanguageProfile>>()

export function resolveLanguageProfile(
  packs: readonly LocalePack[] = DEFAULT_LOCALE_PACKS,
  locale?: string,
): LanguageProfile {
  const requested = normalizeLocale(locale ?? 'en')
  if (!hasNonEnglishLocalePacks(packs) && matchesLocale(enCore, requested)) {
    return englishLanguageProfile
  }
  let byLocale = profileCache.get(packs)
  if (!byLocale) {
    byLocale = new Map()
    profileCache.set(packs, byLocale)
  }
  const cached = byLocale.get(requested)
  if (cached) {
    return cached
  }
  const all = uniquePacks([...DEFAULT_LOCALE_PACKS, ...packs])
  const pack = findPack(all, requested) ?? findPack(all, 'en')!
  const profile = buildProfile(pack, all, new Set())
  byLocale.set(requested, profile)
  return profile
}

export function hasNonEnglishLocalePacks(packs?: readonly LocalePack[]): boolean {
  return packs?.some((pack) => normalizeLocale(pack.locale) !== 'en') ?? false
}

export function isLocaleLoaded(packs: readonly LocalePack[] | undefined, locale: string): boolean {
  const target = normalizeLocale(locale)
  return (
    matchesLocale(enCore, target) || (packs?.some((pack) => matchesLocale(pack, target)) ?? false)
  )
}

function buildProfile(
  pack: LocalePack,
  packs: readonly LocalePack[],
  seen: Set<string>,
): LanguageProfile {
  if (pack === enCore) {
    return englishLanguageProfile
  }
  const id = normalizeLocale(pack.locale)
  if (seen.has(id)) {
    throw new Error(`lingo: circular locale pack inheritance for "${pack.locale}"`)
  }
  seen.add(id)
  const base = pack.extends
    ? buildProfile(
        findPack(packs, pack.extends) ??
          (() => {
            throw new Error(`lingo: locale pack "${pack.locale}" extends unknown "${pack.extends}"`)
          })(),
        packs,
        seen,
      )
    : emptyProfile(pack.locale)
  seen.delete(id)
  return mergeProfile(base, pack)
}

function mergeProfile(base: LanguageProfile, overlay: LocalePack): LanguageProfile {
  return {
    locale: normalizeLocale(overlay.locale),
    aliases: uniqueStrings([...base.aliases, ...(overlay.aliases ?? [])]),
    defaults: { ...base.defaults, ...overlay.defaults },
    grammar: mergeGrammar(base.grammar, overlay.grammar),
    numberWords: mergeNumberWords(base.numberWords, overlay.numberWords),
    date: mergeDate(base.date, overlay.date),
    numerals: overlay.numerals ? { ...(base.numerals ?? {}), ...overlay.numerals } : base.numerals,
  }
}

function emptyProfile(locale: string): LanguageProfile {
  return {
    locale: normalizeLocale(locale),
    aliases: [],
    defaults: {},
    grammar: emptyGrammar(),
    numberWords: emptyNumberWords(),
  }
}

function emptyGrammar(): GrammarWords {
  const result = { boundPhrases: [] } as unknown as GrammarWords
  for (const key of GRAMMAR_SET_KEYS) {
    result[key] = new Set()
  }
  for (const key of GRAMMAR_LIST_KEYS) {
    result[key] = []
  }
  return result
}

function emptyNumberWords(): NumberWordTables {
  const result = {} as NumberWordTables
  for (const key of NUMBER_SET_KEYS) {
    result[key] = new Set()
  }
  for (const key of NUMBER_RECORD_KEYS) {
    result[key] = {}
  }
  return result
}

function mergeGrammar(base: GrammarWords, overlay?: Partial<GrammarWordsInput>): GrammarWords {
  if (!overlay) {
    return base
  }
  const result = {
    boundPhrases: mergeBoundPhrases(base.boundPhrases, overlay.boundPhrases),
  } as GrammarWords
  for (const key of GRAMMAR_SET_KEYS) {
    result[key] = mergeSet(base[key], overlay[key])
  }
  for (const key of GRAMMAR_LIST_KEYS) {
    result[key] = mergeList(base[key], overlay[key])
  }
  // Sort phrase lists longest-first so eatAnyPhrase matches greedily.
  for (const key of LONGEST_FIRST_PHRASE_KEYS) {
    ;(result as unknown as Record<string, readonly string[]>)[key] = sortLongestFirst(
      result[key] as readonly string[],
    )
  }
  return result
}

function mergeNumberWords(
  base: NumberWordTables,
  overlay?: Partial<NumberWordTablesInput>,
): NumberWordTables {
  if (!overlay) {
    return base
  }
  const result = {} as NumberWordTables
  for (const key of NUMBER_SET_KEYS) {
    result[key] = mergeSet(base[key], overlay[key])
  }
  const records = result as unknown as Record<string, unknown>
  for (const key of NUMBER_RECORD_KEYS) {
    records[key] = { ...base[key], ...overlay[key] }
  }
  for (const key of ['bareScales', 'composed'] as const) {
    if (overlay[key] ?? base[key]) {
      result[key] = { ...(base[key] ?? {}), ...(overlay[key] ?? {}) }
    }
  }
  const decimalWords = overlay.decimalWords ?? base.decimalWords
  if (decimalWords) {
    result.decimalWords = mergeSet(base.decimalWords ?? new Set(), overlay.decimalWords)
  }
  return result
}

function mergeDate(
  base: DateVocabPack | undefined,
  overlay: Partial<DateVocabPack> | undefined,
): DateVocabPack | undefined {
  if (!(base || overlay)) {
    return
  }
  return {
    calendarPeriodPhrases: mergeRecord(base?.calendarPeriodPhrases, overlay?.calendarPeriodPhrases),
    clockMinuteWords: mergeRecord(base?.clockMinuteWords, overlay?.clockMinuteWords),
    clockPastWords: mergeList(base?.clockPastWords ?? [], overlay?.clockPastWords),
    clockSuffix: mergeClockSuffix(base?.clockSuffix, overlay?.clockSuffix),
    clockToWords: mergeList(base?.clockToWords ?? [], overlay?.clockToWords),
    compactOffset:
      base?.compactOffset || overlay?.compactOffset
        ? {
            futureSuffixes: mergeList(
              base?.compactOffset?.futureSuffixes ?? [],
              overlay?.compactOffset?.futureSuffixes,
            ),
            pastSuffixes: mergeList(
              base?.compactOffset?.pastSuffixes ?? [],
              overlay?.compactOffset?.pastSuffixes,
            ),
            unitWords: mergeRecord(
              base?.compactOffset?.unitWords,
              overlay?.compactOffset?.unitWords,
            ),
          }
        : undefined,
    dayOffsets: mergeRecord(base?.dayOffsets, overlay?.dayOffsets),
    dayPartWords: mergeRecord(base?.dayPartWords, overlay?.dayPartWords),
    dayPeriods: mergeRecord(base?.dayPeriods, overlay?.dayPeriods),
    dayTimePhrases: mergeRecord(base?.dayTimePhrases, overlay?.dayTimePhrases),
    durationUnitSeconds: mergeRecord(base?.durationUnitSeconds, overlay?.durationUnitSeconds),
    fillerWords: mergeList(base?.fillerWords ?? [], overlay?.fillerWords),
    modifiers: mergeListRecord(base?.modifiers, overlay?.modifiers, DATE_MODIFIER_KEYS),
    months: mergeRecord(base?.months, overlay?.months),
    numericDateSuffixes: mergeNumericDateSuffixes(
      base?.numericDateSuffixes,
      overlay?.numericDateSuffixes,
    ),
    ordinalSuffixes: mergeList(base?.ordinalSuffixes ?? [], overlay?.ordinalSuffixes),
    periodEdgePhrases: mergeRecord(base?.periodEdgePhrases, overlay?.periodEdgePhrases),
    periodWords: mergeListRecord(base?.periodWords, overlay?.periodWords, DATE_PERIOD_KEYS),
    relative: mergeListRecord(base?.relative, overlay?.relative, DATE_RELATIVE_KEYS),
    subunit: mergeRecord(base?.subunit, overlay?.subunit),
    timeAliases: mergeRecord(base?.timeAliases, overlay?.timeAliases),
    timeCorePattern: overlay?.timeCorePattern ?? base?.timeCorePattern,
    timePattern: overlay?.timePattern ?? base?.timePattern,
    unitWords: mergeRecord(base?.unitWords, overlay?.unitWords),
    weekdayOffsetPhrases: mergeRecord(base?.weekdayOffsetPhrases, overlay?.weekdayOffsetPhrases),
    weekdayNames: overlay?.weekdayNames ?? base?.weekdayNames ?? [],
    weekdays: mergeRecord(base?.weekdays, overlay?.weekdays),
  }
}

function mergeRecord<T>(base?: Record<string, T>, overlay?: Record<string, T>): Record<string, T> {
  return { ...(base ?? {}), ...overlay }
}

function mergeClockSuffix(
  base?: DateClockSuffixVocab,
  overlay?: DateClockSuffixVocab,
): DateClockSuffixVocab | undefined {
  if (!(base || overlay)) {
    return
  }
  return {
    hour: mergeList(base?.hour ?? [], overlay?.hour),
    minute: mergeList(base?.minute ?? [], overlay?.minute),
    second: mergeList(base?.second ?? [], overlay?.second),
  }
}

function mergeNumericDateSuffixes(
  base?: DateNumericSuffixVocab,
  overlay?: DateNumericSuffixVocab,
): DateNumericSuffixVocab | undefined {
  if (!(base || overlay)) {
    return
  }
  return {
    day: mergeList(base?.day ?? [], overlay?.day),
    month: mergeList(base?.month ?? [], overlay?.month),
    year: mergeList(base?.year ?? [], overlay?.year),
  }
}

function mergeListRecord<K extends string>(
  base: Partial<Record<K, readonly string[]>> | undefined,
  overlay: Partial<Record<K, readonly string[]>> | undefined,
  keys: readonly K[],
): Partial<Record<K, readonly string[]>> | undefined {
  if (!(base || overlay)) {
    return
  }
  const result: Partial<Record<K, readonly string[]>> = {}
  for (const key of keys) {
    result[key] = mergeList(base?.[key] ?? [], overlay?.[key])
  }
  return result
}

function mergeSet(base: ReadonlySet<string>, overlay?: WordSetInput): ReadonlySet<string> {
  return new Set([...base, ...toWords(overlay)].map((word) => word.toLowerCase()))
}

function mergeList(base: readonly string[], overlay?: readonly string[]): readonly string[] {
  return uniqueStrings([...base, ...(overlay ?? [])].map((word) => word.toLowerCase()))
}

function mergeBoundPhrases(
  base: readonly GrammarBoundPhrase[],
  overlay?: readonly GrammarBoundPhrase[],
): readonly GrammarBoundPhrase[] {
  const seen = new Set<string>()
  const out: GrammarBoundPhrase[] = []
  for (const phrase of [...base, ...(overlay ?? [])]) {
    const key = phrase.phrase.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ ...phrase, phrase: key })
    }
  }
  return out
}

function toWords(input?: WordSetInput): readonly string[] {
  return input ? [...input] : []
}

function findPack(packs: readonly LocalePack[], locale?: string): LocalePack | undefined {
  const target = normalizeLocale(locale ?? 'en')
  const exact = packs.find((pack) => matchesLocale(pack, target))
  if (exact) {
    return exact
  }
  const base = target.split('-')[0]
  return packs.find((pack) => normalizeLocale(pack.locale) === base)
}

function matchesLocale(pack: LocalePack, locale: string): boolean {
  return (
    normalizeLocale(pack.locale) === locale ||
    (pack.aliases ?? []).some((alias) => normalizeLocale(alias) === locale)
  )
}

function uniquePacks(packs: readonly LocalePack[]): readonly LocalePack[] {
  const out = new Map<string, LocalePack>()
  for (const pack of packs) {
    out.set(normalizeLocale(pack.locale), pack)
  }
  return [...out.values()]
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}

function sortLongestFirst(phrases: readonly string[]): readonly string[] {
  return [...phrases].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

export function normalizeLocale(locale: string): string {
  return locale.toLowerCase().replace('_', '-')
}

export { englishLanguageProfile } from './en-core'
export type { LanguageProfile, LocalePack }
