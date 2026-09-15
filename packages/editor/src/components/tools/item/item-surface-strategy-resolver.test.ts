import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import * as core from '@pascal-app/core'
import {
  type ItemEvent,
  ItemNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { Group, Vector3 } from 'three'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { itemSurfaceStrategy, resolveItemSurfacePlacement } from './placement-strategies'
import type { PlacementContext } from './placement-types'

const asset = {
  id: 'table',
  name: 'Table',
  category: 'furniture',
  thumbnail: '',
  src: '/table.glb',
  dimensions: [2, 1, 3],
}
const host = ItemNode.parse({ id: 'item_strategy-resolver-host', asset, scale: [2, 1, 0.5] })
const child = ItemNode.parse({
  id: 'item_strategy-resolver-child',
  asset: { ...asset, dimensions: [0.5, 1, 0.5] },
  rotation: [0.1, 0.2, 0.3],
})
let restoreRegistry: () => void
let savedNodes: ReturnType<typeof useScene.getState>['nodes']
let savedEditor: ReturnType<typeof useEditor.getState>
let savedScope: ReturnType<typeof useInteractionScope.getState>
let resolver: ReturnType<typeof spyOn<typeof core, 'resolveSurfacePlacement'>>

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerNode({
    kind: 'item',
    schemaVersion: 1,
    schema: ItemNode,
    category: 'furnish',
    snapProfile: 'item',
    defaults: () => ({}),
    capabilities: {},
  })
  savedNodes = useScene.getState().nodes
  savedEditor = useEditor.getState()
  savedScope = useInteractionScope.getState()
  useScene.setState({ nodes: { [host.id]: host, [child.id]: child } })
  useInteractionScope.setState({ scope: { kind: 'idle' } })
  useEditor.setState({ mode: 'build', tool: 'item', gridSnapStep: 0.5 })
  useEditor.getState().setSnappingMode('item', 'grid')
  const mesh = new Group()
  mesh.position.set(4, 2, -3)
  mesh.rotation.set(0.1, Math.PI / 3, -0.1)
  mesh.scale.set(2, 1, 0.5)
  mesh.updateMatrixWorld(true)
  sceneRegistry.nodes.set(host.id, mesh)
  resolver = spyOn(core, 'resolveSurfacePlacement')
})

afterEach(() => {
  resolver.mockRestore()
  restoreRegistry()
  sceneRegistry.nodes.delete(host.id)
  useScene.setState({ nodes: savedNodes })
  useEditor.setState(savedEditor)
  useInteractionScope.setState(savedScope)
})

function context(draftItem = child): PlacementContext {
  return {
    asset: draftItem.asset,
    draftItem,
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
}

function hit(): ItemEvent {
  const object = sceneRegistry.nodes.get(host.id)!
  return {
    node: host,
    object,
    normal: [0, 1, 0],
    position: object.localToWorld(new Vector3(0.37, 0.81, -0.39)).toArray(),
    localPosition: [0.37, 0.81, -0.39],
    nativeEvent: {},
    stopPropagation() {},
  } as ItemEvent
}

function onHost(ctx: PlacementContext): PlacementContext {
  return { ...ctx, state: { ...ctx.state, surface: 'item-surface', surfaceItemId: host.id } }
}

test.each([
  [4.01, 1, 1.5],
  [4, 1, 1.51],
] as [
  number,
  number,
  number,
][])('enter checks the scaled footprint while move skips it: %j', (width, height, depth) => {
  const draft = ItemNode.parse({
    ...child,
    asset: { ...asset, dimensions: [width, height, depth] },
  })
  const ctx = context(draft)
  const event = hit()
  const before = useScene.getState().nodes
  expect(itemSurfaceStrategy.enter(ctx, event)).toBeNull()
  const expected = resolveItemSurfacePlacement(
    host,
    event,
    [width, height, depth],
    0.2,
    undefined,
    false,
  )!
  const moved = itemSurfaceStrategy.move(onHost(ctx), event)!
  expect(moved.nodeUpdate).toEqual({ position: expected.position })
  expect(moved.cursorPosition).toEqual(expected.worldPosition)
  expect(moved.cursorRotationY).toBe(ctx.currentCursorRotationY)
  expect(resolver.mock.calls.map(([args]) => args.checkFootprint)).toEqual([true, false])
  expect(useScene.getState().nodes).toBe(before)
})

test.each([
  'grid',
  'off',
] as const)('accepted poses are exactly legacy poses with snapping %s', (mode) => {
  useEditor.getState().setSnappingMode('item', mode)
  const ctx = context()
  const event = hit()
  const expected = resolveItemSurfacePlacement(host, event, [0.5, 1, 0.5], 0.2, child.id)!
  const entered = itemSurfaceStrategy.enter(ctx, event)!
  expect(entered.nodeUpdate).toEqual({
    position: expected.position,
    parentId: host.id,
    rotation: [0.1, expected.rotationY, 0.3],
  })
  expect(entered.cursorPosition).toEqual(expected.worldPosition)
  expect(itemSurfaceStrategy.move(onHost(ctx), event)!.nodeUpdate).toEqual({
    position: expected.position,
  })
  expect(resolver).toHaveBeenCalledTimes(2)
})

test('resolver rejection leaves both enter and move drafts alone', () => {
  resolver.mockReturnValue(null)
  const ctx = context()
  const before = useScene.getState().nodes
  expect(itemSurfaceStrategy.enter(ctx, hit())).toBeNull()
  expect(itemSurfaceStrategy.move(onHost(ctx), hit())).toBeNull()
  expect(useScene.getState().nodes).toBe(before)
  expect(ctx.draftItem).toBe(child)
})

test('move still rejects side hits and missing normals even when fit is skipped', () => {
  for (const normal of [[1, 0, 0], [0, -1, 0], undefined] as ItemEvent['normal'][]) {
    const event = { ...hit(), normal }
    expect(itemSurfaceStrategy.enter(context(), event)).toBeNull()
    expect(itemSurfaceStrategy.move(onHost(context()), event)).toBeNull()
  }
})

test('enter rejects itself and indirect descendants before asking the resolver', () => {
  expect(itemSurfaceStrategy.enter(context(host), hit())).toBeNull()
  const middle = ItemNode.parse({ id: 'item_strategy-middle', parentId: child.id, asset })
  const descendant = { ...host, parentId: middle.id }
  useScene.setState({
    nodes: { ...useScene.getState().nodes, [middle.id]: middle, [host.id]: descendant },
  })
  expect(itemSurfaceStrategy.enter(context(), { ...hit(), node: descendant })).toBeNull()
  expect(resolver).not.toHaveBeenCalled()
})
