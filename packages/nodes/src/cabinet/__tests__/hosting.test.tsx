import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  type CabinetNode as Cabinet,
  type CabinetEvent,
  createSceneApi,
  emitter,
  getFloorPlacedElevation,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  resolveSupportSlabPatch,
  ShelfNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  evaluateRecipe,
  nodeLevelFrame,
  ProceduralItemNode,
  queryProceduralItem,
  type Recipe,
} from '@pascal-app/core/procedural-items'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { Group, PerspectiveCamera, Vector3 } from 'three'
import {
  itemSurfaceStrategy,
  validCatalogCounterPose,
} from '../../../../editor/src/components/tools/item/placement-strategies'
import type { PlacementContext } from '../../../../editor/src/components/tools/item/placement-types'
import { createRegistryItemSurfaceMove } from '../../../../editor/src/components/tools/registry/item-surface-move'
import { MoveRegistryNodeTool } from '../../../../editor/src/components/tools/registry/move-registry-node-tool'
import { createShelfStickiness } from '../../../../editor/src/components/tools/shared/shelf-stickiness'
import useEditor from '../../../../editor/src/store/use-editor'
import useInteractionScope from '../../../../editor/src/store/use-interaction-scope'
import { GeometrySystem } from '../../../../viewer/src/systems/geometry/geometry-system'
import { itemDefinition } from '../../item/definition'
import { buildItemFloorplan } from '../../item/floorplan'
import { itemFloorplanMoveTarget } from '../../item/floorplan-move'
import { getInitialState } from '../../item/move-tool'
import { proceduralItemDefinition } from '../../procedural-item/definition'
import { proceduralFloorplanMoveTarget } from '../../procedural-item/move-session'
import { shelfDefinition } from '../../shelf/definition'
import {
  cabinetDefinition,
  cabinetModuleDefinition,
  cabinetRunNeighborSignature,
} from '../definition'
import { CabinetModuleNode, CabinetNode } from '../schema'
import { cabinetTreeChildIds } from '../tree-structure'

const recipe: Recipe = {
  version: 1,
  name: 'Offset cup',
  description: 'Counter contact',
  constraints: [],
  parameters: [
    { id: 'width', label: 'Width', default: 0.2, min: 0.1, max: 2, step: 0.1, unit: 'm' },
  ],
  slots: [{ id: 'body', label: 'Body', color: '#ffffff' }],
  parts: [
    {
      id: 'body',
      label: 'Body',
      count: 1,
      shapes: [
        {
          id: 'box',
          primitive: 'box',
          size: ['width', 0.2, 0.2],
          position: [0.1, 0.3, 0.1],
          slot: 'body',
        },
      ],
    },
  ],
  surfaces: [],
}
const level = LevelNode.parse({ id: 'level_counter-hosting' })
const slab = SlabNode.parse({
  parentId: level.id,
  elevation: 0.5,
  polygon: [
    [-20, -20],
    [20, -20],
    [20, 20],
    [-20, 20],
  ],
})
const catalog = ItemNode.parse({
  parentId: level.id,
  asset: {
    id: 'mug',
    name: 'Mug',
    category: 'decor',
    thumbnail: '',
    src: '/mug.glb',
    dimensions: [0.2, 0.2, 0.2],
  },
  supportSlabId: slab.id,
})
const design = ProceduralItemNode.parse({ parentId: level.id, recipe, supportSlabId: slab.id })
const dimensions = evaluateRecipe(recipe, {}).dimensions
const modifiers = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }
let restoreRegistry: () => void
let savedScene: ReturnType<typeof useScene.getState>
let savedEditor: ReturnType<typeof useEditor.getState>
let savedViewer: ReturnType<typeof useViewer.getState>
let savedScope: ReturnType<typeof useInteractionScope.getState>
let savedWindow: PropertyDescriptor | undefined
let savedDocument: typeof document
let savedRaf: typeof requestAnimationFrame
let savedCancelRaf: typeof cancelAnimationFrame

