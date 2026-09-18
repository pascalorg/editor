import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  createSceneApi,
  getEffectiveNode,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  resolveSurfacePlacement,
  ShelfNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  frame,
  nodeLevelFrame,
  ProceduralItemNode,
  type Recipe,
  transformPoint,
} from '@pascal-app/core/procedural-items'
import { NodeRenderer, useViewer, WallSystem } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { extend, useFrame } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { Children, cloneElement, isValidElement, type ReactNode, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  Euler,
  Group,
  Line,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  Path,
  Quaternion,
  Vector3,
} from 'three'
import { FloorplanRegistryMoveOverlay } from '../../../editor/src/components/editor-2d/floorplan-registry-move-overlay'
import { FloorplanRegistryLayer } from '../../../editor/src/components/editor-2d/renderers/floorplan-registry-layer'
import { sfxEmitter } from '../../../editor/src/lib/sfx-bus'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { FloorElevationSystem } from '../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../viewer/src/systems/item/item-system'
import { cabinetDefinition, cabinetModuleDefinition } from '../cabinet/definition'
import { CabinetModuleNode, CabinetNode } from '../cabinet/schema'
import { proceduralItemDefinition } from '../procedural-item/definition'
import { shelfDefinition } from '../shelf/definition'
import { itemDefinition } from './definition'
import { buildItemFloorplan } from './floorplan'
import { ItemGLTFLoader } from './model-loader'
import { MoveItemTool } from './move-tool'

