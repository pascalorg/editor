/**
 * The node batch inside the real frame pipeline: the viewer systems that rebuild or re-elevate a
 * node run in the same R3F frames as the batch, and the material cache can be cleared under it.
 * Sources are plain meshes registered by hand; the clock is `performance.now`, stepped past the
 * 180 ms quiet window that lets released nodes rejoin.
 */
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  getMaterialPresetByRef,
  LevelNode,
  MATERIAL_CATALOG,
  nodeRegistry,
  registerLibraryMaterials,
  registerNode,
  SiteNode,
  SlabNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { SelectionManager } from '@pascal-app/editor'
import {
  CeilingSystem,
  clearMaterialCache,
  disposeObject3DResources,
  FloorElevationSystem,
  resolveSlotDefaultMaterial,
  SCENE_LAYER,
  useViewer,
} from '@pascal-app/viewer'
import { flushGlobalEffects } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import type { ReactElement } from 'react'
import { BoxGeometry, BufferGeometry, Group, type Material, Mesh, MeshBasicMaterial } from 'three'
import { GeometrySystem } from '../../__tests__/harness'
import { buildSlabGeometry } from '../../slab/geometry'
import { slabPaint } from '../../slab/paint'
import { columnBatchable, itemBatchable, surfaceBatchable } from './batchable'
import { collectBatchCandidate } from './candidates'
import { NodeBatchSystem, resetNodeBatchState } from './system'

let now = 0
let restoreClock: () => void
let restoreRegistry: () => void
const originalViewer = useViewer.getState()
const originalScene = useScene.getState()
const mounted: Awaited<ReturnType<typeof create>>[] = []

let restoreWindow: () => void
beforeEach(() => {
  // The batch system reads `?perf` / `?disable` from the page URL.
  const window = Object.getOwnPropertyDescriptor(globalThis, 'window')
  globalThis.window = Object.assign(new EventTarget(), {
    location: { search: '' },
  }) as unknown as Window & typeof globalThis
  restoreWindow = () => {
    if (window) Object.defineProperty(globalThis, 'window', window)
    else Reflect.deleteProperty(globalThis, 'window')
  }
  now = 0
  const clock = spyOn(performance, 'now').mockImplementation(() => now)
  restoreClock = () => clock.mockRestore()
  restoreRegistry = nodeRegistry._snapshot()
  for (const [kind, batchable] of [
    ['ceiling', surfaceBatchable],
    ['slab', surfaceBatchable],
    ['item', itemBatchable],
  ] as const)
    nodeRegistry._register({ kind, schemaVersion: 1, capabilities: { batchable } } as never)
  sceneRegistry.clear()
  useViewer.setState({
    shading: 'solid',
    textures: true,
    externalSelectedIds: [],
    previewSelectedIds: [],
    hoveredId: null,
    selection: { ...originalViewer.selection, selectedIds: [], levelId: null },
  })
})

afterEach(async () => {
  for (const renderer of mounted.splice(0)) await renderer.unmount()
  resetNodeBatchState()
  sceneRegistry.clear()
  useLiveTransforms.getState().clearAll()
  useScene.setState(originalScene, true)
  useViewer.setState(originalViewer, true)
  restoreRegistry()
  restoreClock()
  restoreWindow()
})

async function mount(element: ReactElement) {
  const renderer = await create(element)
  mounted.push(renderer)
  // One frame of R3F's loop: every subscriber in priority order, then the global after-effects.
  const frame = () =>
    act(async () => {
      await renderer.advanceFrames(1, 1 / 60)
      flushGlobalEffects('after', now)
    })
  return {
    frame,
    /** Two frames 181 ms apart: past the quiet window, so released sources rejoin. */
    async settle() {
      await frame()
      now += 181
      await frame()
    },
  }
}

function level(children: string[] = []) {
  const node = LevelNode.parse({ id: 'level_test', children, height: 3 })
  const root = new Group()
  sceneRegistry.nodes.set(node.id, root)
  sceneRegistry.byType.level!.add(node.id)
  return { node, root }
}
const batches = (root: Group) => root.children.filter((child) => child.name === 'item-batch')
const batched = (mesh: Mesh) => !mesh.layers.isEnabled(SCENE_LAYER)
function onDispose(material: Material) {
  let disposed = 0
  material.addEventListener('dispose', () => disposed++)
  return () => disposed
}

