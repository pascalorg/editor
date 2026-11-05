import { describe, expect, it } from 'bun:test'
import { parseAngle, parseDimension, pointFromLengthAngle } from './units'

describe('parseDimension', () => {
  it('parses bare number as meters', () => {
    expect(parseDimension('3.5')).toBe(3.5)
    expect(parseDimension('10')).toBe(10)
  })

  it('parses meters with "m" suffix', () => {
    expect(parseDimension('3.5m')).toBe(3.5)
    expect(parseDimension('5 M')).toBe(5)
  })

  it('parses centimeters with "cm" suffix', () => {
    expect(parseDimension('200cm')).toBe(2)
    expect(parseDimension('50 cm')).toBe(0.5)
  })

  it('parses feet with "ft" suffix', () => {
    expect(parseDimension('10ft')).toBeCloseTo(3.048, 4)
  })

  it('returns null on invalid string', () => {
    expect(parseDimension('')).toBeNull()
    expect(parseDimension('abc')).toBeNull()
    expect(parseDimension('5xyz')).toBeNull()
  })
})

describe('parseAngle', () => {
  it('parses plain degrees', () => {
    expect(parseAngle('45')).toBe(45)
    expect(parseAngle('90.5')).toBe(90.5)
  })

  it('handles ° and deg suffix', () => {
    expect(parseAngle('90°')).toBe(90)
    expect(parseAngle('180deg')).toBe(180)
  })

  it('normalizes negative and >360 angles', () => {
    expect(parseAngle('-90')).toBe(270)
    expect(parseAngle('450')).toBe(90)
  })

  it('returns null on invalid string', () => {
    expect(parseAngle('')).toBeNull()
    expect(parseAngle('invalid')).toBeNull()
  })
})

describe('pointFromLengthAngle', () => {
  it('calculates point east (+X) at 0 deg', () => {
    const pt = pointFromLengthAngle([0, 0], 5, 0)
    expect(pt[0]).toBeCloseTo(5, 4)
    expect(pt[1]).toBeCloseTo(0, 4)
  })

  it('calculates point south (+Z) at 90 deg', () => {
    const pt = pointFromLengthAngle([0, 0], 5, 90)
    expect(pt[0]).toBeCloseTo(0, 4)
    expect(pt[1]).toBeCloseTo(5, 4)
  })
})
