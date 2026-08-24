import { describe, expect, test } from 'bun:test'
import { getActiveRoofFeatureId, type RoofFeatureIdentity } from './build-tab-state'

const FEATURES: RoofFeatureIdentity[] = [
  { id: 'roof-shape:conical', roofType: 'conical' },
  { id: 'lean-to-extension', kind: 'lean-to-extension' },
  { id: 'skylight', kind: 'skylight' },
]

describe('roof feature selection', () => {
  test('does not select every accessory for the plain roof tool', () => {
    expect(getActiveRoofFeatureId(FEATURES, 'roof', undefined)).toBeNull()
  })

  test('selects exactly the matching roof shape or accessory', () => {
    expect(getActiveRoofFeatureId(FEATURES, 'roof', 'conical')).toBe('roof-shape:conical')
    expect(getActiveRoofFeatureId(FEATURES, 'lean-to-extension', undefined)).toBe(
      'lean-to-extension',
    )
  })

  test('ignores missing tool identities', () => {
    const malformed = FEATURES.map(({ id, roofType }) => ({ id, roofType }))
    expect(getActiveRoofFeatureId(malformed, undefined, undefined)).toBeNull()
    expect(getActiveRoofFeatureId(malformed, 'skylight', undefined)).toBeNull()
  })
})
