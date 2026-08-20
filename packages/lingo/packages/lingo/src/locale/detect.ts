import { normalizeInput } from '../parse/normalize'
import { type Token, tokenize } from '../parse/tokenize'
import { englishLanguageProfile } from './en-core'
import { normalizeLocale, resolveLanguageProfile } from './profile'
import type { LanguageProfile, LocalePack } from './types'

const packAliasCache = new WeakMap<LocalePack, PackAliases>()
const packDetectionCache = new WeakMap<LocalePack, ReadonlySet<string>>()
const englishWordCache = new WeakMap<LanguageProfile, ReadonlySet<string>>()
const boundPhraseCache = new WeakMap<
  LanguageProfile,
  { all: readonly string[]; uniqueVsEnglish: readonly string[] }
>()

/**
 * Normalization + tokenization of the input under test. Detection scores every
 * loaded pack against the same input, and the caller (`prepare()`) has usually
 * done this work already — sharing one scan keeps detection O(packs) in table
 * lookups instead of O(packs) in full re-tokenization.
 */
export interface LocaleScan {
  lower: string
  raw: string
  tokens: readonly Token[]
}

export function localeScan(input: string): LocaleScan {
  const n = normalizeInput(input)
  return { lower: n.text.toLowerCase(), raw: input, tokens: tokenize(n) }
}

export function detectLanguageProfile(
  packs: readonly LocalePack[],
  input: string,
  scan?: LocaleScan,
): LanguageProfile {
  const locale = detectLocale(packs, input, scan)
  return resolveLanguageProfile(packs, locale)
}

export function detectLocale(
  packs: readonly LocalePack[],
  input: string,
  scan: LocaleScan = localeScan(input),
): string | undefined {
  let bestLocale = 'en'
  let bestScore = scoreScan(englishLanguageProfile, scan, {})
  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i]!
    if (normalizeLocale(pack.locale) === 'en') {
      continue
    }
    const profile = resolveLanguageProfile(packs, pack.locale)
    const aliases = unitAliases(pack)
    const score = scoreScan(profile, scan, {
      aliasPhrases: aliases.phrases,
      aliasWords: aliases.words,
      detectionWords: packDetectionWords(pack),
      uniqueAgainst: englishLanguageProfile,
    })
    if (score > bestScore) {
      bestLocale = profile.locale
      bestScore = score
    }
  }
  return bestScore > 0 ? bestLocale : undefined
}

interface ScoreOptions {
  aliasPhrases?: readonly string[]
  aliasWords?: ReadonlySet<string>
  detectionWords?: readonly string[] | ReadonlySet<string>
  uniqueAgainst?: LanguageProfile
}

export function scoreProfile(
  profile: LanguageProfile,
  input: string,
  options: ScoreOptions = {},
): number {
  return scoreScan(profile, localeScan(input), options)
}

function scoreScan(profile: LanguageProfile, scan: LocaleScan, options: ScoreOptions): number {
  const { lower, tokens } = scan
  const uniqueAgainst = options.uniqueAgainst ? profileWords(options.uniqueAgainst) : undefined
  const detectionWordSet = detectionWords(options.detectionWords)
  let score = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.type !== 'word') {
      continue
    }
    const word = token.text.toLowerCase()
    const unique = !uniqueAgainst?.has(word)
    const standalone = isStandaloneWord(tokens, i)
    if (
      unique &&
      (profile.numberWords.ones[word] !== undefined ||
        profile.numberWords.tens[word] !== undefined ||
        profile.numberWords.scales[word] !== undefined ||
        profile.numberWords.bareScales?.[word] !== undefined ||
        profile.numberWords.composed?.[word] !== undefined)
    ) {
      score += 4
    }
    if (
      unique &&
      (profile.numberWords.fuzzyAmounts[word] ||
        profile.numberWords.fractionWords[word] !== undefined ||
        profile.numberWords.decimalWords?.has(word))
    ) {
      score += 3
    }
    if (
      unique &&
      standalone &&
      (profile.grammar.approximateWords.has(word) ||
        profile.grammar.conversionWords.has(word) ||
        profile.grammar.exactWords.has(word) ||
        profile.grammar.rangeAndWords.has(word) ||
        profile.grammar.rangeBetweenWords.has(word) ||
        profile.grammar.rangeFromWords.has(word) ||
        profile.grammar.rangeSeparatorWords.has(word))
    ) {
      score += 2
    }
    if (
      unique &&
      standalone &&
      (profile.date?.months[word] !== undefined ||
        profile.date?.weekdays[word] !== undefined ||
        profile.date?.dayOffsets?.[word] !== undefined ||
        profile.date?.dayTimePhrases?.[word] !== undefined ||
        profile.date?.timeAliases?.[word] !== undefined ||
        profile.date?.calendarPeriodPhrases?.[word] !== undefined)
    ) {
      score += 2
    }
    if (unique && options.aliasWords?.has(word)) {
      score += 3
    }
    if (unique && detectionWordSet.has(word)) {
      score += 3
    }
  }

  for (const phrase of boundPhrases(profile, uniqueAgainst)) {
    if (hasPhrase(lower, phrase)) {
      score += 2
    }
  }
  for (const alias of options.aliasPhrases ?? []) {
    if (isUniquePhrase(alias, uniqueAgainst) && hasPhrase(lower, alias)) {
      score += 3
    }
  }

  if (profile.numerals) {
    for (const ch of scan.raw) {
      if (profile.numerals[ch] !== undefined) {
        score += 3
      }
    }
  }

  return score
}

interface PackAliases {
  phrases: readonly string[]
  words: ReadonlySet<string>
}

