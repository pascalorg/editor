import { describe, expect, test } from 'bun:test'
import {
  calibrationProblemMessage,
  computeCalibration,
  revertCalibration,
  validateCalibration,
} from './cad-calibration'

describe('computeCalibration', () => {
  test('scales by the ratio the user reports', () => {
    // The drawing measured 2 m where the wall is really 4.2 m.
    const result = computeCalibration({
      currentScale: 1,
      measuredMeters: 2,
      actualMeters: 4.2,
    })

    expect(result?.scale).toBeCloseTo(2.1, 9)
  })

  test('compounds onto the scale already in force', () => {
    const result = computeCalibration({
      currentScale: 0.001,
      measuredMeters: 4,
      actualMeters: 4.2,
    })

    expect(result?.scale).toBeCloseTo(0.00105, 12)
  })

  test('rescues a unitless drawing read as metres', () => {
    // Imported at 1 m/unit, but it was millimetres: a 4.2 m wall read 4200 m.
    const result = computeCalibration({
      currentScale: 1,
      measuredMeters: 4200,
      actualMeters: 4.2,
    })

    expect(result?.scale).toBeCloseTo(0.001, 12)
  })

  test('records what it did, so the correction can be reviewed', () => {
    const result = computeCalibration({
      currentScale: 0.5,
      measuredMeters: 3,
      actualMeters: 6,
      label: 'Entrance wall',
    })

    expect(result?.calibration).toEqual({
      measuredMeters: 3,
      actualMeters: 6,
      previousScale: 0.5,
      label: 'Entrance wall',
    })
  })

  test('is exactly reversible', () => {
    const before = 0.001
    const result = computeCalibration({
      currentScale: before,
      measuredMeters: 4,
      actualMeters: 4.2,
    })

    expect(revertCalibration(result!.calibration)).toBe(before)
  })

  test('returns nothing rather than a broken scale for bad input', () => {
    expect(computeCalibration({ currentScale: 1, measuredMeters: 0, actualMeters: 4 })).toBeNull()
    expect(computeCalibration({ currentScale: 1, measuredMeters: 4, actualMeters: -1 })).toBeNull()
  })
})

describe('validateCalibration', () => {
  test('rejects non-positive lengths', () => {
    expect(validateCalibration({ measuredMeters: 0, actualMeters: 4 })).toBe('not-positive')
    expect(validateCalibration({ measuredMeters: 4, actualMeters: 0 })).toBe('not-positive')
    expect(validateCalibration({ measuredMeters: Number.NaN, actualMeters: 4 })).toBe(
      'not-positive',
    )
  })

  test('accepts the unit corrections people actually make', () => {
    // mm read as m, and inches read as m — the two realistic disasters.
    expect(validateCalibration({ measuredMeters: 4200, actualMeters: 4.2 })).toBeNull()
    expect(validateCalibration({ measuredMeters: 165, actualMeters: 4.2 })).toBeNull()
  })

  test('refuses a correction beyond any plausible unit error', () => {
    expect(validateCalibration({ measuredMeters: 1, actualMeters: 1e9 })).toBe('implausible')
    expect(validateCalibration({ measuredMeters: 1e9, actualMeters: 1 })).toBe('implausible')
  })

  test('refuses a no-op instead of writing a meaningless record', () => {
    expect(validateCalibration({ measuredMeters: 4.2, actualMeters: 4.2 })).toBe('no-change')
    // A rounded display read back at us is not a correction either.
    expect(validateCalibration({ measuredMeters: 4.2, actualMeters: 4.20001 })).toBe('no-change')
  })

  test('every problem has a message', () => {
    for (const problem of ['not-positive', 'implausible', 'no-change'] as const) {
      expect(calibrationProblemMessage(problem).length).toBeGreaterThan(0)
    }
  })
})
