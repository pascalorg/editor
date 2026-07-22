import { describe, expect, test } from 'bun:test'
import {
  buildMeasurementAngleArcPoints,
  cubicMetersToVolumeUnit,
  formatAreaLabel,
  formatLinearMeasurement,
  formatVolumeLabel,
  getAreaUnitLabel,
  getLinearUnitLabel,
  getVolumeUnitLabel,
  linearControlValueToMeters,
  linearUnitToMeters,
  MEASUREMENT_ACTIVE_COLOR,
  MEASUREMENT_DANGLING_COLOR,
  MEASUREMENT_FLOORPLAN_COLOR,
  MEASUREMENT_PERSISTENT_COLOR,
  measurementFloorplanPresentationColor,
  measurementPresentationColor,
  metersToLinearUnit,
  squareMetersToAreaUnit,
} from './measurements'

describe('measurement presentation', () => {
  test('uses black at rest, indigo while active, and red for dangling references', () => {
    expect(measurementPresentationColor(false, false)).toBe(MEASUREMENT_PERSISTENT_COLOR)
    expect(measurementPresentationColor(false, true)).toBe(MEASUREMENT_ACTIVE_COLOR)
    expect(measurementPresentationColor(true, false)).toBe(MEASUREMENT_DANGLING_COLOR)
    expect(measurementPresentationColor(true, true)).toBe(MEASUREMENT_DANGLING_COLOR)
  })

  test('uses an indigo analysis color for resting 2D measurements', () => {
    expect(measurementFloorplanPresentationColor(false, false)).toBe(MEASUREMENT_FLOORPLAN_COLOR)
    expect(measurementFloorplanPresentationColor(false, true)).toBe(MEASUREMENT_ACTIVE_COLOR)
    expect(measurementFloorplanPresentationColor(true, false)).toBe(MEASUREMENT_DANGLING_COLOR)
  })
})

describe('angle arc presentation', () => {
  test('samples the smaller angle from the first ray to the second', () => {
    const arc = buildMeasurementAngleArcPoints([1, 0, 0], [0, 0, 0], [0, 0, 1], {
      radius: 0.25,
      sampleCount: 8,
    })

    expect(arc).toHaveLength(9)
    expect(arc[0]?.[0]).toBeCloseTo(0.25)
    expect(arc[0]?.[2]).toBeCloseTo(0)
    expect(arc.at(-1)?.[0]).toBeCloseTo(0)
    expect(arc.at(-1)?.[2]).toBeCloseTo(0.25)
    expect(arc[4]?.[0]).toBeGreaterThan(0)
    expect(arc[4]?.[2]).toBeGreaterThan(0)
  })

  test('keeps a constant radius on an arbitrary 3D angle plane', () => {
    const arc = buildMeasurementAngleArcPoints([1, 0, 0], [0, 0, 0], [0, 1, 0], {
      radius: 0.3,
    })

    expect(arc.length).toBeGreaterThan(4)
    for (const point of arc) expect(Math.hypot(...point)).toBeCloseTo(0.3)
    expect(arc.at(-1)?.[1]).toBeCloseTo(0.3)
  })

  test('omits an arc when either ray is degenerate', () => {
    expect(buildMeasurementAngleArcPoints([0, 0, 0], [0, 0, 0], [1, 0, 0])).toEqual([])
  })
})

