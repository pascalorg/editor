import { describe, expect, it } from 'vitest'
import {
  candidateOf,
  firstError,
  formatIssue,
  isConversion,
  isNumber,
  isQuantity,
  isRange,
  lingo,
} from './index'

describe('result helpers', () => {
  it('finds the first error and formats it with optional message overrides', () => {
    const result = lingo('5 flurbs', { kind: 'mass' })
    expect(result.ok).toBe(false)

    const issue = firstError(result)
    expect(issue?.code).toBe('UNKNOWN_UNIT')
    expect(formatIssue(issue!)).toBe(issue!.message)
    expect(
      formatIssue(issue!, {
        UNKNOWN_UNIT: (data) => `Use a known unit instead of ${data.unit}.`,
      }),
    ).toBe('Use a known unit instead of flurbs.')
  })

  it('narrows successful result types', () => {
    const quantity = lingo('2 ft')
    const range = lingo('5-10 kg')
    const conversion = lingo('72 in to cm')
    const bareNumber = lingo('72')

    expect(isQuantity(quantity)).toBe(true)
    if (isQuantity(quantity)) {
      expect(quantity.quantity.unit).toBe('ft')
    }

    expect(isRange(range)).toBe(true)
    if (isRange(range)) {
      expect(range.range.maxBase).toBeCloseTo(10, 12)
    }

    expect(isConversion(conversion)).toBe(true)
    if (isConversion(conversion) && 'value' in conversion.converted) {
      expect(conversion.converted.value).toBeCloseTo(182.88, 9)
    }

    expect(isNumber(bareNumber)).toBe(true)
    if (isNumber(bareNumber)) {
      expect(bareNumber.value).toBe(72)
    }
  })

  it('returns confirm-mode candidates without exposing one for successful results', () => {
    const result = lingo('5 meterz', { kind: 'length', strictness: 'confirm' })
    const candidate = candidateOf(result)

    expect(candidate?.type).toBe('quantity')
    if (candidate?.type === 'quantity') {
      expect(candidate.quantity.format()).toBe('5 m')
    }
    expect(candidateOf(lingo('5 m'))).toBeNull()
    expect(firstError(null)).toBeNull()
  })
})
