import { describe, expect, it } from 'vitest'
import { parseRange } from '../index'

describe('QuantityRange.contains() exclusive bounds', () => {
  it('"over 5 kg" excludes exactly 5', () => {
    const r = parseRange('over 5 kg')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.range.contains(5, 'kg')).toBe(false)
    expect(r.range.contains(5.001, 'kg')).toBe(true)
  })

  it('"under 10 kg" excludes exactly 10', () => {
    const r = parseRange('under 10 kg')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.range.contains(10, 'kg')).toBe(false)
    expect(r.range.contains(9.999, 'kg')).toBe(true)
  })

  it('"at least 5 kg" includes exactly 5', () => {
    const r = parseRange('at least 5 kg')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.range.contains(5, 'kg')).toBe(true)
    expect(r.range.contains(4.999, 'kg')).toBe(false)
  })

  it('"at most 10 kg" includes exactly 10', () => {
    const r = parseRange('at most 10 kg')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.range.contains(10, 'kg')).toBe(true)
    expect(r.range.contains(10.001, 'kg')).toBe(false)
  })

  it('just above exclusive min is contained', () => {
    const r = parseRange('over 5 kg')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    // Use a value representably above 5 (Number.EPSILON is relative to 1).
    expect(r.range.contains(5.000_000_001, 'kg')).toBe(true)
  })

  it('just below exclusive max is contained', () => {
    const r = parseRange('under 10 kg')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    // Use a value representably below 10.
    expect(r.range.contains(9.999_999_999, 'kg')).toBe(true)
  })
})