describe('linear measurements', () => {
  test('formats metric measurements in meters', () => {
    expect(formatLinearMeasurement(3, 'metric')).toBe('3m')
    expect(formatLinearMeasurement(3.456, 'metric')).toBe('3.46m')
  })

  test('formats metric measurements in whole millimeters', () => {
    expect(formatLinearMeasurement(3.456, 'metric', 'millimeters')).toBe('3456mm')
    expect(formatLinearMeasurement(-0.1524, 'metric', 'millimeters')).toBe('-152mm')
  })

  test('formats imperial measurements as feet and inches', () => {
    expect(formatLinearMeasurement(3.048, 'imperial')).toBe(`10'0"`)
    expect(formatLinearMeasurement(3.2004, 'imperial')).toBe(`10'6"`)
  })

  test('carries rounded 12 inches into the next foot', () => {
    expect(formatLinearMeasurement(3.047, 'imperial')).toBe(`10'0"`)
  })

  test('returns a placeholder for non-finite measurements', () => {
    expect(formatLinearMeasurement(NaN, 'imperial')).toBe('--')
    expect(formatLinearMeasurement(Infinity, 'imperial')).toBe('--')
    expect(formatLinearMeasurement(NaN, 'metric')).toBe('--')
  })

  test('formats zero measurements', () => {
    expect(formatLinearMeasurement(0, 'imperial')).toBe(`0'0"`)
    expect(formatLinearMeasurement(0, 'metric')).toBe('0m')
  })

  test('formats sub-foot imperial measurements', () => {
    expect(formatLinearMeasurement(0.1524, 'imperial')).toBe(`0'6"`)
  })

  test('formats negative measurements with a sign', () => {
    expect(formatLinearMeasurement(-0.1524, 'imperial')).toBe(`-0'6"`)
    expect(formatLinearMeasurement(-0.1524, 'metric')).toBe('-0.15m')
  })

  test('converts between meters and the active linear unit', () => {
    expect(metersToLinearUnit(0, 'imperial')).toBe(0)
    expect(linearUnitToMeters(0, 'imperial')).toBe(0)

    expect(metersToLinearUnit(1, 'metric')).toBe(1)
    expect(linearUnitToMeters(1, 'metric')).toBe(1)

    expect(metersToLinearUnit(0.3048, 'imperial')).toBeCloseTo(1)
    expect(linearUnitToMeters(1, 'imperial')).toBeCloseTo(0.3048)
  })

  test('converts numeric control input back to meters for wall panel edits', () => {
    expect(linearControlValueToMeters(10, 'imperial')).toBeCloseTo(3.048)
    expect(linearControlValueToMeters(0.5, 'imperial')).toBeCloseTo(0.1524)
    expect(linearControlValueToMeters(-1, 'imperial')).toBeCloseTo(-0.3048)
    expect(linearControlValueToMeters(3.5, 'metric')).toBe(3.5)
  })

  test('clamps numeric control input after converting to meters', () => {
    expect(linearControlValueToMeters(0.1, 'imperial', { minMeters: 0.1 })).toBe(0.1)
    expect(linearControlValueToMeters(0.3, 'imperial', { minMeters: 0.1 })).toBe(0.1)
    expect(linearControlValueToMeters(19.7, 'imperial', { maxMeters: 6 })).toBe(6)
    expect(linearControlValueToMeters(0.2, 'metric', { minMeters: 0.1 })).toBe(0.2)
    expect(linearControlValueToMeters(0.2, 'metric', { maxMeters: 0.15 })).toBe(0.15)
  })

  test('returns the display label for numeric controls', () => {
    expect(getLinearUnitLabel('metric')).toBe('m')
    expect(getLinearUnitLabel('imperial')).toBe('ft')
  })
})

describe('area measurements', () => {
  test('converts square meters to the active area unit', () => {
    expect(squareMetersToAreaUnit(0, 'imperial')).toBe(0)
    expect(squareMetersToAreaUnit(12.5, 'metric')).toBe(12.5)
    expect(squareMetersToAreaUnit(1, 'imperial')).toBeCloseTo(10.7639)
  })

  test('returns the display label for area readouts', () => {
    expect(getAreaUnitLabel('metric')).toBe('m²')
    expect(getAreaUnitLabel('imperial')).toBe('ft²')
  })

  test('formats an area label with value and unit', () => {
    expect(formatAreaLabel(12.34, 'metric')).toBe('12.3m²')
    expect(formatAreaLabel(1, 'imperial')).toBe('10.8ft²')
    expect(formatAreaLabel(12.34, 'metric', 2)).toBe('12.34m²')
  })

  test('returns a placeholder for non-finite areas', () => {
    expect(formatAreaLabel(NaN, 'metric')).toBe('--')
    expect(formatAreaLabel(Infinity, 'imperial')).toBe('--')
  })
})

describe('volume measurements', () => {
  test('converts cubic meters to the active volume unit', () => {
    expect(cubicMetersToVolumeUnit(0, 'imperial')).toBe(0)
    expect(cubicMetersToVolumeUnit(12.5, 'metric')).toBe(12.5)
    expect(cubicMetersToVolumeUnit(1, 'imperial')).toBeCloseTo(35.3147)
  })

  test('returns the display label for volume readouts', () => {
    expect(getVolumeUnitLabel('metric')).toBe('m³')
    expect(getVolumeUnitLabel('imperial')).toBe('ft³')
  })

  test('formats a volume label with value and unit', () => {
    expect(formatVolumeLabel(12.34, 'metric')).toBe('12.3m³')
    expect(formatVolumeLabel(1, 'imperial')).toBe('35.3ft³')
    expect(formatVolumeLabel(12.34, 'metric', 2)).toBe('12.34m³')
  })

  test('returns a placeholder for non-finite volumes', () => {
    expect(formatVolumeLabel(NaN, 'metric')).toBe('--')
    expect(formatVolumeLabel(Infinity, 'imperial')).toBe('--')
    expect(formatVolumeLabel(Number.NEGATIVE_INFINITY, 'metric')).toBe('--')
  })
})