class SvgNode extends Group {
  // Keep R3F from interpreting this SVG attribute as a pierced Three.js property.
  'data-node-id': string | undefined = undefined
  setAttribute(name: string, value: unknown) {
    ;(this as unknown as Record<string, unknown>)[name] = value
  }
  removeAttribute(name: string) {
    delete (this as unknown as Record<string, unknown>)[name]
  }
}
extend({
  G: SvgNode,
  Rect: SvgNode,
  Polygon: SvgNode,
  Circle: SvgNode,
  Text: SvgNode,
  Image: SvgNode,
  Defs: SvgNode,
  Pattern: SvgNode,
  Polyline: SvgNode,
})
let loader: ReturnType<typeof spyOn>
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
  extend({ Line: SvgNode, Path: SvgNode })
  loader = spyOn(ItemGLTFLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
    const scene = new Group()
    scene.add(
      new Mesh(new BoxGeometry(0.2, 0.2, 0.2).translate(0, 0.1, 0), new MeshBasicMaterial()),
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
  useViewer.setState({ previewSelectedIds: [] })
  globals = Object.fromEntries(
    [
      'window',
      'document',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'PointerEvent',
      'HTMLInputElement',
      'HTMLTextAreaElement',
    ].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
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
    window: Object.assign(new EventTarget(), {
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
    }),
    HTMLInputElement: class {},
    HTMLTextAreaElement: class {},
    PointerEvent: class extends Event {
      constructor(type: string, props: object) {
        super(type)
        Object.assign(this, props)
      }
    },
    document: {
      body: { style: {} },
      activeElement: null,
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
  // Isolate React.lazy caches between files without changing the production capabilities.
  for (const def of [
    itemDefinition,
    proceduralItemDefinition,
    shelfDefinition,
    cabinetDefinition,
    cabinetModuleDefinition,
  ])
    registerNode({ ...def, renderer: def.renderer && { ...def.renderer } } as never)
  useInteractionScope.getState().end()
  useEditor.setState({
    viewMode: '2d',
    mode: 'select',
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
  extend({ Line, Path })
  loader.mockRestore()
  sceneRegistry.nodes.clear()
  useLiveTransforms.getState().clearAll()
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
        pointerId: 1,
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    )
  })
}
function RenderedScene({
  levelId,
  structural = false,
}: {
  levelId: AnyNodeId
  structural?: boolean
}) {
  const level = useScene((s) => s.nodes[levelId]) as LevelNode
  const ref = useRef<Group>(null!)
  useRegistry(levelId, 'level', ref)
  return (
    <>
      <group position={[10, 2, -3]} rotation-y={0.4}>
        <group ref={ref}>
          {level.children.map((id) => (
            <NodeRenderer key={id} nodeId={id} />
          ))}
        </group>
      </group>
      <FloorElevationSystem />
      <ItemSystem />
      <GeometrySystem />
      {structural && <WallSystem />}
      <FloorplanRegistryMoveOverlay />
      <FloorplanRegistryLayer />
    </>
  )
}
async function settle(renderer: Awaited<ReturnType<typeof create>>) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  await renderer.advanceFrames(3, 1 / 60)
}
function worldMatrix(id: AnyNodeId) {
  const mesh = sceneRegistry.nodes.get(id)!
  expect(mesh).toBeDefined()
  mesh.updateWorldMatrix(true, false)
  return mesh.matrixWorld.clone()
}
function expectMatrix(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((v, i) => {
    expect(v).toBeCloseTo(expected.elements[i]!, 6)
  })
}
function svgPose(renderer: Awaited<ReturnType<typeof create>>, id: AnyNodeId) {
  const entries = renderer.scene.findAll((n) => n.props['data-node-id'] === id)
  expect(entries.length).toBeGreaterThan(0)
  const shapes = entries.flatMap((entry) =>
    entry
      .findAll(
        (n) =>
          n.props.points !== undefined ||
          (n.props.width !== undefined && n.props.height !== undefined),
      )
      .map((n) => ({
        points: n.props.points,
        x: n.props.x,
        y: n.props.y,
        width: n.props.width,
        height: n.props.height,
        transform: n.props.transform,
      })),
  )
  expect(shapes.length).toBeGreaterThan(0)
  return shapes
}
async function moving(child: AnyNode) {
  await act(async () => {
    useEditor.getState().setMovingNode(child)
    useEditor.getState().setMovingNodeOrigin('2d')
  })
}
for (const kind of hostKinds)
  for (const childKind of ['item', 'procedural-item'] as const)
    for (const nested of [false, true]) {
      test(`rendered exit ${kind} ${childKind} nested=${nested}`, async () => {
        const { child, level } = fixture(kind, childKind, nested)
        const renderer = await create(<RenderedScene levelId={level.id} />)
        try {
          await settle(renderer)
          const initial = sceneRegistry.nodes
            .get(level.id)!
            .worldToLocal(new Vector3().setFromMatrixPosition(worldMatrix(child.id)))
          await moving(child)
          await pointer('pointermove', [initial.x, initial.z])
          await pointer('pointermove', [8, 8])
          await settle(renderer)
          const preview = worldMatrix(child.id)
          const plan = svgPose(renderer, child.id)
          await pointer('pointerup', [8, 8])
          await settle(renderer)
          expectMatrix(preview, worldMatrix(child.id))
          expect(svgPose(renderer, child.id)).toEqual(plan)
        } finally {
          await renderer.unmount()
        }
      })
    }
for (const childKind of ['item', 'procedural-item'] as const) {
  test(`pitched named retention renders and commits ${childKind}`, async () => {
    const { child, host, level } = fixture('named', childKind, true)
    const nodes = useScene.getState().nodes
    const generated = nodes[host.id] as ProceduralItemNode
    generated.recipe = structuredClone(generated.recipe)
    generated.recipe.surfaces[0]!.rotation = [0.2, 0.4, 0]
    if (child.type === 'procedural-item') {
      child.recipe = structuredClone(child.recipe)
      child.recipe.parts[0]!.shapes.push({
        id: 'wing',
        primitive: 'box',
        size: [0.15, 0.1, 0.3],
        position: [0.12, 0.05, -0.05],
        slot: 'body',
      })
    }
    useScene.setState({ nodes: { ...nodes, [child.id]: child } })
    const attachments = structuredClone(generated.attachments)
    const renderer = await create(<RenderedScene levelId={level.id} />)
    try {
      await settle(renderer)
      const initial = sceneRegistry.nodes
        .get(level.id)!
        .worldToLocal(new Vector3().setFromMatrixPosition(worldMatrix(child.id)))
      await moving(child)
      await pointer('pointermove', [initial.x, initial.z])
      await pointer('pointermove', [initial.x, initial.z + 0.1])
      await settle(renderer)
      expect(getEffectiveNode(useScene.getState().nodes[child.id]!).parentId).toBe(host.id)
      const preview = worldMatrix(child.id),
        plan = svgPose(renderer, child.id)
      await pointer('pointerup', [initial.x, initial.z + 0.1])
      await settle(renderer)
      expectMatrix(preview, worldMatrix(child.id))
      expect(svgPose(renderer, child.id)).toEqual(plan)
      expect((useScene.getState().nodes[host.id] as ProceduralItemNode).attachments).toEqual(
        attachments,
      )
    } finally {
      await renderer.unmount()
    }
  })
}
for (const yaw of [0.5, 1.77, 3, -2.2])
  test(`canonical exit yaw ${yaw}`, async () => {
    const { child, host, level } = fixture('item', 'item', false)
    const nodes = useScene.getState().nodes
    useScene.setState({
      nodes: { ...nodes, [host.id]: { ...nodes[host.id], rotation: [0, yaw - 0.2, 0] } as AnyNode },
    })
    const renderer = await create(<RenderedScene levelId={level.id} />)
    try {
      await settle(renderer)
      const origin = sceneRegistry.nodes
        .get(level.id)!
        .worldToLocal(new Vector3().setFromMatrixPosition(worldMatrix(child.id)))
      await moving(child)
      await pointer('pointermove', [origin.x, origin.z])
      await pointer('pointermove', [8, 8])
      await pointer('pointerup', [8, 8])
      await settle(renderer)
      const committed = useScene.getState().nodes[child.id] as ItemNode
      const levelMatrix = sceneRegistry.nodes.get(level.id)!.matrixWorld
      const rendered = levelMatrix.clone().invert().multiply(worldMatrix(child.id))
      expect(Math.atan2(rendered.elements[8]!, rendered.elements[10]!)).toBeCloseTo(yaw)
      expect(committed.rotation[0]).toBe(0)
      expect(committed.rotation[1]).toBeCloseTo(yaw)
      expect(committed.rotation[2]).toBe(0)
      const geometry = buildItemFloorplan(committed, {
        resolve: (id) => useScene.getState().nodes[id],
      } as never)!
      expect(geometry.kind).toBe('group')
      if (geometry.kind !== 'group') throw new Error('Expected item group')
      const polygon = geometry.children[0]!
      if (polygon.kind !== 'polygon') throw new Error('Expected item footprint')
      const [a, b] = polygon.points
      expect(Math.atan2(-(b![1] - a![1]), b![0] - a![0])).toBeCloseTo(yaw)
    } finally {
      await renderer.unmount()
    }
  })
for (const kind of ['shelf', 'counter', 'bar', 'item', 'named'] as const)
  test(`registry pointer picks up procedural ${kind}`, async () => {
    const { child, level } = fixture(kind, 'procedural-item', false)
    const renderer = await create(<RenderedScene levelId={level.id} />)
    try {
      await settle(renderer)
      const entry = renderer.scene.findAll(
        (n) => n.props['data-node-id'] === child.id && typeof n.props.onPointerDown === 'function',
      )[0]!
      expect(entry).toBeDefined()
      const origin = nodeLevelFrame(child.id, useScene.getState().nodes).position
      await act(async () =>
        entry.props.onPointerDown({
          button: 0,
          clientX: origin[0],
          clientY: origin[2],
          pointerId: 1,
          preventDefault() {},
          stopPropagation() {},
        }),
      )
      await pointer('pointermove', [origin[0] + 6, origin[2]])
      expect(useInteractionScope.getState().scope.kind).toBe('moving')
      await pointer('pointermove', [origin[0] + 6, origin[2]])
      await pointer('pointermove', [25, 25])
      await pointer('pointerup', [25, 25])
      await settle(renderer)
      expect(useScene.getState().nodes[child.id]?.parentId).toBe(level.id)
    } finally {
      await renderer.unmount()
    }
  })
test('preview ticks and descendant invalidation survive dirty drains; Escape preserves persisted scene', async () => {
  const { child, level } = fixture('named', 'item', false)
  const lamp = ItemNode.parse({ asset, parentId: child.id, position: [0, 0.2, 0] })
  const nodes = useScene.getState().nodes
  useScene.setState({
    nodes: { ...nodes, [child.id]: { ...child, children: [lamp.id] }, [lamp.id]: lamp },
  })
  const baselineNodes = useScene.getState().nodes
  const baseline = JSON.stringify(baselineNodes)
  let sounds = 0
  const tick = () => {
    sounds++
  }
  sfxEmitter.on('sfx:grid-snap', tick)
  const renderer = await create(<RenderedScene levelId={level.id} />)
  try {
    await settle(renderer)
    await moving(useScene.getState().nodes[child.id]!)
    const origin = nodeLevelFrame(child.id, useScene.getState().nodes).position
    await pointer('pointermove', [origin[0], origin[2]])
    sounds = 0
    for (const p of [
      [8, 8],
      [9, 9],
      [10, 10],
    ]) {
      useScene.getState().dirtyNodes.clear()
      await pointer('pointermove', p)
      expect(useScene.getState().dirtyNodes.has(lamp.id)).toBe(true)
    }
    expect(sounds).toBe(3)
    useScene.getState().dirtyNodes.clear()
    await act(async () =>
      window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })),
    )
    expect(useScene.getState().dirtyNodes.has(lamp.id)).toBe(true)
    expect(JSON.stringify(useScene.getState().nodes)).toBe(baseline)
    expect(useScene.getState().nodes).toBe(baselineNodes)
  } finally {
    sfxEmitter.off('sfx:grid-snap', tick)
    await renderer.unmount()
  }
})

