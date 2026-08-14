import { describe, expect, test } from 'bun:test'
import { shouldCreateFloorDraft } from './draft-creation'

describe('shouldCreateFloorDraft', () => {
  test('does not create a level-hosted draft while custom-face placement is active', () => {
    expect(shouldCreateFloorDraft(null, undefined, 'custom-mesh-face')).toBe(false)
  })

  test('creates a draft for an unmounted floor placement', () => {
    expect(shouldCreateFloorDraft(null, undefined, 'floor')).toBe(true)
  })
})
