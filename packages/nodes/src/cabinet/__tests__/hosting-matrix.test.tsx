import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  BaseNode,
  type CabinetNode as Cabinet,
  type CabinetEvent,
  createSceneApi,
  emitter,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
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
import { z } from 'zod'
import { MoveRegistryNodeTool } from '../../../../editor/src/components/tools/registry/move-registry-node-tool'
import useEditor from '../../../../editor/src/store/use-editor'
import useInteractionScope from '../../../../editor/src/store/use-interaction-scope'
import { itemDefinition } from '../../item/definition'
import { MoveItemTool } from '../../item/move-tool'
import { proceduralItemDefinition } from '../../procedural-item/definition'
import { shelfDefinition } from '../../shelf/definition'
import { cabinetDefinition, cabinetModuleDefinition } from '../definition'
import { CabinetModuleNode, CabinetNode } from '../schema'

const recipe: Recipe = {
  version: 1,
  name: 'Rectangular hosting fixture',
  description: 'Counter contact',
  constraints: [],
  parameters: [
    { id: 'width', label: 'Width', default: 0.4, min: 0.1, max: 2, step: 0.1, unit: 'm' },
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
          size: ['width', 0.6, 0.655],
          position: [0, 0.3, 0],
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
    dimensions: [0.4, 0.6, 0.655],
  },
  supportSlabId: slab.id,
  rotation: [0, Math.PI / 2, 0],
})
const design = ProceduralItemNode.parse({
  parentId: level.id,
  recipe,
  rotation: [0, Math.PI / 2, 0],
  supportSlabId: slab.id,
})
let restoreRegistry: () => void
let savedScene: ReturnType<typeof useScene.getState>
let savedEditor: ReturnType<typeof useEditor.getState>
let savedViewer: ReturnType<typeof useViewer.getState>
let savedScope: ReturnType<typeof useInteractionScope.getState>
let savedWindow: typeof window
let savedDocument: typeof document
let savedRaf: typeof requestAnimationFrame
let savedCancelRaf: typeof cancelAnimationFrame

beforeEach(() => {
  savedScene = useScene.getState()
  savedEditor = useEditor.getState()
  savedViewer = useViewer.getState()
  savedScope = useInteractionScope.getState()
  savedWindow = globalThis.window
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
  globalThis.window = savedWindow
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
// The mounted coordinator keeps its real cursor refs; DOM-only measurement labels need no canvas test coverage.
function withoutLabels(element: ReactNode): ReactNode {
  if (!isValidElement<{ children?: ReactNode }>(element)) return element
  if (element.type === Html) return null
  return cloneElement(element, {}, Children.map(element.props.children, withoutLabels))
}
function RegistryMover({ node }: { node: AnyNode }) {
  return withoutLabels(MoveRegistryNodeTool({ node }))
}
function CatalogMover() {
  const node = useMemo(() => structuredClone(catalog), [])
  return withoutLabels(MoveItemTool({ node }))
}

for (const kind of ['item top', 'shelf board', 'countertop', 'bar ledge'] as const) {
  for (const mover of [
    'catalog',
    'registry procedural',
    'registry catalog',
    'registry procedural without hostable',
  ] as const) {
    test(`${mover} resolves and commits on ${kind}`, async () => {
      const run = fixture({ barLedge: { edge: 'back', height: 1.2, depth: 0.5 } })
      const shelf = ShelfNode.parse({ parentId: level.id, width: 2, depth: 1, height: 2 })
      const table = ItemNode.parse({
        parentId: level.id,
        asset: { ...catalog.asset, dimensions: [2, 1, 2] },
      })
      const host = kind === 'item top' ? table : kind === 'shelf board' ? shelf : run
      if (host !== run) {
        useScene.getState().createNode(host, level.id)
        sceneRegistry.nodes.set(host.id, new Group())
      }
      const surface = getSurfaceProvider(host)
        .surfaces?.(host, { scene: createSceneApi(useScene) })
        .find((s) => kind !== 'bar ledge' || s.label === 'Bar ledge')
      const y = surface?.position[1] ?? 1
      const [x, z] = surface?.region?.center ?? [0, 0]
      const event = hit(host as Cabinet, [x, y, z])
      const child = mover.startsWith('registry procedural') ? design : catalog
      if (mover === 'registry procedural without hostable') {
        const capabilities = nodeRegistry.get('procedural-item')!.capabilities
        delete capabilities.hostable
      }
      useEditor.getState().setMovingNode(child)
      const renderer = await create(
        mover === 'catalog' ? <CatalogMover /> : <RegistryMover node={child} />,
      )
      try {
        for (const dx of [0, 0.12, 0.27]) {
          const moved = hit(host as Cabinet, [x + dx, y, z])
          const nativeEvent = {}
          moved.nativeEvent = { nativeEvent } as CabinetEvent['nativeEvent']
          await act(async () => {
            emitter.emit('grid:move', {
              position: moved.position,
              localPosition: moved.position,
              nativeEvent,
            } as never)
            emitter.emit(`${host.type}:move` as never, moved as never)
          })
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5))
          })
          expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
          const placed = useScene.getState().nodes[child.id] as typeof child
          expect(placed.position[1]).toBeCloseTo(y)
          if (mover === 'catalog') {
            expect(renderer.scene.children[0]!.instance.position.x).toBeCloseTo(moved.position[0])
          } else expect(placed.position[0]).toBeCloseTo(x + dx)
        }
        await act(async () => emitter.emit(`${host.type}:click` as never, event as never))
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        expect((useScene.getState().nodes[child.id] as typeof child).position[0]).toBeCloseTo(
          x + 0.27,
        )
      } finally {
        await renderer.unmount()
      }
      expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
    })
  }
}

