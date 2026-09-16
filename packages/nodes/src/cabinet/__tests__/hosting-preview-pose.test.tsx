import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type CabinetNode as Cabinet,
  type CabinetEvent,
  createSceneApi,
  emitter,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  ShelfNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { nodeLevelFrame, ProceduralItemNode, type Recipe } from '@pascal-app/core/procedural-items'
import { NodeRenderer, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import { Children, cloneElement, isValidElement, type ReactNode, useMemo, useRef } from 'react'
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { MoveRegistryNodeTool } from '../../../../editor/src/components/tools/registry/move-registry-node-tool'
import useEditor from '../../../../editor/src/store/use-editor'
import useInteractionScope from '../../../../editor/src/store/use-interaction-scope'
import { FloorElevationSystem } from '../../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../../viewer/src/systems/item/item-system'
import { itemDefinition } from '../../item/definition'
import { ItemGLTFLoader } from '../../item/model-loader'
import { MoveItemTool } from '../../item/move-tool'
import { proceduralItemDefinition } from '../../procedural-item/definition'
import { shelfDefinition } from '../../shelf/definition'
import { cabinetDefinition, cabinetModuleDefinition } from '../definition'
import { CabinetModuleNode, CabinetNode } from '../schema'

let loadModel: ReturnType<typeof spyOn>
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
    src: '/pose-fixture.glb',
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
  loadModel = spyOn(ItemGLTFLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
    const scene = new Group()
    scene.add(
      new Mesh(new BoxGeometry(0.4, 0.6, 0.655).translate(0, 0.3, 0), new MeshBasicMaterial()),
    )
    onLoad({
      scene,
      scenes: [scene],
      animations: [],
      cameras: [],
      asset: { version: '2.0' },
      parser: {},
    } as never)
  })
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
})
afterEach(() => {
  loadModel.mockRestore()
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
function CatalogMover({ source = catalog }: { source?: ItemNode } = {}) {
  const node = useMemo(() => structuredClone(source), [source])
  return withoutLabels(MoveItemTool({ node }))
}

function generatedHost(named: boolean) {
  return ProceduralItemNode.parse({
    parentId: level.id,
    recipe: {
      ...recipe,
      name: 'Generated table',
      parameters: [
        { id: 'height', label: 'Height', default: 1, min: 0.5, max: 2, step: 0.1, unit: 'm' },
      ],
      parts: [
        {
          id: 'table',
          label: 'Table',
          count: 1,
          shapes: [
            {
              id: 'top',
              primitive: 'box',
              size: [2, 0.1, 2],
              position: [0, { op: 'sub', args: ['height', 0.05] }, 0],
              slot: 'body',
            },
            {
              id: 'back',
              primitive: 'box',
              size: [0.1, 1.5, 0.1],
              position: [-0.9, 0.75, -0.9],
              slot: 'body',
            },
          ],
        },
      ],
      surfaces: named
        ? [
            {
              id: 'tabletop',
              label: 'Tabletop',
              position: [0.15, 'height', 0.1],
              rotation: [0, 0.37, 0],
              size: [2, 2],
            },
          ]
        : [],
    },
  })
}

type Mover = 'catalog' | 'registry catalog' | 'registry procedural'

function SceneAndMover({ mover, child }: { mover: Mover; child: AnyNode }) {
  const children = useScene((s) => (s.nodes[level.id] as typeof level).children)
  const moving = useInteractionScope((s) => s.scope.kind === 'moving' || s.scope.kind === 'placing')
  const ref = useRef<Group>(null!)
  useRegistry(level.id, 'level', ref)
  return (
    <>
      <group ref={ref}>
        {children.map((id) => (
          <NodeRenderer key={id} nodeId={id} />
        ))}
      </group>
      <group name="mover">
        {moving &&
          (mover === 'catalog' ? (
            <CatalogMover source={child as ItemNode} />
          ) : (
            <RegistryMover node={child} />
          ))}
      </group>
      <FloorElevationSystem />
      <ItemSystem />
      <GeometrySystem />
    </>
  )
}

function worldMatrix(id: AnyNode['id']) {
  const mesh = sceneRegistry.nodes.get(id)!
  expect(mesh).toBeDefined()
  mesh.updateWorldMatrix(true, false)
  return mesh.matrixWorld.clone()
}

function expectPose(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, i) => {
    expect(value).toBeCloseTo(expected.elements[i]!, 6)
  })
}

