import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

function runSourceHistoryTest(body: string) {
  const cache = join(import.meta.dir, '.turbo')
  mkdirSync(cache, { recursive: true })
  const directory = mkdtempSync(join(cache, 'history-'))
  const probe = join(directory, 'probe.ts')
  try {
    writeFileSync(
      probe,
      `
      import assert from 'node:assert/strict'
      import { mock } from 'bun:test'
      import { fileURLToPath, pathToFileURL } from 'node:url'
      const editorConsumer = ${JSON.stringify(resolve(import.meta.dir, 'history.ts'))}
      const coreConsumer = ${JSON.stringify(resolve(import.meta.dir, '../../../core/src/index.ts'))}
      const viewerConsumer = ${JSON.stringify(resolve(import.meta.dir, '../../../viewer/src/systems/wall/wall-system.tsx'))}
      const nodesConsumer = ${JSON.stringify(resolve(import.meta.dir, '../../../nodes/src/shared/node-batch/system.tsx'))}
      const peerConsumers = [editorConsumer, coreConsumer, viewerConsumer, nodesConsumer]
      // Resolve only from declared consumers; isolated installs cannot see sibling dependencies.
      const sharedConsumers = [
        ['@pascal-app/core', [editorConsumer, viewerConsumer, nodesConsumer]],
        ['@pascal-app/viewer', [editorConsumer, nodesConsumer]],
        ['react', peerConsumers],
        ['three', peerConsumers],
        ['@react-three/fiber', peerConsumers],
      ]
      const sharedPaths = new Map(
        sharedConsumers.map(([specifier, consumers]) => [
          specifier,
          [...new Set(consumers.map(consumer => fileURLToPath(import.meta.resolve(specifier, pathToFileURL(consumer).href))))],
        ]),
      )
      function mockShared(specifier, factory) {
        for (const path of sharedPaths.get(specifier)) mock.module(path, factory)
      }
      async function importShared(specifier) {
        const module = await import(sharedPaths.get(specifier)[0])
        mockShared(specifier, () => module)
        return module
      }
      await importShared('react')
      await importShared('three')
      await importShared('@react-three/fiber')
      globalThis.requestAnimationFrame = callback => { callback(0); return 0 }
      globalThis.cancelAnimationFrame = () => {}
      const core = await import(${JSON.stringify(resolve(import.meta.dir, '../../..', 'core/src/index.ts'))})
      mockShared('@pascal-app/core', () => core)
      await importShared('@pascal-app/viewer')
      const { useScene: scene, clearSceneHistory, useLiveTransforms: transforms, useLiveNodeOverrides: overrides } = core
      const { runUndo, runRedo, installHistoryCommandDelegate, getHistoryCommandState, shouldCancelDraftOnHistoryJump, subscribeHistoryCommandState } = await import(${JSON.stringify(resolve(import.meta.dir, 'history.ts'))})
      const { default: useInteractionScope } = await import(${JSON.stringify(resolve(import.meta.dir, '../store/use-interaction-scope.ts'))})
      const level = core.LevelNode.parse({ id: 'level_history_source' })
      const wall = core.WallNode.parse({ id: 'wall_history_source', parentId: level.id, start: [0,0], end: [4,0] })
      const remote = core.WallNode.parse({ id: 'wall_remote_source', parentId: level.id, start: [20,0], end: [24,0] })
      const opening = core.DoorNode.parse({ id: 'door_history_source', parentId: wall.id, wallId: wall.id })
      const slab = core.SlabNode.parse({ id: 'slab_history_source', parentId: level.id, polygon: [[0,0],[4,0],[4,4],[0,4]] })
      const baseline = Object.fromEntries([level, { ...wall, children: [opening.id] }, remote, opening, slab].map(node => [node.id, node]))
      scene.setState({ nodes: baseline, dirtyNodes: new Set(), readOnly: false, materials: {}, collections: {}, rootNodeIds: [level.id] })
      clearSceneHistory()
      const flush = async () => { await Promise.resolve(); await Promise.resolve() }
      const clean = () => scene.getState().dirtyNodes.clear()
      const dirty = id => scene.getState().dirtyNodes.has(id)
      const edit = (id, patch) => scene.getState().updateNode(id, patch)
      ${body}
    `,
    )
    const result = Bun.spawnSync([process.execPath, probe], { stdout: 'pipe', stderr: 'pipe' })
    expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({
      code: 0,
      stderr: '',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('standalone history source invalidation', () => {
  test('actual undo/redo keeps unchanged nodes clean and restores exact wall data on repeated jumps', () => {
    runSourceHistoryTest(`
      edit(wall.id, { start: [0,2], end: [4,2] })
      const moved = scene.getState().nodes
      for (let i = 0; i < 3; i++) {
        clean(); runUndo(); await flush()
        assert.equal(scene.getState().nodes[wall.id], baseline[wall.id])
        assert(dirty(wall.id)); assert(!dirty(remote.id)); assert(!dirty(slab.id))
        clean(); runRedo(); await flush()
        assert.equal(scene.getState().nodes[wall.id], moved[wall.id])
        assert(dirty(wall.id)); assert(!dirty(remote.id)); assert(!dirty(slab.id))
      }
    `)
  })

  test('unchanged transform/override targets and hosted parents restore after clear, including stair holes', () => {
    runSourceHistoryTest(`
      edit(level.id, { name: 'Changed' })
      transforms.getState().set(remote.id, { position: [1,0,0], rotation: 0 })
      overrides.getState().set(opening.id, { width: 2 })
      const controller = core.createSurfaceOpeningPreviewController()
      controller.apply([{ id: slab.id, data: { holes: [[[1,1],[2,1],[2,2]]] } }])
      clean(); runUndo(); await flush()
      for (const id of [remote.id, opening.id, wall.id, slab.id]) assert(dirty(id), id)
      assert.equal(scene.getState().nodes[remote.id], baseline[remote.id])
      assert.equal(transforms.getState().transforms.size, 0)
      assert.equal(overrides.getState().overrides.size, 0)
      controller.clear()
    `)
  })

  test.each([
    true,
    false,
  ])('discarded preview neighbours rebuild after undo/redo (joined: %s)', (joined) => {
    runSourceHistoryTest(`
      const react = await importShared('react')
      mockShared('react', () => ({ ...react, useEffect: () => {} }))
      const frames = []
      const fiber = await importShared('@react-three/fiber')
      mockShared('@react-three/fiber', () => ({ ...fiber, useFrame: frame => frames.push(frame) }))
      const selector = store => Object.assign(fn => fn(store.getState()), store)
      mockShared('@pascal-app/core', () => ({ ...core, useScene: selector(scene), useLiveNodeOverrides: selector(overrides) }))
      const { Mesh } = await importShared('three')
      const { WallSystem, getPendingWallRebuildCount } = await import(${JSON.stringify(resolve(import.meta.dir, '../../../viewer/src/systems/wall/wall-system.tsx'))})
      const neighbor = { ...remote, start: [8,0], end: [8,4] }
      scene.setState({ nodes: { ...baseline, [level.id]: { ...level, children: [wall.id, neighbor.id] }, [neighbor.id]: neighbor } })
      clearSceneHistory()
      const a = new Mesh(), b = new Mesh()
      core.sceneRegistry.nodes.set(wall.id, a)
      core.sceneRegistry.nodes.set(neighbor.id, b)
      let now = 0
      performance.now = () => now
      WallSystem()
      const frame = () => { now += 100; frames[0]() }
      scene.getState().markDirty(wall.id); scene.getState().markDirty(neighbor.id)
      frame(); frame(); clean()
      const canonical = Array.from(b.geometry.getAttribute('position').array)
      edit(level.id, { name: 'Unrelated edit' })
      for (const jump of [runUndo, runRedo]) {
        overrides.getState().set(wall.id, { start: [4,0], end: [${joined ? 8 : 6},0] })
        scene.getState().markDirty(wall.id)
        frame(); frame()
        assert.equal(getPendingWallRebuildCount(), 0)
        const preview = Array.from(b.geometry.getAttribute('position').array)
        ${joined ? 'assert.notDeepEqual(preview, canonical)' : 'assert.deepEqual(preview, canonical)'}
        clean(); jump(); await flush()
        assert(dirty(wall.id))
        assert.equal(dirty(neighbor.id), ${joined})
        assert.equal(overrides.getState().overrides.size, 0)
        frame(); frame()
        assert.deepEqual(Array.from(b.geometry.getAttribute('position').array), canonical)
      }
    `)
  })

  test('opening reparent dirties old and new walls on undo and redo', () => {
    runSourceHistoryTest(`
      edit(opening.id, { parentId: remote.id, wallId: remote.id })
      for (const jump of [runUndo, runRedo]) {
        clean(); jump(); await flush()
        for (const id of [wall.id, remote.id, opening.id]) assert(dirty(id), id)
      }
    `)
  })

  test('delete/restore of a subtree leaves no deleted dirty ids or live entries', () => {
    runSourceHistoryTest(`
      scene.getState().deleteNode(wall.id)
      clean(); runUndo(); await flush()
      assert.equal(scene.getState().nodes[opening.id], baseline[opening.id])
      assert(dirty(wall.id)); assert(dirty(opening.id))
      transforms.getState().set(opening.id, { position: [1,0,0], rotation: 0 })
      scene.getState().markDirty(opening.id)
      runRedo(); await flush()
      assert(!scene.getState().nodes[wall.id]); assert(!scene.getState().nodes[opening.id])
      assert(!dirty(wall.id)); assert(!dirty(opening.id))
      assert.equal(transforms.getState().transforms.size, 0)
    `)
  })

  test('synchronous jumps preserve intermediate wall layouts until their microtasks flush', () => {
    runSourceHistoryTest(`
      edit(wall.id, { start: [16,0], end: [20,0] })
      runUndo(); await flush(); clean()
      runRedo(); runUndo(); await flush()
      assert(dirty(remote.id))
      assert.equal(scene.getState().nodes[wall.id], baseline[wall.id])
    `)
  })

  test('empty commands and collaborative delegates retain ownership of live previews and dirtiness', () => {
    runSourceHistoryTest(`
      transforms.getState().set(remote.id, { position: [1,0,0], rotation: 0 })
      overrides.getState().set(opening.id, { width: 2 })
      clean()
      assert.equal(runUndo().kind, 'empty'); assert.equal(runRedo().kind, 'empty')
      edit(wall.id, { thickness: 0.4 }); clean()
      const changed = scene.getState().nodes
      let undo = 0, redo = 0
      const stop = installHistoryCommandDelegate({
        getState: () => ({ canUndo: true, canRedo: true, mode: 'collaborative', status: 'ready' }),
        subscribe: () => () => {},
        undo: () => { undo++; return { kind: 'applied', persistence: 'queued' } },
        redo: () => { redo++; return { kind: 'empty' } },
      })
      runUndo(); runRedo(); await flush(); stop()
      assert.equal(undo, 1); assert.equal(redo, 1)
      assert.equal(scene.getState().nodes, changed)
      assert.equal(scene.getState().dirtyNodes.size, 0)
      assert.equal(transforms.getState().transforms.size, 1)
      assert.equal(overrides.getState().overrides.size, 1)
    `)
  })
  test('one-wall undo releases only its openings and neighbour openings from the real batch store', () => {
    runSourceHistoryTest(`
      const { Group, Mesh, MeshBasicMaterial, BoxGeometry } = await importShared('three')
      const viewer = await importShared('@pascal-app/viewer')
      const { captureChangedNodes, runBatchFrame, resetNodeBatchState } = await import(${JSON.stringify(resolve(import.meta.dir, '../../../nodes/src/shared/node-batch/system.tsx'))})
      const root = new Group()
      core.sceneRegistry.nodes.set(level.id, root)
      core.sceneRegistry.byType.level.add(level.id)
      const material = new MeshBasicMaterial()
      const meshes = []
      const walls = [wall, { ...wall, id: 'wall_neighbor', start: [4,0], end: [4,4] }, remote, { ...remote, id: 'wall_far', start: [30,0], end: [34,0] }]
      const nodes = { [level.id]: level }
      walls.forEach((host, i) => {
        const door = core.DoorNode.parse({ id: 'door_batch_' + i, parentId: host.id })
        nodes[host.id] = { ...host, children: [door.id] }
        nodes[door.id] = door
        const mesh = new Mesh(new BoxGeometry(), material)
        meshes.push(mesh); root.add(mesh)
        core.sceneRegistry.nodes.set(door.id, mesh)
        core.sceneRegistry.byType.door.add(door.id)
      })
      scene.setState({ nodes }); clearSceneHistory()
      edit(wall.id, { start: [0,2], end: [4,2] }); clean()
      viewer.useViewer.setState({ externalSelectedIds: [], previewSelectedIds: [], hoveredId: null, selection: { ...viewer.useViewer.getState().selection, selectedIds: [], levelId: null } })
      let now = 0
      performance.now = () => now
      const wake = { current: null }
      const frame = () => runBatchFrame(() => {}, wake)
      frame(); now += 181; frame()
      assert(meshes.every(mesh => !mesh.layers.isEnabled(viewer.SCENE_LAYER)))
      const batch = root.children.find(child => child.name === 'item-batch')
      assert.equal(batch.instanceCount, 4)
      runUndo(); await flush()
      captureChangedNodes(); clean(); frame()
      assert.deepEqual(meshes.map(mesh => mesh.layers.isEnabled(viewer.SCENE_LAYER)), [true, true, false, false])
      assert.equal(batch.instanceCount, 2)
      now += 181; frame()
      assert.equal(batch.instanceCount, 4)
      assert(meshes.every(mesh => !mesh.layers.isEnabled(viewer.SCENE_LAYER)))
      resetNodeBatchState(); if (wake.current) clearTimeout(wake.current)
    `)
  })

  test('endpoint undo/redo releases exactly both endpoint neighbours and their hosted children', () => {
    runSourceHistoryTest(`
      const { Group, Mesh, MeshBasicMaterial, BoxGeometry } = await importShared('three')
      const viewer = await importShared('@pascal-app/viewer')
      const { captureChangedNodes, runBatchFrame, resetNodeBatchState } = await import(${JSON.stringify(resolve(import.meta.dir, '../../../nodes/src/shared/node-batch/system.tsx'))})
      const root = new Group()
      core.sceneRegistry.nodes.set(level.id, root)
      core.sceneRegistry.byType.level.add(level.id)
      const material = new MeshBasicMaterial()
      const meshes = []
      const walls = [wall, { ...wall, id: 'wall_start', start: [0,0], end: [0,4] }, { ...wall, id: 'wall_old', start: [4,0], end: [4,4] }, { ...wall, id: 'wall_new', start: [6,1], end: [6,4] }, { ...wall, id: 'wall_beyond', start: [6,4], end: [8,4] }, remote, { ...wall, id: 'wall_interior', start: [1,1], end: [2,1] }]
      const nodes = { [level.id]: level, [slab.id]: slab }
      walls.forEach((host, i) => {
        const door = core.DoorNode.parse({ id: 'door_batch_' + i, parentId: host.id })
        nodes[host.id] = { ...host, children: [door.id] }
        nodes[door.id] = door
        const mesh = new Mesh(new BoxGeometry(), material)
        meshes.push(mesh); root.add(mesh)
        core.sceneRegistry.nodes.set(door.id, mesh)
        core.sceneRegistry.byType.door.add(door.id)
      })
      scene.setState({ nodes }); clearSceneHistory()
      const stopSpatial = core.initSpatialGridSync()
      edit(wall.id, { end: [6,1] }); clean()
      viewer.useViewer.setState({ externalSelectedIds: [], previewSelectedIds: [], hoveredId: null, selection: { ...viewer.useViewer.getState().selection, selectedIds: [], levelId: null } })
      let now = 0
      performance.now = () => now
      const wake = { current: null }
      const frame = () => runBatchFrame(() => {}, wake)
      frame(); now += 181; frame()
      assert(meshes.every(mesh => !mesh.layers.isEnabled(viewer.SCENE_LAYER)))
      const batch = root.children.find(child => child.name === 'item-batch')
      assert.equal(batch.instanceCount, 7)
      for (const jump of [runUndo, runRedo]) {
      clean(); jump(); await flush()
      assert.deepEqual([...scene.getState().dirtyNodes].sort(), [level.id, ...walls.slice(0,4).map(node => node.id)].sort())
      captureChangedNodes(); clean(); frame()
      assert.deepEqual(meshes.map(mesh => mesh.layers.isEnabled(viewer.SCENE_LAYER)), [true, true, true, true, false, false, false])
      assert.equal(batch.instanceCount, 3)
      now += 181; frame()
      assert.equal(batch.instanceCount, 7)
      assert(meshes.every(mesh => !mesh.layers.isEnabled(viewer.SCENE_LAYER)))
      }
      stopSpatial(); core.spatialGridManager.clear(); resetNodeBatchState(); if (wake.current) clearTimeout(wake.current)
    `)
  })

  test('all four item supports transfer through undo and redo without touching unrelated hosts', () => {
    runSourceHistoryTest(`
      const ceiling = core.CeilingNode.parse({ id: 'ceiling_transfer', parentId: level.id, polygon: slab.polygon })
      const deck = { ...slab, elevation: 1 }
      const asset = { id: 'transfer', name: 'transfer', category: 'test', thumbnail: '', src: '/test.glb' }
      const supports = [
        { parentId: level.id, supportSlabId: core.GROUND_SUPPORT_ID, asset },
        { parentId: wall.id, supportSlabId: undefined, asset: { ...asset, attachTo: 'wall-side' } },
        { parentId: ceiling.id, supportSlabId: undefined, asset: { ...asset, attachTo: 'ceiling' } },
        { parentId: level.id, supportSlabId: deck.id, asset },
      ]
      for (let from = 0; from < supports.length; from++) {
        for (let to = from + 1; to < supports.length; to++) {
          const item = core.ItemNode.parse({ id: 'item_transfer', ...supports[from] })
          scene.setState({ nodes: { ...baseline, [ceiling.id]: ceiling, [deck.id]: deck, [item.id]: item } })
          clearSceneHistory()
          edit(item.id, { ...supports[to], position: [2,0,2] })
          const moved = scene.getState().nodes[item.id]
          for (const [jump, expected] of [[runUndo, item], [runRedo, moved]]) {
            clean(); jump(); await flush()
            assert.equal(scene.getState().nodes[item.id], expected)
            assert.deepEqual([...scene.getState().dirtyNodes].sort(), [...new Set([item.id, level.id, supports[from].parentId, supports[to].parentId])].sort())
            assert(!dirty(remote.id)); assert(!dirty(deck.id))
          }
        }
      }
    `)
  })

  test('undo and redo re-mark hosted opening proxies and wall-side offsets for real frame rebuilds', () => {
    runSourceHistoryTest(`
      const react = await importShared('react')
      mockShared('react', () => ({ ...react, useEffect: () => {}, useRef: current => ({ current }) }))
      const frames = []
      const fiber = await importShared('@react-three/fiber')
      mockShared('@react-three/fiber', () => ({ ...fiber, useFrame: frame => frames.push(frame) }))
      const selector = store => Object.assign(fn => fn(store.getState()), store)
      mockShared('@pascal-app/core', () => ({ ...core, useScene: selector(scene), useLiveNodeOverrides: selector(overrides) }))
      const viewer = await importShared('@pascal-app/viewer')
      mock.module(${JSON.stringify(resolve(import.meta.dir, '../../../viewer/src/store/use-viewer.ts'))}, () => ({ default: selector(viewer.useViewer) }))
      const { Mesh } = await importShared('three')
      const { DoorSystem } = await import(${JSON.stringify(resolve(import.meta.dir, '../../../viewer/src/systems/door/door-system.tsx'))})
      const { WindowSystem } = await import(${JSON.stringify(resolve(import.meta.dir, '../../../viewer/src/systems/window/window-system.tsx'))})
      const { ItemSystem } = await import(${JSON.stringify(resolve(import.meta.dir, '../../../viewer/src/systems/item/item-system.tsx'))})
      const window = core.WindowNode.parse({ id: 'window_thickness', parentId: wall.id })
      const item = core.ItemNode.parse({ id: 'item_thickness', parentId: wall.id, side: 'front', asset: { id: 'test', name: 'test', category: 'test', thumbnail: '', src: '/test.glb', attachTo: 'wall-side' } })
      const children = [opening, window, item]
      scene.setState({ nodes: { ...baseline, [wall.id]: { ...wall, children: children.map(node => node.id) }, [window.id]: window, [item.id]: item } })
      const meshes = children.map(node => { const mesh = new Mesh(); mesh.userData.itemModelSettled = true; core.sceneRegistry.nodes.set(node.id, mesh); return mesh })
      clearSceneHistory()
      DoorSystem(); WindowSystem(); ItemSystem()
      const frame = () => frames.forEach(frame => frame())
      const depths = () => meshes.slice(0, 2).map(mesh => mesh.getObjectByName('cutout').geometry.parameters.depth)
      const check = thickness => {
        assert.deepEqual(depths(), [thickness + 0.08, thickness + 0.08])
        assert.equal(meshes[2].position.z, thickness / 2)
      }
      children.forEach(node => scene.getState().markDirty(node.id)); frame(); check(core.getWallThickness(wall))
      edit(wall.id, { thickness: 0.6 })
      children.forEach(node => scene.getState().markDirty(node.id)); frame(); check(0.6)
      for (const [jump, thickness] of [[runUndo, core.getWallThickness(wall)], [runRedo, 0.6]]) {
        clean(); jump(); await flush()
        children.forEach(node => assert(dirty(node.id), node.id))
        assert(!dirty(remote.id)); assert(!dirty(slab.id))
        frame(); check(thickness)
        children.forEach(node => assert(!dirty(node.id), node.id))
      }
    `)
  })

  test('undo removes a reconciliation-created side-effect wall and its auto surfaces in one step', () => {
    runSourceHistoryTest(`
      const upper = core.LevelNode.parse({ id: 'level_unrelated_side_effect', level: 1 })
      const walls = [wall, { ...wall, id: 'wall_east', start: [4,0], end: [4,4] }, { ...wall, id: 'wall_north', start: [4,4], end: [0,4] }]
      const closing = core.WallNode.parse({ id: 'wall_closing', parentId: level.id, start: [0,4], end: [0,0] })
      const sideEffect = core.WallNode.parse({ id: 'wall_derived', parentId: level.id, start: [4,4], end: [6,4] })
      scene.setState({ nodes: Object.fromEntries([{ ...level, children: walls.map(node => node.id) }, upper, { ...remote, parentId: upper.id }, ...walls].map(node => [node.id, node])) })
      const editor = { spaces: {}, setSpaces: spaces => { editor.spaces = spaces } }
      let created = false
      const stop = core.initSpaceDetectionSync(scene, { getState: () => editor }, {
        onTopologyReconcile: () => {
          if (created) return
          created = true
          scene.getState().createNode(sideEffect, level.id)
        },
      })
      clearSceneHistory()
      scene.getState().createNode(closing, level.id)
      await flush()
      assert(created); assert(scene.getState().nodes[sideEffect.id])
      const surfaces = Object.values(scene.getState().nodes).filter(node => node.type === 'slab' || node.type === 'ceiling')
      assert(surfaces.length > 0)
      assert.equal(scene.temporal.getState().pastStates.length, 1)
      clean(); runUndo(); await flush()
      for (const node of [closing, sideEffect, ...surfaces]) {
        assert(!scene.getState().nodes[node.id], node.id)
        assert(!dirty(node.id), node.id)
      }
      assert(dirty('wall_north')); assert(!dirty(remote.id))
      stop()
    `)
  })

  test('mounted slab and space subscriptions run on temporal writes without swallowing the wall diff', () => {
    runSourceHistoryTest(`
      const react = await importShared('react')
      const effects = []
      mockShared('react', () => ({ ...react, useEffect: effect => effects.push(effect) }))
      const { default: SlabSystems } = await import(${JSON.stringify(resolve(import.meta.dir, '../../../nodes/src/slab/system.tsx'))})
      SlabSystems()
      const stopSlabs = effects[0]()
      let publications = 0
      const editor = { spaces: {}, setSpaces: spaces => { editor.spaces = spaces; publications++ } }
      const stopSpaces = core.initSpaceDetectionSync(scene, { getState: () => editor })
      edit(wall.id, { start: [0,2], end: [4,2] })
      clean(); const previousPublications = publications
      runUndo()
      assert(dirty(slab.id))
      assert(publications > previousPublications)
      await flush()
      assert(dirty(wall.id))
      assert(!dirty(remote.id))
      stopSpaces(); stopSlabs()
    `)
  })

  test('stair preview cleanup captures holes republished during the first clear', () => {
    runSourceHistoryTest(`
      edit(level.id, { name: 'Changed' })
      transforms.getState().set(wall.id, { position: [1,0,0], rotation: 0 })
      let published = false
      const stop = overrides.subscribe(state => {
        if (published || state.overrides.size || !transforms.getState().transforms.size) return
        published = true
        overrides.getState().set(slab.id, { holes: [[[1,1],[2,1],[2,2]]] })
      })
      clean(); runUndo(); await flush(); stop()
      assert(published)
      assert.equal(overrides.getState().overrides.size, 0)
      assert(dirty(slab.id))
    `)
  })
  test('the wall geometry harness restores positions, normals, UVs and opening cutouts after undo', () => {
    runSourceHistoryTest(`
      const { Mesh } = await importShared('three')
      const { generateExtrudedWall } = await import(${JSON.stringify(resolve(import.meta.dir, '../../../viewer/src/systems/wall/wall-system.tsx'))})
      core.sceneRegistry.nodes.set(wall.id, new Mesh())
      const geometry = () => {
        const nodes = scene.getState().nodes
        const currentWall = nodes[wall.id]
        const children = currentWall.children.map(id => nodes[id]).filter(Boolean)
        const mesh = generateExtrudedWall(currentWall, children, core.calculateLevelMiters([currentWall]))
        const result = Object.fromEntries(['position', 'normal', 'uv'].map(name => [name, Array.from(mesh.getAttribute(name).array)]))
        mesh.dispose(); return result
      }
      const canonical = geometry()
      for (const [id, patch] of [
        [wall.id, { thickness: 0.4 }], [wall.id, { end: [7,2] }],
        [wall.id, { curveOffset: 0.7 }], [opening.id, { position: [2,1,0], width: 1.5 }],
      ]) {
        edit(id, patch)
        assert.notDeepEqual(geometry(), canonical)
        clean(); runUndo(); await flush()
        assert(dirty(wall.id))
        assert.deepEqual(geometry(), canonical)
      }
    `)
  })

  test('the mounted stair subscription restores derived flight heights after a temporal level write', () => {
    runSourceHistoryTest(`
      const react = await importShared('react')
      const effects = []
      mockShared('react', () => ({ ...react, useEffect: effect => effects.push(effect), useRef: current => ({ current }) }))
      const segment = core.StairSegmentNode.parse({ id: 'sseg_history', parentId: 'stair_history', height: 2.5 })
      const stair = core.StairNode.parse({ id: 'stair_history', parentId: level.id, children: [segment.id] })
      scene.setState({ nodes: { ...baseline, [level.id]: { ...level, height: 2.5, children: [stair.id] }, [stair.id]: stair, [segment.id]: segment } })
      const { StairOpeningSystem } = await import(${JSON.stringify(resolve(import.meta.dir, '../../../core/src/systems/stair/stair-opening-system.tsx'))})
      StairOpeningSystem()
      const stop = effects[0]()
      await flush(); clearSceneHistory()
      edit(level.id, { height: 4 }); await flush()
      assert.equal(scene.getState().nodes[segment.id].height, 4)
      clean(); runUndo(); await flush()
      assert.equal(scene.getState().nodes[segment.id].height, 2.5)
      assert(dirty(segment.id)); assert(!dirty(remote.id))
      stop()
    `)
  })
})

describe('editor history controller', () => {
  test('draft cancellation follows the registered kind', () => {
    runSourceHistoryTest(`
      let cancelled = 0
      core.emitter.on('tool:cancel', () => cancelled++)
      useInteractionScope.getState().begin({ kind: 'drafting', tool: 'plain-draft' })
      assert.equal(shouldCancelDraftOnHistoryJump(), false)
      core.nodeRegistry._register({ kind: 'registered-draft', schemaVersion: 1, drafting: { cancelOnHistoryJump: true } })
      useInteractionScope.getState().begin({ kind: 'drafting', tool: 'registered-draft' })
      assert.equal(shouldCancelDraftOnHistoryJump(), true)
      edit(level.id, { level: 1 }); runUndo()
      assert.equal(cancelled, 1)
    `)
  })

  test('delegates publish availability and an older cleanup cannot uninstall the current delegate', () => {
    runSourceHistoryTest(`
      edit(level.id, { level: 1 })
      const observed = []
      const unsubscribe = subscribeHistoryCommandState(() => observed.push(getHistoryCommandState().mode))
      const listeners = new Set()
      let firstCalls = 0, secondCalls = 0
      const delegate = undo => ({
        getState: () => ({ canRedo: false, canUndo: true, mode: 'collaborative', status: 'syncing' }),
        redo: () => ({ kind: 'empty' }),
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        undo,
      })
      const stopFirst = installHistoryCommandDelegate(delegate(() => { firstCalls++; return { kind: 'empty' } }))
      const stopSecond = installHistoryCommandDelegate(delegate(() => { secondCalls++; return { kind: 'applied', persistence: 'queued' } }))
      stopFirst()
      assert.deepEqual(runUndo(), { kind: 'applied', persistence: 'queued' })
      assert.deepEqual(runRedo(), { kind: 'empty' })
      assert.equal(firstCalls, 0); assert.equal(secondCalls, 1)
      assert.equal(scene.getState().nodes[level.id].level, 1)
      assert.equal(scene.temporal.getState().pastStates.length, 1)
      assert.deepEqual(getHistoryCommandState(), { canRedo: false, canUndo: true, mode: 'collaborative', status: 'syncing' })
      for (const listener of listeners) listener()
      stopSecond(); unsubscribe()
      assert.deepEqual(observed, ['collaborative', 'collaborative', 'collaborative', 'standalone'])
      assert.deepEqual(runUndo(), { kind: 'applied', persistence: 'local' })
      assert.equal(scene.getState().nodes[level.id].level, 0)
      assert.deepEqual(runRedo(), { kind: 'applied', persistence: 'local' })
      assert.equal(scene.getState().nodes[level.id].level, 1)
    `)
  })
})
