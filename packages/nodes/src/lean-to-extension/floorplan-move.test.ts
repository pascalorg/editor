import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LeanToExtensionNode,
  nodeRegistry,
  registerNode,
  useLiveNodeOverrides,
  WallNode,
} from '@pascal-app/core'
import { useEditor, useInteractionScope } from '@pascal-app/editor'
import { leanToExtensionDefinition } from './definition'
import { leanToFloorplanMoveTarget } from './floorplan-move'

afterEach(() => {
  useInteractionScope.getState().end()
  useLiveNodeOverrides.getState().clearAll()
})

describe('lean-to floorplan move snapping', () => {
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
