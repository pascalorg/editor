import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

// Isolate module wiring: exercise changed viewer sources without rebuilding live dists
// or leaking Bun's process-global module mocks into the randomized nodes suite.
function runSourceTest(body: string) {
  const result = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    import * as core from '@pascal-app/core'
    import * as viewer from '@pascal-app/viewer'
    import { Group, Mesh, MeshBasicMaterial } from 'three'
    ${body}
  `,
    ],
    { cwd: resolve(import.meta.dir, '../../../../..'), stdout: 'pipe', stderr: 'pipe' },
  )
  expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({
    code: 0,
    stderr: '',
  })
}

test('real slab top/side/skirt collection, shared defaults, transparent overrides and cache ownership', () => {
  runSourceTest(`
    const sourceMaterials = await import('./packages/viewer/src/lib/materials.ts')
    mock.module('@pascal-app/viewer', () => ({ ...viewer, ...sourceMaterials }))
    const { buildSlabGeometry } = await import('./packages/nodes/src/slab/geometry.ts')
    const { collectBatchCandidate } = await import('./packages/nodes/src/shared/node-batch/candidates.ts')
    const { disposeObject3DResources } = await import('./packages/viewer/src/lib/dispose-object3d.ts')
    const site = core.SiteNode.parse({ id: 'site_test', children: ['building_test'] })
    const building = core.BuildingNode.parse({ id: 'building_test', parentId: site.id, children: ['level_test'] })
    const level = core.LevelNode.parse({ id: 'level_test', parentId: building.id, level: 0, height: 2.5 })
    const nodes = { [site.id]: site, [building.id]: building, [level.id]: level }
    const ctx = { parent: level, children: [], siblings: [], resolve: (id) => nodes[id] }
    const slab = core.SlabNode.parse({ id: 'slab_test', parentId: level.id, elevation: 0.8, thickness: 0.2, fillToTerrain: true, polygon: [[0,0],[2,0],[2,2],[0,2]] })
    const first = buildSlabGeometry(slab, ctx, 'solid')
    const second = buildSlabGeometry({ ...slab, id: 'slab_second' }, ctx, 'solid')
    assert.equal(first.children.length, 3)
    assert.deepEqual(first.children.map((mesh) => mesh.userData.slotId), ['surface', 'side', 'side'])
    assert.equal(first.children[1].material, second.children[1].material)
    assert.equal(first.children[1].material, first.children[2].material)
    assert.notEqual(first.children[1].geometry, second.children[1].geometry)
    const root = new Group()
    root.add(first)
    core.sceneRegistry.nodes.set(level.id, root)
    core.sceneRegistry.nodes.set(slab.id, first)
    core.useScene.setState({ nodes: { ...nodes, [slab.id]: slab } })
    const entries = collectBatchCandidate(slab.id).entries
    assert.equal(entries.length, 3)
    assert(entries.every((entry) => entry.castShadow && entry.receiveShadow))
    const override = core.SlabNode.parse({ ...slab, slots: { side: 'scene:sm_transparent' } })
    const painted = buildSlabGeometry(override, { ...ctx, materials: { sm_transparent: { id: 'sm_transparent', name: 'Glass', material: { properties: { color: '#abcdef', opacity: 0.3, transparent: true } } } } }, 'solid')
    root.add(painted)
    core.sceneRegistry.nodes.set(slab.id, painted)
    const paintedEntries = collectBatchCandidate(slab.id).entries
    assert.equal(paintedEntries.length, 1)
    assert.equal(paintedEntries[0].mesh.userData.slotId, 'surface')
    const side = first.children[1].material
    let disposed = 0
    side.addEventListener('dispose', () => disposed++)
    disposeObject3DResources(first)
    assert.equal(disposed, 0)
    const preset = { ...core.MATERIAL_CATALOG[0], id: 'surface-cache-test', preset: { ...core.MATERIAL_CATALOG[0].preset, maps: {} } }
    core.registerLibraryMaterials([preset])
    const legacy = { ...slab, materialPreset: 'library:surface-cache-test' }
    assert(core.getMaterialPresetByRef(legacy.materialPreset))
    const legacyFirst = buildSlabGeometry(legacy, ctx, 'solid')
    const legacySecond = buildSlabGeometry(legacy, ctx, 'solid')
    const top = legacyFirst.children[0].material
    assert.equal(top, legacySecond.children[0].material)
    top.addEventListener('dispose', () => disposed++)
    disposeObject3DResources(legacyFirst)
    assert.equal(disposed, 0)
    assert.equal(top.transparent, false)
    const { flushGlobalEffects } = await import('@react-three/fiber')
    sourceMaterials.clearMaterialCache()
    assert.equal(disposed, 0)
    assert(core.useScene.getState().dirtyNodes.has(slab.id))
    const replacement = buildSlabGeometry(legacy, ctx, 'solid')
    assert.notEqual(replacement.children[0].material, top)
    assert.notEqual(replacement.children[1].material, side)
    assert.equal(buildSlabGeometry(legacy, ctx, 'solid').children[0].material, replacement.children[0].material)
    flushGlobalEffects('after', 0)
    assert.equal(disposed, 2)
    assert.notEqual(sourceMaterials.resolveSlotDefaultMaterial('#cccccc', 'solid', 0.8), sourceMaterials.resolveSlotDefaultMaterial('#cccccc', 'rendered', 0.8))
    assert.notEqual(sourceMaterials.resolveSlotDefaultMaterial('#cccccc', 'rendered', 0.8), sourceMaterials.resolveSlotDefaultMaterial('#cccccc', 'rendered', 0.4))
  `)
})

test('priority-1 dirty snapshot sees the priority-2 ceiling rebuild and batches replacement geometry at 5', () => {
  runSourceTest(`
    const scene = core.useScene
    const selectorHook = Object.assign((selector) => selector(scene.getState()), scene)
    mock.module('@pascal-app/core', () => ({ ...core, useScene: selectorHook }))
    const fiber = await import('@react-three/fiber')
    const callbacks = []
    mock.module('@react-three/fiber', () => ({ ...fiber, useThree: (selector) => selector({ invalidate: () => {} }), useFrame: (callback, priority = 0) => callbacks.push({ callback, priority }) }))
    const react = await import('react')
    const refs = []
    mock.module('react', () => ({ ...react, useEffect: () => {}, useRef: (value) => { const ref = { current: value }; refs.push(ref); return ref } }))
    const { CeilingSystem, generateCeilingGeometry } = await import('./packages/viewer/src/systems/ceiling/ceiling-system.tsx')
    const { NodeBatchSystem, runBatchFrame, resetNodeBatchState } = await import('./packages/nodes/src/shared/node-batch/system.tsx')
    let now = 0
    performance.now = () => now
    const root = new Group()
    const material = new MeshBasicMaterial()
    const nodes = { level_test: { id: 'level_test', type: 'level', height: 3, children: [] } }
    const meshes = []
    core.sceneRegistry.nodes.set('level_test', root)
    core.sceneRegistry.byType.level.add('level_test')
    for (let i = 0; i < 4; i++) {
      const node = core.CeilingNode.parse({ id: 'ceiling_' + i, parentId: 'level_test', polygon: [[0,0],[2,0],[2,2],[0,2]], height: 3 })
      nodes[node.id] = node
      const mesh = new Mesh(generateCeilingGeometry(node), material)
      root.add(mesh)
      meshes.push(mesh)
      core.sceneRegistry.nodes.set(node.id, mesh)
      core.sceneRegistry.byType.ceiling.add(node.id)
    }
    scene.setState({ nodes, dirtyNodes: new Set() })
    viewer.useViewer.setState({ externalSelectedIds: [], previewSelectedIds: [], hoveredId: null, selection: { ...viewer.useViewer.getState().selection, selectedIds: [], levelId: null } })
    const wakeRef = { current: null }
    const frame = () => runBatchFrame(() => {}, wakeRef)
    frame(); now = 181; frame()
    assert.equal(meshes[0].layers.isEnabled(viewer.SCENE_LAYER), false)
    const oldGeometry = meshes[0].geometry
    nodes.ceiling_0.polygon = [[0,0],[8,0],[8,2],[0,2]]
    scene.getState().markDirty('ceiling_0')
    CeilingSystem()
    assert.equal(callbacks.length, 1)
    assert.equal(callbacks[0].priority, 2)
    NodeBatchSystem().type()
    assert.deepEqual(callbacks.map((pass) => pass.priority), [2, 1, 5])
    const viewerStore = viewer.useViewer
    mock.module('./packages/viewer/src/store/use-viewer.ts', () => ({ default: Object.assign((selector) => selector(viewerStore.getState()), viewerStore) }))
    const { GeometrySystem } = await import('./packages/viewer/src/systems/geometry/geometry-system.tsx')
    GeometrySystem()
    assert.equal(callbacks[3].priority, 2)
    const pipeline = callbacks.sort((a,b) => a.priority - b.priority)
    assert.deepEqual(pipeline.map((pass) => pass.priority), [1, 2, 2, 5])
    for (const pass of pipeline) pass.callback()
    assert.equal(scene.getState().dirtyNodes.has('ceiling_0'), false)
    assert.notEqual(meshes[0].geometry, oldGeometry)
    assert.equal(meshes[0].layers.isEnabled(viewer.SCENE_LAYER), true)
    now += 181; frame()
    assert.equal(meshes[0].layers.isEnabled(viewer.SCENE_LAYER), false)
    const packed = root.children.filter((child) => child.name === 'item-batch')
    assert(packed.some((batch) => Array.from(batch.geometry.attributes.position.array).includes(8)))
    resetNodeBatchState()
    if (wakeRef.current) clearTimeout(wakeRef.current)
    for (const ref of refs) if (ref.current) clearTimeout(ref.current)
  `)
})

const slabCacheFixture = `
  const sourceMaterials = await import('./packages/viewer/src/lib/materials.ts')
  const scene = core.useScene
  const viewerStore = viewer.useViewer
  viewerStore.setState({ bumpGeometryRevision: () => viewerStore.setState({ geometryRevision: viewerStore.getState().geometryRevision + 1 }) })
  const selectorHook = (store) => Object.assign((selector) => selector(store.getState()), store)
  mock.module('@pascal-app/core', () => ({ ...core, useScene: selectorHook(scene), useRegistryVersion: () => 0 }))
  mock.module('@pascal-app/viewer', () => ({ ...viewer, ...sourceMaterials, useViewer: selectorHook(viewerStore) }))
  mock.module('./packages/viewer/src/store/use-viewer.ts', () => ({ default: selectorHook(viewerStore) }))
  const fiber = await import('@react-three/fiber')
  const frames = []
  mock.module('@react-three/fiber', () => ({ ...fiber, useThree: (selector) => selector({ gl: { domElement: {} }, invalidate: () => {} }), useFrame: (callback, priority) => frames.push({ callback, priority }) }))
  const react = await import('react')
  let effects = []
  let refs = []
  let refIndex = 0
  const hooks = { useEffect: (effect) => effects.push(effect), useCallback: (callback) => callback, useRef: (value) => refs[refIndex++] ??= { current: value }, useSyncExternalStore: (_, snapshot) => snapshot(), useDebugValue: () => {} }
  mock.module('react', () => ({ ...react, ...hooks, default: { ...react.default, ...hooks } }))
  const { buildSlabGeometry } = await import('./packages/nodes/src/slab/geometry.ts')
  const { GeometrySystem } = await import('./packages/viewer/src/systems/geometry/geometry-system.tsx')
  const { captureChangedNodes, runBatchFrame, subscribeBatchInteractions, resetNodeBatchState } = await import('./packages/nodes/src/shared/node-batch/system.tsx')
  const preset = { ...core.MATERIAL_CATALOG[0], id: 'slab-cache-fixture', preset: { ...core.MATERIAL_CATALOG[0].preset, maps: {} } }
  core.registerLibraryMaterials([preset])
  core.registerNode({ kind: 'slab', schemaVersion: 1, schema: core.SlabNode, geometry: buildSlabGeometry, capabilities: {} })
  const level = core.LevelNode.parse({ id: 'level_test', children: ['slab_0', 'slab_1', 'slab_2'] })
  const nodes = { [level.id]: level }
  const root = new Group()
  core.sceneRegistry.nodes.set(level.id, root)
  core.sceneRegistry.byType.level.add(level.id)
  const slabs = Array.from({ length: 3 }, (_, i) => {
    const node = core.SlabNode.parse({ id: 'slab_' + i, parentId: level.id, materialPreset: 'library:slab-cache-fixture', polygon: [[0,0],[2,0],[2,2],[0,2]] })
    nodes[node.id] = node
    const group = new Group()
    root.add(group)
    core.sceneRegistry.nodes.set(node.id, group)
    core.sceneRegistry.byType.slab.add(node.id)
    return group
  })
  scene.setState({ nodes, dirtyNodes: new Set(level.children), materials: {} })
  viewerStore.setState({ shading: 'solid', textures: true, externalSelectedIds: [], previewSelectedIds: [], hoveredId: null, selection: { ...viewerStore.getState().selection, selectedIds: [], levelId: null } })
  GeometrySystem()
  effects = []; refs = []; refIndex = 0
  const rebuild = frames[0].callback
  const unsubscribeBatch = subscribeBatchInteractions(() => {})
  let now = 0
  performance.now = () => now
  const wakeRef = { current: null }
  const frame = () => {
    captureChangedNodes()
    rebuild()
    runBatchFrame(() => {}, wakeRef)
    fiber.flushGlobalEffects('after', now)
  }
  const settle = () => { frame(); now += 181; frame() }
  const batches = () => root.children.filter((child) => child.name === 'item-batch')
  const dispose = () => {
    unsubscribeBatch()
    resetNodeBatchState()
    if (wakeRef.current) clearTimeout(wakeRef.current)
  }
  frame()
`

test('cache clear releases real slab batches and a single moved slab rejoins its peers under the fresh material key', () => {
  runSourceTest(
    slabCacheFixture +
      `
    settle()
    assert.equal(batches().length, 2)
    assert(batches().every((batch) => batch.instanceCount === 3))
    const oldTop = slabs[0].children[0].material
    const oldSide = slabs[0].children[1].material
    const disposed = new Set()
    for (const material of [oldTop, oldSide]) material.addEventListener('dispose', () => {
      assert.equal(batches().some((batch) => batch.material === material), false)
      assert(slabs.every((slab) => slab.children.every((mesh) => mesh.material !== material)))
      disposed.add(material)
    })
    sourceMaterials.clearMaterialCache()
    assert.equal(disposed.size, 0)
    assert.equal(batches().length, 0)
    assert(level.children.every((id) => scene.getState().dirtyNodes.has(id)))
    frame()
    assert.equal(disposed.size, 2)
    settle()
    const top = slabs[0].children[0].material
    const batch = batches().find((batch) => batch.material === top)
    assert(batch)
    assert.equal(batch.instanceCount, 3)
    core.useLiveTransforms.getState().set('slab_0', { position: [4,0,0], rotation: 0 })
    slabs[0].position.x = 4
    frame()
    assert.equal(batch.instanceCount, 2)
    core.useLiveTransforms.getState().clear('slab_0')
    settle()
    assert.equal(batches().find((container) => container.material === top), batch)
    assert.equal(batch.instanceCount, 3)
    assert.equal(batches().length, 2)
    assert(slabs.every((slab) => slab.children.every((mesh) => !mesh.layers.isEnabled(viewer.SCENE_LAYER))))
    dispose()
  `,
  )
})

test('selected legacy slab cache clear invalidates saved originals before disposal and deselect keeps current cached materials', () => {
  runSourceTest(
    slabCacheFixture +
      `
    const { SelectionManager } = await import('./packages/editor/src/components/editor/selection-manager.tsx')
    const SelectionMaterialSync = SelectionManager().props.children[1].type
    effects = []; refs = []; refIndex = 0
    viewerStore.setState({ selection: { ...viewerStore.getState().selection, selectedIds: ['slab_0'] } })
    const oldMesh = slabs[0].children[0]
    const original = oldMesh.material
    let disposed = false
    original.addEventListener('dispose', () => { disposed = true })
    let assigned = original
    Object.defineProperty(oldMesh, 'material', { get: () => assigned, set: (material) => {
      assert(!(disposed && material === original), 'must never restore a disposed saved original')
      assigned = material
    } })
    SelectionMaterialSync()
    const cleanups = effects.map((effect) => effect()).filter(Boolean)
    assert.notEqual(oldMesh.material, original)
    sourceMaterials.clearMaterialCache()
    assert.equal(disposed, false)
    frame()
    assert.equal(disposed, true)
    const current = slabs[0].children[0].material
    assert.notEqual(current, original)
    let currentDisposed = false
    current.addEventListener('dispose', () => { currentDisposed = true })
    viewerStore.setState({ selection: { ...viewerStore.getState().selection, selectedIds: [] } })
    effects = []; refIndex = 0
    SelectionMaterialSync()
    effects[0]()
    assert.equal(slabs[0].children[0].material, current)
    assert.equal(currentDisposed, false)
    assert.equal(buildSlabGeometry(nodes.slab_0, { parent: level, children: [], siblings: [], resolve: (id) => nodes[id] }, 'solid').children[0].material, current)
    for (const cleanup of cleanups) cleanup()
    dispose()
  `,
  )
})

test('paint cancellation after cache clear never restores a disposed legacy slab reference', () => {
  runSourceTest(
    slabCacheFixture +
      `
    const { slabPaint } = await import('./packages/nodes/src/slab/paint.ts')
    const oldMesh = slabs[0].children[0]
    const original = oldMesh.material
    let disposed = false
    original.addEventListener('dispose', () => { disposed = true })
    let assigned = original
    Object.defineProperty(oldMesh, 'material', { get: () => assigned, set: (material) => {
      assert(!(disposed && material === original), 'must never restore a disposed preview original')
      assigned = material
    } })
    const cancel = slabPaint.applyPreview({ node: nodes.slab_0, root: slabs[0], role: 'surface', material: { properties: { color: '#ff0000' } }, materialPreset: undefined })
    assert(cancel)
    sourceMaterials.clearMaterialCache()
    frame()
    assert.equal(disposed, true)
    const current = slabs[0].children[0].material
    cancel()
    assert.equal(slabs[0].children[0].material, current)
    dispose()
  `,
  )
})
