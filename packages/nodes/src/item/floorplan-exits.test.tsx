import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  createSceneApi,
  getFloorPlacedElevation,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  resolveSurfacePlacement,
  ShelfNode,
  SlabNode,
  spatialGridManager,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  frame,
  nodeLevelFrame,
  ProceduralItemNode,
  type Recipe,
  transformPoint,
} from '@pascal-app/core/procedural-items'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { FloorplanRegistryMoveOverlay } from '../../../editor/src/components/editor-2d/floorplan-registry-move-overlay'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { cabinetDefinition, cabinetModuleDefinition } from '../cabinet/definition'
import { CabinetModuleNode, CabinetNode } from '../cabinet/schema'
import { proceduralItemDefinition } from '../procedural-item/definition'
import { shelfDefinition } from '../shelf/definition'
import { itemDefinition } from './definition'

const recipe: Recipe = {
  version: 1,
  name: 'Box',
  description: '',
  parameters: [
    { id: 'width', label: 'Width', default: 0.2, min: 0.1, max: 1, step: 0.1, unit: 'm' },
  ],
  constraints: [],
  slots: [{ id: 'body', label: 'Body', color: '#ffffff' }],
  parts: [
    {
      id: 'body',
      label: 'Body',
      count: 1,
      shapes: [
        { id: 'box', primitive: 'box', size: [0.2, 0.2, 0.2], position: [0, 0.1, 0], slot: 'body' },
      ],
    },
  ],
  surfaces: [],
}
const asset = {
  id: 'box',
  name: 'Box',
  category: 'furniture',
  src: '/box.glb',
  thumbnail: '',
  dimensions: [0.2, 0.2, 0.2],
}
const hostKinds = ['shelf', 'counter', 'bar', 'item', 'named', 'generated'] as const
let restore: () => void
let savedScene: ReturnType<typeof useScene.getState>
let savedEditor: ReturnType<typeof useEditor.getState>
let savedViewer: ReturnType<typeof useViewer.getState>
let savedScope: ReturnType<typeof useInteractionScope.getState>
let globals: Record<string, PropertyDescriptor | undefined>
beforeEach(() => {
  savedScene = useScene.getState()
  savedEditor = useEditor.getState()
  savedViewer = useViewer.getState()
  savedScope = useInteractionScope.getState()
  globals = Object.fromEntries(
    ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  )
  const svg = {
    getBoundingClientRect: () => ({ left: -100, right: 100, top: -100, bottom: 100 }),
    createSVGPoint: () => ({
      x: 0,
      y: 0,
      matrixTransform() {
        return { x: this.x, y: this.y }
      },
    }),
  }
  Object.assign(globalThis, {
    window: new EventTarget(),
    document: {
      body: { style: {} },
      querySelector: () => ({
        ownerSVGElement: svg,
        getScreenCTM: () => ({ inverse: () => ({}) }),
      }),
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  })
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  for (const def of [
    itemDefinition,
    proceduralItemDefinition,
    shelfDefinition,
    cabinetDefinition,
    cabinetModuleDefinition,
  ])
    registerNode(def as never)
  useInteractionScope.getState().end()
  useEditor.setState({
    mode: 'build',
    tool: 'item',
    movingNodeOrigin: '2d',
    placementDragMode: false,
  })
  useEditor.getState().setSnappingMode('item', 'off')
  useLiveNodeOverrides.getState().clearAll()
  spatialGridManager.clear()
  useScene.temporal.getState().pause()
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  spatialGridManager.clear()
  useScene.setState(savedScene, true)
  useEditor.setState(savedEditor, true)
  useViewer.setState(savedViewer, true)
  useInteractionScope.setState(savedScope, true)
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  restore()
  for (const k of Object.keys(globals)) {
    if (globals[k]) Object.defineProperty(globalThis, k, globals[k]!)
    else Reflect.deleteProperty(globalThis, k)
  }
})
function fixture(
  kind: (typeof hostKinds)[number],
  childKind: 'item' | 'procedural-item',
  nested: boolean,
) {
  const level = LevelNode.parse({ id: 'level_f1' })
  const slab = SlabNode.parse({
    id: 'slab_f1',
    parentId: level.id,
    elevation: 0.6,
    polygon: [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ],
  })
  const lower = SlabNode.parse({ ...slab, id: 'slab_lower', elevation: 0.2 })
  const ancestor = ItemNode.parse({
    id: 'item_ancestor',
    parentId: level.id,
    asset: { ...asset, dimensions: [8, 1, 8] },
    position: [1, 0, 1],
    rotation: [0, 0.3, 0],
    supportSlabId: slab.id,
  })
  const common = {
    parentId: nested ? ancestor.id : level.id,
    position: [2, nested ? 1 : 0, 3],
    supportSlabId: nested ? undefined : slab.id,
  }
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_f1',
    width: 2,
    depth: 1,
    position: [0, 0.1, 0],
  })
  let host: AnyNode
  if (kind === 'shelf')
    host = ShelfNode.parse({
      ...common,
      width: 2,
      depth: 1,
      height: 2,
      rows: 3,
      rotation: [0, 0.6, 0],
    })
  else if (kind === 'counter' || kind === 'bar')
    host = CabinetNode.parse({
      ...common,
      rotation: 0.6,
      children: [module.id],
      withCountertop: true,
      barLedge: kind === 'bar' ? { edge: 'back', height: 1.2, depth: 0.4 } : undefined,
    })
  else if (kind === 'item')
    host = ItemNode.parse({
      ...common,
      asset: { ...asset, dimensions: [2, 1, 2] },
      rotation: [0, 0.6, 0],
    })
  else
    host = ProceduralItemNode.parse({
      ...common,
      rotation: [0, 0.6, 0],
      recipe: {
        ...recipe,
        parts: [
          {
            ...recipe.parts[0]!,
            shapes: [{ ...recipe.parts[0]!.shapes[0]!, size: [3, 1, 3], position: [0, 0.5, 0] }],
          },
        ],
        surfaces:
          kind === 'named'
            ? [
                {
                  id: 'top',
                  label: 'Top',
                  position: [0.2, 1, 0.1],
                  rotation: [0, 0.4, 0],
                  size: [2, 2],
                },
              ]
            : [],
      },
    })
  const child =
    childKind === 'item'
      ? ItemNode.parse({ asset, parentId: host.id, rotation: [0, 0.2, 0] })
      : ProceduralItemNode.parse({ recipe, parentId: host.id, rotation: [0, 0.2, 0] })
  const nodes: Record<AnyNodeId, AnyNode> = {
    [level.id]: { ...level, children: [slab.id, lower.id, nested ? ancestor.id : host.id] },
    [slab.id]: slab,
    [lower.id]: lower,
    [host.id]: host,
    [child.id]: child,
  }
  if (nested) nodes[ancestor.id] = { ...ancestor, children: [host.id] }
  if (host.type === 'cabinet') nodes[module.id] = { ...module, parentId: host.id }
  useScene.setState({ nodes, rootNodeIds: [level.id], dirtyNodes: new Set(), readOnly: false })
  const scene = createSceneApi(useScene)
  const surfaces = getSurfaceProvider(host).surfaces?.(host, { scene }) ?? []
  const surface = kind === 'bar' ? surfaces.find((s) => s.label === 'Bar ledge')! : surfaces.at(-1)
  const center = surface?.region.center ?? [0, 0]
  const hit = surface
    ? transformPoint(frame([...surface.position], [...(surface.rotation ?? [0, 0, 0])]), [
        center[0],
        0,
        center[1],
      ])
    : ([0, 1, 0] as [number, number, number])
  const pose = resolveSurfacePlacement({
    host,
    childKind,
    childFootprint: { size: [0.2, 0.2, 0.2], rotationY: 0.2 },
    hit: { point: hit, normalWorldY: 1 },
    scene,
  })!
  expect(pose).not.toBeNull()
  const stored = pose.childFrame === 'surface-local' ? pose.surfaceLocal! : pose
  nodes[child.id] = { ...child, position: [...stored.position], rotation: [0, stored.rotationY, 0] }
  nodes[host.id] = {
    ...host,
    children: [...('children' in host ? host.children : []), child.id],
    ...(host.type === 'procedural-item'
      ? { attachments: pose.surfaceId ? { [child.id]: pose.surfaceId } : {} }
      : {}),
  } as AnyNode
  useScene.setState({ nodes })
  spatialGridManager.handleNodeCreated(slab, level.id)
  spatialGridManager.handleNodeCreated(lower, level.id)
  useViewer.setState({
    selection: { levelId: level.id, buildingId: null, zoneId: null, selectedIds: [child.id] },
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  return {
    child: nodes[child.id] as ItemNode | ProceduralItemNode,
    host,
    level,
    slab,
    baseline: structuredClone(nodes),
  }
}
async function pointer(type: string, p: readonly number[]) {
  await act(async () => {
    window.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: p[0],
        clientY: p[1],
        button: 0,
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    )
  })
}
async function mount(child: AnyNode) {
  useEditor.getState().setMovingNode(child)
  useEditor.getState().setMovingNodeOrigin('2d')
  return create(<FloorplanRegistryMoveOverlay />)
}
for (const kind of hostKinds)
  for (const childKind of ['item', 'procedural-item'] as const)
    for (const nested of [false, true]) {
      const label = `${childKind} exits ${nested ? 'nested ' : ''}${kind}`
      test(`${label}: preview, atomic commit, support, undo and repeat`, async () => {
        const { child, host, level, slab, baseline } = fixture(kind, childKind, nested)
        const start = nodeLevelFrame(child.id, baseline)
        const yaw = Math.atan2(start.axes[2][0], start.axes[2][2])
        for (const destination of [
          [8, 8],
          [25, 25],
        ] as const) {
          useScene.temporal.getState().clear()
          const renderer = await mount(child)
          try {
            await pointer('pointermove', [start.position[0], start.position[2]])
            await pointer('pointermove', destination)
            const preview = useLiveNodeOverrides.getState().get(child.id)!
            expect(preview).toBeDefined()
            const transitions: (string | undefined)[] = []
            const unsubscribe = useScene.subscribe((state, previous) => {
              if (state.nodes[child.id]?.parentId !== previous.nodes[child.id]?.parentId) {
                transitions.push(
                  (state.nodes[host.id] as ProceduralItemNode).attachments?.[child.id],
                )
              }
            })
            try {
              await pointer('pointerup', destination)
            } finally {
              unsubscribe()
            }
            const committed = useScene.getState().nodes[child.id] as typeof child
            expect(committed.parentId).toBe(level.id)
            expect(committed.position).toEqual([destination[0], 0, destination[1]])
            expect(committed.rotation[1]).toBeCloseTo(yaw)
            const committedFrame = nodeLevelFrame(child.id, useScene.getState().nodes)
            expect(Math.atan2(committedFrame.axes[2][0], committedFrame.axes[2][2])).toBeCloseTo(
              yaw,
            )
            const previewFrame = nodeLevelFrame(child.id, {
              ...baseline,
              [child.id]: { ...child, ...preview },
            })
            for (let axis = 0; axis < 3; axis++) {
              expect(previewFrame.position[axis]).toBeCloseTo(committedFrame.position[axis]!)
              for (let component = 0; component < 3; component++)
                expect(previewFrame.axes[axis]![component]).toBeCloseTo(
                  committedFrame.axes[axis]![component]!,
                )
            }
            expect(committed.supportSlabId).toBe(destination[0] === 8 ? slab.id : undefined)
            expect(
              getFloorPlacedElevation({
                node: committed,
                nodes: useScene.getState().nodes,
                position: committed.position,
              }),
            ).toBe(destination[0] === 8 ? 0.6 : 0)
            for (const [key, value] of Object.entries(preview))
              expect((committed as unknown as Record<string, unknown>)[key]).toEqual(value)
            expect(
              (useScene.getState().nodes[host.id] as ProceduralItemNode).children,
            ).not.toContain(child.id)
            expect(
              (useScene.getState().nodes[level.id] as LevelNode).children.filter(
                (id) => id === child.id,
              ),
            ).toHaveLength(1)
            expect(transitions).toEqual([undefined])
            expect(useScene.temporal.getState().pastStates).toHaveLength(1)
            await renderer.unmount()
            const again = await mount(committed)
            try {
              await pointer('pointermove', destination)
              await pointer('pointerup', destination)
            } finally {
              await again.unmount()
            }
            expect(useScene.getState().nodes[child.id]).toEqual(committed)
            useScene.temporal.getState().undo()
            expect(useScene.getState().nodes).toEqual(baseline)
          } finally {
            await renderer.unmount()
          }
        }
      })
      test(`${label}: retention, return, Escape and unmount restore baseline`, async () => {
        const { child, host, baseline } = fixture(kind, childKind, nested)
        const start = nodeLevelFrame(child.id, baseline).position
        for (const cancel of ['Escape', 'unmount']) {
          const renderer = await mount(child)
          try {
            await pointer('pointermove', [start[0], start[2]])
            await pointer('pointermove', [start[0] + 0.01, start[2]])
            expect(useLiveNodeOverrides.getState().get(child.id)?.parentId).toBe(host.id)
            await pointer('pointermove', [25, 25])
            await pointer('pointermove', [start[0], start[2]])
            const returned = useLiveNodeOverrides.getState().get(child.id)!
            expect(returned.parentId).toBe(host.id)
            expect(returned.supportSlabId).toBeUndefined()
            await pointer('pointermove', [25, 25])
            if (cancel === 'Escape')
              await act(async () => {
                window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
              })
          } finally {
            await renderer.unmount()
          }
          expect(useScene.getState().nodes).toEqual(baseline)
          expect(useLiveNodeOverrides.getState().get(child.id)).toBeUndefined()
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        }
      })
    }
