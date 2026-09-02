import { describe, expect, test } from 'bun:test'
import {
  fitScale,
  INCHES_PER_METRE,
  METRES_PER_FOOT,
  paperSize,
  scaleLabel,
  sheetInchesToWorld,
  worldToSheetInches,
  worldWindow,
} from './scale'

describe('world → sheet inches', () => {
  test('1/4" = 1\'-0" draws a foot as a quarter inch', () => {
    expect(worldToSheetInches(METRES_PER_FOOT, 48)).toBeCloseTo(0.25, 9)
  })

  test('1/8" = 1\'-0" draws a foot as an eighth of an inch', () => {
    expect(worldToSheetInches(METRES_PER_FOOT, 96)).toBeCloseTo(0.125, 9)
  })

  test("1\" = 20' draws twenty feet as one inch", () => {
    expect(worldToSheetInches(METRES_PER_FOOT * 20, 240)).toBeCloseTo(1, 9)
  })

  test('a 12 m wide house at 1/4" fits in 9.84 inches', () => {
    expect(worldToSheetInches(12, 48)).toBeCloseTo((12 * INCHES_PER_METRE) / 48, 9)
    expect(worldToSheetInches(12, 48)).toBeCloseTo(9.8425, 3)
  })

  test('round trips', () => {
    for (const scale of [12, 48, 96, 240]) {
      expect(sheetInchesToWorld(worldToSheetInches(7.5, scale), scale)).toBeCloseTo(7.5, 9)
    }
  })
})

describe('scale labels', () => {
  test('presets read as architects write them', () => {
    expect(scaleLabel(48)).toBe('1/4" = 1\'-0"')
    expect(scaleLabel(96)).toBe('1/8" = 1\'-0"')
    expect(scaleLabel(240)).toBe('1" = 20\'')
  })

  test('an off-preset scale still prints something true', () => {
    expect(scaleLabel(600)).toBe('1" = 50\'')
  })
})

describe('fitScale', () => {
  test('picks the largest scale that still fits the box', () => {
    // A 12 × 9 m house in a 14 × 10 in box: 1/4" needs 9.84 × 7.38 in — fits.
    expect(fitScale(12, 9, 14, 10)).toBe(48)
  })

  test('steps down when the drawing is too big', () => {
    // 40 × 30 m will not fit 14 × 10 in at 1/4" (32.8 × 24.6 in).
    const scale = fitScale(40, 30, 14, 10)
    expect(scale).toBeGreaterThan(48)
    expect(worldToSheetInches(40, scale)).toBeLessThanOrEqual(14)
    expect(worldToSheetInches(30, scale)).toBeLessThanOrEqual(10)
  })
})

describe('paper + windows', () => {
  test('ARCH D is 36 × 24 inches and unknown sizes fall back to it', () => {
    expect(paperSize('arch-d')).toMatchObject({ widthIn: 36, heightIn: 24 })
    expect(paperSize('nonsense')).toMatchObject({ widthIn: 36, heightIn: 24 })
    expect(paperSize('tabloid')).toMatchObject({ widthIn: 17, heightIn: 11 })
  })

  test('a world window is the viewport box measured back into metres', () => {
    const win = worldWindow({ x: 0, y: 0 }, 12, 9, 48)
    expect(win.maxX - win.minX).toBeCloseTo(sheetInchesToWorld(12, 48), 9)
    expect(win.maxY - win.minY).toBeCloseTo(sheetInchesToWorld(9, 48), 9)
    expect((win.minX + win.maxX) / 2).toBeCloseTo(0, 9)
  })
})
