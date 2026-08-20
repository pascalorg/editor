import type { FuzzyVocab } from '../core/registry'
import type { Kind, NumberFormatPolicy, UnitSystem } from '../core/types'

export type LocaleId = string

export type WordSetInput = ReadonlySet<string> | readonly string[]

export type DateOffsetUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'
export type DateGrainUnit = 'hour' | 'minute' | 'second'
export type DatePeriodUnit = 'week' | 'month' | 'year'
export type DateRelativeModifier = 'this' | 'next' | 'last' | 'afterNext' | 'beforeLast'

export interface GrammarBoundPhrase {
  bound: 'min' | 'max'
  exclusive: boolean
  phrase: string
  /**
   * The phrase follows the quantity instead of leading it (`5キロ未満`,
   * `5公斤以下`). Postposition is a property of the phrase, not of the
   * language, so each entry declares it: an unmarked phrase is only ever read
   * before the value.
   */
  suffix?: boolean
}

export interface GrammarWords {
  /**
   * Multi-word leading approximate phrases matched longest-first before
   * single-word approximateWords. E.g. "más o menos", "à peu près",
   * "mais ou menos", "por volta de". Sorted longest-first at resolve time.
   */
  approximatePhrases: readonly string[]
  approximateWords: ReadonlySet<string>
  boundPhrases: readonly GrammarBoundPhrase[]
  compoundJoinWords: ReadonlySet<string>
  compoundMinusWords: ReadonlySet<string>
  compoundPlusWords: ReadonlySet<string>
  conversionWords: ReadonlySet<string>
  exactWords: ReadonlySet<string>
  globalFillers: ReadonlySet<string>
  phraseWords: readonly string[]
  qualifierArticleFollowers: ReadonlySet<string>
  qualifierArticleWords: ReadonlySet<string>
  qualifierFillers: ReadonlySet<string>
  qualifierSkipAfterApprox: ReadonlySet<string>
  qualifierSoftenerPhrases: readonly string[]
  qualifierSoftenerWords: ReadonlySet<string>
  rangeAlternativeWords: ReadonlySet<string>
  rangeAndWords: ReadonlySet<string>
  rangeBetweenWords: ReadonlySet<string>
  rangeFromWords: ReadonlySet<string>
  rangeSeparatorWords: ReadonlySet<string>
  trailingApproxPhrases: readonly string[]
  trailingApproxWords: ReadonlySet<string>
  trailingOkWords: ReadonlySet<string>
}

export type GrammarWordsInput = Omit<
  {
    [K in keyof GrammarWords]: GrammarWords[K] extends ReadonlySet<string>
      ? WordSetInput
      : GrammarWords[K]
  },
  never
>

export interface FuzzyAmountWord {
  spread: [number, number]
  value: number
}

export interface NumberWordTables {
  andWords: ReadonlySet<string>
  articles: ReadonlySet<string>
  /**
   * Scale words that may open a number expression without a preceding multiplier.
   * E.g. Spanish "cien" (100), "mil" (1000); Portuguese "cem" (100).
   * English "hundred"/"thousand" require "a hundred" — they stay out of this table.
   */
  bareScales?: Record<string, number>
  /**
   * Single- or multi-word exact number compounds resolved via longest-match
   * before general word composition. Handles vigesimal French
   * (quatre-vingts→80), Spanish hundreds (quinientos→500), etc.
   * Multi-word entries are space-separated; matching uses the same folded text
   * as other word tables.
   */
  composed?: Record<string, number>
  /**
   * Words meaning "decimal point" spoken between integer and fractional parts.
   * E.g. Spanish "coma", French "virgule", Portuguese "vírgula", English "point".
   * "dos coma cinco" → 2.5, "two point five" → 2.5.
   */
  decimalWords?: ReadonlySet<string>
  dozenWords: ReadonlySet<string>
  fractionWords: Record<string, number>
  fuzzyAmounts: Record<string, FuzzyAmountWord>
  negativeWords: ReadonlySet<string>
  ofWords: ReadonlySet<string>
  ones: Record<string, number>
  scales: Record<string, number>
  tens: Record<string, number>
}

export type NumberWordTablesInput = Omit<
  {
    [K in keyof NumberWordTables]: NumberWordTables[K] extends ReadonlySet<string>
      ? WordSetInput
      : NumberWordTables[K] extends ReadonlySet<string> | undefined
        ? WordSetInput
        : NumberWordTables[K]
  },
  never
>

export interface LocaleDefaults {
  currency?: string
  numberFormat?: NumberFormatPolicy
  system?: Exclude<UnitSystem, 'shared'>
}

export interface LocaleUnitAliases {
  aliases: readonly string[]
  kind: Kind
  unit: string
}

export type LocaleUnitAliasGroups = Partial<
  Record<Kind, readonly (readonly [unit: string, aliases: string])[]>
>

export interface LocaleFuzzyVocab {
  kind: Kind
  vocab: FuzzyVocab
}

