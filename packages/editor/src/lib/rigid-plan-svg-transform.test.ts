import { describe, expect, test } from 'bun:test'
import { resolveAttachmentPreviewRotation, rigidPlanSvgTransform } from './rigid-plan-svg-transform'

describe('resolveAttachmentPreviewRotation', () => {
  test('uses wall yaw only while attached and restores the free yaw after detaching', () => {
    const freeRotation = Math.PI / 4

    expect(resolveAttachmentPreviewRotation(freeRotation, 0)).toBe(0)
    expect(resolveAttachmentPreviewRotation(freeRotation, null)).toBe(freeRotation)
  })
})

describe('rigidPlanSvgTransform', () => {
  test('preserves the existing translation-only preview when yaw is unchanged', () => {
    expect(
      rigidPlanSvgTransform({
        from: [1, 2],
        fromRotation: 0,
        to: [1.5, 3],
        toRotation: 0,
      }),
    ).toBe('translate(0.5 1)')
  })

  test('rotates the plan entry around the moved node origin while translating it', () => {
    expect(
      rigidPlanSvgTransform({
        from: [1, 2],
        fromRotation: Math.PI / 2,
        to: [3, 4],
        toRotation: 0,
      }),
    ).toBe('translate(3 4) rotate(90) translate(-1 -2)')
  })
})
