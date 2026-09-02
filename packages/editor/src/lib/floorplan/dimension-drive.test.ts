import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import {
  parseDimensionInput,
  planDimensionDrive,
  resolveDimensionDrive,
} from './dimension-drive'

const FOOT = 0.3048

describe('parseDimensionInput', () => {
  test('feet and inches', () => {
    expect(parseDimensionInput(`12'-6"`)).toBeCloseTo(12.5 * FOOT, 9)
    expect(parseDimensionInput(`12' 6"`)).toBeCloseTo(12.5 * FOOT, 9)
    expect(parseDimensionInput(`12'6"`)).toBeCloseTo(12.5 * FOOT, 9)
    expect(parseDimensionInput(`12'`)).toBeCloseTo(12 * FOOT, 9)
    expect(parseDimensionInput(`6"`)).toBeCloseTo(0.1524, 9)
    expect(parseDimensionInput(`12'-6 1/2"`)).toBeCloseTo((12 * 12 + 6.5) * 0.0254, 9)
  })

  test('metric suffixes', () => {
    expect(parseDimensionInput('3810mm')).toBeCloseTo(3.81, 9)
    expect(parseDimensionInput('3810 mm')).toBeCloseTo(3.81, 9)
    expect(parseDimensionInput('3.81m')).toBeCloseTo(3.81, 9)
    expect(parseDimensionInput('381cm')).toBeCloseTo(3.81, 9)
  })

  test('bare numbers follow the unit system', () => {
    expect(parseDimensionInput('12.5', 'metric')).toBeCloseTo(12.5, 9)
    expect(parseDimensionInput('12.5', 'imperial')).toBeCloseTo(12.5 * FOOT, 9)
  })

  test('rejects garbage and non-positive values', () => {
    expect(parseDimensionInput('')).toBeNull()
    expect(parseDimensionInput('abc')).toBeNull()
    expect(parseDimensionInput('0')).toBeNull()
    expect(parseDimensionInput('-3m')).toBeNull()
  })
})

// ── Fixture: an L of two walls sharing the corner [3, 0] ─────────────
//
//   wall A: [0,0] → [3,0]   (runs east, the one we drive)
//   wall B: [3,0] → [3,4]   (runs south from A's end — must follow)

function scene(): Record<string, AnyNode> {
  const level = {
    object: 'node',
    id: 'level_1',
    type: 'level',
    parentId: null,
    visible: true,
    metadata: {},
    level: 0,
    children: ['wall_a', 'wall_b'],
  } as unknown as AnyNode
  const wallA = {
    object: 'node',
    id: 'wall_a',
    type: 'wall',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [3, 0],
    thickness: 0.15,
    frontSide: 'exterior',
    backSide: 'interior',
    children: [],
  } as unknown as AnyNode
  const wallB = {
    object: 'node',
    id: 'wall_b',
    type: 'wall',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    start: [3, 0],
    end: [3, 4],
    thickness: 0.15,
    frontSide: 'exterior',
    backSide: 'interior',
    children: [],
  } as unknown as AnyNode
  return { level_1: level, wall_a: wallA, wall_b: wallB }
}