test('slab top, side and skirt are collected with shared defaults; a transparent side keeps its own draw', () => {
  const { node: levelNode, root } = level()
  const site = SiteNode.parse({ id: 'site_test', children: ['building_test'] })
  const building = BuildingNode.parse({
    id: 'building_test',
    parentId: site.id,
    children: [levelNode.id],
  })
  levelNode.parentId = building.id
  const nodes: Record<string, AnyNode> = {
    [site.id]: site,
    [building.id]: building,
    [levelNode.id]: levelNode,
  }
  const ctx = {
    parent: levelNode,
    children: [],
    siblings: [],
    resolve: (id: string) => nodes[id],
  } as never
  const slab = SlabNode.parse({
    id: 'slab_test',
    parentId: levelNode.id,
    elevation: 0.8,
    thickness: 0.2,
    fillToTerrain: true,
    polygon: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
  })
  const first = buildSlabGeometry(slab, ctx, 'solid')
  const second = buildSlabGeometry({ ...slab, id: 'slab_second' }, ctx, 'solid')
  expect(first.children.map((mesh) => mesh.userData.slotId)).toEqual(['surface', 'side', 'side'])
  const [, side, skirt] = first.children as Mesh[]
  expect(side!.material).toBe((second.children[1] as Mesh).material)
  expect(side!.material).toBe(skirt!.material)
  expect(side!.geometry).not.toBe((second.children[1] as Mesh).geometry)

  root.add(first)
  sceneRegistry.nodes.set(slab.id, first)
  useScene.setState({ nodes: { ...nodes, [slab.id]: slab } })
  const entries = collectBatchCandidate(slab.id)!.entries
  expect(entries).toHaveLength(3)
  expect(entries.every((entry) => entry.castShadow && entry.receiveShadow)).toBe(true)

  const glass = SlabNode.parse({ ...slab, slots: { side: 'scene:sm_transparent' } })
  const painted = buildSlabGeometry(
    glass,
    {
      ...ctx,
      materials: {
        sm_transparent: {
          id: 'sm_transparent',
          name: 'Glass',
          material: { properties: { color: '#abcdef', opacity: 0.3, transparent: true } },
        },
      },
    } as never,
    'solid',
  )
  root.add(painted)
  sceneRegistry.nodes.set(slab.id, painted)
  const paintedEntries = collectBatchCandidate(slab.id)!.entries
  expect(paintedEntries.map((entry) => entry.mesh.userData.slotId)).toEqual(['surface'])

  const sideDisposals = onDispose(side!.material as Material)
  disposeObject3DResources(first)
  expect(sideDisposals()).toBe(0)
})

test('clearing the material cache disposes shared slab materials only after the frame, and rebuilds get fresh ones', () => {
  const { node: levelNode } = level()
  const ctx = { parent: levelNode, children: [], siblings: [], resolve: () => undefined } as never
  const preset = {
    ...MATERIAL_CATALOG[0]!,
    id: 'surface-cache-test',
    preset: { ...MATERIAL_CATALOG[0]!.preset, maps: {} },
  }
  registerLibraryMaterials([preset])
  const slab = SlabNode.parse({
    id: 'slab_legacy',
    parentId: levelNode.id,
    materialPreset: 'library:surface-cache-test',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
  })
  useScene.setState({
    nodes: { [levelNode.id]: levelNode, [slab.id]: slab },
    dirtyNodes: new Set(),
  })
  expect(getMaterialPresetByRef(slab.materialPreset!)).toBeDefined()
  const first = buildSlabGeometry(slab, ctx, 'solid')
  const top = (first.children[0] as Mesh).material as Material
  const side = (first.children[1] as Mesh).material as Material
  expect((buildSlabGeometry(slab, ctx, 'solid').children[0] as Mesh).material).toBe(top)
  const topDisposals = onDispose(top)
  const sideDisposals = onDispose(side)
  disposeObject3DResources(first)
  expect(topDisposals() + sideDisposals()).toBe(0)
  expect(top.transparent).toBe(false)

  clearMaterialCache()
  expect(topDisposals() + sideDisposals()).toBe(0)
  expect(useScene.getState().dirtyNodes.has(slab.id)).toBe(true)
  const replacement = buildSlabGeometry(slab, ctx, 'solid')
  expect((replacement.children[0] as Mesh).material).not.toBe(top)
  expect((replacement.children[1] as Mesh).material).not.toBe(side)
  expect((buildSlabGeometry(slab, ctx, 'solid').children[0] as Mesh).material).toBe(
    (replacement.children[0] as Mesh).material,
  )
  flushGlobalEffects('after', 0)
  expect(topDisposals()).toBe(1)
  expect(sideDisposals()).toBe(1)
  expect(resolveSlotDefaultMaterial('#cccccc', 'solid', 0.8)).not.toBe(
    resolveSlotDefaultMaterial('#cccccc', 'rendered', 0.8),
  )
  expect(resolveSlotDefaultMaterial('#cccccc', 'rendered', 0.8)).not.toBe(
    resolveSlotDefaultMaterial('#cccccc', 'rendered', 0.4),
  )
})

