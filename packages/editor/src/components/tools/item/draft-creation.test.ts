import { describe, expect, test } from 'bun:test'
import { shouldCreateFloorDraft } from './draft-creation'

describe('shouldCreateFloorDraft', () => {
  test('does not create a level-hosted draft while block-face placement is active', () => {
    expect(shouldCreateFloorDraft(null, undefined, 'block-face')).toBe(false)
  })

  test('creates a draft for an unmounted floor placement', () => {
    expect(shouldCreateFloorDraft(null, undefined, 'floor')).toBe(true)
  })
})
