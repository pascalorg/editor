import { describe, expect, test } from 'bun:test'
import { LeanToExtensionNode } from '@pascal-app/core'
import { leanToExtensionParametrics } from './parametrics'

describe('lean-to resize locks', () => {
  test('preserves the low edge when projection changes', () => {
    const node = LeanToExtensionNode.parse({ resizeLock: 'preserve-low-edge' })
    const low = node.highEdgeHeight - node.projection * Math.tan((node.pitch * Math.PI) / 180)
    const patch = { projection: 4 }
    const derived = leanToExtensionParametrics.derive?.({ ...node, ...patch }, patch, node)
    const high = derived?.highEdgeHeight ?? node.highEdgeHeight
    expect(high - patch.projection * Math.tan((node.pitch * Math.PI) / 180)).toBeCloseTo(low)
  })

  test('preserves both edge heights and recalculates pitch in high-edge mode', () => {
    const node = LeanToExtensionNode.parse({ resizeLock: 'preserve-high-edge' })
    const originalLow =
      node.highEdgeHeight - node.projection * Math.tan((node.pitch * Math.PI) / 180)
    const patch = { projection: 4 }
    const derived = leanToExtensionParametrics.derive?.({ ...node, ...patch }, patch, node)

    expect(derived?.highEdgeHeight).toBe(node.highEdgeHeight)
    expect(derived?.pitch).not.toBe(node.pitch)
    expect(
      (derived?.highEdgeHeight ?? node.highEdgeHeight) -
        patch.projection * Math.tan((((derived?.pitch as number) ?? node.pitch) * Math.PI) / 180),
    ).toBeCloseTo(originalLow)
  })

  test('preserves pitch and derives a new low edge in pitch mode', () => {
    const node = LeanToExtensionNode.parse({ resizeLock: 'preserve-pitch' })
    const patch = { projection: 4 }
    const derived = leanToExtensionParametrics.derive?.({ ...node, ...patch }, patch, node)

    expect(derived?.pitch).toBe(node.pitch)
    expect(derived?.lowEdgeHeight).toBeCloseTo(
      node.highEdgeHeight - patch.projection * Math.tan((node.pitch * Math.PI) / 180),
    )
  })

  test('accepts an editable low edge while preserving pitch', () => {
    const node = LeanToExtensionNode.parse({ resizeLock: 'preserve-pitch' })
    const patch = { lowEdgeHeight: 2 }
    const derived = leanToExtensionParametrics.derive?.({ ...node, ...patch }, patch, node)

    expect(derived?.lowEdgeHeight).toBe(2)
    expect(derived?.pitch).toBe(node.pitch)
    expect(derived?.highEdgeHeight).toBeCloseTo(
      2 + node.projection * Math.tan((node.pitch * Math.PI) / 180),
    )
  })

  test('clears the occupied host edge when switched to manual connection', () => {
    const node = LeanToExtensionNode.parse({
      connectionMode: 'auto',
      hostRoofId: 'roof_test',
      hostRoofSegmentId: 'rseg_test',
      hostRoofEdge: '+Z',
      hostRoofEdgeRange: [0.25, 0.75],
    })
    const patch = { connectionMode: 'manual' as const }

    const derived = leanToExtensionParametrics.derive?.({ ...node, ...patch }, patch, node)

    expect(derived).toMatchObject({
      hostRoofId: undefined,
      hostRoofSegmentId: undefined,
      hostRoofEdge: undefined,
      hostRoofEdgeRange: undefined,
    })
  })
})