test.each([
  'catalog',
  'procedural',
] as const)('registry %s uses an unlisted host provider and respects its acceptance predicate', async (assetType) => {
  const schema = BaseNode.extend({
    id: objectId('test-surface'),
    type: nodeType('test-surface'),
    children: z.array(z.string()).default([]),
  })
  let accepts = false
  registerNode({
    kind: 'test-surface',
    schemaVersion: 1,
    schema,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {
      surfaces: {
        hosting: {
          childFrame: 'host-local',
          resolveHit: () => ({
            id: 'top',
            position: [0, 0.84, 0],
            normal: [0, 1, 0],
            region: { kind: 'rect', size: [1, 1] },
          }),
          accepts: () => accepts,
        },
      },
    },
  } as never)
  const host = schema.parse({ parentId: level.id }) as unknown as AnyNode
  useScene.getState().createNode(host, level.id)
  sceneRegistry.nodes.set(host.id, new Group())
  const child = assetType === 'catalog' ? catalog : design
  const renderer = await create(<RegistryMover node={child} />)
  const event = hit(host as Cabinet, [0, 0.84, 0])
  try {
    await act(async () => emitter.emit('test-surface:move' as never, event as never))
    expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
    accepts = true
    await act(async () => emitter.emit('test-surface:move' as never, event as never))
    expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
    expect((useScene.getState().nodes[child.id] as typeof child).position[1]).toBeCloseTo(0.84)
  } finally {
    await renderer.unmount()
  }
})

for (const mover of ['catalog', 'registry procedural'] as const) {
  for (const order of ['grid first', 'host first'] as const) {
    test.each([
      'fit',
      'cutout',
      'kind',
    ] as const)(`${mover}, ${order}: %s accepts overhang or refuses without text and never silently commits to the floor`, async (reason) => {
      const run = fixture({}, [
        CabinetModuleNode.parse({
          width: 0.8,
          position: [0, 0.1, 0],
          stack: [{ id: 'sink', type: 'sink' }],
        }),
        CabinetModuleNode.parse({ width: 0.8, position: [2, 0.1, 0] }),
      ])
      let accepts = reason !== 'kind'
      const capabilities = nodeRegistry.get('cabinet')!.capabilities
      capabilities.surfaces = {
        ...capabilities.surfaces,
        hosting: { ...getSurfaceProvider(run), accepts: () => accepts },
      }
      const child = mover === 'catalog' ? catalog : design
      useEditor.getState().setMovingNode(child)
      const renderer = await create(
        mover === 'catalog' ? <CatalogMover /> : <RegistryMover node={child} />,
      )
      try {
        const event = hit(run, [reason === 'fit' ? 2.39 : reason === 'cutout' ? 0 : 2, 0.85, 0.01])
        const nativeEvent = {}
        event.nativeEvent = { nativeEvent } as CabinetEvent['nativeEvent']
        const grid = {
          position: event.position,
          localPosition: event.position,
          nativeEvent,
        } as never
        await act(async () => {
          if (order === 'grid first') emitter.emit('grid:move', grid)
          emitter.emit('cabinet:move', event)
          if (order === 'host first') emitter.emit('grid:move', grid)
        })
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
        })
        const root = renderer.scene.children[0]!.instance as Group
        let invalidColor = false
        root.traverse((object) => {
          const material = (object as { material?: { color?: { getHex(): number } } }).material
          if (material?.color?.getHex() === 0xef4444) invalidColor = true
        })
        if (reason === 'fit') {
          expect(invalidColor).toBe(false)
          await act(async () => emitter.emit('cabinet:click', event))
          const placed = useScene.getState().nodes[child.id] as typeof child
          expect(placed.parentId).toBe(run.id)
          expect(placed.position[0]).toBeCloseTo(2.39)
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
          return
        }
        expect(invalidColor).toBe(true)
        await act(async () =>
          window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Alt' })),
        )
        await act(async () => {
          emitter.emit('cabinet:click', event)
          emitter.emit('grid:click', grid)
          emitter.emit('node:click', event as never)
        })
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        expect(useEditor.getState().movingNode).not.toBeNull()
        await act(async () =>
          window.dispatchEvent(Object.assign(new Event('keyup'), { key: 'Alt' })),
        )
        accepts = true
        await act(async () => emitter.emit('cabinet:move', hit(run, [2, 0.85, 0.01])))
        expect(useEditor.getState().movingNode).not.toBeNull()
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(run.id)
        await act(async () => emitter.emit('cabinet:click', hit(run, [2, 0.85, 0.01])))
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      } finally {
        await renderer.unmount()
      }
    })
  }
}

