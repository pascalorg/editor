import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNodeId,
  createSceneApi,
  emitter,
  type GridEvent,
  getFloorPlacedElevation,
  getSurfaceProvider,
  type ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  resolveSupportSlabPatch,
  type ShelfEvent,
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
  ProceduralItemNode,
  queryProceduralItem,
  type Recipe,
  radiatorRecipe,
} from '@pascal-app/core/procedural-items'
import { useViewer } from '@pascal-app/viewer'
import { reconciler } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { StrictMode, useEffect } from 'react'
import { Group, PerspectiveCamera, Vector3 } from 'three'
import { useHandleDrag } from '../../../editor/src/components/editor/handles/use-handle-drag'
import { createRegistryItemSurfaceMove } from '../../../editor/src/components/tools/registry/item-surface-move'
import { MoveRegistryNodeTool } from '../../../editor/src/components/tools/registry/move-registry-node-tool'
import { clearBoxSelectHandled } from '../../../editor/src/components/tools/select/box-select-state'
import { createShelfStickiness } from '../../../editor/src/components/tools/shared/shelf-stickiness'
import { commitFreshPlacementSubtree } from '../../../editor/src/lib/fresh-planar-placement'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { FloorElevationSystem } from '../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { itemFloorplanMoveTarget } from '../item/floorplan-move'
import { shelfDefinition } from '../shelf/definition'
import { shelfResizeAffordance } from '../shelf/floorplan-affordances'
import { shelfFloorplanMoveTarget } from '../shelf/floorplan-move'
import { proceduralItemDefinition } from './definition'
import { proceduralFloorplanMoveTarget } from './move-session'
import ProceduralRenderer from './renderer'

