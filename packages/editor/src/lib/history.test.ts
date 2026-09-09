import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  emitter,
  LevelNode,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import useInteractionScope from '../store/use-interaction-scope'
import {
  getHistoryCommandState,
  installHistoryCommandDelegate,
  runRedo,
  runUndo,
  shouldCancelDraftOnHistoryJump,
  subscribeHistoryCommandState,
} from './history'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const BUILDING_ID = 'building_history_controller' as AnyNodeId
const LEVEL_ID = 'level_history_controller' as AnyNodeId
let disposeController = () => {}
let restoreRegistry = () => {}

function levelNumber(): number {
  return (useScene.getState().nodes[LEVEL_ID] as { level: number }).level
}

describe('editor history controller', () => {
  beforeEach(() => {
    disposeController()
    disposeController = () => {}
    restoreRegistry()
    restoreRegistry = nodeRegistry._snapshot()
    useInteractionScope.getState().end()
    const level = LevelNode.parse({
      id: LEVEL_ID,
      parentId: BUILDING_ID,
      children: [],
      level: 0,
    })
    const building = BuildingNode.parse({
      id: BUILDING_ID,
      parentId: null,
      children: [LEVEL_ID],
    })
    useScene.setState({
      nodes: { [BUILDING_ID]: building, [LEVEL_ID]: level },
      rootNodeIds: [BUILDING_ID],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
      materials: {},
      readOnly: false,
    } as never)
    clearSceneHistory()
    useScene.getState().updateNode(LEVEL_ID, { level: 1 } as Partial<AnyNode>)
  })

  afterEach(() => {
    disposeController()
    disposeController = () => {}
    restoreRegistry()
    restoreRegistry = () => {}
    useInteractionScope.getState().end()
  })

  test('cancels history jumps only when the drafted kind opts in', () => {
    const onCancel = mock(() => {})
    emitter.on('tool:cancel', onCancel)
    try {
      useInteractionScope.getState().begin({ kind: 'drafting', tool: 'plain-draft' })
      expect(shouldCancelDraftOnHistoryJump()).toBe(false)

      nodeRegistry._register({
        kind: 'registered-draft',
        schemaVersion: 1,
        drafting: { cancelOnHistoryJump: true },
      } as never)
      useInteractionScope.getState().begin({ kind: 'drafting', tool: 'registered-draft' })
      expect(shouldCancelDraftOnHistoryJump()).toBe(true)

      runUndo()
      expect(onCancel).toHaveBeenCalledTimes(1)
    } finally {
      emitter.off('tool:cancel', onCancel)
    }
  })

  test('delegates undo and redo while a host delegate is installed', () => {
    const undo = mock(() => ({ kind: 'applied', persistence: 'queued' }) as const)
    const redo = mock(() => ({ kind: 'empty' }) as const)
    disposeController = installHistoryCommandDelegate({
      getState: () => ({
        canRedo: false,
        canUndo: true,
        mode: 'collaborative',
        status: 'syncing',
      }),
      redo,
      subscribe: () => () => {},
      undo,
    })

    expect(runUndo()).toEqual({ kind: 'applied', persistence: 'queued' })
    expect(runRedo()).toEqual({ kind: 'empty' })
    expect(getHistoryCommandState()).toEqual({
      canRedo: false,
      canUndo: true,
      mode: 'collaborative',
      status: 'syncing',
    })

    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
    expect(levelNumber()).toBe(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('falls back to standalone Zundo undo and redo when no controller is installed', () => {
    expect(runUndo()).toEqual({ kind: 'applied', persistence: 'local' })
    expect(levelNumber()).toBe(0)
    expect(useScene.temporal.getState().futureStates).toHaveLength(1)

    expect(runRedo()).toEqual({ kind: 'applied', persistence: 'local' })
    expect(levelNumber()).toBe(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('an older cleanup cannot uninstall a newer controller', () => {
    const firstUndo = mock(() => {})
    const delegate = (undo: () => void) => ({
      getState: () => ({
        canRedo: false,
        canUndo: true,
        mode: 'collaborative' as const,
        status: 'ready' as const,
      }),
      redo: () => ({ kind: 'empty' as const }),
      subscribe: () => () => {},
      undo: () => {
        undo()
        return { kind: 'applied' as const, persistence: 'queued' as const }
      },
    })
    const stopFirst = installHistoryCommandDelegate(delegate(firstUndo))
    const secondUndo = mock(() => {})
    disposeController = installHistoryCommandDelegate(delegate(secondUndo))

    stopFirst()
    runUndo()

    expect(firstUndo).toHaveBeenCalledTimes(0)
    expect(secondUndo).toHaveBeenCalledTimes(1)
  })

  test('publishes delegate state changes and restores standalone availability on teardown', () => {
    const listeners = new Set<() => void>()
    const observed: string[] = []
    const unsubscribe = subscribeHistoryCommandState(() => {
      observed.push(getHistoryCommandState().mode)
    })
    disposeController = installHistoryCommandDelegate({
      getState: () => ({
        canRedo: false,
        canUndo: true,
        mode: 'collaborative',
        status: 'offline',
      }),
      redo: () => ({ kind: 'empty' }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      undo: () => ({ kind: 'applied', persistence: 'queued' }),
    })

    for (const listener of listeners) listener()
    disposeController()
    disposeController = () => {}
    unsubscribe()

    expect(observed).toEqual(['collaborative', 'collaborative', 'standalone'])
  })
})

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
      globalThis.requestAnimationFrame = callback => { callback(0); return 0 }
      globalThis.cancelAnimationFrame = () => {}
      const core = await import(${JSON.stringify(resolve(import.meta.dir, '../../..', 'core/src/index.ts'))})
      mock.module('@pascal-app/core', () => core)
      const { useScene: scene, clearSceneHistory, useLiveTransforms: transforms, useLiveNodeOverrides: overrides } = core
      const { runUndo, runRedo, installHistoryCommandDelegate } = await import(${JSON.stringify(resolve(import.meta.dir, 'history.ts'))})
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
      const { Group, Mesh, MeshBasicMaterial, BoxGeometry } = await import('three')
      const viewer = await import('@pascal-app/viewer')
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

  test('mounted slab and space subscriptions run on temporal writes without swallowing the wall diff', () => {
    runSourceHistoryTest(`
      const react = await import('react')
      const effects = []
      mock.module('react', () => ({ ...react, useEffect: effect => effects.push(effect) }))
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
      const { Mesh } = await import('three')
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
      const react = await import('react')
      const effects = []
      mock.module('react', () => ({ ...react, useEffect: effect => effects.push(effect), useRef: current => ({ current }) }))
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
