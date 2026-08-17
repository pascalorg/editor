import { describe, expect, it } from 'bun:test'
import { parseRegisteredArea } from '../src/area'

describe('parseRegisteredArea', () => {
  it('reads both decimal conventions TKGM returns for the same parcel', () => {
    expect(parseRegisteredArea('1,295.00')).toBe(1295)
    expect(parseRegisteredArea('1.295,00')).toBe(1295)
  })

  it('reads an ungrouped value in either convention', () => {
    expect(parseRegisteredArea('1295')).toBe(1295)
    expect(parseRegisteredArea('1295.50')).toBe(1295.5)
    expect(parseRegisteredArea('1295,50')).toBe(1295.5)
  })

  it('treats a lone separator with three trailing digits as a thousands group', () => {
    expect(parseRegisteredArea('1.295')).toBe(1295)
    expect(parseRegisteredArea('1,295')).toBe(1295)
  })

  it('handles several grouping separators', () => {
    expect(parseRegisteredArea('1.234.567,89')).toBeCloseTo(1234567.89, 2)
    expect(parseRegisteredArea('1,234,567.89')).toBeCloseTo(1234567.89, 2)
    expect(parseRegisteredArea('1.234.567')).toBe(1234567)
  })

  it('accepts a number the registry already gave as one', () => {
    expect(parseRegisteredArea(1295)).toBe(1295)
  })

  it('gives up rather than guessing on unusable input', () => {
    expect(parseRegisteredArea(undefined)).toBeUndefined()
    expect(parseRegisteredArea(null)).toBeUndefined()
    expect(parseRegisteredArea('')).toBeUndefined()
    expect(parseRegisteredArea('   ')).toBeUndefined()
    expect(parseRegisteredArea('0')).toBeUndefined()
    expect(parseRegisteredArea('yok')).toBeUndefined()
    expect(parseRegisteredArea('-5')).toBeUndefined()
    // Two decimal points is not a convention, it is corruption.
    expect(parseRegisteredArea('1.29.5,00')).toBeUndefined()
  })
})