test('nested catalog plan footprint and pickup agree with the mounted mesh', async () => {
  const { child, level } = fixture('shelf', 'item', true)
  const renderer = await create(<RenderedScene levelId={level.id} />)
  try {
    await settle(renderer)
    const local = sceneRegistry.nodes
      .get(level.id)!
      .worldToLocal(new Vector3().setFromMatrixPosition(worldMatrix(child.id)))
    const plan = buildItemFloorplan(
      child as ItemNode,
      { resolve: (id) => useScene.getState().nodes[id] } as never,
    )!
    if (plan.kind !== 'group' || plan.children[0]?.kind !== 'polygon')
      throw new Error('Missing polygon')
    const points = plan.children[0].points
    expect(points.reduce((s, p) => s + p[0], 0) / points.length).toBeCloseTo(local.x)
    expect(points.reduce((s, p) => s + p[1], 0) / points.length).toBeCloseTo(local.z)
    const before = worldMatrix(child.id)
    await moving(child)
    await pointer('pointermove', [local.x, local.z])
    await settle(renderer)
    expectMatrix(worldMatrix(child.id), before)
  } finally {
    await renderer.unmount()
  }
})

test('movement sound follows preview steps rather than the unchanged committed node', async () => {
  const { child, level } = fixture('named', 'item', false)
  let count = 0
  const tick = () => {
    count++
  }
  sfxEmitter.on('sfx:grid-snap', tick)
  const renderer = await create(<RenderedScene levelId={level.id} />)
  try {
    await settle(renderer)
    await moving(child)
    await pointer('pointermove', [0, 0])
    count = 0
    await pointer('pointermove', [8, 8])
    await pointer('pointermove', [8, 8])
    await pointer('pointermove', [9, 9])
    expect(count).toBe(2)
  } finally {
    sfxEmitter.off('sfx:grid-snap', tick)
    await renderer.unmount()
  }
})

test('fresh procedural preset subtree remains on floor and commits remapped attachment IDs', async () => {
  const { host, child, level } = fixture('named', 'procedural-item', false)
  const nodes = useScene.getState().nodes
  const fresh = { ...nodes[host.id]!, metadata: { isNew: true } }
  useScene.setState({ nodes: { ...nodes, [host.id]: fresh } })
  useScene.temporal.getState().clear()
  const renderer = await create(<RenderedScene levelId={level.id} />)
  try {
    await settle(renderer)
    await moving(fresh)
    await pointer('pointermove', [8, 8])
    await settle(renderer)
    const preview = worldMatrix(host.id)
    await pointer('pointerup', [8, 8])
    await settle(renderer)
    expect(useScene.getState().nodes[host.id]).toBeUndefined()
    expect(useScene.getState().nodes[child.id]).toBeUndefined()
    const committed = Object.values(useScene.getState().nodes).find(
      (n) => n.type === 'procedural-item' && n.parentId === level.id,
    ) as ProceduralItemNode
    expect(committed).toBeDefined()
    expect(committed.position).toEqual([8, 0, 8])
    expect(committed.children).toHaveLength(1)
    const nested = useScene.getState().nodes[committed.children[0]!]!
    expect(nested.parentId).toBe(committed.id)
    expect(committed.attachments[nested.id]).toBe('top')
    expect(Object.keys(committed.attachments)).toEqual([nested.id])
    expectMatrix(worldMatrix(committed.id), preview)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[committed.id]).toBeUndefined()
    expect(useScene.getState().nodes[nested.id]).toBeUndefined()
  } finally {
    await renderer.unmount()
  }
})