test('a ceiling rebuilt in its own frame pass is batched again with the replacement geometry', async () => {
  const { node: levelNode, root } = level()
  const material = new MeshBasicMaterial()
  const nodes: Record<string, AnyNode> = { [levelNode.id]: levelNode }
  const meshes = Array.from({ length: 4 }, (_, i) => {
    const node = CeilingNode.parse({
      id: `ceiling_${i}`,
      parentId: levelNode.id,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      height: 3,
    })
    nodes[node.id] = node
    // Empty until the ceiling system builds it from the dirty mark below.
    const mesh = new Mesh(new BufferGeometry(), material)
    root.add(mesh)
    sceneRegistry.nodes.set(node.id, mesh)
    sceneRegistry.byType.ceiling!.add(node.id)
    return mesh
  })
  useScene.setState({ nodes, dirtyNodes: new Set(Object.keys(nodes).slice(1) as never[]) })
  const { frame, settle } = await mount(
    <>
      <CeilingSystem />
      <NodeBatchSystem />
    </>,
  )
  await settle()
  expect(batched(meshes[0]!)).toBe(true)

  const previous = meshes[0]!.geometry
  useScene.setState({
    nodes: {
      ...nodes,
      ceiling_0: {
        ...nodes.ceiling_0!,
        polygon: [
          [0, 0],
          [8, 0],
          [8, 2],
          [0, 2],
        ],
      } as AnyNode,
    },
  })
  useScene.getState().markDirty('ceiling_0' as never)
  await frame()
  expect(useScene.getState().dirtyNodes.has('ceiling_0' as never)).toBe(false)
  expect(meshes[0]!.geometry).not.toBe(previous)
  expect(batched(meshes[0]!)).toBe(false)
  now += 181
  await frame()
  expect(batched(meshes[0]!)).toBe(true)
  const packed = batches(root) as Mesh[]
  expect(
    packed.some((batch) =>
      Array.from((batch.geometry as BufferGeometry).attributes.position!.array).includes(8),
    ),
  ).toBe(true)
})

test('a column whose dirty mark the floor-elevation pass consumes first still leaves its batch', async () => {
  registerNode({
    kind: 'column',
    schemaVersion: 1,
    capabilities: {
      batchable: columnBatchable,
      floorPlaced: { footprint: () => ({ dimensions: [0.3, 3, 0.3] }) },
    },
  } as never)
  const { node: levelNode, root } = level()
  const material = new MeshBasicMaterial()
  const nodes: Record<string, AnyNode> = { [levelNode.id]: levelNode }
  const meshes = Array.from({ length: 3 }, (_, i) => {
    const id = `column_${i}`
    nodes[id] = {
      id,
      type: 'column',
      parentId: levelNode.id,
      visible: true,
      children: [],
      position: [i, 0, 0],
      rotation: [0, 0, 0],
    } as never
    const mesh = new Mesh(new BoxGeometry(), material)
    mesh.position.x = i
    root.add(mesh)
    sceneRegistry.nodes.set(id, mesh)
    sceneRegistry.byType.column!.add(id)
    return mesh
  })
  useScene.setState({ nodes, dirtyNodes: new Set() })
  const { frame, settle } = await mount(
    <>
      <FloorElevationSystem />
      <NodeBatchSystem />
    </>,
  )
  await settle()
  expect(batched(meshes[0]!)).toBe(true)

  // An undo (or an MCP or collaborator write) moves the column: a store write plus a dirty mark.
  useScene.setState({
    nodes: { ...useScene.getState().nodes, column_0: { ...nodes.column_0!, position: [5, 0, 0] } },
  })
  meshes[0]!.position.x = 5
  useScene.getState().markDirty('column_0' as never)
  await frame()
  expect(useScene.getState().dirtyNodes.has('column_0' as never)).toBe(false)
  expect(batched(meshes[0]!)).toBe(false)
  now += 181
  await frame()
  expect(batched(meshes[0]!)).toBe(true)
})

