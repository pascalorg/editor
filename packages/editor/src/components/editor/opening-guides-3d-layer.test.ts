import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { computeOpeningGuidesForSelectedNode } from './opening-guides-3d-layer'

describe('computeOpeningGuidesForSelectedNode', () => {
  function createScene() {
    const wall = {
      object: 'node',
      id: 'wall_1',
      type: 'wall',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      start: [0, 0],
      end: [6, 0],
      height: 3,
      thickness: 0.2,
      children: ['win_1', 'door_1'],
    } as unknown as AnyNode

    const windowNode = {
      object: 'node',
      id: 'win_1',
      type: 'window',
      parentId: 'wall_1',
      wallId: 'wall_1',
      visible: true,
      metadata: {},
      position: [2.0, 1.5, 0], // Center at 2m along wall, 1.5m elevation
      width: 1.0,
      height: 1.2,
    } as unknown as AnyNode

    const doorNode = {
      object: 'node',
      id: 'door_1',
      type: 'door',
      parentId: 'wall_1',
      wallId: 'wall_1',
      visible: true,
      metadata: {},
      position: [4.5, 1.05, 0], // Center at 4.5m along wall
      width: 0.9,
      height: 2.1,
    } as unknown as AnyNode

    const nodes: Record<string, AnyNode> = {
      wall_1: wall,
      win_1: windowNode,
      door_1: doorNode,
    }

    return { wall, windowNode, doorNode, nodes }
  }

  test('computes 3D dimension guides for selected window with interactive metadata', () => {
    const { windowNode, nodes } = createScene()
    const guides = computeOpeningGuidesForSelectedNode(windowNode, nodes)

    // Should include gap:left, gap:right, sill, and head
    const dimensionGuides = guides.filter((g) => g.kind === 'dimension')
    expect(dimensionGuides.length).toBeGreaterThanOrEqual(2)

    const sillGuide = dimensionGuides.find((g) => g.id === 'sill')
    expect(sillGuide).toBeDefined()
    expect(sillGuide?.targetNodeId).toBe('win_1')
    expect(sillGuide?.wallId).toBe('wall_1')
    expect(sillGuide?.role).toBe('sill')
    // Bottom of window: centerY (1.5) - height / 2 (0.6) = 0.9m
    expect(sillGuide?.value).toBeCloseTo(0.9, 2)

    const leftGap = dimensionGuides.find((g) => g.id === 'gap:left')
    expect(leftGap).toBeDefined()
    expect(leftGap?.targetNodeId).toBe('win_1')
    expect(leftGap?.role).toBe('gap:left')
    // Left edge: centerS (2.0) - width / 2 (0.5) = 1.5m from wall start (0)
    expect(leftGap?.value).toBeCloseTo(1.5, 2)

    const rightGap = dimensionGuides.find((g) => g.id === 'gap:right')
    expect(rightGap).toBeDefined()
    expect(rightGap?.targetNodeId).toBe('win_1')
    expect(rightGap?.role).toBe('gap:right')
    // Right edge: centerS (2.0) + width / 2 (0.5) = 2.5m -> distance to door left edge (4.5 - 0.45 = 4.05) is 1.55m
    expect(rightGap?.value).toBeCloseTo(1.55, 2)
  })

  test('computes 3D dimension guides for selected door (horizontal gaps only)', () => {
    const { doorNode, nodes } = createScene()
    const guides = computeOpeningGuidesForSelectedNode(doorNode, nodes)

    const dimensionGuides = guides.filter((g) => g.kind === 'dimension')
    // Doors sit on the floor so sill/head are not included
    expect(dimensionGuides.find((g) => g.id === 'sill')).toBeUndefined()

    const leftGap = dimensionGuides.find((g) => g.id === 'gap:left')
    expect(leftGap).toBeDefined()
    expect(leftGap?.targetNodeId).toBe('door_1')
    expect(leftGap?.role).toBe('gap:left')
    // Door left edge: 4.5 - 0.45 = 4.05 -> distance to window right edge (2.5) is 1.55m
    expect(leftGap?.value).toBeCloseTo(1.55, 2)

    const rightGap = dimensionGuides.find((g) => g.id === 'gap:right')
    expect(rightGap).toBeDefined()
    expect(rightGap?.targetNodeId).toBe('door_1')
    expect(rightGap?.role).toBe('gap:right')
    // Door right edge: 4.5 + 0.45 = 4.95 -> distance to wall end (6.0) is 1.05m
    expect(rightGap?.value).toBeCloseTo(1.05, 2)
  })

  test('returns empty guides for non-hosted or non-opening nodes', () => {
    const { wall, nodes } = createScene()
    expect(computeOpeningGuidesForSelectedNode(wall, nodes)).toEqual([])
  })
})
