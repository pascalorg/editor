import { describe, expect, test } from 'bun:test'
import { getActiveRoofFeatureId, type RoofFeatureIdentity } from './build-tab-state'

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
