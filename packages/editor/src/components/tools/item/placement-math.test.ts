import { describe, expect, test } from 'bun:test'
import { getDetachedAttachmentPreviewLift, steppedRotation, stripTransient } from './placement-math'

describe('steppedRotation', () => {
  test('rotates a placement clockwise to the next 45 degree increment', () => {
    expect(steppedRotation(Math.PI / 15, 1)).toBeCloseTo(Math.PI / 4)
  })

  test('rotates a placement counter-clockwise to the previous 45 degree increment', () => {
    expect(steppedRotation(Math.PI / 15, -1)).toBeCloseTo(-Math.PI / 4)
  })
})

describe('stripTransient', () => {
  test('removes placement-only metadata flags before commit', () => {
    expect(stripTransient({ isNew: true, isTransient: true, label: 'copy' })).toEqual({
      label: 'copy',
    })
  })
})

describe('getDetachedAttachmentPreviewLift', () => {
  test('raises attach-only item previews while they are detached from their host', () => {
    expect(getDetachedAttachmentPreviewLift('wall')).toBeGreaterThan(0)
    expect(getDetachedAttachmentPreviewLift('wall-side')).toBeGreaterThan(0)
    expect(getDetachedAttachmentPreviewLift('ceiling')).toBeGreaterThan(0)
  })

  test('keeps floor item previews on the floor', () => {
    expect(getDetachedAttachmentPreviewLift(undefined)).toBe(0)
  })
})
