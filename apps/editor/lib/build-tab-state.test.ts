import { describe, expect, test } from 'bun:test'
import {
  getActiveRoofFeatureId,
  getRoofFootprintSource,
  getRoofFootprintSources,
  ROOF_TYPE_OPTIONS,
  type RoofFeatureIdentity,
} from './build-tab-state'

const FEATURES: RoofFeatureIdentity[] = [
  { id: 'lean-to-extension', kind: 'lean-to-extension' },
  { id: 'skylight', kind: 'skylight' },
]

describe('roof feature selection', () => {
  test('does not select every accessory for the plain roof tool', () => {
    expect(getActiveRoofFeatureId(FEATURES, 'roof')).toBeNull()
  })

  test('selects exactly the matching accessory', () => {
    expect(getActiveRoofFeatureId(FEATURES, 'lean-to-extension')).toBe('lean-to-extension')
  })

  test('ignores missing tool identities', () => {
    const malformed = FEATURES.map(({ id }) => ({ id }))
    expect(getActiveRoofFeatureId(malformed, undefined)).toBeNull()
    expect(getActiveRoofFeatureId(malformed, 'skylight')).toBeNull()
  })
})

test('roof creation exposes every supported roof type', () => {
  expect(ROOF_TYPE_OPTIONS.map((option) => option.value)).toEqual([
    'hip',
    'gable',
    'shed',
    'flat',
    'gambrel',
    'dutch',
    'mansard',
    'conical',
  ])
})

test('conical roofs expose wall and draw footprint sources', () => {
  expect(getRoofFootprintSources('conical').map((source) => source.value)).toEqual([
    'walls',
    'draw',
  ])
  expect(getRoofFootprintSource('conical', 'room')).toBe('walls')
  expect(getRoofFootprintSource('conical', 'draw')).toBe('draw')
})

test('non-conical roofs expose room and draw footprint sources', () => {
  expect(getRoofFootprintSources('hip').map((source) => source.value)).toEqual(['room', 'draw'])
  expect(getRoofFootprintSource('hip', 'walls')).toBe('room')
  expect(getRoofFootprintSource('hip', 'draw')).toBe('draw')
})