const recipe: Recipe = {
  version: 1,
  name: 'Offset box',
  description: 'Shelf contact fixture',
  constraints: [],
  parameters: [
    { id: 'width', label: 'Width', default: 0.4, min: 0.1, max: 1, step: 0.1, unit: 'm' },
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
          size: ['width', 0.3, 0.2],
          position: [0.3, 0.35, -0.2],
          slot: 'body',
        },
      ],
    },
  ],
  surfaces: [],
}
const level = LevelNode.parse({ id: 'level_slice-c' })
const slab = SlabNode.parse({
  id: 'slab_slice-c',
  parentId: level.id,
  elevation: 0.6,
  polygon: [
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ],
})
const shelf = ShelfNode.parse({
  id: 'shelf_slice-c',
  parentId: level.id,
  width: 2,
  depth: 1,
  height: 2,
  rows: 3,
  position: [2, 0.1, 3],
  rotation: [0, 0.6, 0],
  supportSlabId: slab.id,
})
const original = ProceduralItemNode.parse({
  id: 'procedural-item_slice-c',
  parentId: level.id,
  recipe,
  position: [-2, 0, 0],
  rotation: [0, 0.2, 0],
  supportSlabId: slab.id,
})
const dimensions = evaluateRecipe(original.recipe, original.parameters).dimensions
const modifiers = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }
let restore: () => void
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
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  globalThis.window = new EventTarget() as unknown as Window & typeof globalThis
  globalThis.document = { body: { style: { cursor: '' } } } as unknown as Document
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerNode(proceduralItemDefinition)
  registerNode(shelfDefinition)
  useScene.setState({
    nodes: {
      [level.id]: { ...level, children: [shelf.id, slab.id, original.id] },
      [shelf.id]: shelf,
      [slab.id]: slab,
      [original.id]: original,
    },
    rootNodeIds: [level.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  spatialGridManager.clear()
  spatialGridManager.handleNodeCreated(slab, level.id)
  useScene.temporal.getState().clear()
  useScene.temporal.getState().pause()
  useInteractionScope.getState().end()
  useEditor.setState({
    mode: 'build',
    tool: 'item',
    movingNodeOrigin: '3d',
    placementDragMode: false,
  })
  useEditor.getState().setMovingNode(original)
  useEditor.getState().setSnappingMode('item', 'off')
  useViewer.setState({
    selection: { buildingId: null, levelId: level.id, zoneId: null, selectedIds: [] },
  })
  const levelMesh = new Group()
  levelMesh.position.set(10, 3, 20)
  levelMesh.rotation.y = 0.4
  const hostMesh = new Group()
  hostMesh.position.set(shelf.position[0], shelf.position[1] + slab.elevation, shelf.position[2])
  hostMesh.rotation.set(...shelf.rotation)
  levelMesh.add(hostMesh)
  levelMesh.updateMatrixWorld(true)
  sceneRegistry.nodes.set(level.id, levelMesh)
  sceneRegistry.nodes.set(shelf.id, hostMesh)
})

afterEach(() => {
  clearBoxSelectHandled()
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  spatialGridManager.clear()
  for (const id of [level.id, shelf.id, original.id]) sceneRegistry.nodes.delete(id)
  useScene.setState(savedScene, true)
  useEditor.setState(savedEditor, true)
  useViewer.setState(savedViewer, true)
  useInteractionScope.setState(savedScope, true)
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  restore()
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  globalThis.document = savedDocument
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancelRaf
})

function hit(
  local: [number, number, number] = [0.2, 1, 0.1],
  normal: [number, number, number] = [0, 1, 0],
): ShelfEvent {
  const object = sceneRegistry.nodes.get(shelf.id)!
  return {
    node: shelf,
    object,
    normal,
    position: object.localToWorld(new Vector3(...local)).toArray(),
    localPosition: local,
    nativeEvent: {},
    stopPropagation() {},
  } as ShelfEvent
}
function rows() {
  return getSurfaceProvider(shelf).surfaces!(shelf, { scene: createSceneApi(useScene) }).map(
    (s) => s.position[1],
  )
}
function live() {
  return useScene.getState().nodes[original.id] as ProceduralItemNode
}
function expectOnBoard(row: number) {
  const q = queryProceduralItem(live(), useScene.getState().nodes)
  expect(q.levelBounds.min[1]).toBeCloseTo(slab.elevation + shelf.position[1] + row)
  expect(live().supportSlabId).toBeUndefined()
  expect(
    getFloorPlacedElevation({
      node: live(),
      nodes: useScene.getState().nodes,
      position: live().position,
    }),
  ).toBe(0)
}

test('enters the nearest declared row with offset bounds, shelf-local yaw and one slab lift; moves across rows and side faces', () => {
  const session = createRegistryItemSurfaceMove(original)!
  const boardYs = rows()
  let pose = session.enter(hit([0.2, boardYs[1]! + 0.01, 0.1]), dimensions, original.rotation[1])!
  expect(session.hosted).toBe(true)
  expect(live().parentId).toBe(shelf.id)
  expect(live().rotation[1]).toBeCloseTo(-0.4)
  expectOnBoard(boardYs[1]!)
  const center = new Vector3(0.3, 0, -0.2).applyAxisAngle(new Vector3(0, 1, 0), -0.4)
  expect(pose.position[0] + center.x).toBeCloseTo(0.2)
  expect(pose.position[2] + center.z).toBeCloseTo(0.1)
  pose = session.enter(hit([-0.3, boardYs[2]!, 0.2], [1, 0, 0]), dimensions, pose.rotationY)!
  expectOnBoard(boardYs[2]!)
  const plan = session.planPose(pose.position, pose.rotationY)
  const query = queryProceduralItem(live(), useScene.getState().nodes)
  plan.position.forEach((v, i) => {
    expect(v).toBeCloseTo(query.frame.position[i]!)
  })
  expect(plan.rotationY).toBeCloseTo(original.rotation[1])
})

test('entry rejects side normals; oversized children accept until their centre leaves the shelf', () => {
  const session = createRegistryItemSurfaceMove(original)!
  expect(session.enter(hit([0, 1, 0], [1, 0, 0]), dimensions, 0.2)).toBeNull()
  expect(session.enter(hit(), [2.1, 0.3, 0.2], 0.2)).not.toBeNull()
  expect(session.enter(hit(), [0.4, 0.3, 1.1], 0.2)).not.toBeNull()
  const pose = session.enter(hit(), dimensions, 0.2)!
  expect(session.enter(hit([1.2, 1, 0]), [2.1, 0.3, 0.2], pose.rotationY)).toBeNull()
})

test('shelf snapping follows the active XZ grid for the non-centred footprint', () => {
  useEditor.getState().setSnappingMode('item', 'grid')
  useEditor.setState({ gridSnapStep: 0.1 })
  const session = createRegistryItemSurfaceMove(original)!
  const pose = session.enter(hit([0.23, 1, 0.13]), dimensions, 0.2)!
  const center = new Vector3(0.3, 0, -0.2).applyAxisAngle(new Vector3(0, 1, 0), pose.rotationY)
  expect(pose.position[0] + center.x).toBeCloseTo(0.2)
  expect(pose.position[2] + center.z).toBeCloseTo(0.1)
})

test('existing shelf grab, rotation, detach and cancel preserve their frames and support', () => {
  const entry = createRegistryItemSurfaceMove(original)!
  const first = entry.enter(hit(), dimensions, 0.2)!
  const hosted = live()
  const session = createRegistryItemSurfaceMove(hosted)!
  const grabbed = session.enter(hit([0.8, 1, -0.2]), dimensions, first.rotationY)!
  grabbed.position.forEach((v, i) => {
    expect(v).toBeCloseTo(first.position[i]!)
  })
  const rotated = session.rotate(first.rotationY + Math.PI / 4)!
  expect(rotated.position).toEqual(grabbed.position)
  const floorPoint = sceneRegistry.nodes
    .get(level.id)!
    .localToWorld(new Vector3(6, 0, 7))
    .toArray()
  const detached = session.detach(floorPoint, rotated.rotationY)!
  expect(detached.position[0]).toBeCloseTo(6)
  expect(detached.position[1]).toBe(0)
  expect(detached.rotationY).toBeCloseTo(0.2 + Math.PI / 4)
  expect(resolveSupportSlabPatch(live(), useScene.getState().nodes, { pinSupport: true })).toEqual({
    supportSlabId: slab.id,
  })
  session.restore()
  expect(live()).toEqual(hosted)
  entry.restore()
  expect(live()).toEqual(original)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('shared volume stickiness keeps board-gap leaves and unmatched grid hits hosted until the ray misses', () => {
  const session = createRegistryItemSurfaceMove(original)!
  const pose = session.enter(hit(), dimensions, 0.2)!
  const mesh = sceneRegistry.nodes.get(shelf.id)!
  const camera = new PerspectiveCamera()
  camera.position.copy(mesh.localToWorld(new Vector3(0, 3, 5)))
  const behind = mesh.localToWorld(new Vector3(0, 0, -4)).toArray()
  const outside = mesh.localToWorld(new Vector3(10, 0, -4)).toArray()
  const sticky = createShelfStickiness()
  expect(sticky(shelf.id, camera, behind)).toBe(true)
  expect(sticky(shelf.id, camera, outside)).toBe(false)
  expect(session.leave(hit(), pose.rotationY)).toBeNull()
  const grid = { position: behind, nativeEvent: {} } as GridEvent
  expect(session.blocksGrid(grid, camera)).toBe(true)
  expect(session.blocksGrid({ ...grid, position: outside }, camera)).toBe(false)
  session.detach(outside, pose.rotationY)
  expect(session.hosted).toBe(false)
})

test.each(['wall', 'ceiling'])('%s mounted recipes never create the surface session', (kind) => {
  const mounted = ProceduralItemNode.parse({
    ...original,
    recipe:
      kind === 'wall'
        ? radiatorRecipe
        : {
            ...recipe,
            mounting: { attachTo: 'ceiling', reference: 'top' },
            surfaces: [{ id: 'top', label: 'Top', position: [0, 0.5, 0], size: [0.4, 0.2] }],
          },
  })
  expect(createRegistryItemSurfaceMove(mounted)).toBeNull()
})

test('one undo restores the floor parent and redo restores shelf parenting; attaching never changes shelf geometry key', () => {
  const key = shelfDefinition.geometryKey!(shelf)
  const session = createRegistryItemSurfaceMove(original)!
  session.enter(hit(), dimensions, 0.2)
  const final = live()
  expect(shelfDefinition.geometryKey!(useScene.getState().nodes[shelf.id] as ShelfNode)).toBe(key)
  session.restore()
  useScene.temporal.getState().resume()
  useScene.getState().updateNode(original.id, {
    ...final,
    ...resolveSupportSlabPatch(final, useScene.getState().nodes),
  })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(live()).toEqual(original)
  useScene.temporal.getState().redo()
  expect(live()).toEqual(final)
})

test('fresh placement survives replay cleanup, commits once on the shelf and undo removes it', () => {
  const draft = { ...original, metadata: { isNew: true }, visible: false }
  useScene.getState().updateNode(original.id, draft)
  const session = createRegistryItemSurfaceMove(draft)!
  session.enter(hit(), dimensions, 0.2)
  session.restore()
  expect(live()).toEqual(draft)
  session.enter(hit(), dimensions, 0.2)
  const id = commitFreshPlacementSubtree(original.id, { visible: true })!
  expect(useScene.getState().nodes[id]?.parentId).toBe(shelf.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[id]).toBeUndefined()
  expect(useScene.getState().nodes[original.id]).toBeUndefined()
})

test('2D renders a shelf-hosted design and delegates dragging to the same detach path as catalog items', () => {
  createRegistryItemSurfaceMove(original)!.enter(hit(), dimensions, 0.2)
  const node = live()
  const nodes = useScene.getState().nodes
  const bounds = queryProceduralItem(node, nodes).levelBounds
  const geometry = proceduralItemDefinition.floorplan!(node, {
    resolve: (id: AnyNodeId) => nodes[id],
    children: [],
    siblings: [],
    parent: nodes[shelf.id],
  } as never)
  expect(geometry).toMatchObject({
    kind: 'rect',
    x: bounds.min[0],
    y: bounds.min[2],
    width: bounds.dimensions[0],
    height: bounds.dimensions[2],
  })
  const sceneApi = createSceneApi(useScene)
  const procedural = proceduralFloorplanMoveTarget({ node, nodes, sceneApi })!
  const facade = { ...node, asset: { dimensions }, scale: [1, 1, 1] } as unknown as ItemNode
  const catalog = itemFloorplanMoveTarget({ node: facade, nodes, sceneApi })!
  for (const session of [procedural, catalog]) {
    session.apply({ planPoint: [2, 3], modifiers } as never)
    session.apply({ planPoint: [4, 5], modifiers } as never)
  }
  const catalogPatch = useLiveNodeOverrides.getState().overrides.get(node.id)
  useLiveNodeOverrides.getState().clear(node.id)
  procedural.apply({ planPoint: [4, 5], modifiers } as never)
  expect(useLiveNodeOverrides.getState().overrides.get(node.id)).toEqual(catalogPatch)
  expect(catalogPatch).toMatchObject({
    parentId: level.id,
    position: [expect.any(Number), 0, expect.any(Number)],
  })
})

function key(key: string) {
  window.dispatchEvent(Object.assign(new Event('keydown'), { key, preventDefault() {} }))
}

test('mounted registry tool routes shelf events, flushes grid arbitration on click and survives actual Strict Mode replay', async () => {
  let setups = 0
  function Probe() {
    useEffect(() => {
      setups += 1
    }, [])
    return <MoveRegistryNodeTool node={original} />
  }
  const createContainer = reconciler.createContainer
  // R3F hardcodes a non-strict root; React only replays passive effects for a strict root.
  const strictRoot = spyOn(reconciler, 'createContainer').mockImplementation((...args) => {
    args[3] = true
    return createContainer(...args)
  })
  let renderer: Awaited<ReturnType<typeof create>>
  try {
    renderer = await create(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )
  } finally {
    strictRoot.mockRestore()
  }
  try {
    expect(setups).toBe(2)
    const event = hit()
    const native = {}
    event.nativeEvent = { nativeEvent: native } as ShelfEvent['nativeEvent']
    await act(async () => {
      emitter.emit('grid:move', {
        position: event.position,
        localPosition: [2, 0, 3],
        nativeEvent: native,
      } as GridEvent)
      emitter.emit('shelf:enter', event)
      emitter.emit('shelf:click', event)
    })
    expect(live().parentId).toBe(shelf.id)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const committed = live()
    await renderer.unmount()
    expect(live()).toEqual(committed)
    useScene.temporal.getState().undo()
    expect(live()).toEqual(original)
  } finally {
    await renderer.unmount()
  }
})

test('mounted tool row movement and rotation cancel back to the original floor placement', async () => {
  const renderer = await create(<MoveRegistryNodeTool node={original} />)
  try {
    await act(async () => emitter.emit('shelf:move', hit()))
    const board = rows().at(-1)!
    await act(async () => emitter.emit('shelf:move', hit([0, board, 0], [1, 0, 0])))
    expectOnBoard(board)
    const yaw = live().rotation[1]
    await act(async () => key('r'))
    expect(live().rotation[1]).toBeCloseTo(yaw + Math.PI / 4)
    await act(async () => emitter.emit('shelf:leave', hit()))
    expect(live().parentId).toBe(shelf.id)
    await act(async () => emitter.emit('tool:cancel'))
    expect(live()).toEqual(original)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    await renderer.unmount()
  }
})

test('shelf move and 2D resize re-mark the hosted child after dirty work drains', async () => {
  createRegistryItemSurfaceMove(original)!.enter(hit(), dimensions, 0.2)
  const host = useScene.getState().nodes[shelf.id] as ShelfNode
  const renderer = await create(<MoveRegistryNodeTool node={host} />)
  try {
    for (const x of [4, 5]) {
      useScene.getState().dirtyNodes.clear()
      await act(async () =>
        emitter.emit('grid:move', {
          position: [x, 0, 4],
          localPosition: [x, 0, 4],
          nativeEvent: {},
        } as GridEvent),
      )
      expect(useScene.getState().dirtyNodes.has(original.id)).toBe(true)
    }
  } finally {
    await renderer.unmount()
  }
  const nodes = useScene.getState().nodes
  const move = shelfFloorplanMoveTarget({ node: host, nodes, sceneApi: createSceneApi(useScene) })!
  const resize = shelfResizeAffordance.start({
    node: host,
    payload: { dim: 'width', planAxis: [1, 0] },
    initialPlanPoint: [2, 3],
  } as never)!
  for (const session of [move, resize]) {
    for (const x of [4, 5]) {
      useScene.getState().dirtyNodes.clear()
      session.apply({ planPoint: [x, 4], modifiers } as never)
      expect(useScene.getState().dirtyNodes.has(original.id)).toBe(true)
    }
  }
})

test('3D resize handle cascades each tick and cancel restores dirty descendants', async () => {
  createRegistryItemSurfaceMove(original)!.enter(hit(), dimensions, 0.2)
  const host = useScene.getState().nodes[shelf.id]!
  let begin: ReturnType<typeof useHandleDrag>
  function Handle() {
    begin = useHandleDrag({
      kind: 'drag',
      cursor: 'ew-resize',
      node: host,
      rideObject: sceneRegistry.nodes.get(shelf.id)!,
      handleIndex: 0,
      setIsDragging() {},
      dragControls: { onStart() {}, onEnd() {} },
      onStart: () => ({ move: (ctx) => ({ width: 2 + ctx.event.clientX }) }),
    })
    return null
  }
  const renderer = await create(<Handle />)
  try {
    await act(async () =>
      begin!({
        button: 0,
        stopPropagation() {},
        nativeEvent: { altKey: false, pointerId: 1 },
      } as never),
    )
    for (const x of [1, 2]) {
      useScene.getState().dirtyNodes.clear()
      await act(async () =>
        window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: x })),
      )
      expect(useScene.getState().dirtyNodes.has(original.id)).toBe(true)
    }
    await act(async () => key('Escape'))
    expect(useLiveNodeOverrides.getState().overrides.has(shelf.id)).toBe(false)
    expect(useScene.getState().nodes[shelf.id]).toEqual(host)
  } finally {
    await renderer.unmount()
    await new Promise((resolve) => setTimeout(resolve, 310))
  }
})

