import { describe, expect, it } from 'vitest'
import { findQuantities, lingo, parseQuantity, parseRange, partialState } from '../index'

function expectKindMismatch(result: ReturnType<typeof lingo>) {
  expect(result.ok).toBe(false)
  if (result.ok) {
    throw new Error(`expected KIND_MISMATCH, got ${result.type}`)
  }
  const issue = result.issues.find((candidate) => candidate.code === 'KIND_MISMATCH')
  expect(issue?.data).toMatchObject({ found: 'temperature', expected: 'mass' })
  const single = parseQuantity('12 K', { kind: 'mass' })
  if (single.ok) {
    throw new Error('expected single-value kind mismatch')
  }
  expect(issue?.data).toEqual(
    single.issues.find((candidate) => candidate.code === 'KIND_MISMATCH')?.data,
  )
  expect(result.candidate?.type).toBe('range')
  if (result.candidate?.type !== 'range') {
    throw new Error('expected range candidate')
  }
  return result.candidate.range
}

describe('range kind gate', () => {
  it('rejects cross-kind ranges with the same KIND_MISMATCH payload and a candidate', () => {
    const parsed = parseRange('8 to 12 K')
    if (!parsed.ok) {
      throw new Error('expected no-kind range parse')
    }

    expect(expectKindMismatch(parseRange('8 to 12 K', { kind: 'mass' })).toJSON()).toEqual(
      parsed.range.toJSON(),
    )
    expect(expectKindMismatch(lingo('8 to 12 K', { kind: 'mass' })).toJSON()).toEqual(
      parsed.range.toJSON(),
    )
  })

  it('keeps matching-kind ranges valid', () => {
    const range = parseRange('8 to 12 kg', { kind: 'mass' })
    expect(range.ok).toBe(true)
    if (range.ok) {
      expect(range.range.kind).toBe('mass')
      expect(range.range.minBase).toBeCloseTo(8, 12)
      expect(range.range.maxBase).toBeCloseTo(12, 12)
    }

    const parsed = lingo('8 to 12 kg', { kind: 'mass' })
    expect(parsed.ok && parsed.type === 'range').toBe(true)
  })

  it('applies through partial and extraction paths without changing conversions', () => {
    expect(partialState('8 to 12 K', { kind: 'mass' })).toBe('invalid')
    expect(findQuantities('8 to 12 K', { kind: 'mass' })).toEqual([])

    const converted = lingo('8 to 12 K to C', { kind: 'mass' })
    expect(converted.ok && converted.type === 'conversion').toBe(true)
    if (converted.ok && converted.type === 'conversion') {
      expect(converted.source.kind).toBe('temperature')
      expect(converted.converted.kind).toBe('temperature')
    }
  })
})
