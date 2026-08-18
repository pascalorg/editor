import { describe, expect, test } from 'bun:test'
import { AnyNode, LeanToExtensionNode, RoofNode, WallNode } from '@pascal-app/core'
import {
  resolveLeanToEdgeSnapTargets,
  resolveLeanToLayout,
  resolveLeanToMoveCenterX,
  resolveLeanToWallPlacement,
} from './layout'

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

  test('derives post count from target spacing', () => {
    const node = LeanToExtensionNode.parse({
      span: 8,
      postInset: 0,
      postLayoutMode: 'target-spacing',
      postSpacing: 2,
    })
    expect(resolveLeanToLayout(node).postXs).toHaveLength(5)
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
    expect(node?.lowEdgeHeight).toBeCloseTo(
      node!.highEdgeHeight - node!.projection * Math.tan((node!.pitch * Math.PI) / 180),
    )
  })

  test('hosts a curved wall with a bent span', () => {
    // sagitta 1, half-chord 3 -> R = (3^2 + 1^2) / (2*1) = 5
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], curveOffset: 1 })
    const node = resolveLeanToWallPlacement(wall, 3, 'front')
    expect(node?.type).toBe('lean-to-extension')
    expect(node?.parentId).toBe(wall.id)
    // The stored arc carries the wall's true radius and a finite signed center.
    expect(node?.spanArcRadius).toBeCloseTo(5, 3)
    expect(Number.isFinite(node?.spanArcCenterZ ?? Number.NaN)).toBe(true)
    expect(Math.abs(node?.spanArcCenterZ ?? 0)).toBeGreaterThan(1e-3)
  })

  test('moves along the host wall with snapping and roof-edge clamping', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [10, 0] })
    const node = LeanToExtensionNode.parse({
      span: 4,
      leftOverhang: 0.2,
      rightOverhang: 0.4,
    })

    expect(resolveLeanToMoveCenterX(node, wall, 5.26, 0.5)).toBe(5.5)
    expect(resolveLeanToMoveCenterX(node, wall, -2)).toBe(2.2)
    expect(resolveLeanToMoveCenterX(node, wall, 20)).toBe(7.6)
  })

  test('snaps moving lean-to edges to adjacent lean-to edges on split wall chunks', () => {
    const wall = WallNode.parse({
      id: 'wall_left',
      parentId: 'level_test',
      start: [0, 0],
      end: [5, 0],
    })
    const adjacentWall = WallNode.parse({
      id: 'wall_right',
      parentId: 'level_test',
      start: [5, 0],
      end: [10, 0],
    })
    const moving = LeanToExtensionNode.parse({
      id: 'leanto_left',
      parentId: wall.id,
      position: [2, 0, 0.05],
      span: 2,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const adjacent = LeanToExtensionNode.parse({
      id: 'leanto_right',
      parentId: adjacentWall.id,
      position: [1.2, 0, 0.05],
      span: 2,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = {
      [wall.id]: wall,
      [adjacentWall.id]: adjacentWall,
      [moving.id]: moving,
      [adjacent.id]: adjacent,
    } as Record<string, AnyNode>

    expect(
      resolveLeanToMoveCenterX(
        moving,
        wall,
        4.1,
        0,
        resolveLeanToEdgeSnapTargets(moving, wall, nodes),
      ),
    ).toBe(4)
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
