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
})
