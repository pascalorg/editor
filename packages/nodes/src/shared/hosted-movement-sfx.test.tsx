import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type CabinetNode as Cabinet,
  createSceneApi,
  emitter,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  type NodeEvent,
  nodeRegistry,
  registerNode,
  ShelfNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode, type Recipe } from '@pascal-app/core/procedural-items'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import { Children, cloneElement, isValidElement, type ReactNode, useMemo } from 'react'
import { Group, Vector3 } from 'three'
import { MoveRegistryNodeTool } from '../../../editor/src/components/tools/registry/move-registry-node-tool'
import { sfxEmitter } from '../../../editor/src/lib/sfx-bus'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { cabinetDefinition, cabinetModuleDefinition } from '../cabinet/definition'
import { CabinetModuleNode, CabinetNode } from '../cabinet/schema'
import { itemDefinition } from '../item/definition'
import { MoveItemTool } from '../item/move-tool'
import { proceduralItemDefinition } from '../procedural-item/definition'
import { shelfDefinition } from '../shelf/definition'

const recipe: Recipe = {
  version: 1,
  name: 'Movement sound fixture',
  description: 'Small surface decoration',
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
          position: [0, 0.1, 0],
          slot: 'body',
        },
      ],
    },
  ],
  surfaces: [],
}
const level = LevelNode.parse({ id: 'level_movement-sfx' })
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
  rotation: [0, 0, 0],
})
const design = ProceduralItemNode.parse({
  parentId: level.id,
  recipe,
  rotation: [0, 0, 0],
  supportSlabId: slab.id,
})
let restoreRegistry: () => void
let savedScene: ReturnType<typeof useScene.getState>
let savedEditor: ReturnType<typeof useEditor.getState>
let savedViewer: ReturnType<typeof useViewer.getState>
let savedScope: ReturnType<typeof useInteractionScope.getState>
let savedWindow: PropertyDescriptor | undefined
let savedDocument: typeof document
let savedRaf: typeof requestAnimationFrame
let savedCancelRaf: typeof cancelAnimationFrame