beforeEach(() => {
  savedScene = useScene.getState()
  savedEditor = useEditor.getState()
  savedViewer = useViewer.getState()
  savedScope = useInteractionScope.getState()
  savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  savedDocument = globalThis.document
  savedRaf = globalThis.requestAnimationFrame
  savedCancelRaf = globalThis.cancelAnimationFrame
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.document = { body: { style: { cursor: '' } } } as Document
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  for (const def of [
    cabinetDefinition,
    cabinetModuleDefinition,
    shelfDefinition,
    proceduralItemDefinition,
    itemDefinition,
  ])
    registerNode(def as never)
  useScene.setState({
    nodes: {
      [level.id]: { ...level, children: [slab.id, catalog.id, design.id] },
      [slab.id]: slab,
      [catalog.id]: catalog,
      [design.id]: design,
    },
    rootNodeIds: [level.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  spatialGridManager.clear()
  spatialGridManager.handleNodeCreated(slab, level.id)
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  useScene.temporal.getState().clear()
  useScene.temporal.getState().pause()
  useInteractionScope.getState().end()
  useEditor.setState({
    mode: 'build',
    tool: 'item',
    movingNodeOrigin: '3d',
    placementDragMode: false,
  })
  useEditor.getState().setMovingNode(design)
  useEditor.getState().setSnappingMode('item', 'off')
  useViewer.setState({
    selection: { buildingId: null, levelId: level.id, zoneId: null, selectedIds: [] },
  })
  sceneRegistry.nodes.set(level.id, new Group())
})
afterEach(() => {
  sceneRegistry.nodes.clear()
  spatialGridManager.clear()
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  useScene.setState(savedScene)
  useEditor.setState(savedEditor)
  useViewer.setState(savedViewer)
  useInteractionScope.setState(savedScope)
  restoreRegistry()
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  globalThis.document = savedDocument
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancelRaf
})
function fixture(
  patch: Partial<Cabinet> = {},
  modules = [-0.6, 0, 0.6].map((x) =>
    CabinetModuleNode.parse({ width: 0.6, depth: 0.6, carcassHeight: 0.72, position: [x, 0.1, 0] }),
  ),
) {
  const run = CabinetNode.parse({
    parentId: level.id,
    position: [2, 0.1, 3],
    rotation: 0.6,
    withCountertop: true,
    countertopThickness: 0.03,
    children: modules.map((m) => m.id),
    supportSlabId: slab.id,
    ...patch,
  })
  useScene.getState().createNode(run, run.parentId)
  for (const module of modules)
    useScene.getState().createNode({ ...module, parentId: run.id }, run.id)
  const object = new Group()
  object.position.set(...run.position)
  object.rotation.y = run.rotation
  if (run.parentId === level.id) object.position.y += slab.elevation
  sceneRegistry.nodes.get(run.parentId!)?.add(object)
  sceneRegistry.nodes.set(run.id, object)
  object.updateWorldMatrix(true, true)
  return run
}
function hit(run: Cabinet, local: [number, number, number] = [0, 0.85, 0]): CabinetEvent {
  const object = sceneRegistry.nodes.get(run.id)!
  return {
    node: run,
    object,
    normal: [0, 1, 0],
    position: object.localToWorld(new Vector3(...local)).toArray(),
    localPosition: local,
    nativeEvent: {},
    stopPropagation() {},
  } as CabinetEvent
}
function context(node = catalog): PlacementContext {
  return {
    asset: node.asset,
    draftItem: { ...node },
    levelId: level.id,
    gridPosition: new Vector3(...node.position),
    currentCursorRotationY: 0,
    state: getInitialState(node),
  }
}
function enterCatalog(run: Cabinet, local: [number, number, number] = [0, 0.85, 0]) {
  const ctx = context()
  const result = itemSurfaceStrategy.enter(ctx, hit(run, local))!
  expect(result).not.toBeNull()
  Object.assign(ctx.state, result.stateUpdate)
  Object.assign(ctx.draftItem!, result.nodeUpdate)
  ctx.gridPosition.set(...result.gridPosition)
  useScene.getState().updateNode(catalog.id, result.nodeUpdate)
  return ctx
}

test('both assets slide freely across modules in one span with mode-driven grid snapping', () => {
  const run = fixture()
  const ctx = enterCatalog(run, [-0.63, 0.85, 0])
  const session = createRegistryItemSurfaceMove(design)!
  for (const x of [-0.61, -0.14, 0.47]) {
    const moved = itemSurfaceStrategy.move(ctx, hit(run, [x, 0.85, 0]))!
    expect(moved.gridPosition[0]).toBeCloseTo(x)
    expect(session.enter(hit(run, [x, 0.85, 0]), dimensions, 0)).not.toBeNull()
    const q = queryProceduralItem(
      useScene.getState().nodes[design.id] as ProceduralItemNode,
      useScene.getState().nodes,
    )
    expect(q.levelBounds.min[1]).toBeCloseTo(1.45)
  }
  useEditor.getState().setSnappingMode('item', 'grid')
  useEditor.setState({ gridSnapStep: 0.1 })
  const snapped = itemSurfaceStrategy.move(ctx, hit(run, [0.137, 0.85, 0]))!
  expect(snapped.gridPosition[0]).toBeCloseTo(0.1)
  expect(session.enter(hit(run, [0.137, 0.85, 0]), dimensions, 0)).not.toBeNull()
})
test('catalog commit accepts rotated overhang while its centre stays on the counter', () => {
  const run = fixture()
  const ctx = enterCatalog(run)
  ctx.gridPosition.set(0, 0.85, 0.25)
  ctx.draftItem!.rotation = [0, Math.PI / 4, 0]
  expect(validCatalogCounterPose(ctx)).toBe(true)
  expect(itemSurfaceStrategy.click(ctx, hit(run))).not.toBeNull()
})
test('procedural parameter changes and rotation allow overhang with a supported centre', () => {
  const run = fixture()
  const wide = { ...design, parameters: { width: 1.8 } }
  useScene.getState().updateNode(design.id, wide)
  expect(
    createRegistryItemSurfaceMove(wide)!.enter(hit(run), [1.8, 0.2, 0.2], Math.PI / 2),
  ).not.toBeNull()
})
test.each(['wall', 'tall'] as const)('%s run refuses both movers', (runTier) => {
  const run = fixture({ runTier })
  expect(itemSurfaceStrategy.enter(context(), hit(run))).toBeNull()
  expect(createRegistryItemSurfaceMove(design)!.enter(hit(run), dimensions, 0)).toBeNull()
})
test('empty run refuses both movers', () => {
  const run = fixture({}, [])
  expect(itemSurfaceStrategy.enter(context(), hit(run))).toBeNull()
  expect(createRegistryItemSurfaceMove(design)!.enter(hit(run), dimensions, 0)).toBeNull()
})
test('sink opening rejects both drops and does not keep a ray stuck to the cabinet volume', () => {
  const module = CabinetModuleNode.parse({
    width: 1.2,
    depth: 0.6,
    position: [0, 0.1, 0],
    stack: [{ id: 'sink', type: 'sink', height: 0.72 }],
  })
  const run = fixture({}, [module])
  const surfaces = getSurfaceProvider(run).surfaces!(run, { scene: createSceneApi(useScene) })
  expect(surfaces[0]!.region!.holes!.length).toBeGreaterThan(0)
  expect(itemSurfaceStrategy.enter(context(), hit(run))).toBeNull()
  expect(createRegistryItemSurfaceMove(design)!.enter(hit(run), dimensions, 0)).toBeNull()
  const camera = new PerspectiveCamera()
  const point = new Vector3(...hit(run).position)
  camera.position.copy(point).add(new Vector3(0, 4, 0))
  camera.updateMatrixWorld()
  expect(createShelfStickiness()(run.id, camera, point.toArray())).toBe(false)
})
test('bar ledge and island back overhang are reachable at their distinct heights', () => {
  const run = fixture({
    withFinishedBack: true,
    countertopBackOverhang: 0.3,
    barLedge: { edge: 'back', height: 1.2, depth: 0.3 },
  })
  const surfaces = getSurfaceProvider(run).surfaces!(run, { scene: createSceneApi(useScene) })
  for (const surface of surfaces) {
    const [x, z] = surface.region!.center!
    const local: [number, number, number] = [x, surface.position[1], z]
    expect(itemSurfaceStrategy.enter(context(), hit(run, local))!.gridPosition[1]).toBeCloseTo(
      surface.position[1],
    )
    expect(
      createRegistryItemSurfaceMove(design)!.enter(hit(run, local), dimensions, 0),
    ).not.toBeNull()
  }
  const island = fixture({ withFinishedBack: true, countertopBackOverhang: 0.3 })
  expect(itemSurfaceStrategy.enter(context(), hit(island, [0, 0.85, -0.45]))).not.toBeNull()
})
test('rotated corner leg owns its child, inherits slab lift once, and carries it when the ancestor moves', () => {
  const run = fixture()
  const leg = fixture({ parentId: run.id, position: [1, 0, 0], rotation: Math.PI / 2 })
  enterCatalog(leg)
  createRegistryItemSurfaceMove(design)!.enter(hit(leg), dimensions, 0)
  const child = useScene.getState().nodes[design.id] as ProceduralItemNode
  expect(child.parentId).toBe(leg.id)
  expect(child.supportSlabId).toBeUndefined()
  expect(
    getFloorPlacedElevation({
      node: child,
      nodes: useScene.getState().nodes,
      position: child.position,
    }),
  ).toBe(0)
  const before = nodeLevelFrame(child.id, useScene.getState().nodes)
  useScene.getState().updateNode(run.id, { position: [4, 0.1, 3] })
  const after = nodeLevelFrame(child.id, useScene.getState().nodes)
  expect(after.position[0] - before.position[0]).toBeCloseTo(2)
  expect(after.position[1]).toBeCloseTo(before.position[1])
  const geometry = buildItemFloorplan(useScene.getState().nodes[catalog.id] as ItemNode, {
    resolve: (id) => useScene.getState().nodes[id],
    children: [],
    siblings: [],
    parent: leg,
  })!
  expect(geometry.kind).toBe('group')
  if (geometry.kind === 'group' && geometry.children[0]?.kind === 'polygon') {
    const points = geometry.children[0].points
    const frame = nodeLevelFrame(catalog.id, useScene.getState().nodes)
    expect(points.reduce((sum, p) => sum + p[0], 0) / 4).toBeCloseTo(frame.position[0])
    expect(points.reduce((sum, p) => sum + p[1], 0) / 4).toBeCloseTo(frame.position[2])
  }
})
test('detaching restores floor support and cancel restores the original parent and support stamp', () => {
  const run = fixture()
  const session = createRegistryItemSurfaceMove(design)!
  const pose = session.enter(hit(run), dimensions, 0)!
  const detached = session.detach([2, 0, 3], pose.rotationY)!
  expect(detached.position[1]).toBe(0)
  expect(
    resolveSupportSlabPatch(useScene.getState().nodes[design.id]!, useScene.getState().nodes, {
      pinSupport: true,
    }),
  ).toMatchObject({ supportSlabId: slab.id })
  session.restore()
  expect(useScene.getState().nodes[design.id]).toMatchObject({
    parentId: level.id,
    supportSlabId: slab.id,
  })
})
test.each([
  'cabinet',
  'shelf',
] as const)('2D retains contained catalog and procedural children on their current %s surface', (kind) => {
  const run = fixture()
  const shelf = ShelfNode.parse({ parentId: level.id, width: 2, depth: 1, height: 2 })
  if (kind === 'shelf') useScene.getState().createNode(shelf, level.id)
  const host = kind === 'cabinet' ? run : shelf
  const y = getSurfaceProvider(host).surfaces!(host, { scene: createSceneApi(useScene) })[0]!
    .position[1]
  for (const child of [catalog, design]) {
    const position: [number, number, number] =
      child.type === 'item' ? [0, y, 0] : [-0.1, y - 0.2, -0.1]
    useScene
      .getState()
      .updateNode(child.id, { parentId: host.id, position, supportSlabId: undefined })
    const node = useScene.getState().nodes[child.id]!
    const session =
      child.type === 'item'
        ? itemFloorplanMoveTarget({
            node: node as ItemNode,
            nodes: useScene.getState().nodes,
            sceneApi: createSceneApi(useScene),
          })!
        : proceduralFloorplanMoveTarget({
            node: node as ProceduralItemNode,
            nodes: useScene.getState().nodes,
            sceneApi: createSceneApi(useScene),
          })!
    session.apply({ planPoint: [2, 3], modifiers } as never)
    session.apply({ planPoint: [2.1, 3], modifiers } as never)
    expect(useLiveNodeOverrides.getState().overrides.get(child.id)).toMatchObject({
      parentId: host.id,
      supportSlabId: undefined,
    })
    session.commit!()
    expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
  }
})
test('attaching and live-moving hosted assets leaves the actual countertop geometry object intact', async () => {
  const run = fixture()
  const object = sceneRegistry.nodes.get(run.id)!
  const signature = cabinetRunNeighborSignature(run)
  const renderer = await create(<GeometrySystem />)
  try {
    useScene.getState().markDirty(run.id)
    await renderer.advanceFrames(1, 0.016)
    const counter = object.children.find((child) => child.name === 'cabinet-run-countertop')!
    expect(counter).toBeDefined()
    for (const child of [catalog, design]) {
      useScene.getState().updateNode(child.id, { parentId: run.id, position: [0, 0.85, 0] })
      useLiveNodeOverrides.getState().set(child.id, { position: [0.1, 0.85, 0] })
      useScene.getState().markDirty(run.id)
      await renderer.advanceFrames(1, 0.016)
      expect(object.children.find((child) => child.name === 'cabinet-run-countertop')).toBe(counter)
      expect(cabinetRunNeighborSignature(useScene.getState().nodes[run.id] as Cabinet)).toBe(
        signature,
      )
      expect(
        cabinetTreeChildIds(useScene.getState().nodes[run.id]!, useScene.getState().nodes),
      ).toContain(child.id)
    }
    useLiveNodeOverrides.getState().set(run.children[0]!, { width: 0.8 })
    useScene.getState().markDirty(run.id)
    await renderer.advanceFrames(1, 0.016)
    expect(object.children.find((child) => child.name === 'cabinet-run-countertop')).not.toBe(
      counter,
    )
  } finally {
    await renderer.unmount()
  }
})
test('mounted procedural mover receives cabinet events and commits one hosted drop', async () => {
  const run = fixture()
  const renderer = await create(<MoveRegistryNodeTool node={design} />)
  try {
    await act(async () => emitter.emit('cabinet:move', hit(run)))
    expect(useScene.getState().nodes[design.id]!.parentId).toBe(run.id)
    await act(async () => emitter.emit('cabinet:click', hit(run)))
    expect(useScene.getState().nodes[design.id]!.parentId).toBe(run.id)
  } finally {
    await renderer.unmount()
  }
})

test('run inspector height changes carry both children atomically and reject a disappearing support', async () => {
  const { updateCabinetRun } = await import('../run-panel')
  const run = fixture()
  enterCatalog(run)
  createRegistryItemSurfaceMove(design)!.enter(hit(run), dimensions, 0)
  const beforeCatalog = useScene.getState().nodes[catalog.id] as ItemNode
  const beforeDesign = useScene.getState().nodes[design.id] as ProceduralItemNode
  const modules = run.children.map(
    (id) => useScene.getState().nodes[id as AnyNodeId] as CabinetModuleNode,
  )
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  updateCabinetRun({ node: run, modules, patch: { carcassHeight: 0.92 } })
  expect(
    (useScene.getState().nodes[catalog.id] as ItemNode).position[1] - beforeCatalog.position[1],
  ).toBeCloseTo(0.2)
  expect(
    (useScene.getState().nodes[design.id] as ProceduralItemNode).position[1] -
      beforeDesign.position[1],
  ).toBeCloseTo(0.2)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[catalog.id]).toEqual(beforeCatalog)
  expect(useScene.getState().nodes[design.id]).toEqual(beforeDesign)
  const before = useScene.getState().nodes
  updateCabinetRun({ node: run, modules, patch: { withCountertop: false } })
  expect(useScene.getState().nodes).toBe(before)
})

test('resize handle previews carry child heights and can be cancelled without a scene write', async () => {
  const { createLinearResizeDragBinding } = await import(
    '../../../../editor/src/components/editor/handles/linear-resize-drag'
  )
  const run = fixture()
  enterCatalog(run)
  createRegistryItemSurfaceMove(design)!.enter(hit(run), dimensions, 0)
  const module = useScene.getState().nodes[run.children[0] as AnyNodeId] as CabinetModuleNode
  const handles = (cabinetModuleDefinition.handles as Function)(module, createSceneApi(useScene))
  const height = handles.find((h: { axis: string }) => h.axis === 'y')
  const binding = createLinearResizeDragBinding({
    descriptor: height,
    initialNode: module,
    nodeId: module.id,
    sceneApi: createSceneApi(useScene),
    initialModifiers: { altKey: false },
  })
  const before = useScene.getState().nodes
  binding.apply(0.92, { altKey: false })
  expect(
    (useLiveNodeOverrides.getState().overrides.get(catalog.id)?.position as number[])[1],
  ).toBeCloseTo(1.05)
  expect(useLiveNodeOverrides.getState().overrides.has(design.id)).toBe(true)
  binding.clearPreview()
  expect(useScene.getState().nodes).toBe(before)
  expect(useLiveNodeOverrides.getState().overrides.has(design.id)).toBe(false)
})

test('moving a run re-marks both hosted children after dirty work drains on successive ticks', async () => {
  const run = fixture()
  enterCatalog(run)
  createRegistryItemSurfaceMove(design)!.enter(hit(run), dimensions, 0)
  const host = useScene.getState().nodes[run.id]!
  const renderer = await create(<MoveRegistryNodeTool node={host} />)
  try {
    for (const x of [4, 5]) {
      useScene.getState().dirtyNodes.clear()
      await act(async () =>
        emitter.emit('grid:move', {
          position: [x, 0, 4],
          localPosition: [x, 0, 4],
          nativeEvent: {},
        } as never),
      )
      expect(useScene.getState().dirtyNodes.has(catalog.id)).toBe(true)
      expect(useScene.getState().dirtyNodes.has(design.id)).toBe(true)
    }
  } finally {
    await renderer.unmount()
  }
})

test('duplicate and delete carry the complete nested cabinet subtree, including both asset kinds', () => {
  const run = fixture()
  const leg = fixture({ parentId: run.id, position: [1, 0, 0], rotation: Math.PI / 2 })
  enterCatalog(leg)
  createRegistryItemSurfaceMove(design)!.enter(hit(leg), dimensions, 0)
  const scene = createSceneApi(useScene)
  const subtree = scene.getSubtree(run.id)!
  expect(subtree.descendants.map((node) => node.id)).toContain(catalog.id)
  expect(subtree.descendants.map((node) => node.id)).toContain(design.id)
  const clonedId = scene.cloneNodesInto([subtree.root, ...subtree.descendants], {
    rootId: run.id,
    parentId: level.id,
  })!
  const cloned = scene.getSubtree(clonedId)!
  expect(cloned.descendants.map((node) => node.type).sort()).toEqual(
    subtree.descendants.map((node) => node.type).sort(),
  )
  for (const child of cloned.descendants.filter(
    (node) => node.type === 'item' || node.type === 'procedural-item',
  )) {
    expect(child.parentId).not.toBe(leg.id)
    expect(useScene.getState().nodes[child.parentId as AnyNodeId]?.type).toBe('cabinet')
  }
  useScene.getState().deleteNodes([run.id])
  for (const child of [subtree.root, ...subtree.descendants])
    expect(useScene.getState().nodes[child.id]).toBeUndefined()
  expect(useScene.getState().nodes[clonedId]).toBeDefined()
})

test('deleting the last structural module removes its empty run and hosted assets', () => {
  const run = fixture({}, [CabinetModuleNode.parse({ width: 1.2, position: [0, 0.1, 0] })])
  enterCatalog(run)
  createRegistryItemSurfaceMove(design)!.enter(hit(run), dimensions, 0)
  useScene.getState().deleteNodes([run.children[0] as AnyNodeId])
  expect(useScene.getState().nodes[run.id]).toBeUndefined()
  expect(useScene.getState().nodes[catalog.id]).toBeUndefined()
  expect(useScene.getState().nodes[design.id]).toBeUndefined()
})

test('an off-origin design can retain a bar in 2D even when its origin lies outside the slab and below the main counter', () => {
  const run = fixture({ barLedge: { edge: 'back', height: 1.2, depth: 0.4 } })
  const offOrigin = structuredClone(recipe)
  offOrigin.parts[0]!.shapes[0]!.position = [0.1, 1.5, 0.5]
  const node = { ...design, recipe: offOrigin }
  useScene.getState().updateNode(design.id, node)
  const bar = getSurfaceProvider(run).surfaces!(run, { scene: createSceneApi(useScene) }).find(
    (surface) => surface.label === 'Bar ledge',
  )!
  const [x, z] = bar.region!.center!
  const session = createRegistryItemSurfaceMove(node)!
  expect(session.enter(hit(run, [x, bar.position[1], z]), dimensions, 0)).not.toBeNull()
  const hosted = useScene.getState().nodes[design.id] as ProceduralItemNode
  expect(hosted.position[1]).toBeLessThan(0)
  expect(session.rotate(hosted.rotation[1])).not.toBeNull()
  expect(session.valid).toBe(true)
  const plan = proceduralFloorplanMoveTarget({
    node: hosted,
    nodes: useScene.getState().nodes,
    sceneApi: createSceneApi(useScene),
  })!
  plan.apply({ planPoint: [0, 0], modifiers } as never)
  plan.apply({ planPoint: [0.03, 0], modifiers } as never)
  expect(useLiveNodeOverrides.getState().overrides.get(design.id)).toMatchObject({
    parentId: run.id,
  })
})