const hosts = [
  'item top',
  'shelf board',
  'countertop',
  'bar ledge',
  'generated named surface',
  'generated hit surface',
] as const
const movers: Mover[] = ['catalog', 'registry catalog', 'registry procedural']
for (const kind of hosts) {
  for (const mover of movers) {
    for (const frame of ['level', 'raised slab', 'hosted'] as const) {
      for (const creation of ['existing', 'fresh'] as const) {
        for (const checkpoint of ['entry', 'move', 'rotate'] as const) {
          test(`${kind} / ${mover} / ${frame} / ${creation} / ${checkpoint}: rendered preview equals committed world pose`, async () => {
            const run = fixture({
              position: [2, 0, 3],
              barLedge: { edge: 'back', height: 1.2, depth: 0.5 },
            })
            const host = kind.startsWith('generated')
              ? generatedHost(kind === 'generated named surface')
              : kind === 'item top'
                ? ItemNode.parse({ asset: { ...catalog.asset, dimensions: [2, 1, 2] } })
                : kind === 'shelf board'
                  ? ShelfNode.parse({ width: 2, depth: 1, height: 2 })
                  : run
            const parent =
              kind === 'shelf board' || kind === 'countertop' || kind === 'bar ledge'
                ? ItemNode.parse({ asset: { ...catalog.asset, dimensions: [4, 1, 4] } })
                : generatedHost(true)
            const parentId = frame === 'hosted' ? parent.id : level.id
            if (frame === 'hosted') {
              useScene.getState().createNode(
                {
                  ...parent,
                  position: [1, 0, -2],
                  rotation: [0, -0.43, 0],
                  supportSlabId: slab.id,
                  ...(parent.type === 'procedural-item'
                    ? { attachments: { [host.id]: 'tabletop' } }
                    : {}),
                },
                level.id,
              )
            }
            const patch = {
              parentId,
              position: frame === 'hosted' ? [0, parent.type === 'item' ? 1 : 0, 0] : [2, 0, 3],
              rotation: host.type === 'cabinet' ? 0.61 : [0, 0.61, 0],
              supportSlabId:
                frame === 'raised slab' ? slab.id : frame === 'level' ? 'ground' : undefined,
            }
            if (host === run) useScene.getState().updateNode(host.id, patch as never)
            else useScene.getState().createNode({ ...host, ...patch } as AnyNode, parentId)
            const child = {
              ...(mover === 'registry procedural' ? design : catalog),
              ...(creation === 'fresh' ? { metadata: { isNew: true } } : {}),
            }
            useScene.getState().updateNode(child.id, { metadata: child.metadata })
            const hostedChildId = () => {
              const nodes = useScene.getState().nodes
              const children = (nodes[host.id] as typeof host).children
              const matches = children.filter(
                (id) => nodes[id as AnyNode['id']]?.type === child.type,
              )
              expect(matches).toHaveLength(1)
              return matches[0] as AnyNode['id']
            }
            useEditor.getState().setMovingNode(child)
            const renderer = await create(<SceneAndMover mover={mover} child={child} />)
            const inputElement = globalThis.HTMLInputElement
            const textElement = globalThis.HTMLTextAreaElement
            globalThis.HTMLInputElement = class {} as typeof HTMLInputElement
            globalThis.HTMLTextAreaElement = class {} as typeof HTMLTextAreaElement
            try {
              await act(async () => {
                await renderer.advanceFrames(2, 1 / 60)
              })
              const currentHost = useScene.getState().nodes[host.id]!
              const surface = getSurfaceProvider(currentHost)
                .surfaces?.(currentHost, { scene: createSceneApi(useScene) })
                .find((s) => kind !== 'bar ledge' || s.label === 'Bar ledge')
              const y = surface?.position[1] ?? 1
              const [x, z] = surface?.region?.center ?? [0.15, 0.1]
              let event = hit(currentHost as Cabinet, [x, y, z])
              await act(async () => emitter.emit(`${host.type}:move` as never, event as never))
              if (checkpoint !== 'entry') {
                event = hit(currentHost as Cabinet, [x + 0.17, y, z + 0.07])
                await act(async () => emitter.emit(`${host.type}:move` as never, event as never))
              }
              if (checkpoint === 'rotate')
                await act(async () =>
                  window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'r' })),
                )
              await act(async () => {
                await renderer.advanceFrames(2, 1 / 60)
              })
              expect(useScene.getState().nodes[hostedChildId()]!.parentId).toBe(host.id)
              const preview = worldMatrix(hostedChildId())
              const moverRoot = renderer.scene.children.find(
                (c) => c.instance.name === 'mover',
              )!.instance
              let boxMatrix: Matrix4 | undefined
              moverRoot.traverse((object) => {
                if (object.type === 'LineSegments' && object.renderOrder === 999) {
                  object.parent!.updateWorldMatrix(true, false)
                  boxMatrix = object.parent!.matrixWorld.clone()
                }
              })
              expect(boxMatrix).toBeDefined()
              // Advance once more without input: frame systems must not move a settled preview.
              await act(async () => {
                await renderer.advanceFrames(1, 1 / 60)
              })
              expectPose(worldMatrix(hostedChildId()), preview)
              await act(async () => emitter.emit(`${host.type}:click` as never, event as never))
              await act(async () => {
                await renderer.advanceFrames(2, 1 / 60)
              })
              expect(useInteractionScope.getState().scope.kind).toBe('idle')
              expectPose(preview, worldMatrix(hostedChildId()))
              expectPose(preview, boxMatrix!)
              const committed = nodeLevelFrame(hostedChildId(), useScene.getState().nodes)
              expectPose(
                worldMatrix(hostedChildId()),
                new Matrix4()
                  .makeBasis(
                    ...(committed.axes.map((axis) => new Vector3(...axis)) as [
                      Vector3,
                      Vector3,
                      Vector3,
                    ]),
                  )
                  .setPosition(...committed.position),
              )
            } finally {
              await renderer.unmount()
              globalThis.HTMLInputElement = inputElement
              globalThis.HTMLTextAreaElement = textElement
            }
          })
        }
      }
    }
  }
}