/** Three slabs on one library preset, rebuilt by the geometry system and batched. */
async function slabsOnPreset() {
  const preset = {
    ...MATERIAL_CATALOG[0]!,
    id: 'slab-cache-fixture',
    preset: { ...MATERIAL_CATALOG[0]!.preset, maps: {} },
  }
  registerLibraryMaterials([preset])
  registerNode({
    kind: 'slab',
    schemaVersion: 1,
    schema: SlabNode,
    geometry: buildSlabGeometry,
    capabilities: { batchable: surfaceBatchable },
  } as never)
  const { node: levelNode, root } = level(['slab_0', 'slab_1', 'slab_2'])
  const nodes: Record<string, AnyNode> = { [levelNode.id]: levelNode }
  const slabs = Array.from({ length: 3 }, (_, i) => {
    const node = SlabNode.parse({
      id: `slab_${i}`,
      parentId: levelNode.id,
      materialPreset: 'library:slab-cache-fixture',
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    nodes[node.id] = node
    const group = new Group()
    root.add(group)
    sceneRegistry.nodes.set(node.id, group)
    sceneRegistry.byType.slab!.add(node.id)
    return group
  })
  useScene.setState({ nodes, dirtyNodes: new Set(levelNode.children as never[]), materials: {} })
  const pipeline = await mount(
    <>
      <GeometrySystem />
      <NodeBatchSystem />
    </>,
  )
  await pipeline.frame()
  return { ...pipeline, root, slabs, nodes, levelNode }
}

test('cache clear releases slab batches and a moved slab rejoins its peers under the fresh material', async () => {
  const { frame, settle, root, slabs, levelNode } = await slabsOnPreset()
  await settle()
  expect(batches(root)).toHaveLength(2)
  const top = slabs[0]!.children[0] as Mesh
  const oldMaterials = [top.material, (slabs[0]!.children[1] as Mesh).material] as Material[]
  const disposed = new Set<Material>()
  for (const material of oldMaterials)
    material.addEventListener('dispose', () => {
      expect((batches(root) as Mesh[]).some((batch) => batch.material === material)).toBe(false)
      disposed.add(material)
    })
  clearMaterialCache()
  expect(disposed.size).toBe(0)
  expect(batches(root)).toHaveLength(0)
  expect(levelNode.children.every((id) => useScene.getState().dirtyNodes.has(id as never))).toBe(
    true,
  )
  await frame()
  expect(disposed.size).toBe(2)
  await settle()
  const fresh = (slabs[0]!.children[0] as Mesh).material
  const batch = (batches(root) as Mesh[]).find((candidate) => candidate.material === fresh) as
    | (Mesh & { instanceCount: number })
    | undefined
  expect(batch?.instanceCount).toBe(3)

  useLiveTransforms.getState().set('slab_0', { position: [4, 0, 0], rotation: 0 })
  slabs[0]!.position.x = 4
  await frame()
  expect(batch!.instanceCount).toBe(2)
  useLiveTransforms.getState().clear('slab_0')
  await settle()
  expect((batches(root) as Mesh[]).find((candidate) => candidate.material === fresh)).toBe(batch)
  expect(batch!.instanceCount).toBe(3)
  expect(batches(root)).toHaveLength(2)
  for (const slab of slabs)
    for (const mesh of slab.children as Mesh[]) expect(batched(mesh)).toBe(true)
})

test('cancelling a slab paint preview after a cache clear never restores a disposed material', async () => {
  const { frame, slabs, nodes } = await slabsOnPreset()
  const mesh = slabs[0]!.children[0] as Mesh
  const original = mesh.material as Material
  let disposed = false
  original.addEventListener('dispose', () => {
    disposed = true
  })
  let assigned: Mesh['material'] = original
  Object.defineProperty(mesh, 'material', {
    get: () => assigned,
    set: (material: Mesh['material']) => {
      expect(disposed && material === original).toBe(false)
      assigned = material
    },
  })
  const cancel = slabPaint.applyPreview!({
    node: nodes.slab_0,
    root: slabs[0],
    role: 'surface',
    material: { properties: { color: '#ff0000' } },
    materialPreset: undefined,
  } as never)
  expect(cancel).toBeDefined()
  clearMaterialCache()
  await frame()
  expect(disposed).toBe(true)
  const current = (slabs[0]!.children[0] as Mesh).material
  cancel!()
  expect((slabs[0]!.children[0] as Mesh).material).toBe(current)
})

test('a selected slab whose material cache is cleared never gets a disposed original back on deselect', async () => {
  const { frame, slabs } = await slabsOnPreset()
  await mount(<SelectionManager />)
  const mesh = slabs[0]!.children[0] as Mesh
  const original = mesh.material as Material
  let disposed = false
  original.addEventListener('dispose', () => {
    disposed = true
  })
  let assigned: Mesh['material'] = original
  Object.defineProperty(mesh, 'material', {
    get: () => assigned,
    set: (material: Mesh['material']) => {
      expect(disposed && material === original).toBe(false)
      assigned = material
    },
  })
  await act(async () =>
    useViewer.setState({
      selection: { ...useViewer.getState().selection, selectedIds: ['slab_0'] },
    }),
  )
  await frame()
  expect(mesh.material).not.toBe(original)
  clearMaterialCache()
  expect(disposed).toBe(false)
  await frame()
  expect(disposed).toBe(true)
  const current = (slabs[0]!.children[0] as Mesh).material as Material
  let currentDisposed = false
  current.addEventListener('dispose', () => {
    currentDisposed = true
  })
  await act(async () =>
    useViewer.setState({ selection: { ...useViewer.getState().selection, selectedIds: [] } }),
  )
  await frame()
  expect((slabs[0]!.children[0] as Mesh).material).toBe(current)
  expect(currentDisposed).toBe(false)
})