for (const mounting of ['wall', 'roof', 'ceiling'] as const)
  test(`shared frame preserves ${mounting}-mounted item ancestry`, async () => {
    const { WallNode, RoofNode, RoofSegmentNode, CeilingNode } = await import('@pascal-app/core')
    const definitions = await Promise.all([
      import('../wall/definition'),
      import('../roof/definition'),
      import('../roof-segment/definition'),
      import('../ceiling/definition'),
    ])
    for (const def of [
      definitions[0].wallDefinition,
      definitions[1].roofDefinition,
      definitions[2].roofSegmentDefinition,
      definitions[3].ceilingDefinition,
    ]) {
      if (def.renderer?.kind === 'parametric') await def.renderer.module()
      registerNode({ ...def, renderer: def.renderer && { ...def.renderer } } as never)
    }
    const { child, host, level } = fixture('item', 'item', false)
    const nodes = useScene.getState().nodes
    const wall = WallNode.parse({
      parentId: level.id,
      start: [2, 3],
      end: [6, 5],
      thickness: 0.4,
      children: [host.id],
    })
    const roof = RoofNode.parse({ parentId: level.id, position: [2, 0, 3], rotation: 0.3 })
    const segment = RoofSegmentNode.parse({
      parentId: roof.id,
      position: [1, 2, 1],
      rotation: 0.2,
      children: [host.id],
    })
    const ceiling = CeilingNode.parse({
      parentId: level.id,
      polygon: [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ],
      children: [host.id],
    })
    const parent = mounting === 'wall' ? wall : mounting === 'roof' ? segment : ceiling
    const mounted = ItemNode.parse({
      ...host,
      parentId: parent.id,
      position: [1, 0.5, 0],
      rotation: [0, 0.2, 0],
      asset: {
        ...(host as ItemNode).asset,
        attachTo: mounting === 'ceiling' ? 'ceiling' : 'wall-side',
      },
      side: 'front',
      ...(mounting === 'roof' ? { roofSegmentId: segment.id, roofFace: 'front' } : {}),
    })
    useScene.setState({
      nodes: {
        ...nodes,
        [host.id]: { ...mounted, children: [child.id] },
        [parent.id]: parent,
        ...(mounting === 'roof' ? { [roof.id]: { ...roof, children: [segment.id] } } : {}),
        [level.id]: { ...level, children: [mounting === 'roof' ? roof.id : parent.id] },
      },
    })
    const renderer = await create(<RenderedScene levelId={level.id} structural />)
    try {
      await settle(renderer)
      const graph = useScene.getState().nodes
      const plan = buildItemFloorplan(child as ItemNode, { resolve: (id) => graph[id] } as never)!
      if (plan.kind !== 'group' || plan.children[0]?.kind !== 'polygon')
        throw new Error('Missing plan footprint')
      const points = plan.children[0].points
      const center = [
        points.reduce((s, p) => s + p[0], 0) / 4,
        points.reduce((s, p) => s + p[1], 0) / 4,
      ]
      const actual = sceneRegistry.nodes
        .get(level.id)!
        .worldToLocal(new Vector3().setFromMatrixPosition(worldMatrix(child.id)))
      if (mounting === 'roof') {
        // Production plan rendering uses stored roof-face Z, not the wall-side thickness offset.
        const { getRoofWallFaceFrame, roofFacePointToSegment } = await import('@pascal-app/core')
        const face = getRoofWallFaceFrame(segment, mounted.roofFace!)
        const local = roofFacePointToSegment(segment, mounted.roofFace!, mounted.position)
        const expected = transformPoint(
          frame(roof.position, [0, roof.rotation, 0]),
          transformPoint(
            frame(segment.position, [0, segment.rotation, 0]),
            transformPoint(frame(local, [0, face.yaw + mounted.rotation[1], 0]), child.position),
          ),
        )
        expect(center[0]).toBeCloseTo(expected[0])
        expect(center[1]).toBeCloseTo(expected[2])
      } else {
        expect(center[0]).toBeCloseTo(actual.x)
        expect(center[1]).toBeCloseTo(actual.z)
      }
      const beforeDrag = worldMatrix(child.id)
      await moving(child)
      await pointer('pointermove', center)
      await settle(renderer)
      if (mounting !== 'ceiling') expectMatrix(worldMatrix(child.id), beforeDrag)
      const override = useLiveNodeOverrides.getState().get(child.id)
      expect(override).toBeDefined()
      await pointer('pointermove', [8, 8])
      const exit = useLiveNodeOverrides.getState().get(child.id)!
      expect(exit.parentId).toBe(level.id)
      const position = exit.position as number[]
      expect(position[0]).toBeCloseTo(8)
      expect(position[2]).toBeCloseTo(8)
      await settle(renderer)
      const preview = worldMatrix(child.id),
        planPreview = svgPose(renderer, child.id)
      await pointer('pointerup', [8, 8])
      await settle(renderer)
      expectMatrix(worldMatrix(child.id), preview)
      expect(svgPose(renderer, child.id)).toEqual(planPreview)
    } finally {
      await renderer.unmount()
    }
  })

function withoutLabels(element: ReactNode): ReactNode {
  if (!isValidElement<{ children?: ReactNode }>(element)) return element
  if (element.type === Html) return null
  return cloneElement(element, {}, Children.map(element.props.children, withoutLabels))
}
function CatalogMover({ source }: { source: ItemNode }) {
  const node = useMemo(() => structuredClone(source), [source])
  return withoutLabels(MoveItemTool({ node }))
}
for (const phase of ['retained', 'exited', 'floor'])
  for (const key of ['r', 't'])
    test(`2D drag does not commit ${key} rotation ${phase}`, async () => {
      const hosted = phase !== 'floor'
      const { child, host, level } = fixture('item', 'item', false)
      let source = child as ItemNode
      if (!hosted) {
        source = { ...source, parentId: level.id, position: [2, 0, 3] }
        useScene.setState({
          nodes: {
            ...useScene.getState().nodes,
            [source.id]: source,
            [host.id]: { ...host, children: [] } as AnyNode,
            [level.id]: { ...level, children: [source.id] },
          },
        })
      }
      const renderer = await create(
        <>
          <RenderedScene levelId={level.id} />
          <CatalogMover source={source} />
        </>,
      )
      try {
        await settle(renderer)
        await moving(source)
        const origin = nodeLevelFrame(source.id, useScene.getState().nodes).position
        const point = phase === 'retained' ? [origin[0], origin[2]] : [8, 8]
        await pointer('pointermove', point)
        await pointer('pointermove', point)
        const rotation = [
          ...(getEffectiveNode(useScene.getState().nodes[source.id]!) as ItemNode).rotation,
        ]
        await act(async () => window.dispatchEvent(Object.assign(new Event('keydown'), { key })))
        await pointer('pointermove', [point[0]! + 0.01, point[1]!])
        await pointer('pointerup', [point[0]! + 0.01, point[1]!])
        await settle(renderer)
        expect((useScene.getState().nodes[source.id] as ItemNode).rotation).toEqual(rotation)
      } finally {
        await renderer.unmount()
      }
    })
for (const kind of hostKinds)
  for (const childKind of ['item', 'procedural-item'] as const)
    test(`rendered retention ${kind} ${childKind}`, async () => {
      const { child, host, level } = fixture(kind, childKind, true)
      const renderer = await create(<RenderedScene levelId={level.id} />)
      try {
        await settle(renderer)
        const local = sceneRegistry.nodes
          .get(level.id)!
          .worldToLocal(new Vector3().setFromMatrixPosition(worldMatrix(child.id)))
        await moving(child)
        await pointer('pointermove', [local.x, local.z])
        await pointer('pointermove', [local.x + 0.02, local.z])
        await settle(renderer)
        const preview = worldMatrix(child.id),
          plan = svgPose(renderer, child.id)
        expect(getEffectiveNode(useScene.getState().nodes[child.id]!).parentId).toBe(host.id)
        await pointer('pointerup', [local.x + 0.02, local.z])
        await settle(renderer)
        expectMatrix(worldMatrix(child.id), preview)
        expect(svgPose(renderer, child.id)).toEqual(plan)
      } finally {
        await renderer.unmount()
      }
    })

test('Escape is a persistence no-op after an exit preview', async () => {
  const { child, level } = fixture('named', 'procedural-item', false)
  const renderer = await create(<RenderedScene levelId={level.id} />)
  try {
    await settle(renderer)
    const baseline = useScene.getState().nodes
    const baselinePose = worldMatrix(child.id),
      baselinePlan = svgPose(renderer, child.id)
    await moving(child)
    await pointer('pointermove', [0, 0])
    await pointer('pointermove', [8, 8])
    await act(async () =>
      window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })),
    )
    expect(useScene.getState().nodes).toBe(baseline)
    await settle(renderer)
    expectMatrix(worldMatrix(child.id), baselinePose)
    expect(svgPose(renderer, child.id)).toEqual(baselinePlan)
  } finally {
    await renderer.unmount()
  }
})

