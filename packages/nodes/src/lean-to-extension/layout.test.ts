import { describe, expect, test } from 'bun:test'
import { AnyNode, LeanToExtensionNode, RoofNode, WallNode } from '@pascal-app/core'
import { resolveLeanToLayout, resolveLeanToWallPlacement } from './layout'

describe('lean-to extension layout', () => {
  test('derives a descending roof and evenly spaced post row', () => {
    const node = LeanToExtensionNode.parse({
      span: 4,
      projection: 2.5,
      highEdgeHeight: 2.8,
      pitch: 10,
      postCount: 3,
      postInset: 0.2,
    })
    const layout = resolveLeanToLayout(node)
    expect(layout.lowEdgeHeight).toBeLessThan(layout.highEdgeHeight)
    expect(layout.postXs).toEqual([-1.8, 0, 1.8])
    expect(layout.postHeight).toBeGreaterThan(0)
    expect(layout.slopeLength).toBeGreaterThan(layout.roofRun)
  })

  test('clamps unsafe pitch to preserve a buildable post height', () => {
    const node = LeanToExtensionNode.parse({
      projection: 6,
      highEdgeHeight: 1.5,
      pitch: 45,
    })
    const layout = resolveLeanToLayout(node)
    expect(layout.effectivePitchDegrees).toBeLessThan(45)
    expect(layout.postHeight).toBeGreaterThanOrEqual(0.2)
  })
})

describe('lean-to wall placement', () => {
  test('creates a separate wall-hosted node without changing a roof node', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], thickness: 0.2, height: 3 })
    const node = resolveLeanToWallPlacement(wall, 3, 'front')
    expect(node?.type).toBe('lean-to-extension')
    expect(node?.parentId).toBe(wall.id)
    expect(node?.position).toEqual([3, 0, 0.1])
    expect(node?.rotation).toEqual([0, 0, 0])
  })

  test('rejects curved walls until tangent hosting is implemented', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], curveOffset: 1 })
    expect(resolveLeanToWallPlacement(wall, 3, 'front')).toBeNull()
  })

  test('keeps existing roof data unchanged when parsed with the extended node union', () => {
    const existingRoof = RoofNode.parse({
      children: [],
      position: [1, 0, 2],
      rotation: 0.35,
      segments: [],
    })
    const parsed = AnyNode.parse(existingRoof)
    expect(parsed).toEqual(existingRoof)
    expect(parsed.type).toBe('roof')
  })
})
