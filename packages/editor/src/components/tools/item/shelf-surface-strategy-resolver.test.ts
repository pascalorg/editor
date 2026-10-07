import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import * as core from '@pascal-app/core'
import {
  ItemNode,
  nodeRegistry,
  type ShelfEvent,
  ShelfNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { Euler, Group, Quaternion, Vector3 } from 'three'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { registerHostingTestNode } from '../__fixtures__/hosting'
import { shelfSurfaceStrategy } from './placement-strategies'
import type { PlacementContext } from './placement-types'

const host = ShelfNode.parse({ id: 'shelf_resolver-host', width: 2, depth: 1, height: 2 })
const child = ItemNode.parse({
  id: 'item_shelf-resolver-child',
  asset: {
    id: 'book',
    name: 'Book',
    category: 'decor',
    thumbnail: '',
    src: '/book.glb',
    dimensions: [0.5, 0.25, 0.25],
  },
  rotation: [0.1, 0.2, 0.3],
})
let rows: number[]
let restoreRegistry: () => void
let savedNodes: ReturnType<typeof useScene.getState>['nodes']
let savedEditor: ReturnType<typeof useEditor.getState>
let savedScope: ReturnType<typeof useInteractionScope.getState>
let resolver: ReturnType<typeof spyOn<typeof core, 'resolveSurfacePlacement'>>

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  rows = [0.5, 1.5]
  registerHostingTestNode({
    kind: 'shelf',
    schemaVersion: 1,
    schema: ShelfNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {
      surfaces: {
        custom: () => rows.map((y) => ({ position: [0, y, 0], normal: [0, 1, 0] })),
      },
    },
  })
  registerHostingTestNode({
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
    currentCursorRotationY: 0.7,
    gridPosition: new Vector3(),
    levelId: 'level_test',
  } as PlacementContext
}

function onShelf(ctx: PlacementContext): PlacementContext {
  return { ...ctx, state: { ...ctx.state, surface: 'shelf-surface', shelfId: host.id } }
}

function hit(y = 1, z = -0.1): ShelfEvent {
  const object = sceneRegistry.nodes.get(host.id)!
  return {
    node: host,
    object,
    normal: [0, 1, 0],
    position: object.localToWorld(new Vector3(0.37, y, z)).toArray(),
    localPosition: [0.37, y, z],
    nativeEvent: {},
    stopPropagation() {},
  } as ShelfEvent
}

test.each([
  'grid',
  'off',
] as const)('midpoint keeps the first declared row and preserves X/Z with grid %s', (mode) => {
  useEditor.getState().setSnappingMode('item', mode)
  for (const declared of [
    [0.5, 1.5],
    [1.5, 0.5],
  ]) {
    rows = declared
    const expected: [number, number, number] =
      mode === 'grid' ? [0.25, rows[0]!, 0.125] : [0.37, rows[0]!, -0.1]
    const ctx = context()
    const entered = shelfSurfaceStrategy.enter(ctx, hit())!
    expect(entered.nodeUpdate).toEqual({
      position: expected,
      parentId: host.id,
      rotation: [0.1, 0.7, 0.3],
    })
    expect(entered.gridPosition).toEqual(expected)
    expect(entered.cursorPosition).toEqual(expected)
    const moved = shelfSurfaceStrategy.move(onShelf(ctx), hit())!
    expect(moved.nodeUpdate).toEqual({ position: expected })
    expect(moved.cursorPosition).toEqual(expected)
    const committed = shelfSurfaceStrategy.click(
      { ...onShelf(ctx), gridPosition: new Vector3(...entered.gridPosition) },
      hit(),
    )!
    expect(committed.nodeUpdate.position).toEqual(expected)
    expect(committed.nodeUpdate.parentId).toBe(host.id)
  }
  expect(resolver).toHaveBeenCalledTimes(6)
})

test.each([
  [0.999, 0.5],
  [1.001, 1.5],
])('hit Y %s elects nearest row %s on enter and move', (y, expected) => {
  expect(shelfSurfaceStrategy.enter(context(), hit(y))!.gridPosition[1]).toBe(expected)
  expect(shelfSurfaceStrategy.move(onShelf(context()), hit(y))!.gridPosition[1]).toBe(expected)
})

test.each([
  [2.01, 0.25],
  [0.5, 1.01],
])('scaled footprint %s by %s overhang is accepted on enter and move', (width, depth) => {
  const draft = ItemNode.parse({
    ...child,
    asset: { ...child.asset, dimensions: [width / 2, 0.25, depth / 2] },
    scale: [2, 1, 2],
  })
  const ctx = context(draft)
  expect(shelfSurfaceStrategy.enter(ctx, hit())).not.toBeNull()
  expect(shelfSurfaceStrategy.move(onShelf(ctx), hit())).not.toBeNull()
  expect(resolver.mock.calls.map(([args]) => args.checkFootprint)).toEqual([true, true])
})

test('a full-board object is refused when grid snapping puts its centre outside the board', () => {
  const draft = ItemNode.parse({
    ...child,
    asset: { ...child.asset, dimensions: [host.width, 0.25, host.depth] },
  })
  expect(shelfSurfaceStrategy.enter(context(draft), hit(1, -0.39))).toBeNull()
})

test.each([
  'grid',
  'off',
] as const)('shelf frame conversion retains exact poses with grid %s', (mode) => {
  useEditor.getState().setSnappingMode('item', mode)
  const mesh = sceneRegistry.nodes.get(host.id)!
  mesh.position.set(4, 2, -3)
  mesh.rotation.set(0, Math.PI / 3, 0)
  mesh.updateMatrixWorld(true)
  const event = hit(1.2)
  const local = mesh.worldToLocal(new Vector3(...event.position))
  const expected: [number, number, number] =
    mode === 'grid' ? [0.25, 1.5, 0.125] : [local.x, 1.5, local.z]
  const yaw = new Euler().setFromQuaternion(mesh.getWorldQuaternion(new Quaternion()), 'YXZ').y
  const entered = shelfSurfaceStrategy.enter(context(), event)!
  expect(entered.nodeUpdate).toEqual({
    position: expected,
    parentId: host.id,
    rotation: [0.1, 0.7 - yaw, 0.3],
  })
  expect(entered.cursorPosition).toEqual(mesh.localToWorld(new Vector3(...expected)).toArray())
  expect(shelfSurfaceStrategy.move(onShelf(context()), event)!.gridPosition).toEqual(expected)
})

test('only enter requires an upward normal; moves keep electing rows', () => {
  for (const normal of [[1, 0, 0], [0, -1, 0], undefined] as ShelfEvent['normal'][]) {
    const event = { ...hit(), normal }
    expect(shelfSurfaceStrategy.enter(context(), event)).toBeNull()
    expect(shelfSurfaceStrategy.move(onShelf(context()), event)!.gridPosition[1]).toBe(0.5)
  }
})

test('missing rows and resolver rejection leave the draft untouched', () => {
  const before = useScene.getState().nodes
  rows = []
  expect(shelfSurfaceStrategy.enter(context(), hit())).toBeNull()
  expect(shelfSurfaceStrategy.move(onShelf(context()), hit())).toBeNull()
  rows = [0.5, 1.5]
  resolver.mockReturnValue(null)
  expect(shelfSurfaceStrategy.enter(context(), hit())).toBeNull()
  expect(shelfSurfaceStrategy.move(onShelf(context()), hit())).toBeNull()
  expect(useScene.getState().nodes).toBe(before)
})

test('a centred unrotated object exactly matching the board is accepted with epsilon tolerance', () => {
  useEditor.getState().setSnappingMode('item', 'off')
  const region = core.shelfSurfaceProvider.surfaces!(host, {
    scene: core.createSceneApi(useScene),
  })[0]!.region
  const draft = ItemNode.parse({
    ...child,
    rotation: [0, 0, 0],
    asset: { ...child.asset, dimensions: [region.size![0] * 2, 0.25, region.size![1] * 2] },
  })
  const ctx = { ...context(draft), currentCursorRotationY: 0 }
  for (const x of [0, 1e-7]) {
    const event = { ...hit(), position: [x, 0.5, 0], localPosition: [x, 0.5, 0] } as ShelfEvent
    expect(shelfSurfaceStrategy.enter(ctx, event)).not.toBeNull()
  }
})

test('shelf validation uses the current shelf after leaving a different surface host', () => {
  const other = ItemNode.parse({
    ...child,
    id: 'item_previous-host',
    asset: { ...child.asset, dimensions: [0.01, 0.1, 0.01] },
  })
  useScene.setState({ nodes: { ...useScene.getState().nodes, [other.id]: other } })
  const ctx = onShelf(context(ItemNode.parse({ ...child, rotation: [0, 0, 0] })))
  ctx.state.surfaceItemId = other.id
  ctx.gridPosition.set(0, 0.5, 0)
  expect(shelfSurfaceStrategy.click(ctx, hit())).not.toBeNull()
})