describe('driving a wall length', () => {
  test('3.0 m becomes 3.5 m: the wall end moves and the perpendicular wall follows', () => {
    const nodes = scene()
    const resolution = resolveDimensionDrive({
      nodes,
      ownerNodeId: 'wall_a' as AnyNodeId,
      start: [0, 0],
      end: [3, 0],
    })
    expect(resolution.drivable).toBe(true)
    if (!resolution.drivable) return
    expect(resolution.target).toMatchObject({ kind: 'wall-endpoint', wallId: 'wall_a', endpoint: 'end' })

    const plan = planDimensionDrive({
      nodes,
      target: resolution.target,
      currentLength: 3,
      nextLength: 3.5,
    })
    expect(plan).not.toBeNull()
    if (!plan) return
    expect(plan.delta).toBeCloseTo(0.5, 9)

    const byId = new Map(plan.updates.map((update) => [update.id, update.data]))
    expect(byId.get('wall_a' as AnyNodeId)).toEqual({ start: [0, 0], end: [3.5, 0] })
    // The perpendicular wall shared the moved corner, so it follows.
    expect(byId.get('wall_b' as AnyNodeId)).toEqual({ start: [3.5, 0], end: [3, 4] })
  })

  test('shrinking applies the negative delta', () => {
    const nodes = scene()
    const resolution = resolveDimensionDrive({
      nodes,
      ownerNodeId: 'wall_a' as AnyNodeId,
      start: [0, 0],
      end: [3, 0],
    })
    if (!resolution.drivable) throw new Error('expected drivable')
    const plan = planDimensionDrive({
      nodes,
      target: resolution.target,
      currentLength: 3,
      nextLength: 2.4,
    })
    expect(plan?.updates[0]?.data).toEqual({ start: [0, 0], end: [2.4, 0] })
  })

  test('a face-datum dimension still lands on the typed value (delta driving)', () => {
    // Finished-face datum reads 2.85 for a 3.0 centreline wall. Typing 3.35
    // must add 0.5, not set the centreline to 3.35.
    const nodes = scene()
    const resolution = resolveDimensionDrive({
      nodes,
      ownerNodeId: 'wall_a' as AnyNodeId,
      start: [0.075, 0],
      end: [2.925, 0],
    })
    if (!resolution.drivable) throw new Error('expected drivable')
    const plan = planDimensionDrive({
      nodes,
      target: resolution.target,
      currentLength: 2.85,
      nextLength: 3.35,
    })
    expect(plan?.updates[0]?.data).toEqual({ start: [0, 0], end: [3.5, 0] })
  })

  test('a dimension across the wall is not drivable', () => {
    const nodes = scene()
    const resolution = resolveDimensionDrive({
      nodes,
      ownerNodeId: 'wall_a' as AnyNodeId,
      start: [1.5, -1],
      end: [1.5, 1],
    })
    expect(resolution).toEqual({ drivable: false, reason: 'dimension is not along the wall' })
  })

  test('a locked wall refuses to drive', () => {
    const nodes = scene()
    ;(nodes.wall_a as unknown as { metadata: Record<string, unknown> }).metadata = { locked: true }
    const resolution = resolveDimensionDrive({
      nodes,
      ownerNodeId: 'wall_a' as AnyNodeId,
      start: [0, 0],
      end: [3, 0],
    })
    expect(resolution).toEqual({ drivable: false, reason: 'node is locked' })
  })
})

describe('driving an opening along its wall', () => {
  function sceneWithDoor(): Record<string, AnyNode> {
    const nodes = scene()
    ;(nodes.wall_a as unknown as { children: string[] }).children = ['door_1']
    nodes.door_1 = {
      object: 'node',
      id: 'door_1',
      type: 'door',
      parentId: 'wall_a',
      visible: true,
      metadata: {},
      wallId: 'wall_a',
      width: 0.9,
      height: 2.1,
      position: [1.2, 1.05, 0],
      children: [],
    } as unknown as AnyNode
    return nodes
  }

  test('the wall dimension that ends at the door centre moves the door', () => {
    const nodes = sceneWithDoor()
    const resolution = resolveDimensionDrive({
      nodes,
      ownerNodeId: 'wall_a' as AnyNodeId,
      start: [0, 0],
      end: [1.2, 0],
    })
    expect(resolution.drivable).toBe(true)
    if (!resolution.drivable) return
    expect(resolution.target).toMatchObject({ kind: 'opening', openingId: 'door_1', sign: 1 })

    const plan = planDimensionDrive({
      nodes,
      target: resolution.target,
      currentLength: 1.2,
      nextLength: 1.5,
    })
    expect(plan?.updates).toEqual([
      { id: 'door_1' as AnyNodeId, data: { position: [1.5, 1.05, 0] } },
    ])
  })

  test('a contextual dimension owned by the door drives the door', () => {
    const nodes = sceneWithDoor()
    const resolution = resolveDimensionDrive({
      nodes,
      ownerNodeId: 'door_1' as AnyNodeId,
      start: [0, 0],
      end: [1.2, 0],
    })
    expect(resolution).toMatchObject({ drivable: true, target: { kind: 'opening', sign: 1 } })
  })

  test('the door stays inside its wall', () => {
    const nodes = sceneWithDoor()
    const resolution = resolveDimensionDrive({
      nodes,
      ownerNodeId: 'door_1' as AnyNodeId,
      start: [0, 0],
      end: [1.2, 0],
    })
    if (!resolution.drivable) throw new Error('expected drivable')
    const plan = planDimensionDrive({
      nodes,
      target: resolution.target,
      currentLength: 1.2,
      nextLength: 9,
    })
    // Wall is 3 m long, door 0.9 wide → clamped to 3 - 0.45.
    expect(plan?.updates[0]?.data).toEqual({ position: [2.55, 1.05, 0] })
  })
})