export interface DateTimeAlias {
  grain?: DateGrainUnit
  hour: number
  minute?: number
  second?: number
}

export interface DateDayTimePhrase extends DateTimeAlias {
  dayOffset?: number
}

export interface DateCalendarPeriodPhrase {
  modifier: DateRelativeModifier
  period: DatePeriodUnit
}

export interface DatePeriodEdgePhrase {
  edge: 'start' | 'mid' | 'end'
  /**
   * Deterministic anchor for edge phrases. `start` resolves to the first day of
   * the period, `mid` to the existing midpoint convention (week +3, month day
   * 15, year July 2), and `end` to the last day of the period. Month-name
   * composition is parser-owned (`fin juillet`); pack values do not carry month
   * names.
   */
  period: DatePeriodUnit
}

export interface DateCompactOffsetVocab {
  futureSuffixes?: readonly string[]
  pastSuffixes?: readonly string[]
  unitWords: Record<string, DateOffsetUnit>
}

/**
 * Clocks whose parts are closed by a suffix rather than separated by a colon:
 * `3点`, `3时15分`, `15時30分`. Hour numbers may be digits or, when the pack
 * declares `numerals`, its own digits (`三時`). A minute part spelled as a word
 * rather than a number (`3時半`, `三点一刻`) comes from `clockMinuteWords`.
 */
export interface DateClockSuffixVocab {
  hour: readonly string[]
  minute?: readonly string[]
  second?: readonly string[]
}

/**
 * A word that fixes a 12-hour clock reading to a half of the day, the way
 * am/pm does: `上午`/`下午`, `午前`/`午後`. `am` maps 12 to 0 and leaves 1–11
 * alone; `pm` maps 1–11 to 13–23.
 */
export interface DateDayPeriod {
  meridiem: 'am' | 'pm'
}

/**
 * Civil date parts closed by a suffix instead of a separator, as in
 * `2026年3月5日` or `3月5号`.
 */
export interface DateNumericSuffixVocab {
  day?: readonly string[]
  month?: readonly string[]
  year?: readonly string[]
}

export interface DateRelativeVocab {
  anchorWords?: readonly string[]
  futurePrefixes?: readonly string[]
  pastPrefixes?: readonly string[]
  pastSuffixes?: readonly string[]
}

export interface DateVocabPack {
  calendarPeriodPhrases?: Record<string, DateCalendarPeriodPhrase>
  clockMinuteWords?: Record<string, number>
  clockPastWords?: readonly string[]
  clockSuffix?: DateClockSuffixVocab
  clockToWords?: readonly string[]
  compactOffset?: DateCompactOffsetVocab
  dayOffsets?: Record<string, number>
  dayPartWords?: Record<string, { grain?: 'hour'; hour: number }>
  dayPeriods?: Record<string, DateDayPeriod>
  dayTimePhrases?: Record<string, DateDayTimePhrase>
  durationUnitSeconds?: Record<string, number>
  fillerWords?: readonly string[]
  modifiers?: Partial<Record<DateRelativeModifier, readonly string[]>>
  months: Record<string, number>
  numericDateSuffixes?: DateNumericSuffixVocab
  /**
   * Ordinal markers that may follow a day number in a written date
   * (`1er juillet`, `1º de julho`). Defaults to the English `st/nd/rd/th`.
   * Normalization folds the masculine/feminine ordinal indicators `º`/`ª` to
   * the degree sign (they are degree look-alikes), so Romance packs list `°`
   * next to the ASCII `o`/`a` spellings.
   */
  ordinalSuffixes?: readonly string[]
  periodEdgePhrases?: Record<string, DatePeriodEdgePhrase>
  periodWords?: Partial<Record<DatePeriodUnit, readonly string[]>>
  relative?: DateRelativeVocab
  subunit: Partial<Record<DateOffsetUnit, DateOffsetUnit>>
  timeAliases?: Record<string, DateTimeAlias>
  timeCorePattern?: string
  timePattern?: string
  unitWords: Record<string, DateOffsetUnit>
  weekdayNames: readonly string[]
  weekdayOffsetPhrases?: Record<string, number>
  weekdays: Record<string, number>
}

export interface LocalePack {
  aliases?: readonly string[]
  date?: Partial<DateVocabPack>
  defaults?: LocaleDefaults
  detectionWords?: WordSetInput
  extends?: LocaleId
  fuzzy?: readonly LocaleFuzzyVocab[]
  grammar?: Partial<GrammarWordsInput>
  locale: LocaleId
  numberWords?: Partial<NumberWordTablesInput>
  numerals?: Record<string, number>
  unitAliases?: readonly LocaleUnitAliases[]
  units?: LocaleUnitAliasGroups
}

export interface LanguageProfile {
  aliases: readonly string[]
  date?: DateVocabPack
  defaults: LocaleDefaults
  grammar: GrammarWords
  locale: LocaleId
  numberWords: NumberWordTables
  numerals?: Record<string, number>
}