function DrawProbe({ draw }: { draw: () => void }) {
  useFrame(draw, 1)
  return null
}
test('exit preview is corrected before the priority-1 draw', async () => {
  const { child, level } = fixture('named', 'procedural-item', true)
  let drawn: Matrix4 | undefined
  const renderer = await create(
    <>
      <RenderedScene levelId={level.id} />
      <DrawProbe
        draw={() => {
          if (sceneRegistry.nodes.has(child.id)) drawn = worldMatrix(child.id)
        }}
      />
    </>,
  )
  try {
    await settle(renderer)
    await moving(child)
    await pointer('pointermove', [0, 0])
    await pointer('pointermove', [8, 8])
    await renderer.advanceFrames(1, 1 / 60)
    const preview = drawn!.clone()
    await pointer('pointerup', [8, 8])
    await settle(renderer)
    expectMatrix(preview, worldMatrix(child.id))
  } finally {
    await renderer.unmount()
  }
})

function MovingCatalog({ source }: { source: ItemNode }) {
  const moving = useInteractionScope((s) => s.scope.kind === 'moving')
  return moving ? <CatalogMover source={source} /> : null
}
test('concurrent catalog cancel restores serialized scene', async () => {
  const { child, level } = fixture('named', 'item', false)
  const renderer = await create(
    <>
      <RenderedScene levelId={level.id} />
      <MovingCatalog source={child as ItemNode} />
    </>,
  )
  try {
    await settle(renderer)
    const baseline = useScene.getState().nodes
    await moving(child)
    await pointer('pointermove', [0, 0])
    await pointer('pointermove', [8, 8])
    await act(async () =>
      window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })),
    )
    await settle(renderer)
    expect(JSON.stringify(useScene.getState().nodes)).toBe(JSON.stringify(baseline))
  } finally {
    await renderer.unmount()
  }
})

for (const finish of ['Escape', 'return'] as const)
  test(`audit: scaled host exit restores mounted transform on ${finish}`, async () => {
    const { child, host, level } = fixture('item', 'item', false)
    const renderer = await create(<RenderedScene levelId={level.id} />)
    try {
      await settle(renderer)
      sceneRegistry.nodes.get(host.id)!.scale.setScalar(2)
      const baseline = worldMatrix(child.id)
      const origin = nodeLevelFrame(child.id, useScene.getState().nodes).position
      await moving(child)
      await pointer('pointermove', [origin[0], origin[2]])
      await pointer('pointermove', [8, 8])
      await settle(renderer)
      if (finish === 'Escape')
        await act(async () =>
          window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })),
        )
      else await pointer('pointermove', [origin[0], origin[2]])
      await settle(renderer)
      expectMatrix(worldMatrix(child.id), baseline)
    } finally {
      await renderer.unmount()
    }
  })

for (const changeAt of ['tick', 'commit'] as const)
  test(`audit: retention reads live shelf width at ${changeAt}`, async () => {
    const { child, host, level } = fixture('shelf', 'item', false)
    const source = { ...child, position: [0.8, child.position[1], 0] } as ItemNode
    useScene.setState({ nodes: { ...useScene.getState().nodes, [child.id]: source } })
    const renderer = await create(<RenderedScene levelId={level.id} />)
    try {
      await settle(renderer)
      const origin = nodeLevelFrame(child.id, useScene.getState().nodes).position
      await moving(source)
      await pointer('pointermove', [origin[0], origin[2]])
      await act(async () => useScene.getState().updateNode(host.id, { width: 0.5 } as never))
      if (changeAt === 'tick') {
        await pointer('pointermove', [origin[0], origin[2]])
        expect(getEffectiveNode(useScene.getState().nodes[child.id]!).parentId).toBe(level.id)
      }
      await pointer('pointerup', [origin[0], origin[2]])
      expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
    } finally {
      await renderer.unmount()
    }
  })

for (const kind of ['item', 'procedural-item'] as const)
  test(`audit: tilted surface exit matches the asset-specific 3D detach policy ${kind}`, async () => {
    const { child, host, level } = fixture('named', kind, false)
    const nodes = useScene.getState().nodes
    const generated = nodes[host.id] as ProceduralItemNode
    generated.recipe = structuredClone(generated.recipe)
    generated.recipe.surfaces[0]!.rotation = [0.3, 1.7, 0.1]
    useScene.setState({ nodes: { ...nodes } })
    const renderer = await create(<RenderedScene levelId={level.id} />)
    try {
      await settle(renderer)
      const { surfaceFramePose } = await import('../../../editor/src/lib/surface-attachment')
      const { createRegistryItemSurfaceMove } = await import(
        '../../../editor/src/components/tools/registry/item-surface-move'
      )
      const adopted = surfaceFramePose(host.id, 'top', child, false)
      const levelYaw = new Euler().setFromQuaternion(
        sceneRegistry.nodes.get(level.id)!.getWorldQuaternion(new Quaternion()),
        'YXZ',
      ).y
      const meshYaw = new Euler().setFromQuaternion(
        sceneRegistry.nodes.get(child.id)!.getWorldQuaternion(new Quaternion()),
        'YXZ',
      ).y
      const expected =
        kind === 'item'
          ? [adopted.rotation[0], meshYaw - levelYaw, adopted.rotation[2]]
          : [
              child.rotation[0],
              createRegistryItemSurfaceMove(child)!.worldYaw(child.rotation[1]) - levelYaw,
              child.rotation[2],
            ]
      await moving(child)
      await pointer('pointermove', [0, 0])
      await pointer('pointermove', [8, 8])
      await pointer('pointerup', [8, 8])
      const result = useScene.getState().nodes[child.id] as ItemNode
      result.rotation.forEach((v, i) => {
        expect(v).toBeCloseTo(expected[i]!, 6)
      })
    } finally {
      await renderer.unmount()
    }
  })

test('audit: procedural pickup does not enable a new plain 3D drag gesture', () => {
  expect(proceduralItemDefinition.capabilities.movable?.directDrag).toBe(
    itemDefinition.capabilities.movable?.directDrag,
  )
})