describe('construction-dimension nodes', () => {
  test('free point anchors are not drivable', () => {
    const nodes = scene()
    nodes.dim_1 = {
      object: 'node',
      id: 'dim_1',
      type: 'construction-dimension',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      anchors: [
        [0, 0, 0],
        [3, 0, 0],
      ],
      children: [],
    } as unknown as AnyNode
    expect(
      resolveDimensionDrive({
        nodes,
        ownerNodeId: 'dim_1' as AnyNodeId,
        start: [0, 0],
        end: [3, 0],
      }),
    ).toEqual({ drivable: false, reason: 'dimension anchors are free points' })
  })

  test('a feature anchor on a wall drives that wall', () => {
    const nodes = scene()
    nodes.dim_1 = {
      object: 'node',
      id: 'dim_1',
      type: 'construction-dimension',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      anchors: [
        [0, 0, 0],
        { kind: 'feature', reference: { nodeId: 'wall_a', featureId: 'end' }, fallback: [3, 0, 0] },
      ],
      children: [],
    } as unknown as AnyNode
    expect(
      resolveDimensionDrive({
        nodes,
        ownerNodeId: 'dim_1' as AnyNodeId,
        start: [0, 0],
        end: [3, 0],
      }),
    ).toMatchObject({ drivable: true, target: { kind: 'wall-endpoint', wallId: 'wall_a' } })
  })
})

describe('an opening width tag resizes the opening', () => {
  test('a dimension spanning the opening edge to edge drives width, not position', () => {
    const nodes: Record<string, AnyNode> = {
      level_1: {
        object: 'node',
        id: 'level_1',
        type: 'level',
        parentId: null,
        visible: true,
        metadata: {},
        level: 0,
        children: ['wall_a'],
      } as unknown as AnyNode,
      wall_a: {
        object: 'node',
        id: 'wall_a',
        type: 'wall',
        parentId: 'level_1',
        visible: true,
        metadata: {},
        start: [0, 0],
        end: [6, 0],
        thickness: 0.15,
        children: ['win_1'],
      } as unknown as AnyNode,
      win_1: {
        object: 'node',
        id: 'win_1',
        type: 'window',
        parentId: 'wall_a',
        visible: true,
        metadata: {},
        wallId: 'wall_a',
        width: 0.9144,
        height: 1.2,
        position: [2, 1.1, 0],
        children: [],
      } as unknown as AnyNode,
    }
    const resolution = resolveDimensionDrive({
      nodes,
      ownerNodeId: 'win_1' as AnyNodeId,
      start: [2 - 0.4572, 0],
      end: [2 + 0.4572, 0],
    })
    expect(resolution).toMatchObject({ drivable: true, target: { kind: 'opening-width' } })
    if (!resolution.drivable) return
    const plan = planDimensionDrive({
      nodes,
      target: resolution.target,
      currentLength: 0.9144,
      nextLength: 1.2192,
    })
    expect(plan?.updates).toEqual([
      { id: 'win_1' as AnyNodeId, data: { width: 1.2192 } },
    ])
  })
})
