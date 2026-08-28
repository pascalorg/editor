import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LeanToExtensionNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SlabNode,
  useLiveNodeOverrides,
  WallNode,
} from '@pascal-app/core'
import { useEditor, useInteractionScope } from '@pascal-app/editor'
import { leanToExtensionDefinition } from './definition'
import { leanToFloorplanMoveTarget } from './floorplan-move'
import { resolveLeanToSlabEdgePlacement } from './placement'

afterEach(() => {
  useInteractionScope.getState().end()
  useLiveNodeOverrides.getState().clearAll()
})

describe('lean-to floorplan move snapping', () => {
  test('moves a freestanding canopy freely in plan', () => {
    const moving = LeanToExtensionNode.parse({
      id: 'leanto_freestanding_move',
      parentId: 'level_freestanding_move',
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      position: [1, 0, 1],
    })
    const nodes = { [moving.id]: moving } as Record<AnyNodeId, AnyNode>
    const sceneApi = {
      get: (id: AnyNodeId) => nodes[id],
      nodes: () => nodes,
      markDirty: () => {},
      update: () => {},
    } as never

    const session = leanToFloorplanMoveTarget({ node: moving, nodes, sceneApi })
    session.apply({ planPoint: [3.8, 2.2], modifiers: { altKey: true, shiftKey: false } })

    expect(useLiveNodeOverrides.getState().overrides.get(moving.id)?.position).toEqual([
      3.8, 0, 0.8250000000000002,
    ])
    expect(session.canCommit()).toBe(true)
  })

  test('moves a slab-attached canopy along its host edge', () => {
    const building = BuildingNode.parse({ id: 'building_slab_move' })
    const ground = LevelNode.parse({
      id: 'level_slab_move_ground',
      parentId: building.id,
      level: 0,
      height: 3,
    })
    const first = LevelNode.parse({
      id: 'level_slab_move_first',
      parentId: building.id,
      level: 1,
      height: 3,
    })
    const slab = SlabNode.parse({
      id: 'slab_move_host',
      parentId: first.id,
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      elevation: 0.05,
      thickness: 0.2,
    })
    const hostNodes = {
      [building.id]: building,
      [ground.id]: ground,
      [first.id]: first,
      [slab.id]: slab,
    } as Record<AnyNodeId, AnyNode>
    const moving = resolveLeanToSlabEdgePlacement({
      activeLevelId: ground.id,
      edgeIndex: 0,
      edgeT: 0.5,
      nodes: hostNodes,
      slab,
    })!
    const nodes = { ...hostNodes, [moving.id]: moving }
    const sceneApi = {
      get: (id: AnyNodeId) => nodes[id],
      nodes: () => nodes,
      markDirty: () => {},
      update: () => {},
    } as never

    const session = leanToFloorplanMoveTarget({ node: moving, nodes, sceneApi })
    session.apply({ planPoint: [5, 1], modifiers: { altKey: true, shiftKey: false } })

    const preview = useLiveNodeOverrides.getState().overrides.get(moving.id)
    expect(preview?.position).toEqual([5, 0, 0])
    expect(preview?.hostSlabEdgeT).toBeCloseTo(5 / 6, 6)
    expect(session.canCommit()).toBe(true)
  })

  test('connects a side edge while grid mode is active', () => {
    if (!nodeRegistry.has(leanToExtensionDefinition.kind)) registerNode(leanToExtensionDefinition)
    const wall = WallNode.parse({
      id: 'wall_move_snap',
      parentId: 'level_move_snap',
      start: [0, 0],
      end: [5, 0],
    })
    const adjacentWall = WallNode.parse({
      id: 'wall_move_snap_adjacent',
      parentId: 'level_move_snap',
      start: [4.87, 0],
      end: [10, 0],
    })
    const moving = LeanToExtensionNode.parse({
      id: 'leanto_move_snap',
      parentId: wall.id,
      position: [2, 0, 0.05],
      span: 2,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const adjacent = LeanToExtensionNode.parse({
      id: 'leanto_move_snap_adjacent',
      parentId: adjacentWall.id,
      position: [1, 0, 0.05],
      span: 2,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = {
      [wall.id]: wall,
      [adjacentWall.id]: adjacentWall,
      [moving.id]: moving,
      [adjacent.id]: adjacent,
    } as Record<AnyNodeId, AnyNode>
    const sceneApi = {
      get: (id: AnyNodeId) => nodes[id],
      nodes: () => nodes,
      markDirty: () => {},
      update: () => {},
    } as never

    useEditor.setState((state) => ({
      gridSnapStep: 0.5,
      snappingModeByContext: { ...state.snappingModeByContext, polygon: 'grid' },
    }))
    useInteractionScope.getState().begin({
      kind: 'moving',
      node: moving,
      nodeId: moving.id,
      nodeType: moving.type,
      view: '2d',
    })

    const session = leanToFloorplanMoveTarget({ node: moving, nodes, sceneApi })
    session.apply({ planPoint: [3.8, 0], modifiers: { altKey: false, shiftKey: false } })

    const preview = useLiveNodeOverrides.getState().overrides.get(moving.id)
    expect(preview?.position?.[0]).toBeCloseTo(3.87)
  })

  test('keeps the raw side position while force-moving', () => {
    const wall = WallNode.parse({
      id: 'wall_force_move',
      parentId: 'level_force_move',
      start: [0, 0],
      end: [5, 0],
    })
    const moving = LeanToExtensionNode.parse({
      id: 'leanto_force_move',
      parentId: wall.id,
      position: [2, 0, 0.05],
      span: 2,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = { [wall.id]: wall, [moving.id]: moving } as Record<AnyNodeId, AnyNode>
    const sceneApi = {
      get: (id: AnyNodeId) => nodes[id],
      nodes: () => nodes,
      markDirty: () => {},
      update: () => {},
    } as never

    const session = leanToFloorplanMoveTarget({ node: moving, nodes, sceneApi })
    session.apply({ planPoint: [3.8, 0], modifiers: { altKey: true, shiftKey: false } })

    const preview = useLiveNodeOverrides.getState().overrides.get(moving.id)
    expect(preview?.position?.[0]).toBeCloseTo(3.8)
  })
})
