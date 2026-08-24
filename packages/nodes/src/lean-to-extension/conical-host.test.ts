import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'
import { bendLocalPoint } from './arc'
import { createLeanToAssembly } from './assembly'
import {
  findConicalLeanToHostInPlan,
  resolveConicalLeanToPlacement,
  resolveConicalLeanToSurfaceHit,
} from './conical-host'
import { resolveLeanToLayout } from './layout'

describe('resolveConicalLeanToPlacement', () => {
  test('wraps one closed lean-to around the cylindrical base', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_conical',
      parentId: 'roof_test',
      roofType: 'conical',
      width: 8,
      depth: 8,
      wallHeight: 3,
    })

    const leanTo = resolveConicalLeanToPlacement(segment)

    expect(leanTo).not.toBeNull()
    expect(leanTo?.parentId).toBe(segment.id)
    expect(leanTo?.hostKind).toBe('conical-roof')
    expect(leanTo?.position).toEqual([0, 0, 4])
    expect(leanTo?.span).toBeCloseTo(8 * Math.PI)
    expect(leanTo?.spanArcCenterZ).toBe(-4)
    expect(leanTo?.spanArcRadius).toBe(4)
    expect(leanTo?.highEdgeHeight).toBe(3)
    expect(leanTo?.leftOverhang).toBe(0)
    expect(leanTo?.rightOverhang).toBe(0)
    expect(leanTo?.leftEndCondition).toBe('joined')
    expect(leanTo?.rightEndCondition).toBe('joined')
  })

  test('rejects non-conical roof segments', () => {
    const segment = RoofSegmentNode.parse({ roofType: 'gable' })

    expect(resolveConicalLeanToPlacement(segment)).toBeNull()
  })

  test('closes the assembly without duplicate seam members or gutter caps', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'conical',
      width: 8,
      depth: 8,
      wallHeight: 3,
    })
    const leanTo = resolveConicalLeanToPlacement(segment)!

    const layout = resolveLeanToLayout(leanTo)
    const firstPost = bendLocalPoint(leanTo, layout.postXs[0]!, layout.beamZ)
    const lastPost = bendLocalPoint(leanTo, layout.postXs.at(-1)!, layout.beamZ)
    const assembly = createLeanToAssembly(leanTo)

    expect(layout.postXs).toHaveLength(9)
    expect(Math.hypot(firstPost.x - lastPost.x, firstPost.y - lastPost.y)).toBeGreaterThan(0.1)
    expect(assembly.posts).toHaveLength(9)
    expect(assembly.segment.arc).toBeDefined()
    expect(assembly.gutter.arc).toBeDefined()
    expect(assembly.gutter.endCapLeft).toBe(false)
    expect(assembly.gutter.endCapRight).toBe(false)
  })

  test('accepts the cylindrical wall but rejects the cone surface', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'conical',
      width: 8,
      depth: 8,
      wallHeight: 3,
    })

    expect(resolveConicalLeanToSurfaceHit(segment, [4, 1.5, 0], [1, 0, 0])).not.toBeNull()
    expect(resolveConicalLeanToSurfaceHit(segment, [2, 4, 0], [0.7, 0.7, 0])).toBeNull()
  })

  test('finds the conical footprint in the active floorplan level', () => {
    const level = LevelNode.parse({ id: 'level_plan_host' })
    const roof = RoofNode.parse({
      id: 'roof_plan_host',
      parentId: level.id,
      position: [2, 0, 3],
      children: ['rseg_plan_host'],
    })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_plan_host',
      parentId: roof.id,
      roofType: 'conical',
      position: [1, 0, 0],
      width: 8,
      depth: 8,
    })
    const nodes = Object.fromEntries(
      [level, roof, segment].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>

    expect(findConicalLeanToHostInPlan([6, 3], nodes, level.id)?.segment.id).toBe(segment.id)
    expect(findConicalLeanToHostInPlan([20, 20], nodes, level.id)).toBeNull()

    const existing = resolveConicalLeanToPlacement(segment, { id: 'leanto_plan_host' })!
    nodes[existing.id as AnyNodeId] = existing
    expect(findConicalLeanToHostInPlan([6, 3], nodes, level.id)).toBeNull()
  })
})