for (const mover of ['catalog', 'registry procedural', 'registry catalog'] as const) {
  test(`${mover}: rotating a hosted shelf object into overhang keeps the drop valid`, async () => {
    const shelf = ShelfNode.parse({ parentId: level.id, width: 1.2, depth: 0.5, height: 1 })
    useScene.getState().createNode(shelf, level.id)
    sceneRegistry.nodes.set(shelf.id, new Group())
    const child = mover === 'registry procedural' ? design : catalog
    useEditor.getState().setMovingNode(child)
    const renderer = await create(
      mover === 'catalog' ? <CatalogMover /> : <RegistryMover node={child} />,
    )
    const event = hit(shelf as unknown as Cabinet, [0, 1.04, 0])
    const key = (key: string) => window.dispatchEvent(Object.assign(new Event('keydown'), { key }))
    const inputElement = globalThis.HTMLInputElement
    const textElement = globalThis.HTMLTextAreaElement
    globalThis.HTMLInputElement = class {} as typeof HTMLInputElement
    globalThis.HTMLTextAreaElement = class {} as typeof HTMLTextAreaElement
    try {
      await act(async () => emitter.emit('shelf:move', event as never))
      expect(useScene.getState().nodes[child.id]!.parentId).toBe(shelf.id)
      await act(async () => key('r'))
      expect(hasInvalidPreview(renderer.scene.children[0]!.instance as Group)).toBe(false)
      await act(async () => key('t'))
      expect(hasInvalidPreview(renderer.scene.children[0]!.instance as Group)).toBe(false)
      await act(async () => emitter.emit('shelf:click', event as never))
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    } finally {
      await renderer.unmount()
      globalThis.HTMLInputElement = inputElement
      globalThis.HTMLTextAreaElement = textElement
    }
  })
}

function hasInvalidPreview(root: Group): boolean {
  let invalid = false
  root.traverse((object) => {
    const material = (object as { material?: { color?: { getHex(): number } } }).material
    if (material?.color?.getHex() === 0xef4444) invalid = true
  })
  return invalid
}

for (const mover of ['catalog', 'registry procedural'] as const) {
  test(`${mover}: crossing the shelf centre boundary detaches with a visible floor preview before commit`, async () => {
    const shelf = ShelfNode.parse({ parentId: level.id, width: 1.2, depth: 0.5, height: 1 })
    useScene.getState().createNode(shelf, level.id)
    sceneRegistry.nodes.set(shelf.id, new Group())
    const child = mover === 'catalog' ? catalog : design
    useEditor.getState().setMovingNode(child)
    const renderer = await create(
      mover === 'catalog' ? <CatalogMover /> : <RegistryMover node={child} />,
    )
    try {
      await act(async () =>
        emitter.emit('shelf:move', hit(shelf as unknown as Cabinet, [0.57, 1.04, 0]) as never),
      )
      expect(useScene.getState().nodes[child.id]!.parentId).toBe(shelf.id)
      expect(hasInvalidPreview(renderer.scene.children[0]!.instance as Group)).toBe(false)
      const outside = hit(shelf as unknown as Cabinet, [0.61, 1.04, 0])
      await act(async () => emitter.emit('shelf:move', outside as never))
      const preview = useScene.getState().nodes[child.id] as typeof child
      expect(preview.parentId).toBe(level.id)
      expect(preview.position[0]).toBeCloseTo(0.61)
      expect(preview.position[1]).toBe(0)
      expect(preview.position[2]).toBeCloseTo(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      await act(async () =>
        window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Alt' })),
      )
      await act(async () =>
        emitter.emit('grid:click', {
          position: outside.position,
          localPosition: outside.position,
          nativeEvent: {},
        } as never),
      )
      const committed = useScene.getState().nodes[child.id] as typeof child
      expect(committed.parentId).toBe(level.id)
      expect(committed.position).toEqual(preview.position)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    } finally {
      await renderer.unmount()
    }
  })
}
