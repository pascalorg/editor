import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
} from '@pascal-app/core'
import { roofFloorplanAffectedIds, roofFloorplanSiblingOverrides } from './floorplan-overrides'

function scene() {
  const level = LevelNode.parse({
    id: 'level_roof',
    type: 'level',
    children: ['roof_main', 'roof_wing', 'wall_a'],
  })
  const main = RoofNode.parse({
    id: 'roof_main',
    type: 'roof',
    parentId: level.id,
    children: ['rseg_main'],
  })
  const wing = RoofNode.parse({
    id: 'roof_wing',
    type: 'roof',
    parentId: level.id,
    children: ['rseg_wing'],
  })
  const mainSegment = RoofSegmentNode.parse({
    id: 'rseg_main',
    type: 'roof-segment',
    parentId: main.id,
  })
  const wingSegment = RoofSegmentNode.parse({
    id: 'rseg_wing',
    type: 'roof-segment',
    parentId: wing.id,
  })
  const wall = WallNode.parse({
    id: 'wall_a',
    type: 'wall',
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
  })
  return Object.fromEntries(
    [level, main, wing, mainSegment, wingSegment, wall].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
}

const project = (
  nodes: Record<AnyNodeId, AnyNode>,
  live: {
    overrides?: [string, Record<string, unknown>][]
    transforms?: [string, { position: [number, number, number]; rotation: number }][]
  },
) =>
  roofFloorplanSiblingOverrides({
    nodeId: 'roof_main' as AnyNodeId,
    nodes,
    liveOverrides: new Map(live.overrides ?? []),
    liveTransforms: new Map(live.transforms ?? []),
  })

describe('roof plan during a live edit', () => {
  test("a segment's live move reaches the roof's builder snapshot", () => {
    const nodes = scene()
    const projected = project(nodes, { overrides: [['rseg_main', { position: [2, 0, 1] }]] })
    expect((projected['rseg_main' as AnyNodeId] as RoofSegmentNode).position).toEqual([2, 0, 1])
    expect(projected['rseg_wing' as AnyNodeId]).toBe(nodes['rseg_wing' as AnyNodeId])
  })

  test("a roof's live transform from the 3D move tool moves it in the snapshot", () => {
    const nodes = scene()
    const projected = project(nodes, {
      transforms: [['roof_wing', { position: [1, 0, 3], rotation: 0.5 }]],
    })
    const wing = projected['roof_wing' as AnyNodeId] as RoofNode
    expect(wing.position).toEqual([1, 0, 3])
    expect(wing.rotation).toBe(0.5)
  })

  test('nothing live, or only other kinds live, leaves the scene as it is', () => {
    const nodes = scene()
    expect(project(nodes, {})).toBe(nodes)
    expect(project(nodes, { overrides: [['wall_a', { start: [1, 1] }]] })).toBe(nodes)
  })

  test("a segment's edit rebuilds its roof and the level's other roofs", () => {
    const nodes = scene()
    const affected = roofFloorplanAffectedIds({ node: nodes['rseg_wing' as AnyNodeId]!, nodes })
    expect([...affected].sort()).toEqual(['roof_main', 'roof_wing'])
    expect(roofFloorplanAffectedIds({ node: nodes['wall_a' as AnyNodeId]!, nodes })).toEqual([])
  })
})
