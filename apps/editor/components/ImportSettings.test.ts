import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SETTINGS,
  isModified,
  resolveUnitScale,
} from './ImportSettings'

describe('resolveUnitScale', () => {
  test('"auto" → undefined (let parser infer)', () => {
    expect(resolveUnitScale('auto')).toBeUndefined()
  })

  test('"mm" → 0.001', () => {
    expect(resolveUnitScale('mm')).toBe(0.001)
  })

  test('"cm" → 0.01', () => {
    expect(resolveUnitScale('cm')).toBe(0.01)
  })

  test('"m" → 1.0', () => {
    expect(resolveUnitScale('m')).toBe(1.0)
  })
})

describe('isModified', () => {
  test('default settings → false', () => {
    expect(isModified(DEFAULT_SETTINGS)).toBe(false)
  })

  test('changed wallThicknessMinMm → true', () => {
    expect(isModified({ ...DEFAULT_SETTINGS, wallThicknessMinMm: 100 })).toBe(true)
  })

  test('changed wallThicknessMaxMm → true', () => {
    expect(isModified({ ...DEFAULT_SETTINGS, wallThicknessMaxMm: 300 })).toBe(true)
  })

  test('changed unitScale → true', () => {
    expect(isModified({ ...DEFAULT_SETTINGS, unitScale: 'mm' })).toBe(true)
  })

  test('all changed → true', () => {
    expect(isModified({ wallThicknessMinMm: 100, wallThicknessMaxMm: 300, unitScale: 'mm' })).toBe(
      true,
    )
  })

  test('reset to default → false', () => {
    const modified = { ...DEFAULT_SETTINGS, unitScale: 'mm' as const }
    const reset = { ...modified, unitScale: 'auto' as const }
    expect(isModified(reset)).toBe(false)
  })
})
