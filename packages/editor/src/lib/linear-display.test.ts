import { describe, expect, test } from 'bun:test'
import { getLinearDisplay } from './linear-display'

describe('linear property control units', () => {
  test('keeps meter storage while displaying and accepting millimeters', () => {
    const display = getLinearDisplay('m', 'metric', 'millimeters', 2, 0.05)
    expect(display.displayUnit).toBe('mm')
    expect(display.parseUnit).toBe('mm')
    expect(display.toDisplay(2.5)).toBe(2500)
    expect(display.toStored(1800)).toBe(1.8)
    expect(display.toStored(-250)).toBe(-0.25)
    expect(display.precision).toBe(0)
    expect(display.step).toBe(50)
    expect(display.toStored(display.step)).toBe(0.05)
  })

  test('retains sub-millimeter precision when the field supports it', () => {
    const display = getLinearDisplay('m', 'metric', 'millimeters', 4, 0.0001)
    expect(display.precision).toBe(1)
    expect(display.step).toBe(0.1)
    expect(display.toDisplay(0.0125)).toBe(12.5)
    expect(display.roundStored(0.01254)).toBe(0.0125)
  })

  test('imperial preference takes precedence over the saved metric notation', () => {
    const display = getLinearDisplay('m', 'imperial', 'millimeters', 2, 0.05)
    expect(display.displayUnit).toBe('ft')
    expect(display.parseUnit).toBe('ft')
    expect(display.toDisplay(0.9144)).toBeCloseTo(3, 10)
    expect(display.toStored(7)).toBeCloseTo(2.1336, 10)
    expect(display.precision).toBe(2)
    expect(display.step).toBe(0.05)
  })

  test('switching notation round-trips the same stored dimensions', () => {
    for (const stored of [0, 0.01, 0.125, 0.9, 2.1, -0.25]) {
      for (const [unit, notation] of [
        ['metric', 'meters'],
        ['metric', 'millimeters'],
        ['imperial', 'meters'],
      ] as const) {
        const display = getLinearDisplay('m', unit, notation, 2, 0.01)
        expect(display.toStored(display.toDisplay(stored))).toBeCloseTo(stored, 12)
      }
    }
  })

  test('leaves non-meter fields and their gesture steps unchanged', () => {
    for (const unit of ['°', 'rad', '%', '', 'in', 'cm']) {
      const display = getLinearDisplay(unit, 'metric', 'millimeters', 2, 0.05)
      expect(display.displayUnit).toBe(unit)
      expect(display.parseUnit).toBeUndefined()
      expect(display.toDisplay(12.5)).toBe(12.5)
      expect(display.toStored(12.5)).toBe(12.5)
      expect(display.precision).toBe(2)
      expect(display.step).toBe(0.05)
    }
  })
})