test('audit: block top exit clears face storage and lands upright at the floor datum', async () => {
  const { BlockNode, getBlockFaceFrame } = await import('@pascal-app/core')
  const { blockDefinition } = await import('../block/definition')
  registerNode(blockDefinition)
  const { child, level } = fixture('item', 'item', false)
  const block = BlockNode.parse({
    parentId: level.id,
    position: [2, 0, 3],
    rotation: 0.6,
    children: [child.id],
  })
  const face = block.topology.faces.find(
    (f) => getBlockFaceFrame(block.topology, f.id)!.normal[1] > 0.99,
  )!
  const source = {
    ...child,
    parentId: block.id,
    position: [0, 0, 0] as [number, number, number],
    rotation: [Math.PI / 2, 0, 0] as [number, number, number],
    blockFaceId: face.id,
  }
  useScene.setState({
    nodes: {
      ...useScene.getState().nodes,
      [child.id]: source,
      [block.id]: block,
      [level.id]: { ...level, children: [block.id] },
    },
  })
  const renderer = await create(<RenderedScene levelId={level.id} />)
  try {
    await settle(renderer)
    await moving(source)
    await pointer('pointermove', [0, 0])
    await pointer('pointermove', [8, 8])
    await settle(renderer)
    const before = worldMatrix(child.id)
    await pointer('pointerup', [8, 8])
    await settle(renderer)
    const result = useScene.getState().nodes[child.id] as ItemNode
    expect(result.parentId).toBe(level.id)
    expect(result.blockFaceId).toBeUndefined()
    expect(result.position[1]).toBe(0)
    expect(result.rotation[0]).toBe(0)
    expect(result.rotation[2]).toBe(0)
    expectMatrix(worldMatrix(child.id), before)
  } finally {
    await renderer.unmount()
  }
})

test('audit: unmount releases every imperative exit transform', async () => {
  const { child, level } = fixture('item', 'item', false)
  const renderer = await create(<RenderedScene levelId={level.id} />)
  let unmounted = false
  try {
    await settle(renderer)
    const mesh = sceneRegistry.nodes.get(child.id)!
    const position = mesh.position.clone(),
      quaternion = mesh.quaternion.clone(),
      scale = mesh.scale.clone()
    await moving(child)
    await pointer('pointermove', [0, 0])
    await pointer('pointermove', [8, 8])
    await settle(renderer)
    await renderer.unmount()
    unmounted = true
    expect(mesh.matrixAutoUpdate).toBe(true)
    expect(mesh.position.toArray()).toEqual(position.toArray())
    expect(mesh.quaternion.toArray()).toEqual(quaternion.toArray())
    expect(mesh.scale.toArray()).toEqual(scale.toArray())
  } finally {
    if (!unmounted) await renderer.unmount()
  }
})

for (const kind of ['fence', 'imported-mesh', 'plugin', 'ineligible-plugin', 'slab'] as const)
  for (const childKind of ['item', 'procedural-item'] as const)
    for (const overSlab of [true, false])
      test(`review bot: generic parent exit ${kind} ${childKind} slab=${overSlab}`, async () => {
        const { FenceNode, ImportedMeshNode, nodeType, objectId } = await import('@pascal-app/core')
        const { fenceDefinition } = await import('../fence/definition')
        const { importedMeshDefinition } = await import('../imported-mesh/definition')
        const { slabDefinition } = await import('../slab/definition')
        registerNode(fenceDefinition)
        registerNode(importedMeshDefinition)
        registerNode(slabDefinition)
        const pluginSchema = ShelfNode.extend({
          type: nodeType('review:host'),
          id: objectId('reviewhost'),
        })
        const schema =
          kind === 'ineligible-plugin' ? pluginSchema.omit({ children: true }) : pluginSchema
        registerNode({
          kind: 'review:host',
          schemaVersion: 1,
          schema,
          category: 'furnish',
          defaults: () => ({}),
          capabilities: { dragBounds: () => ({ size: [2, 1, 2], center: [0, 0.5, 0] }) },
          geometry: () => {
            const group = new Group()
            group.add(
              new Mesh(new BoxGeometry(2, 1, 2).translate(0, 0.5, 0), new MeshBasicMaterial()),
            )
            return group
          },
        } as never)
        const { child, host: ancestor, level, slab } = fixture('item', childKind, false)
        const parent =
          kind === 'fence'
            ? FenceNode.parse({ parentId: ancestor.id, start: [-1, 0], end: [1, 0], height: 1 })
            : kind === 'imported-mesh'
              ? ImportedMeshNode.parse({
                  parentId: level.id,
                  position: [2, 0.6, 3],
                  rotation: [0, 0.6, 0],
                  primitives: [
                    { positions: [-1, 1, -1, 1, 1, 1, 1, 1, -1, -1, 1, -1, -1, 1, 1, 1, 1, 1] },
                  ],
                })
              : kind === 'slab'
                ? slab
                : schema.parse({ parentId: level.id, position: [2, 0.6, 3], rotation: [0, 0.6, 0] })
        const source = {
          ...child,
          parentId: parent.id,
          position: [0, kind === 'slab' ? slab.elevation : 1, 0],
          rotation: [0, 0.2, 0],
          supportSlabId: undefined,
        } as typeof child
        const graph = {
          ...useScene.getState().nodes,
          [child.id]: source,
          [ancestor.id]: { ...ancestor, children: kind === 'fence' ? [parent.id] : [] },
          [parent.id]: { ...parent, children: [child.id] },
          [level.id]: {
            ...level,
            children:
              kind === 'fence'
                ? [slab.id, ancestor.id]
                : kind === 'slab'
                  ? [slab.id]
                  : [slab.id, parent.id],
          },
        } as Record<AnyNodeId, AnyNode>
        useScene.setState({ nodes: graph })
        useScene.temporal.getState().clear()
        const baseline = structuredClone(graph)
        const renderer = await create(<RenderedScene levelId={level.id} />)
        try {
          await settle(renderer)
          if (kind === 'fence') {
            useScene.getState().markDirty(ancestor.id)
            await renderer.advanceFrames(1, 1 / 60)
          }
          const baselineMatrix = worldMatrix(child.id)
          const initial = sceneRegistry.nodes
            .get(level.id)!
            .matrixWorld.clone()
            .invert()
            .multiply(baselineMatrix)
          const heading = Math.atan2(initial.elements[8]!, initial.elements[10]!)
          const footprint = svgPose(renderer, child.id)[0]!
          const points =
            typeof footprint.points === 'string'
              ? footprint.points.split(' ').map((p) => p.split(',').map(Number))
              : [
                  [
                    Number(footprint.x) + Number(footprint.width) / 2,
                    Number(footprint.y) + Number(footprint.height) / 2,
                  ],
                ]
          const pickup = [0, 1].map(
            (axis) => points.reduce((sum, p) => sum + p[axis]!, 0) / points.length,
          )
          const target = overSlab ? [8, 8] : [14, 14]
          await moving(source)
          await pointer('pointermove', pickup)
          await pointer('pointermove', target)
          await settle(renderer)
          const preview = worldMatrix(child.id)
          const plan = svgPose(renderer, child.id)
          await pointer('pointerup', target)
          await settle(renderer)
          const committed = useScene.getState().nodes[child.id] as ItemNode
          expect(committed.parentId).toBe(level.id)
          expect(committed.position[1]).toBe(0)
          expect(committed.position[0]).toBeCloseTo(target[0]!)
          expect(committed.position[2]).toBeCloseTo(target[1]!)
          expect(committed.rotation[0]).toBe(0)
          expect(committed.rotation[1]).toBeCloseTo(heading)
          expect(committed.rotation[2]).toBe(0)
          expect(committed.supportSlabId).toBe(overSlab ? slab.id : undefined)
          const rendered = worldMatrix(child.id)
          const actual = sceneRegistry.nodes
            .get(level.id)!
            .matrixWorld.clone()
            .invert()
            .multiply(rendered)
          expect(actual.elements[13]).toBeCloseTo(overSlab ? slab.elevation : 0)
          expect(Math.atan2(actual.elements[8]!, actual.elements[10]!)).toBeCloseTo(heading)
          expectMatrix(preview, worldMatrix(child.id))
          expect(svgPose(renderer, child.id)).toEqual(plan)
          expect(
            (useScene.getState().nodes[parent.id] as { children: string[] }).children,
          ).not.toContain(child.id)
          expect(
            (useScene.getState().nodes[level.id] as LevelNode).children.filter(
              (id) => id === child.id,
            ),
          ).toHaveLength(1)
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
          await act(async () => useScene.temporal.getState().undo())
          await settle(renderer)
          expect(useScene.getState().nodes).toEqual(baseline)
          expectMatrix(worldMatrix(child.id), baselineMatrix)
        } finally {
          await renderer.unmount()
        }
      })