function unitAliases(pack: LocalePack): PackAliases {
  const cached = packAliasCache.get(pack)
  if (cached) {
    return cached
  }
  const words = new Set<string>()
  for (const kind of Object.keys(pack.units ?? {})) {
    for (const entry of pack.units![kind as keyof typeof pack.units] ?? []) {
      for (const alias of entry[1].split(' ')) {
        words.add(normalizeInput(alias).text.toLowerCase())
      }
    }
  }
  for (const entry of pack.unitAliases ?? []) {
    for (const alias of entry.aliases) {
      words.add(normalizeInput(alias).text.toLowerCase())
    }
  }
  const aliases: PackAliases = {
    phrases: [...words].filter((alias) => alias.includes(' ')),
    words,
  }
  packAliasCache.set(pack, aliases)
  return aliases
}

/**
 * Bound phrases are scanned as substrings on every candidate pack, so the
 * uniqueness filter is precomputed per profile rather than re-split per parse.
 */
function boundPhrases(
  profile: LanguageProfile,
  uniqueAgainst: ReadonlySet<string> | undefined,
): readonly string[] {
  let cached = boundPhraseCache.get(profile)
  if (!cached) {
    const all = profile.grammar.boundPhrases.map((entry) => entry.phrase)
    cached = {
      all,
      uniqueVsEnglish: all.filter((phrase) =>
        isUniquePhrase(phrase, profileWords(englishLanguageProfile)),
      ),
    }
    boundPhraseCache.set(profile, cached)
  }
  if (!uniqueAgainst) {
    return cached.all
  }
  if (uniqueAgainst === profileWords(englishLanguageProfile)) {
    return cached.uniqueVsEnglish
  }
  return cached.all.filter((phrase) => isUniquePhrase(phrase, uniqueAgainst))
}

const EMPTY_WORDS: ReadonlySet<string> = new Set()

function packDetectionWords(pack: LocalePack): ReadonlySet<string> {
  const cached = packDetectionCache.get(pack)
  if (cached) {
    return cached
  }
  const words = detectionWords(pack.detectionWords)
  packDetectionCache.set(pack, words)
  return words
}

function detectionWords(words: ScoreOptions['detectionWords']): ReadonlySet<string> {
  if (!words) {
    return EMPTY_WORDS
  }
  return new Set([...words].map((word) => normalizeInput(word).text.toLowerCase()))
}

function profileWords(profile: LanguageProfile): ReadonlySet<string> {
  const cached = englishWordCache.get(profile)
  if (cached) {
    return cached
  }
  const words = new Set<string>()
  addRecordKeys(words, profile.numberWords.ones)
  addRecordKeys(words, profile.numberWords.tens)
  addRecordKeys(words, profile.numberWords.scales)
  addRecordKeys(words, profile.numberWords.bareScales)
  addRecordKeys(words, profile.numberWords.composed)
  addRecordKeys(words, profile.numberWords.fuzzyAmounts)
  addRecordKeys(words, profile.numberWords.fractionWords)
  if (profile.numberWords.decimalWords) {
    addSet(words, profile.numberWords.decimalWords)
  }
  addSet(words, profile.numberWords.andWords)
  addSet(words, profile.numberWords.articles)
  addSet(words, profile.numberWords.dozenWords)
  addSet(words, profile.numberWords.negativeWords)
  addSet(words, profile.numberWords.ofWords)
  addSet(words, profile.grammar.approximateWords)
  addSet(words, profile.grammar.conversionWords)
  addSet(words, profile.grammar.exactWords)
  addSet(words, profile.grammar.rangeAndWords)
  addSet(words, profile.grammar.rangeBetweenWords)
  addSet(words, profile.grammar.rangeFromWords)
  addSet(words, profile.grammar.rangeSeparatorWords)
  for (const phrase of profile.grammar.boundPhrases) {
    for (const word of phrase.phrase.split(' ')) {
      words.add(word)
    }
  }
  addRecordKeys(words, profile.date?.months)
  addRecordKeys(words, profile.date?.weekdays)
  addRecordKeys(words, profile.date?.dayOffsets)
  addRecordKeys(words, profile.date?.dayTimePhrases)
  addRecordKeys(words, profile.date?.timeAliases)
  addRecordKeys(words, profile.date?.calendarPeriodPhrases)
  englishWordCache.set(profile, words)
  return words
}

function addSet(out: Set<string>, words: ReadonlySet<string>): void {
  for (const word of words) {
    out.add(word)
  }
}

function addRecordKeys(out: Set<string>, words: Record<string, unknown> | undefined): void {
  for (const word of Object.keys(words ?? {})) {
    out.add(word)
  }
}

function isUniquePhrase(phrase: string, uniqueAgainst: ReadonlySet<string> | undefined): boolean {
  return !uniqueAgainst || phrase.split(' ').some((word) => !uniqueAgainst.has(word))
}

function isStandaloneWord(
  tokens: readonly { spaceBefore: boolean; text: string }[],
  i: number,
): boolean {
  const token = tokens[i]!
  if (token.text.length > 1) {
    return true
  }
  return (i === 0 || token.spaceBefore) && (i === tokens.length - 1 || tokens[i + 1]!.spaceBefore)
}

function hasPhrase(input: string, phrase: string): boolean {
  // Non-regex word-boundary check: find the phrase in the lowercased input
  // and verify it is bounded by start/end or whitespace on both sides.
  const pLen = phrase.length
  let idx = 0
  while (true) {
    idx = input.indexOf(phrase, idx)
    if (idx < 0) {
      return false
    }
    const before = idx === 0 || input.charCodeAt(idx - 1) <= 32
    const after = idx + pLen >= input.length || input.charCodeAt(idx + pLen) <= 32
    if (before && after) {
      return true
    }
    idx++
  }
}
