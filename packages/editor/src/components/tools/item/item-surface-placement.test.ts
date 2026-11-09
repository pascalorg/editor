import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type ItemEvent, ItemNode, nodeRegistry, sceneRegistry, useScene } from '@pascal-app/core'
import { Group, Vector3 } from 'three'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { registerHostingTestNode } from '../__fixtures__/hosting'
import { itemSurfaceStrategy } from './placement-strategies'
import type { PlacementContext } from './placement-types'

const asset = {
  id: 'table',
  name: 'Table',
  category: 'furniture',
  thumbnail: '',
  src: '/table.glb',
  dimensions: [2, 1, 3],
}
let restoreRegistry: () => void
const editorState = useEditor.getState()
const scopeState = useInteractionScope.getState()

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerHostingTestNode({
    kind: 'item',
    schemaVersion: 1,
    schema: ItemNode,
    category: 'furnish',
    snapProfile: 'item',
    defaults: () => ({}),
    capabilities: {},
  })
  useInteractionScope.setState({ scope: { kind: 'idle' } })
  useEditor.setState({ mode: 'build', tool: 'item', gridSnapStep: 0.5 })
  useEditor.getState().setSnappingMode('item', 'grid')
})

afterEach(() => {
  restoreRegistry()
  sceneRegistry.nodes.delete('item_surface-test')
  useEditor.setState(editorState)
  useInteractionScope.setState(scopeState)
})

function surface(overrides: Partial<ItemNode> = {}) {
  const host = ItemNode.parse({ id: 'item_surface-test', asset, ...overrides })
  const mesh = new Group()
  mesh.position.set(4, 2, -3)
  mesh.rotation.y = Math.PI / 3
  mesh.updateMatrixWorld(true)
  sceneRegistry.nodes.set(host.id, mesh)
  const world = mesh.localToWorld(new Vector3(0.37, 0.81, -0.39))
  const event = {
    node: host,
    object: mesh,
    position: world.toArray(),
    localPosition: [0.37, 0.81, -0.39],
    normal: [0, 1, 0],
    stopPropagation: () => {},
    nativeEvent: {} as ItemEvent['nativeEvent'],
  } as ItemEvent
  return { host, mesh, event }
}

function enterSurface(
  event: ItemEvent,
  dimensions: [number, number, number],
  yaw = 0,
  draftId?: ItemNode['id'],
) {
  const draft = ItemNode.parse({ id: draftId, asset: { ...asset, dimensions } })
  return itemSurfaceStrategy.enter(
    {
      asset: draft.asset,
      draftItem: draft,
      state: { surface: 'floor' },
      currentCursorRotationY: yaw,
    } as PlacementContext,
    event,
  )
}

describe('itemSurfaceStrategy production placement', () => {
  test('scaled host accepts centred rotated and oversized footprints', () => {
    const { event } = surface({ scale: [2, 1, 0.5] })
    expect(enterSurface(event, [4, 5, 1.5], 0)).not.toBeNull()
    expect(enterSurface(event, [4, 5, 1.5], Math.PI / 3)).not.toBeNull()
    expect(enterSurface(event, [4.01, 1, 1.5], 0)).not.toBeNull()
    expect(enterSurface(event, [4, 1, 1.51], 0)).not.toBeNull()
  })

  test('rejects ceiling hosts, low profiles, side hits, and absent normals', () => {
    for (const overrides of [
      { asset: { ...asset, attachTo: 'ceiling' } },
      { asset: { ...asset, dimensions: [2, 0.05, 3] } },
    ]) {
      const { event } = surface(overrides as Partial<ItemNode>)
      expect(enterSurface(event, [0.5, 1, 0.5], 0)).toBeNull()
    }
    const { event } = surface()
    for (const normal of [[1, 0, 0], [0, -1, 0], undefined]) {
      expect(enterSurface({ ...event, normal } as ItemEvent, [0.5, 1, 0.5], 0)).toBeNull()
    }
  })

  test('uses scaled asset surface height, snapped host-local XZ, and continuous world yaw', () => {
    const { mesh, event } = surface({
      asset: { ...asset, surface: { height: 0.7 } } as ItemNode['asset'],
      scale: [1, 2, 1],
    })
    const pose = enterSurface(event, [0.5, 1, 0.5], Math.PI / 4)!
    expect(pose.nodeUpdate.position!).toEqual([0.25, 1.4, -0.25])
    expect(pose.nodeUpdate.rotation![1]! + Math.PI / 3).toBeCloseTo(Math.PI / 4)
    expect(pose.cursorPosition).toEqual(
      mesh.localToWorld(new Vector3(...pose.nodeUpdate.position!)).toArray(),
    )
  })

  test('uses local hit Y without surface metadata and honors snapping off', () => {
    useEditor.getState().setSnappingMode('item', 'off')
    const { event } = surface()
    const pose = enterSurface(event, [0.5, 1, 0.5], 0)!
    expect(pose.nodeUpdate.position![0]).toBeCloseTo(0.37)
    expect(pose.nodeUpdate.position![1]).toBeCloseTo(0.81)
    expect(pose.nodeUpdate.position![2]).toBeCloseTo(-0.39)
  })

  test('rejects the moving node and its descendants', () => {
    const { host, event } = surface({ parentId: 'item_moving' })
    expect(enterSurface(event, [0.5, 1, 0.5], 0, host.id)).toBeNull()
    expect(enterSurface(event, [0.5, 1, 0.5], 0, 'item_moving')).toBeNull()
  })

  test('catalog strategy keeps its enter pose and position-only move contract', () => {
    const { host, event } = surface()
    const draft = ItemNode.parse({ asset: { ...asset, dimensions: [0.5, 1, 0.5] } })
    const ctx = {
      asset: draft.asset,
      draftItem: draft,
      state: {
        surface: 'floor',
        wallId: null,
        roofSegmentId: null,
        ceilingId: null,
        surfaceItemId: null,
        shelfId: null,
      },
      currentCursorRotationY: 0.2,
      gridPosition: new Vector3(),
      levelId: 'level_test',
    } as PlacementContext
    const enter = itemSurfaceStrategy.enter(ctx, event)!
    expect(enter.nodeUpdate.parentId).toBe(host.id)
    expect(enter.nodeUpdate.rotation?.[1]).toBeCloseTo(0.2 - Math.PI / 3)
    const oldNodes = useScene.getState().nodes
    useScene.setState({ nodes: { ...oldNodes, [host.id]: host } })
    try {
      const move = itemSurfaceStrategy.move(
        { ...ctx, state: { ...ctx.state, surface: 'item-surface', surfaceItemId: host.id } },
        event,
      )!
      expect(move.nodeUpdate).toEqual({ position: enter.gridPosition })
      expect(move.cursorRotationY).toBe(0.2)
    } finally {
      useScene.setState({ nodes: oldNodes })
    }
  })
})
