import { expect, test } from 'bun:test'
import { cabinetDimensionProfileById, cabinetDimensionProfileId } from '../profiles'

test('recognizes the metric base profile', () => {
  expect(
    cabinetDimensionProfileId({
      depth: 0.6,
      carcassHeight: 0.8,
      plinthHeight: 0.1,
      countertopThickness: 0.02,
    }),
  ).toBe('metric-base')
})

test('recognizes the US base profile with small measurement noise', () => {
  expect(
    cabinetDimensionProfileId({
      depth: 0.60960001,
      carcassHeight: 0.762,
      plinthHeight: 0.1016,
      countertopThickness: 0.0381,
    }),
  ).toBe('us-base')
})

test('keeps custom dimensions distinguishable from standard profiles', () => {
  expect(
    cabinetDimensionProfileId({
      depth: 0.58,
      carcassHeight: 0.8,
      plinthHeight: 0.1,
      countertopThickness: 0.02,
    }),
  ).toBe('custom')
})

test('returns the complete profile used by the side-panel action', () => {
  expect(cabinetDimensionProfileById('metric-base')).toEqual({
    id: 'metric-base',
    label: 'Metric · 600 mm',
    depth: 0.6,
    carcassHeight: 0.8,
    plinthHeight: 0.1,
    countertopThickness: 0.02,
  })
})