for (const kind of ['item', 'shelf', 'generated'] as const)
  test(`review bot: block face frame composes ${kind} ancestor and one slab lift`, async () => {
    const { BlockNode, getBlockFaceFrame } = await import('@pascal-app/core')
    const { blockDefinition } = await import('../block/definition')
    registerNode(blockDefinition)
    const { child, host, level, slab } = fixture(kind, 'item', false)
    const block = BlockNode.parse({
      parentId: host.id,
      position: [0.3, 1, 0.2],
      rotation: 0.4,
      children: [child.id],
    })
    const face = block.topology.faces.find(
      (f) => getBlockFaceFrame(block.topology, f.id)!.normal[2] > 0.99,
    )!
    const source = {
      ...child,
      parentId: block.id,
      position: [0.1, 0.2, 0.05],
      rotation: [0, 0.2, 0],
      blockFaceId: face.id,
    } as ItemNode
    const graph = {
      ...useScene.getState().nodes,
      [child.id]: source,
      [host.id]: { ...host, children: [block.id] },
      [block.id]: block,
    } as Record<AnyNodeId, AnyNode>
    useScene.setState({ nodes: graph })
    const renderer = await create(<RenderedScene levelId={level.id} />)
    try {
      await settle(renderer)
      useScene.getState().markDirty(host.id)
      await renderer.advanceFrames(1, 1 / 60)
      const rendered = worldMatrix(child.id)
      const actual = sceneRegistry.nodes
        .get(level.id)!
        .matrixWorld.clone()
        .invert()
        .multiply(rendered)
      const faceFrame = getBlockFaceFrame(block.topology, face.id)!
      expect(actual.elements[13]).toBeCloseTo(
        slab.elevation + block.position[1] + faceFrame.origin[1] + source.position[1],
      )
      const resolved = nodeLevelFrame(child.id, graph)
      resolved.position.forEach((v, i) => {
        expect(v).toBeCloseTo(actual.elements[12 + i]!, 6)
      })
      resolved.axes.forEach((axis, i) => {
        axis.forEach((v, j) => {
          expect(v).toBeCloseTo(actual.elements[i * 4 + j]!, 6)
        })
      })
    } finally {
      await renderer.unmount()
    }
  })

for (const kind of ['shelf', 'plugin'] as const)
  for (const check of ['frame', 'plan'] as const)
    test(`review bot 2: ${kind} named attachment ${check}`, async () => {
      const { nodeType, objectId } = await import('@pascal-app/core')
      const schema = ShelfNode.extend({
        type: nodeType('review:child'),
        id: objectId('reviewchild'),
      })
      registerNode({
        kind: 'review:child',
        schemaVersion: 1,
        schema,
        category: 'furnish',
        defaults: () => ({}),
        capabilities: {},
        geometry: () => {
          const group = new Group()
          group.add(
            new Mesh(new BoxGeometry(0.6, 0.4, 0.3).translate(0, 0.2, 0), new MeshBasicMaterial()),
          )
          return group
        },
        floorplan: shelfDefinition.floorplan,
      } as never)
      const { host, child, level } = fixture('named', 'item', true)
      const source = (kind === 'shelf' ? ShelfNode : schema).parse({
        parentId: host.id,
        position: [0.2, 0, -0.1],
        rotation: [0, 0.15, 0],
        width: 0.6,
        height: 0.4,
        depth: 0.3,
      })
      const generated = useScene.getState().nodes[host.id] as ProceduralItemNode
      const recipe = structuredClone(generated.recipe)
      recipe.surfaces[0]!.position = [0.4, 1, -0.3]
      recipe.surfaces[0]!.rotation = [0.3, 0.4, 0.1]
      const graph = {
        ...useScene.getState().nodes,
        [host.id]: {
          ...generated,
          recipe,
          children: [source.id],
          attachments: { [source.id]: 'top' },
        },
        [source.id]: source,
      } as Record<AnyNodeId, AnyNode>
      delete graph[child.id]
      useScene.setState({ nodes: graph })
      const renderer = await create(<RenderedScene levelId={level.id} />)
      try {
        await settle(renderer)
        useScene.getState().markDirty(host.parentId as AnyNodeId)
        await renderer.advanceFrames(1, 1 / 60)
        const rendered = worldMatrix(source.id as AnyNodeId)
        const actual = sceneRegistry.nodes
          .get(level.id)!
          .matrixWorld.clone()
          .invert()
          .multiply(rendered)
        if (check === 'frame') {
          const resolved = nodeLevelFrame(source.id, graph)
          resolved.position.forEach((v, i) => {
            expect(v).toBeCloseTo(actual.elements[12 + i]!, 6)
          })
          resolved.axes.forEach((axis, i) => {
            axis.forEach((v, j) => {
              expect(v).toBeCloseTo(actual.elements[i * 4 + j]!, 6)
            })
          })
        } else {
          const entry = renderer.scene.findAll((n) => n.props['data-node-id'] === source.id)[0]!
          const transform = entry.findAll(
            (n) =>
              typeof n.props.transform === 'string' && n.props.transform.startsWith('translate('),
          )[0]!.props.transform as string
          const values = transform.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number)
          expect(values[0]).toBeCloseTo(actual.elements[12]!, 6)
          expect(values[1]).toBeCloseTo(actual.elements[14]!, 6)
          expect((values[2]! * Math.PI) / 180).toBeCloseTo(
            -Math.atan2(actual.elements[8]!, actual.elements[10]!),
            6,
          )
        }
      } finally {
        await renderer.unmount()
      }
    })

