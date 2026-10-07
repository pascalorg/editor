import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  createSceneApi,
  emitter,
  ItemNode,
  LevelNode,
  type NodeEvent,
  nodeRegistry,
  registerNode,
  resolveSurfacePlacement,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import { Children, cloneElement, isValidElement, type ReactNode, useMemo } from 'react'
import { Group } from 'three'
import { shelfRecipe } from '../../../../core/src/procedural-items/fixtures'
import { MoveRegistryNodeTool } from '../../../../editor/src/components/tools/registry/move-registry-node-tool'
import useEditor from '../../../../editor/src/store/use-editor'
import useInteractionScope from '../../../../editor/src/store/use-interaction-scope'
import { cabinetDefinition } from '../../cabinet/definition'
import { CabinetNode } from '../../cabinet/schema'
import { itemDefinition } from '../../item/definition'
import { MoveItemTool } from '../../item/move-tool'
import { proceduralItemDefinition } from '../../procedural-item/definition'
import { slabDefinition } from '../definition'

const level = LevelNode.parse({})
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
  position: [-5, 0, -5],
  supportSlabId: 'ground',
  asset: {
    id: 'mug',
    name: 'Mug',
    category: 'decor',
    thumbnail: '',
    src: '/mug.glb',
    dimensions: [0.4, 0.6, 0.4],
  },
})
const design = ProceduralItemNode.parse({
  parentId: level.id,
  recipe: shelfRecipe,
  position: [-5, 0, -5],
  supportSlabId: 'ground',
})
const cabinet = CabinetNode.parse({
  parentId: level.id,
  position: [-5, 0, -5],
  supportSlabId: 'ground',
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
  for (const def of [slabDefinition, itemDefinition, proceduralItemDefinition, cabinetDefinition])
    registerNode(def as never)
  useScene.setState({
    nodes: {
      [level.id]: { ...level, children: [slab.id, catalog.id, design.id, cabinet.id] },
      [slab.id]: slab,
      [catalog.id]: structuredClone(catalog),
      [design.id]: { ...structuredClone(design), position: [-10, 0, -10] },
      [cabinet.id]: { ...structuredClone(cabinet), position: [-15, 0, -15] },
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
  useEditor.getState().setSnappingMode('item', 'off')
  useViewer.setState({
    selection: { buildingId: null, levelId: level.id, zoneId: null, selectedIds: [] },
  })
  sceneRegistry.nodes.set(level.id, new Group())
  sceneRegistry.nodes.set(slab.id, new Group())
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

test.each([
  'item',
  'procedural-item',
  'cabinet',
])('slabs defer %s to floor support without a surface refusal', (childKind) => {
  const refusals: string[] = []
  expect(
    resolveSurfacePlacement({
      host: slab,
      childKind,
      childFootprint: { size: [0.4, 0.6, 0.4], rotationY: 0 },
      hit: { point: [0, slab.elevation, 0], normalWorldY: 1 },
      scene: createSceneApi(useScene),
      onReject: (reason) => refusals.push(reason),
    }),
  ).toBeNull()
  expect(refusals).toEqual([])
})

for (const mover of [
  'catalog',
  'registry catalog',
  'registry procedural',
  'registry cabinet',
] as const) {
  for (const order of ['grid first', 'slab first'] as const) {
    test(`${mover}, ${order}: a slab drop stays level-parented and elects supportSlabId`, async () => {
      const child =
        mover === 'registry procedural' ? design : mover === 'registry cabinet' ? cabinet : catalog
      useScene.setState({
        nodes: {
          [level.id]: { ...level, children: [slab.id, child.id] },
          [slab.id]: slab,
          [child.id]: structuredClone(child),
        },
      })
      useEditor.getState().setMovingNode(child)
      const renderer = await create(
        mover === 'catalog' ? <CatalogMover /> : <RegistryMover node={child} />,
      )
      const nativeEvent = {}
      const event = {
        node: slab,
        object: sceneRegistry.nodes.get(slab.id)!,
        normal: [0, 1, 0],
        position: [2, slab.elevation, 3],
        localPosition: [2, slab.elevation, 3],
        nativeEvent: { nativeEvent },
        stopPropagation() {},
      } as NodeEvent<AnyNode>
      const grid = {
        position: event.position,
        localPosition: event.position,
        nativeEvent,
        stopPropagation() {},
      }
      try {
        await act(async () =>
          emitter.emit('grid:move', {
            ...grid,
            position: [-5, slab.elevation, -5],
            localPosition: [-5, slab.elevation, -5],
          } as never),
        )
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
        })
        await act(async () => {
          if (order === 'grid first') emitter.emit('grid:move', grid as never)
          emitter.emit('slab:move', event as never)
          emitter.emit('node:move', event)
          if (order === 'slab first') emitter.emit('grid:move', grid as never)
        })
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
        })
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
        await act(async () => {
          emitter.emit('slab:click', event as never)
          emitter.emit('node:click', event)
          emitter.emit('grid:click', grid as never)
        })
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
      } finally {
        await renderer.unmount()
      }
      const placed = useScene.getState().nodes[child.id] as typeof child
      expect(placed.parentId).toBe(level.id)
      expect(placed.supportSlabId).toBe(slab.id)
      expect(placed.position).toEqual([2, 0, 3])
      expect((useScene.getState().nodes[level.id] as LevelNode).children).toContain(child.id)
      expect(
        (useScene.getState().nodes[slab.id] as AnyNode & { children?: string[] }).children ?? [],
      ).not.toContain(child.id)
    })
  }
}
