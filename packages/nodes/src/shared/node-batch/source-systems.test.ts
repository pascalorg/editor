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
    mock.module('@pascal-app/viewer', () => ({ ...viewer, resolveSlotDefaultMaterial: sourceMaterials.resolveSlotDefaultMaterial }))
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
    const legacy = { ...slab, material: { properties: { color: '#123456' } } }
    const legacyFirst = buildSlabGeometry(legacy, ctx, 'solid')
    const legacySecond = buildSlabGeometry(legacy, ctx, 'solid')
    const top = legacyFirst.children[0].material
    assert.equal(top, legacySecond.children[0].material)
    top.addEventListener('dispose', () => disposed++)
    disposeObject3DResources(legacyFirst)
    assert.equal(disposed, 0)
    assert.equal(top.transparent, false)
    assert.notEqual(sourceMaterials.resolveSlotDefaultMaterial('#cccccc', 'solid', 0.8), sourceMaterials.resolveSlotDefaultMaterial('#cccccc', 'rendered', 0.8))
    assert.notEqual(sourceMaterials.resolveSlotDefaultMaterial('#cccccc', 'rendered', 0.8), sourceMaterials.resolveSlotDefaultMaterial('#cccccc', 'rendered', 0.4))
  `)
})

test('priority-1 dirty snapshot sees the priority-2 ceiling rebuild and batches replacement geometry at 5', () => {
  runSourceTest(String.raw`
    const scene = core.useScene
    const selectorHook = Object.assign((selector) => selector(scene.getState()), scene)
    mock.module('@pascal-app/core', () => ({ ...core, useScene: selectorHook }))
    const fiber = await import('@react-three/fiber')
    const callbacks = []
    mock.module('@react-three/fiber', () => ({ ...fiber, useFrame: (callback, priority = 0) => callbacks.push({ callback, priority }) }))
    const { CeilingSystem, generateCeilingGeometry } = await import('./packages/viewer/src/systems/ceiling/ceiling-system.tsx')
    const { captureChangedNodes, runBatchFrame, resetNodeBatchState } = await import('./packages/nodes/src/shared/node-batch/system.tsx')
    const batchSource = await Bun.file('./packages/nodes/src/shared/node-batch/system.tsx').text()
    assert.match(batchSource, /useFrame\(captureChangedNodes, 1\)/)
    assert.match(batchSource, /useFrame\(\(\) => runBatchFrame\(invalidate, wakeRef\), 5\)/)
    const geometrySource = await Bun.file('./packages/viewer/src/systems/geometry/geometry-system.tsx').text()
    assert.match(geometrySource, /}, 2\)/)
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
    const pipeline = [{ priority: 1, callback: captureChangedNodes }, callbacks[0], { priority: 5, callback: frame }].sort((a,b) => a.priority - b.priority)
    assert.deepEqual(pipeline.map((pass) => pass.priority), [1, 2, 5])
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
  `)
})