test('hosted renderer keeps local board height across remount and drains elevation dirty work', async () => {
  createRegistryItemSurfaceMove(original)!.enter(hit(), dimensions, 0.2)
  const node = live()
  for (let replay = 0; replay < 2; replay += 1) {
    const renderer = await create(
      <>
        <ProceduralRenderer node={node} />
        <FloorElevationSystem />
      </>,
    )
    try {
      await renderer.advanceFrames(1, 1 / 60)
      expect(sceneRegistry.nodes.get(node.id)!.position.y).toBeCloseTo(node.position[1])
      expect(useScene.getState().dirtyNodes.has(node.id)).toBe(false)
    } finally {
      await renderer.unmount()
    }
  }
})

test('mounted grid routing retains shelf gaps and re-elects slab elevation after a real leave', async () => {
  const levelMesh = sceneRegistry.nodes.get(level.id)!
  levelMesh.position.set(0, 0, 0)
  levelMesh.rotation.set(0, 0, 0)
  levelMesh.updateMatrixWorld(true)
  const mesh = sceneRegistry.nodes.get(shelf.id)!
  const camera = new PerspectiveCamera()
  camera.position.copy(mesh.localToWorld(new Vector3(0, 3, 5)))
  const behind = mesh.localToWorld(new Vector3(0, 0, -4)).toArray()
  const outside = mesh.localToWorld(new Vector3(4, 0, -4)).toArray()
  const renderer = await create(<MoveRegistryNodeTool node={original} />, { camera })
  try {
    await act(async () => emitter.emit('shelf:enter', hit()))
    await act(async () => {
      emitter.emit('shelf:leave', hit())
      emitter.emit('grid:move', {
        position: behind,
        localPosition: [0, 0, -4],
        nativeEvent: {},
      } as GridEvent)
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(live().parentId).toBe(shelf.id)
    await act(async () => {
      emitter.emit('grid:move', {
        position: outside,
        localPosition: [4, 0, -4],
        nativeEvent: {},
      } as GridEvent)
      emitter.emit('grid:click', {
        position: outside,
        localPosition: [4, 0, -4],
        nativeEvent: {},
      } as GridEvent)
    })
    expect(live().parentId).toBe(level.id)
    expect(
      getFloorPlacedElevation({
        node: live(),
        nodes: useScene.getState().nodes,
        position: live().position,
      }),
    ).toBeCloseTo(slab.elevation)
    expect(live().rotation[1]).toBeCloseTo(original.rotation[1])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(live()).toEqual(original)
  } finally {
    await renderer.unmount()
  }
})

test('fresh mounted placement commits via a shelf click and explicit cancel deletes a separate fresh draft', async () => {
  const draft = { ...original, metadata: { isNew: true }, visible: false }
  useScene.getState().updateNode(original.id, draft)
  const renderer = await create(<MoveRegistryNodeTool node={draft} />)
  try {
    await act(async () => {
      emitter.emit('shelf:move', hit())
      emitter.emit('shelf:click', hit())
    })
    const finalId = (useScene.getState().nodes[shelf.id] as ShelfNode).children[0]!
    expect(useScene.getState().nodes[finalId]).toMatchObject({
      type: 'procedural-item',
      parentId: shelf.id,
      visible: true,
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[finalId]).toBeUndefined()
  } finally {
    await renderer.unmount()
  }
  useScene.temporal.getState().pause()
  useScene.getState().createNode(draft, level.id)
  useEditor.getState().setMovingNode(draft)
  const cancelled = await create(<MoveRegistryNodeTool node={draft} />)
  try {
    await act(async () => emitter.emit('shelf:enter', hit()))
    await act(async () => emitter.emit('tool:cancel'))
    expect(useScene.getState().nodes[draft.id]).toBeUndefined()
    expect((useScene.getState().nodes[shelf.id] as ShelfNode).children).toEqual([])
  } finally {
    await cancelled.unmount()
  }
})
