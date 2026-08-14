import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  LeanToExtensionNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { leanToPlacementConflicts } from './placement-validation'

describe('lean-to placement validation', () => {
  test('rejects a span crossing a host-wall opening', () => {
    const window = WindowNode.parse({ position: [2, 1, 0], width: 1.2 })
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], children: [window.id] })
    const leanTo = LeanToExtensionNode.parse({ parentId: wall.id, position: [2, 0, 0.05] })
    const nodes = { [wall.id]: wall, [window.id]: window } as Record<string, AnyNode>
    expect(leanToPlacementConflicts(leanTo, wall, nodes)).toHaveLength(1)
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
