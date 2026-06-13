import { describe, expect, test } from 'bun:test'
import { getDetachedAttachmentPreviewLift, stripTransient } from './placement-math'

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
