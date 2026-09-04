import { describe, expect, it } from 'vitest'
import { parseDate } from '../../src/date/index'
import { createLingo } from '../../src/index'
import { resolveLanguageProfile } from '../../src/locale'
import { enGb } from '../../src/locales/en-gb'

describe('en-GB locale overlay', () => {
  it('merges onto English defaults', () => {
    const profile = resolveLanguageProfile([enGb], 'en-GB')
    expect(profile.locale).toBe('en-gb')
    expect(profile.defaults.currency).toBe('GBP')
    expect(profile.defaults.system).toBe('imperial')
    expect(profile.grammar.approximateWords.has('about')).toBe(true)
    expect(profile.grammar.approximateWords.has('roundabout')).toBe(true)
  })

  it('defaults numeric dates to day-first', () => {
    const result = parseDate('5/3/2026', { locale: 'en-gb', localePacks: [enGb] })
    expect(result.ok, JSON.stringify(result.issues)).toBe(true)
    if (result.ok) {
      expect(result.date.getFullYear()).toBe(2026)
      expect(result.date.getMonth()).toBe(2)
      expect(result.date.getDate()).toBe(5)
    }
  })

  it('keeps British mass and currency aliases available', () => {
    const lingo = createLingo({ locales: [enGb] })

    const stone = lingo.parseQuantity('12 stone', { locale: 'en-gb', kind: 'mass' })
    expect(stone.ok, JSON.stringify(stone.issues)).toBe(true)
    if (stone.ok) {
      expect(stone.quantity.unit).toBe('st')
      expect(stone.quantity.value).toBe(12)
    }

    const quid = lingo.parseQuantity('3 quid', { locale: 'en-gb', kind: 'currency' })
    expect(quid.ok, JSON.stringify(quid.issues)).toBe(true)
    if (quid.ok) {
      expect(quid.quantity.unit).toBe('GBP')
      expect(quid.quantity.value).toBe(3)
    }
  })
})
