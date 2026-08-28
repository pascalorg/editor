// @ts-expect-error - bun:test is provided by the Bun runtime; core does not depend on @types/bun.
import { describe, expect, test } from 'bun:test'
import { LevelNode, RoofNode, RoofSegmentNode } from '../schema'
import { resolveConicalRoofPlacement } from './conical-roof-placement'

function sceneWithHost() {
  const level = LevelNode.parse({
    id: 'level_host',
    children: ['roof_host'],
  })
  const roof = RoofNode.parse({
    id: 'roof_host',
    parentId: level.id,
    position: [2, 1, 3],
    children: ['rseg_host'],
  })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_host',
    parentId: roof.id,
    roofType: 'gable',
    width: 10,
    depth: 8,
    wallHeight: 2,
    pitch: 45,
  })
  return {
    level,
    roof,
    segment,
    nodes: {
      [level.id]: level,
      [roof.id]: roof,
      [segment.id]: segment,
    },
  }
}

describe('conical roof placement', () => {
  test('ground mode creates a level-supported roof at the drawn center', () => {
    const { level, nodes } = sceneWithHost()
    const placement = resolveConicalRoofPlacement({
      nodes,
      levelId: level.id,
      center: [2, 3],
      radius: 1,
      curbHeight: 0.5,
      allowRoofSupport: false,
      requireRoofSupport: false,
    })

    expect(placement).toEqual({
      valid: true,
      kind: 'level',
      position: [2, 0, 3],
      wallHeight: 0.5,
      support: { kind: 'level' },
    })
  })

  test('auto mode mounts a fully contained circle on the highest roof surface', () => {
    const { level, roof, segment, nodes } = sceneWithHost()
    const placement = resolveConicalRoofPlacement({
      nodes,
      levelId: level.id,
      center: [2, 3],
      radius: 1,
      curbHeight: 0.5,
      allowRoofSupport: true,
      requireRoofSupport: false,
    })

    expect(placement.valid).toBe(true)
    if (!(placement.valid && placement.kind === 'roof')) throw new Error('expected roof placement')
    expect(placement.hostRoofId).toBe(roof.id)
    expect(placement.position[0]).toBe(2)
    expect(placement.position[2]).toBe(3)
    expect(placement.wallHeight).toBeGreaterThan(0.5)
    expect(placement.support).toEqual({
      kind: 'roof',
      roofSegmentId: segment.id,
      localPosition: [0, 0],
      curbHeight: 0.5,
    })
  })

  test('auto mode does not mount a circle through the missing half of a conical sector', () => {
    const { level, roof, nodes } = sceneWithHost()
    const sector = RoofSegmentNode.parse({
      id: 'rseg_host',
      parentId: roof.id,
      roofType: 'conical',
      width: 10,
      depth: 10,
      wallHeight: 0,
      pitch: 45,
      conicalStartAngle: 0,
      conicalSweepAngle: Math.PI / 2,
      conicalFullCircle: false,
    })
    const sectorNodes = { ...nodes, [sector.id]: sector }

    const placement = resolveConicalRoofPlacement({
      nodes: sectorNodes,
      levelId: level.id,
      center: [2, 3],
      radius: 1,
      curbHeight: 0.5,
      allowRoofSupport: true,
      requireRoofSupport: false,
    })

    expect(placement.valid).toBe(true)
    expect(placement.support).toEqual({ kind: 'level' })
  })

  test('roof mode rejects a circle that has no complete roof support', () => {
    const { level, nodes } = sceneWithHost()
    const placement = resolveConicalRoofPlacement({
      nodes,
      levelId: level.id,
      center: [20, 20],
      radius: 1,
      curbHeight: 0.5,
      allowRoofSupport: true,
      requireRoofSupport: true,
    })

    expect(placement).toEqual({ valid: false, reason: 'no-roof-support' })
  })

  test('auto mode falls back to the level when no roof supports the circle', () => {
    const { level, nodes } = sceneWithHost()
    const placement = resolveConicalRoofPlacement({
      nodes,
      levelId: level.id,
      center: [20, 20],
      radius: 1,
      curbHeight: 0.75,
      allowRoofSupport: true,
      requireRoofSupport: false,
    })

    expect(placement).toEqual({
      valid: true,
      kind: 'level',
      position: [20, 0, 20],
      wallHeight: 0.75,
      support: { kind: 'level' },
    })
  })

  test('roof schema preserves the optional surface attachment and parses legacy roofs', () => {
    const legacy = RoofNode.parse({ id: 'roof_legacy' })
    expect(legacy.support).toEqual({ kind: 'level' })

    const mounted = RoofNode.parse({
      id: 'roof_mounted',
      support: {
        kind: 'roof',
        roofSegmentId: 'rseg_host',
        localPosition: [1.25, -0.5],
        curbHeight: 0.4,
      },
    })
    expect(mounted.support).toEqual({
      kind: 'roof',
      roofSegmentId: 'rseg_host',
      localPosition: [1.25, -0.5],
      curbHeight: 0.4,
    })
  })
})