for (const hostKind of ['item', 'generated'] as const)
  for (const childKind of ['item', 'procedural-item'] as const)
    test(`review bot 3: undeclared ${hostKind} top retains and exits ${childKind}`, async () => {
      const { child, host, level, slab } = fixture(hostKind, childKind, false)
      const provider = getSurfaceProvider(host)
      if (hostKind === 'item') expect(provider.surfaces).toBeUndefined()
      else expect(provider.surfaces?.(host, { scene: createSceneApi(useScene) })).toEqual([])
      const renderer = await create(<RenderedScene levelId={level.id} />)
      try {
        await settle(renderer)
        const origin = sceneRegistry.nodes
          .get(level.id)!
          .worldToLocal(new Vector3().setFromMatrixPosition(worldMatrix(child.id)))
        await moving(child)
        for (const delta of [0, 0.1, 0.2]) {
          await pointer('pointermove', [origin.x + delta, origin.z])
          await settle(renderer)
          const preview = getEffectiveNode(useScene.getState().nodes[child.id]!) as typeof child
          expect(preview.parentId).toBe(host.id)
          expect(preview.position[1]).toBeCloseTo(child.position[1])
        }
        await pointer('pointermove', [8, 8])
        await settle(renderer)
        const preview = worldMatrix(child.id)
        const plan = svgPose(renderer, child.id)
        await pointer('pointerup', [8, 8])
        await settle(renderer)
        const committed = useScene.getState().nodes[child.id] as typeof child
        expect(committed.parentId).toBe(level.id)
        expect(committed.position[0]).toBeCloseTo(8)
        expect(committed.position[1]).toBe(0)
        expect(committed.position[2]).toBeCloseTo(8)
        expect(committed.supportSlabId).toBe(slab.id)
        expectMatrix(worldMatrix(child.id), preview)
        expect(svgPose(renderer, child.id)).toEqual(plan)
      } finally {
        await renderer.unmount()
      }
    })

for (const childKind of ['item', 'procedural-item'] as const)
  for (const finish of ['occupied', 'exit', 'reentry'] as const)
    test(`review bot 3: named occupancy ${childKind} ${finish}`, async () => {
      const { child, host, level, slab } = fixture('named', childKind, false)
      const source = { ...child, position: [0, 0, 0], rotation: [0, 0.2, 0] } as typeof child
      const occupant = ItemNode.parse({
        asset,
        parentId: host.id,
        position: [0.92, 0, 0],
      })
      const generated = useScene.getState().nodes[host.id] as ProceduralItemNode
      const attachments = { ...generated.attachments, [occupant.id]: 'top' }
      useScene.setState({
        nodes: {
          ...useScene.getState().nodes,
          [child.id]: source,
          [occupant.id]: occupant,
          [host.id]: { ...generated, children: [child.id, occupant.id], attachments },
        },
      })
      useScene.temporal.getState().clear()
      const baseline = structuredClone(useScene.getState().nodes)
      const renderer = await create(<RenderedScene levelId={level.id} />)
      try {
        await settle(renderer)
        const wrapper = sceneRegistry.nodes.get(child.id)!.parent!
        const levelMesh = sceneRegistry.nodes.get(level.id)!
        const planPoint = (x: number) => {
          const point = levelMesh.worldToLocal(wrapper.localToWorld(new Vector3(x, 0, 0)))
          return [point.x, point.z]
        }
        const origin = planPoint(0)
        const valid = planPoint(0.45)
        const occupied = planPoint(0.8)
        const outside = planPoint(1.05)
        await moving(source)
        await pointer('pointermove', origin)
        await pointer('pointermove', valid)
        await settle(renderer)
        const lastValid = getEffectiveNode(useScene.getState().nodes[child.id]!) as typeof child
        expect(lastValid.parentId).toBe(host.id)
        expect(lastValid.position[0]).toBeCloseTo(0.45)
        const hostedPreview = worldMatrix(child.id)
        const hostedPlan = svgPose(renderer, child.id)[0]
        if (finish === 'reentry') {
          await pointer('pointermove', outside)
          await settle(renderer)
          expect(getEffectiveNode(useScene.getState().nodes[child.id]!).parentId).toBe(level.id)
        }
        await pointer('pointermove', occupied)
        await settle(renderer)
        if (finish !== 'exit') {
          const refused = getEffectiveNode(useScene.getState().nodes[child.id]!) as typeof child
          expect(refused.parentId).toBe(host.id)
          expect(refused.position).toEqual(lastValid.position)
          expect(refused.rotation).toEqual(lastValid.rotation)
          expectMatrix(worldMatrix(child.id), hostedPreview)
          expect(svgPose(renderer, child.id)[0]).toEqual(hostedPlan)
        } else {
          await pointer('pointermove', outside)
          await settle(renderer)
        }
        const preview = worldMatrix(child.id)
        const plan = svgPose(renderer, child.id)[0]
        await pointer('pointerup', finish === 'exit' ? outside : occupied)
        await settle(renderer)
        const committed = useScene.getState().nodes[child.id] as typeof child
        const committedHost = useScene.getState().nodes[host.id] as ProceduralItemNode
        if (finish === 'exit') {
          expect(committed.parentId).toBe(level.id)
          expect(committed.position[1]).toBe(0)
          expect(committed.supportSlabId).toBe(slab.id)
          expect(committedHost.attachments[child.id]).toBeUndefined()
          expect(committedHost.children).not.toContain(child.id)
        } else {
          expect(committed.parentId).toBe(host.id)
          expect(committed.position).toEqual(lastValid.position)
          expect(committed.rotation).toEqual(lastValid.rotation)
          expect(committedHost.attachments).toEqual(attachments)
        }
        expectMatrix(worldMatrix(child.id), preview)
        expect(svgPose(renderer, child.id)[0]).toEqual(plan)
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        await act(async () => useScene.temporal.getState().undo())
        expect(useScene.getState().nodes).toEqual(baseline)
      } finally {
        await renderer.unmount()
      }
    })
