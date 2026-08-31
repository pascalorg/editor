import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  getWallCurveLength,
  LeanToExtensionNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { resolveLeanToCornerJoints } from './corner-joint'
import { resolveLeanToWallPlacement } from './layout'
import { leanToPlacementConflicts, resolveLeanToEndAbutments } from './placement-validation'
import { applyLeanToWallAutoSpan } from './roof-attachment'

describe('lean-to placement validation', () => {
  test('allows a span crossing a host-wall opening', () => {
    const window = WindowNode.parse({ position: [2, 1, 0], width: 1.2 })
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], children: [window.id] })
    const leanTo = LeanToExtensionNode.parse({ parentId: wall.id, position: [2, 0, 0.05] })
    const nodes = { [wall.id]: wall, [window.id]: window } as Record<string, AnyNode>
    expect(leanToPlacementConflicts(leanTo, wall, nodes)).toHaveLength(0)
  })

  test('allows adjacent extensions on the same unsplit wall', () => {
    const wall = WallNode.parse({
      id: 'wall_shared',
      start: [0, 0],
      end: [10, 0],
      children: ['leanto_left'],
    })
    const existing = LeanToExtensionNode.parse({
      id: 'leanto_left',
      parentId: wall.id,
      position: [1.5, 0, 0.05],
      span: 3,
    })
    const candidate = LeanToExtensionNode.parse({
      id: 'leanto_right',
      parentId: wall.id,
      position: [6.5, 0, 0.05],
      span: 7,
    })
    const nodes = { [wall.id]: wall, [existing.id]: existing } as Record<string, AnyNode>

    expect(leanToPlacementConflicts(candidate, wall, nodes)).toHaveLength(0)
  })

  test('rejects an overlapping extension hosted by an adjacent wall', () => {
    const wall = WallNode.parse({ id: 'wall_candidate', start: [0, 0], end: [6, 0] })
    const adjacentWall = WallNode.parse({ id: 'wall_adjacent', start: [0.2, 0.2], end: [6.2, 0.2] })
    const leanTo = LeanToExtensionNode.parse({ parentId: wall.id, position: [3, 0, 0.05] })
    const adjacent = LeanToExtensionNode.parse({
      parentId: adjacentWall.id,
      position: [3, 0, 0.05],
    })
    const nodes = Object.fromEntries(
      [wall, adjacentWall, adjacent].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    expect(leanToPlacementConflicts(leanTo, wall, nodes)).toHaveLength(1)
  })

  test('allows the second extension that completes an internal L corner', () => {
    const wallA = WallNode.parse({
      id: 'wall_inner_placement_a',
      parentId: 'level_inner_placement',
      start: [0, 0],
      end: [4, 0],
      children: ['leanto_inner_placement_a'],
    })
    const wallB = WallNode.parse({
      id: 'wall_inner_placement_b',
      parentId: 'level_inner_placement',
      start: [4, 0],
      end: [4, 4],
    })
    const existing = LeanToExtensionNode.parse({
      id: 'leanto_inner_placement_a',
      parentId: wallA.id,
      position: [2, 0, 0.05],
      span: 4,
    })
    const candidate = LeanToExtensionNode.parse({
      id: 'leanto_inner_placement_b',
      parentId: wallB.id,
      position: [2, 0, 0.05],
      span: 4,
    })
    const nodes = Object.fromEntries(
      [wallA, wallB, existing].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    expect(leanToPlacementConflicts(candidate, wallB, nodes)).toEqual([])
  })

  test('allows a curved extension to continue onto a tangent straight wall', () => {
    const curvedWall = WallNode.parse({
      id: 'wall_curved_continuation',
      parentId: 'level_continuation',
      start: [0, 0],
      end: [6, 0],
      curveOffset: 1,
      children: ['leanto_curved_continuation'],
    })
    const straightWall = WallNode.parse({
      id: 'wall_straight_continuation',
      parentId: 'level_continuation',
      start: [6, 0],
      end: [10.8, 3.6],
    })
    const curvedPlacement = resolveLeanToWallPlacement(
      curvedWall,
      getWallCurveLength(curvedWall) / 2,
      'front',
    )!
    const existing = {
      ...applyLeanToWallAutoSpan(curvedPlacement, curvedWall),
      id: 'leanto_curved_continuation',
    }
    const straightPlacement = resolveLeanToWallPlacement(straightWall, 3, 'front')!
    const candidate = applyLeanToWallAutoSpan(straightPlacement, straightWall)
    const nodes = {
      [curvedWall.id]: curvedWall,
      [straightWall.id]: straightWall,
      [existing.id]: existing,
    } as Record<string, AnyNode>

    expect(leanToPlacementConflicts(candidate, straightWall, nodes)).toEqual([])
  })

  test('allows a convex curved-to-straight corner with an overlapping footprint', () => {
    const curvedWall = WallNode.parse({
      id: 'wall_curved_convex_placement',
      parentId: 'level_convex_placement',
      start: [0, 0],
      end: [6, 0],
      curveOffset: -0.5,
      children: ['leanto_curved_convex_placement'],
    })
    const straightWall = WallNode.parse({
      id: 'wall_straight_convex_placement',
      parentId: 'level_convex_placement',
      start: [6, 0],
      end: [6, -6],
    })
    const curvedPlacement = resolveLeanToWallPlacement(
      curvedWall,
      getWallCurveLength(curvedWall) / 2,
      'front',
    )!
    const existing = {
      ...applyLeanToWallAutoSpan(curvedPlacement, curvedWall),
      id: 'leanto_curved_convex_placement',
      rightOverhang: 4,
    }
    const straightPlacement = resolveLeanToWallPlacement(straightWall, 3, 'front')!
    const candidate = {
      ...applyLeanToWallAutoSpan(straightPlacement, straightWall),
      leftOverhang: 4,
    }
    const nodes = {
      [curvedWall.id]: curvedWall,
      [straightWall.id]: straightWall,
      [existing.id]: existing,
    } as Record<AnyNodeId, AnyNode>

    expect(
      Object.values(resolveLeanToCornerJoints(candidate, straightWall, nodes)).some(
        (joint) => joint?.kind === 'convex' && joint.neighborId === existing.id,
      ),
    ).toBe(true)
    expect(leanToPlacementConflicts(candidate, straightWall, nodes)).toEqual([])
  })

  test('rejects an adjacent building crossing the canopy footprint', () => {
    const building = BuildingNode.parse({ id: 'building_host' })
    const level = LevelNode.parse({ id: 'level_host', parentId: building.id })
    const wall = WallNode.parse({
      id: 'wall_host',
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
    })
    const adjacentBuilding = BuildingNode.parse({ id: 'building_adjacent' })
    const adjacentLevel = LevelNode.parse({ id: 'level_adjacent', parentId: adjacentBuilding.id })
    const adjacentWall = WallNode.parse({
      id: 'wall_other_building',
      parentId: adjacentLevel.id,
      start: [1, 1],
      end: [5, 1],
    })
    const leanTo = LeanToExtensionNode.parse({ parentId: wall.id, position: [3, 0, 0.05] })
    const nodes = Object.fromEntries(
      [building, level, wall, adjacentBuilding, adjacentLevel, adjacentWall].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>

    expect(leanToPlacementConflicts(leanTo, wall, nodes)).toContain(
      `adjacent building ${adjacentBuilding.id}`,
    )
  })

  test('resolves an adjacent building at an end as a wall abutment', () => {
    const building = BuildingNode.parse({ id: 'building_end_host' })
    const level = LevelNode.parse({ id: 'level_end_host', parentId: building.id })
    const wall = WallNode.parse({
      id: 'wall_end_host',
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
    })
    const adjacentBuilding = BuildingNode.parse({ id: 'building_end_adjacent' })
    const adjacentLevel = LevelNode.parse({
      id: 'level_end_adjacent',
      parentId: adjacentBuilding.id,
    })
    const adjacentWall = WallNode.parse({
      id: 'wall_end_adjacent',
      parentId: adjacentLevel.id,
      start: [0.85, -0.5],
      end: [0.85, 3.5],
    })
    const leanTo = LeanToExtensionNode.parse({
      parentId: wall.id,
      position: [3, 0, 0.05],
      span: 4,
    })
    const nodes = Object.fromEntries(
      [building, level, wall, adjacentBuilding, adjacentLevel, adjacentWall].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>

    const resolved = resolveLeanToEndAbutments(leanTo, wall, nodes)
    expect(resolved.leftEndCondition).toBe('wall-abutment')
    expect(resolved.downspoutPosition).toBe(1)
    expect(leanToPlacementConflicts(resolved, wall, nodes)).not.toContain(
      `adjacent building ${adjacentBuilding.id}`,
    )
  })

  test('still rejects an adjacent wall crossing the middle when another wall resolves an end', () => {
    const building = BuildingNode.parse({ id: 'building_mixed_host' })
    const level = LevelNode.parse({ id: 'level_mixed_host', parentId: building.id })
    const wall = WallNode.parse({
      id: 'wall_mixed_host',
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
    })
    const adjacentBuilding = BuildingNode.parse({ id: 'building_mixed_adjacent' })
    const adjacentLevel = LevelNode.parse({
      id: 'level_mixed_adjacent',
      parentId: adjacentBuilding.id,
    })
    const endWall = WallNode.parse({
      id: 'wall_mixed_end',
      parentId: adjacentLevel.id,
      start: [0.85, -0.5],
      end: [0.85, 3.5],
    })
    const crossingWall = WallNode.parse({
      id: 'wall_mixed_crossing',
      parentId: adjacentLevel.id,
      start: [2, 1],
      end: [4, 1],
    })
    const leanTo = LeanToExtensionNode.parse({
      parentId: wall.id,
      position: [3, 0, 0.05],
      span: 4,
    })
    const nodes = Object.fromEntries(
      [building, level, wall, adjacentBuilding, adjacentLevel, endWall, crossingWall].map(
        (node) => [node.id, node],
      ),
    ) as Record<string, AnyNode>
    const resolved = resolveLeanToEndAbutments(leanTo, wall, nodes)

    expect(resolved.leftEndCondition).toBe('wall-abutment')
    expect(leanToPlacementConflicts(resolved, wall, nodes)).toContain(
      `adjacent building ${adjacentBuilding.id}`,
    )
  })

  test('rejects a neighboring roof volume intersecting the canopy', () => {
    const building = BuildingNode.parse({ id: 'building_roof' })
    const level = LevelNode.parse({ id: 'level_roof', parentId: building.id })
    const wall = WallNode.parse({
      id: 'wall_roof',
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
    })
    const roof = RoofNode.parse({
      id: 'roof_neighbor',
      parentId: level.id,
      position: [3, 2.2, 1.5],
    })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_neighbor',
      parentId: roof.id,
      roofType: 'flat',
      width: 4,
      depth: 1,
      wallHeight: 0.3,
    })
    const leanTo = LeanToExtensionNode.parse({ parentId: wall.id, position: [3, 0, 0.05] })
    const nodes = Object.fromEntries(
      [building, level, wall, { ...roof, children: [segment.id] }, segment].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>

    expect(leanToPlacementConflicts(leanTo, wall, nodes)).toContain(`roof/eave ${segment.id}`)
  })

  test('allows an unrelated upper-level roof over a lower-level canopy footprint', () => {
    const building = BuildingNode.parse({
      id: 'building_multilevel',
      children: ['level_ground', 'level_upper'],
    })
    const ground = LevelNode.parse({
      id: 'level_ground',
      parentId: building.id,
      level: 0,
      height: 2.5,
      children: ['wall_ground'],
    })
    const upper = LevelNode.parse({
      id: 'level_upper',
      parentId: building.id,
      level: 1,
      height: 2.5,
      children: ['roof_upper'],
    })
    const wall = WallNode.parse({
      id: 'wall_ground',
      parentId: ground.id,
      start: [0, 0],
      end: [6, 0],
      height: 2.8,
    })
    const roof = RoofNode.parse({
      id: 'roof_upper',
      parentId: upper.id,
      position: [3, 2.2, 1.5],
    })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_upper',
      parentId: roof.id,
      roofType: 'flat',
      width: 4,
      depth: 1,
      wallHeight: 0.3,
    })
    const leanTo = LeanToExtensionNode.parse({ parentId: wall.id, position: [3, 0, 0.05] })
    const nodes = Object.fromEntries(
      [building, ground, upper, wall, { ...roof, children: [segment.id] }, segment].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>

    expect(leanToPlacementConflicts(leanTo, wall, nodes)).not.toContain(`roof/eave ${segment.id}`)
  })

  test('rejects a host eave that intrudes beyond its recorded connection edge', () => {
    const building = BuildingNode.parse({ id: 'building_host_eave' })
    const level = LevelNode.parse({ id: 'level_host_eave', parentId: building.id })
    const wall = WallNode.parse({
      id: 'wall_host_eave',
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
    })
    const roof = RoofNode.parse({ id: 'roof_host_eave', parentId: level.id, position: [3, 2, 1] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_host_eave',
      parentId: roof.id,
      roofType: 'flat',
      width: 4,
      depth: 1,
    })
    const leanTo = LeanToExtensionNode.parse({
      parentId: wall.id,
      position: [3, 0, 0.05],
      hostRoofId: roof.id,
      hostRoofSegmentId: segment.id,
      hostRoofEdge: '+Z',
      connectionInset: 0.3,
    })
    const nodes = Object.fromEntries(
      [building, level, wall, { ...roof, children: [segment.id] }, segment].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>

    expect(leanToPlacementConflicts(leanTo, wall, nodes)).toContain(`host roof/eave ${segment.id}`)
  })
})