let ticks = 0
const onTick = () => {
  ticks++
}
beforeEach(() => {
  ticks = 0
  sfxEmitter.on('sfx:grid-snap', onTick)
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
    registerNode({ ...def, capabilities: { ...def.capabilities } } as never)
  useScene.setState({
    nodes: {
      [level.id]: { ...level, children: [slab.id, catalog.id, design.id] },
      [slab.id]: slab,
      [catalog.id]: structuredClone(catalog),
      [design.id]: structuredClone(design),
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
  useEditor.getState().setSnappingMode('item', 'grid')
  useEditor.setState({ gridSnapStep: 0.1 })
  useViewer.setState({
    selection: { buildingId: null, levelId: level.id, zoneId: null, selectedIds: [] },
  })
  sceneRegistry.nodes.set(level.id, new Group())
})
afterEach(() => {
  sfxEmitter.off('sfx:grid-snap', onTick)
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
    rotation: 0,
    withCountertop: true,
    countertopThickness: 0.03,
    children: modules.map((m) => m.id),
    supportSlabId: slab.id,
    ...patch,
  })
  useScene.getState().createNode(run, run.parentId as AnyNodeId)
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
function hit(run: AnyNode, local: [number, number, number] = [0, 0.85, 0]): NodeEvent {
  const object = sceneRegistry.nodes.get(run.id)!
  return {
    node: run,
    object,
    normal: [0, 1, 0],
    position: object.localToWorld(new Vector3(...local)).toArray(),
    localPosition: local,
    nativeEvent: {},
    stopPropagation() {},
  } as NodeEvent
}
// The mounted coordinator keeps its real cursor refs; DOM-only measurement labels need no canvas test coverage.
function withoutLabels(element: ReactNode): ReactNode {
  if (!isValidElement<{ children?: ReactNode }>(element)) return element
  if (element.type === Html) return null
  return cloneElement(element, {}, Children.map(element.props.children, withoutLabels))
}
function CatalogMover() {
  const node = useMemo(() => structuredClone(catalog), [])
  return withoutLabels(MoveItemTool({ node }))
}

type Mover = 'catalog' | 'procedural' | 'registry catalog'
async function mount(mover: Mover) {
  const child = mover === 'procedural' ? design : catalog
  useEditor.getState().setMovingNode(child)
  return create(mover === 'catalog' ? <CatalogMover /> : <MoveRegistryNodeTool node={child} />)
}
async function sendHost(
  event: NodeEvent,
  order: 'grid first' | 'host first' | 'host only',
  suffix = 'move',
) {
  const nativeEvent = {}
  event.nativeEvent = { nativeEvent } as NodeEvent['nativeEvent']
  const grid = { position: [99, 0, 99], localPosition: [99, 0, 99], nativeEvent }
  await act(async () => {
    if (order === 'grid first') emitter.emit('grid:move', grid as never)
    emitter.emit(`${event.node.type}:${suffix}` as never, event as never)
    if (order === 'host first') emitter.emit('grid:move', grid as never)
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
}
async function sendGrid(x: number) {
  await act(async () => {
    emitter.emit('grid:move', {
      position: [x, 0, 0],
      localPosition: [x, 0, 0],
      nativeEvent: {},
    } as never)
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
}
for (const mover of ['catalog', 'procedural', 'registry catalog'] as const) {
  for (const kind of [
    'item top',
    'shelf board',
    'countertop',
    'bar ledge',
    'generated surface',
  ] as const) {
    if (mover === 'catalog' && kind === 'generated surface') continue
    for (const order of ['grid first', 'host first', 'host only'] as const) {
      test(`${mover}: ${kind} ticks once per step (${order}), never for stationary enter/move`, async () => {
        const run = fixture({ barLedge: { edge: 'back', height: 1.2, depth: 0.5 } })
        const shelf = ShelfNode.parse({ parentId: level.id, width: 2, depth: 1, height: 2 })
        const table = ItemNode.parse({
          parentId: level.id,
          asset: { ...catalog.asset, dimensions: [2, 1, 2] },
        })
        const generated = ProceduralItemNode.parse({
          parentId: level.id,
          // Generated hosting currently requires the attachment selection to exist before reparenting.
          attachments: { [catalog.id]: 'top', [design.id]: 'top' },
          recipe: {
            ...recipe,
            surfaces: [{ id: 'top', label: 'Top', position: [0, 1, 0], size: [2, 2] }],
            parts: [
              {
                id: 'body',
                label: 'Body',
                count: 1,
                shapes: [
                  {
                    id: 'box',
                    primitive: 'box',
                    size: [2, 1, 2],
                    position: [0, 0.5, 0],
                    slot: 'body',
                  },
                ],
              },
            ],
          },
        })
        const host =
          kind === 'item top'
            ? table
            : kind === 'shelf board'
              ? shelf
              : kind === 'generated surface'
                ? generated
                : run
        if (host !== run) {
          useScene.getState().createNode(host, level.id)
          sceneRegistry.nodes.set(host.id, new Group())
        }
        const surface = getSurfaceProvider(host)
          .surfaces?.(host, { scene: createSceneApi(useScene) })
          .find((s) => kind !== 'bar ledge' || s.label === 'Bar ledge')
        const [x, z] = surface?.region?.center ?? [0, 0]
        const y = surface?.position[1] ?? 1
        const child = mover === 'procedural' ? design : catalog
        const renderer = await mount(mover)
        try {
          await sendHost(hit(host, [x, y, z]), order, 'enter')
          expect(ticks).toBe(0)
          expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
          for (let i = 0; i < 4; i++) {
            const event = hit(host, [x + i * 0.1, y, z])
            await sendHost(event, order)
            expect(ticks).toBe(i)
            await sendHost(event, order)
            expect(ticks).toBe(i)
          }
          await sendHost(hit(host, [x + 0.3, y, z]), 'host only', 'leave')
          expect(ticks).toBe(3)
        } finally {
          await renderer.unmount()
        }
      })
    }
  }
  test(`${mover}: floor/host transitions at the same plan position add no attachment cue`, async () => {
    const host = ItemNode.parse({
      parentId: level.id,
      asset: { ...catalog.asset, dimensions: [2, 1, 2] },
    })
    useScene.getState().createNode(host, level.id)
    sceneRegistry.nodes.set(host.id, new Group())
    const renderer = await mount(mover)
    try {
      await sendGrid(0)
      const initial = ticks
      await sendHost(hit(host, [0, 1, 0]), 'grid first', 'enter')
      expect(ticks).toBe(initial)
      await sendHost(hit(host, [0, 1, 0]), 'host only', 'leave')
      await sendGrid(0)
      expect(ticks).toBe(initial)
      await sendGrid(0.1)
      expect(ticks).toBe(initial + 1)
      await sendHost(hit(host, [0.1, 1, 0]), 'grid first', 'enter')
      expect(ticks).toBe(initial + 1)
    } finally {
      await renderer.unmount()
    }
  })
  test(`${mover}: floor retains its initial cue and one tick per changed step`, async () => {
    const renderer = await mount(mover)
    try {
      await sendGrid(0)
      const initial = mover === 'catalog' ? 0 : 1
      expect(ticks).toBe(initial)
      await sendGrid(0)
      expect(ticks).toBe(initial)
      await sendGrid(0.1)
      expect(ticks).toBe(initial + 1)
      await sendGrid(0.1)
      expect(ticks).toBe(initial + 1)
    } finally {
      await renderer.unmount()
    }
  })
  test(`${mover}: free hosted motion uses the floor's existing 0.1 m sound cadence`, async () => {
    useEditor.getState().setSnappingMode('item', 'off')
    const host = ItemNode.parse({
      parentId: level.id,
      asset: { ...catalog.asset, dimensions: [2, 1, 2] },
    })
    useScene.getState().createNode(host, level.id)
    sceneRegistry.nodes.set(host.id, new Group())
    const renderer = await mount(mover)
    try {
      await sendHost(hit(host, [0, 1, 0]), 'grid first')
      await sendHost(hit(host, [0.01, 1, 0]), 'grid first')
      expect(ticks).toBe(0)
      await sendHost(hit(host, [0.11, 1, 0]), 'grid first')
      expect(ticks).toBe(1)
    } finally {
      await renderer.unmount()
    }
  })
}

for (const finish of ['commit', 'cancel', 'unmount'] as const) {
  test(`registry pending floor sound is ${finish === 'commit' ? 'flushed before placement' : 'cancelled'} on ${finish}`, async () => {
    useScene.getState().deleteNode(catalog.id)
    const renderer = await mount('procedural')
    const sounds: string[] = []
    const record = (type: string) => {
      sounds.push(type)
    }
    sfxEmitter.on('*', record)
    try {
      await act(async () => {
        const event = {
          position: [1, 0, 0],
          localPosition: [1, 0, 0],
          nativeEvent: {},
          stopPropagation() {},
        }
        emitter.emit('grid:move', event as never)
        if (finish === 'commit') emitter.emit('grid:click', event as never)
        else if (finish === 'cancel') emitter.emit('tool:cancel')
        // Unmount inside act(): the cue is scheduled on a 0ms timer, and act()
        // yields before resolving, so unmounting after it races the timer.
        else if (finish === 'unmount') await renderer.unmount()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      })
      expect(sounds).toEqual(finish === 'commit' ? ['sfx:grid-snap', 'sfx:item-place'] : [])
    } finally {
      sfxEmitter.off('*', record)
      if (finish !== 'unmount') await renderer.unmount()
    }
  })
}
