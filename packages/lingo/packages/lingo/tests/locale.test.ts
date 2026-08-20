import { describe, expect, it } from 'vitest'
import { createLingo } from '../src/index'
import { detectLocale, resolveLanguageProfile } from '../src/locale'
import { enGb } from '../src/locales/en-gb'
import { es } from '../src/locales/es'
import { fr } from '../src/locales/fr'
import { zh } from '../src/locales/zh'
import { normalizeInput } from '../src/parse/normalize'
import { tokenize } from '../src/parse/tokenize'

describe('locale profiles', () => {
  it('resolves English by default', () => {
    const profile = resolveLanguageProfile()
    expect(profile.locale).toBe('en')
    expect(profile.grammar.conversionWords.has('to')).toBe(true)
    expect(profile.numberWords.ones.three).toBe(3)
  })

  it('merges overlays onto English', () => {
    const profile = resolveLanguageProfile([enGb], 'en-GB')
    expect(profile.locale).toBe('en-gb')
    expect(profile.defaults.currency).toBe('GBP')
    expect(profile.defaults.system).toBe('imperial')
    expect(profile.grammar.approximateWords.has('about')).toBe(true)
    expect(profile.grammar.approximateWords.has('roundabout')).toBe(true)
  })

  it('scores loaded packs deterministically', () => {
    expect(detectLocale([es, fr], 'dos kg')).toBe('es')
    expect(detectLocale([es], 'two kg')).toBe('en')
    expect(detectLocale([es, fr], '72 in to cm')).toBe('en')
    expect(detectLocale([zh], '三kg')).toBe('zh')
  })

  it('keeps inherited English grammar in English during auto-detection', () => {
    const lingo = createLingo({ locales: [es] })

    const english = lingo.parse('two kg')
    expect(english.ok, JSON.stringify(english.issues)).toBe(true)
    if (english.ok) {
      expect(english.locale).toBe('en')
    }

    const spanish = lingo.parse('dos kg')
    expect(spanish.ok, JSON.stringify(spanish.issues)).toBe(true)
    if (spanish.ok) {
      expect(spanish.locale).toBe('es')
    }

    const conversion = createLingo({ locales: [es, fr] }).parse('72 in to cm')
    expect(conversion.ok, JSON.stringify(conversion.issues)).toBe(true)
    if (conversion.ok) {
      expect(conversion.locale).toBe('en')
    }
  })

  it('parses with explicit and detected locale packs', () => {
    const lingo = createLingo({ locales: [es] })

    const explicit = lingo.parseQuantity('dos kg', { locale: 'es' })
    expect(explicit.ok).toBe(true)
    if (explicit.ok) {
      expect(explicit.locale).toBe('es')
      expect(explicit.quantity.value).toBe(2)
    }

    const detected = lingo.parseQuantity('tres kg')
    expect(detected.ok).toBe(true)
    if (detected.ok) {
      expect(detected.locale).toBe('es')
      expect(detected.quantity.value).toBe(3)
    }
  })

  it('fails explicit locales that were not loaded', () => {
    const lingo = createLingo()
    const result = lingo.parse('two kg', { locale: 'es' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe('LOCALE_NOT_LOADED')
      expect(result.issues[0]?.data).toEqual({ locale: 'es' })
    }
  })

  it('tokenizes CJK runs as words', () => {
    const tokens = tokenize(normalizeInput('三kg'))
    expect(tokens.map((token) => [token.type, token.text])).toEqual([
      ['word', '三'],
      ['word', 'kg'],
    ])
  })
})
