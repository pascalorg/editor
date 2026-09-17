import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  type AnyNode,
  type AnyNodeId,
  DoorNode,
  sceneRegistry,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { shouldDeferWallRebuild } from './wall-system'

describe('progressive wall budget', () => {
  const openings = Array.from({ length: 6 }, (_, index) =>
    (index % 2 ? DoorNode : WindowNode).parse({ position: [index, 1, 0] }),
  )
  const cheap = WallNode.parse({ start: [0, 0], end: [8, 0], children: [] })
  const heavy = WallNode.parse({
    start: [0, 0],
    end: [8, 0],
    children: openings.map((opening) => opening.id),
  })
  const nodes: Record<AnyNodeId, AnyNode> = Object.fromEntries(
    [cheap, heavy, ...openings].map((node) => [node.id, node]),
  )

  function frame(walls: WallNode[]): string[] {
    const rebuilt: string[] = []
    for (const wall of walls) {
      if (shouldDeferWallRebuild(wall.id, nodes, rebuilt.length, 0)) break
      rebuilt.push(wall.id)
    }
    return rebuilt
  }

  test('defers a heavy wall after a cheap wall and rebuilds it at the start of the next frame', () => {
    expect(frame([cheap, heavy])).toEqual([cheap.id])
    expect(frame([heavy])).toEqual([heavy.id])
  })

  test('counts hosted cutouts rather than all children', () => {
    const five = { ...heavy, children: [...heavy.children.slice(0, 5), cheap.id] }
    expect(shouldDeferWallRebuild(five.id, { ...nodes, [five.id]: five }, 1, 0)).toBe(false)
    expect(shouldDeferWallRebuild(heavy.id, nodes, 1, 0)).toBe(true)
  })

  test('retains the eight-wall and eight-millisecond limits while allowing initial progress', () => {
    expect(shouldDeferWallRebuild(cheap.id, nodes, 7, 7.9)).toBe(false)
    expect(shouldDeferWallRebuild(cheap.id, nodes, 8, 0)).toBe(true)
    expect(shouldDeferWallRebuild(cheap.id, nodes, 1, 8)).toBe(true)
    expect(shouldDeferWallRebuild(heavy.id, nodes, 0, 100)).toBe(false)
  })

  test('counts item cutout proxies but skips ordinary items', () => {
    const item = { id: 'item_budget-test', type: 'item' } as AnyNode
    const wall = { ...heavy, children: [...heavy.children.slice(0, 5), item.id] }
    const sceneNodes = { ...nodes, [wall.id]: wall, [item.id]: item }
    const mesh = new THREE.Group()
    const proxy = new THREE.Mesh(new THREE.BoxGeometry())
    proxy.name = 'cutout'
    sceneRegistry.nodes.set(item.id, mesh)
    try {
      expect(shouldDeferWallRebuild(wall.id, sceneNodes, 1, 0)).toBe(false)
      mesh.add(proxy)
      expect(shouldDeferWallRebuild(wall.id, sceneNodes, 1, 0)).toBe(true)
    } finally {
      sceneRegistry.nodes.delete(item.id)
      proxy.geometry.dispose()
    }
  })
})

// Isolate source aliases from Bun's process-global mocks while live dists stay untouched.
test('initial wall drain lifecycle and scheduling against source packages', () => {
  const sourcePath = (path: string) =>
    JSON.stringify(resolve(import.meta.dir, '../../../../..', path))
  const cache = join(import.meta.dir, '.turbo')
  mkdirSync(cache, { recursive: true })
  const directory = mkdtempSync(join(cache, 'initial-build-'))
  try {
    const preload = join(directory, 'preload.ts')
    writeFileSync(
      preload,
      `
      import { mock } from 'bun:test'
      mock.module(${sourcePath('packages/viewer/src/lib/gpu-perf.ts')}, () => ({ PERF_OVERLAY_ENABLED: process.env.WALL_TEST_PERF !== 'off' }))
      mock.module('@pascal-app/core', () => require(${sourcePath('packages/core/src/index.ts')}))
    `,
    )
    const probe = join(directory, 'probe.test.ts')
    writeFileSync(
      probe,
      `
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  initSpaceDetectionSync,
  applySceneSnapshot,
  applyScenePatch,
  BuildingNode,
  ElevatorNode,
  StairNode,
  StairSegmentNode,
  SlabNode,
  CeilingNode,
  DoorNode,
  LevelNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import { publishPerfBatchStats, readPerfBatchStats } from ${sourcePath('packages/viewer/src/lib/perf-panel-store.ts')}
import {
  getPendingWallRebuildCount,
  isWallInitialBuildActive,
  runWallBuildFrame,
} from ${sourcePath('packages/viewer/src/systems/wall/wall-system.tsx')}
import { subscribeWallBuildInteractions } from ${sourcePath('packages/viewer/src/systems/wall/wall-build-lifecycle.ts')}
import { initializeElevatorOpeningSync } from ${sourcePath('packages/core/src/systems/elevator/elevator-opening-system.tsx')}
import { initializeStairOpeningSync } from ${sourcePath('packages/core/src/systems/stair/stair-opening-system.tsx')}
import { subscribePerfSamples } from ${sourcePath('packages/viewer/src/lib/perf-tracks.ts')}
import { WALL_PLACEHOLDER_SWEEP_INTERVAL } from ${sourcePath('packages/viewer/src/systems/wall/wall-placeholder-sweep.ts')}

let now = 0
let rebuildCost = 0
let restoreClock: () => void
let restoreRaf: () => void
let unsubscribe: () => void
let canvas: EventTarget
const meshes: Mesh[] = []
const rafs = new Map<number, FrameRequestCallback>()
let nextRaf = 0

beforeEach(() => {
  const request = globalThis.requestAnimationFrame
  const cancel = globalThis.cancelAnimationFrame
  rafs.clear()
  globalThis.requestAnimationFrame = (callback) => {
    rafs.set(++nextRaf, callback)
    return nextRaf
  }
  globalThis.cancelAnimationFrame = (id) => { rafs.delete(id) }
  restoreRaf = () => {
    globalThis.requestAnimationFrame = request
    globalThis.cancelAnimationFrame = cancel
  }
  now = 0
  rebuildCost = 0
  const clock = spyOn(performance, 'now').mockImplementation(() => now)
  restoreClock = () => clock.mockRestore()
  useScene.getState().unloadScene()
  useScene.setState({ readOnly: false })
  sceneRegistry.clear()
  canvas = new EventTarget()
  unsubscribe = subscribeWallBuildInteractions(canvas)
})

afterEach(() => {
  unsubscribe()
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  for (const mesh of meshes.splice(0)) {
    mesh.geometry.dispose()
    ;(mesh.material as MeshBasicMaterial).dispose()
  }
  sceneRegistry.clear()
  useScene.getState().unloadScene()
  restoreClock()
  restoreRaf()
})

function register(wall: WallNode) {
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  mesh.geometry.addEventListener('dispose', () => {
    now += rebuildCost
  })
  sceneRegistry.nodes.set(wall.id, mesh)
  sceneRegistry.byType.wall.add(wall.id)
  meshes.push(mesh)
  return mesh
}

function hydrate(count = 20, heavyIndex = -1, mountedCount = count) {
  const level = LevelNode.parse({ height: 3 })
  const walls = Array.from({ length: count }, (_, index) =>
    WallNode.parse({
      parentId: level.id,
      start: [index * 12, 0],
      end: [(index + 1) * 12, 0],
      height: 3,
    }),
  )
  const openings =
    heavyIndex < 0
      ? []
      : Array.from({ length: 6 }, (_, index) =>
          DoorNode.parse({
            parentId: walls[heavyIndex]!.id,
            position: [index * 1.5 + 1, 0, 0],
          }),
        )
  if (heavyIndex >= 0) walls[heavyIndex]!.children = openings.map((node) => node.id)
  level.children = walls.map((wall) => wall.id)
  useScene
    .getState()
    .setScene(Object.fromEntries([level, ...walls, ...openings].map((node) => [node.id, node])), [
      level.id,
    ])
  for (const wall of walls.slice(0, mountedCount)) register(wall)
  return walls
}

const stats = () => readPerfBatchStats().wallDrain!

function buildingWithOpenings() {
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1, height: 3 })
  const slab = SlabNode.parse({ parentId: upper.id, polygon: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] })
  const elevator = ElevatorNode.parse({ parentId: building.id, position: [2, 0, 2], fromLevelId: ground.id, toLevelId: upper.id })
  const stair = StairNode.parse({ parentId: ground.id, position: [5, 0, 5], fromLevelId: ground.id, toLevelId: upper.id, slabOpeningMode: 'destination' })
  const segment = StairSegmentNode.parse({ parentId: stair.id, height: 1 })
  stair.children = [segment.id]
  const walls = Array.from({ length: 12 }, (_, index) => WallNode.parse({ parentId: ground.id, start: [index * 12, 0], end: [(index + 1) * 12, 0] }))
  ground.children = [...walls.map(wall => wall.id), stair.id]
  upper.children = [slab.id]
  building.children = [ground.id, upper.id, elevator.id]
  return { building, slab, segment, walls, nodes: Object.fromEntries([building, ground, upper, slab, elevator, stair, segment, ...walls].map(node => [node.id, node])) }
}

test('elevator reconciliation finishes before publishing hydration and the first wall frame', async () => {
  const scene = buildingWithOpenings()
  const stop = initializeElevatorOpeningSync()
  try {
    useScene.getState().setScene(scene.nodes, [scene.building.id])
    expect((useScene.getState().nodes[scene.slab.id] as SlabNode).holes).toHaveLength(1)
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(useScene.getState().hydrationToken).not.toBeNull()
    for (const wall of scene.walls) register(wall)
    expect(isWallInitialBuildActive()).toBe(true)
    runWallBuildFrame()
    expect(stats().wallsConsumedThisFrame).toBe(12)
  } finally { stop() }
})

test.each(['none', 'edit', 'host', 'remote', 'wheel'])('deferred stair normalization completes hydration unless interrupted by %s', async (interrupt) => {
  const scene = buildingWithOpenings()
  const stop = initializeStairOpeningSync()
  try {
    useScene.getState().setScene(scene.nodes, [scene.building.id])
    expect(useScene.getState().hydrationToken).toBeNull()
    if (interrupt === 'edit') useScene.getState().updateNode(scene.walls[0]!.id, { height: 4 })
    if (interrupt === 'host') useScene.setState(state => ({ nodes: { ...state.nodes, [scene.walls[0]!.id]: { ...state.nodes[scene.walls[0]!.id], height: 4 } as AnyNode } }))
    if (interrupt === 'remote') expect(applyScenePatch({ materialChanges: [], nodeUpdates: [{ id: scene.walls[0]!.id, data: { height: 4 }, removeFields: [] }] })).toBe(true)
    if (interrupt === 'wheel') canvas.dispatchEvent(new Event('wheel'))
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect((useScene.getState().nodes[scene.segment.id] as StairSegmentNode).height).toBe(3)
    expect((useScene.getState().nodes[scene.slab.id] as SlabNode).holes!.length).toBeGreaterThan(0)
    expect(isWallInitialBuildActive()).toBe(interrupt === 'none')
    for (const wall of scene.walls) register(wall)
    runWallBuildFrame()
    expect(stats().wallsConsumedThisFrame).toBe(interrupt === 'none' ? 12 : 8)
  } finally { stop() }
})

test('opening normalization belongs to hydration even when the systems mount after setScene', async () => {
  const scene = buildingWithOpenings()
  useScene.getState().setScene(scene.nodes, [scene.building.id])
  expect(useScene.getState().hydrationToken).toBeNull()
  await new Promise<void>(resolve => queueMicrotask(resolve))
  const token = useScene.getState().hydrationToken
  expect(token).not.toBeNull()
  expect((useScene.getState().nodes[scene.segment.id] as StairSegmentNode).height).toBe(3)
  expect((useScene.getState().nodes[scene.slab.id] as SlabNode).holes!.length).toBe(2)
  const stopStair = initializeStairOpeningSync()
  const stopElevator = initializeElevatorOpeningSync()
  try {
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(useScene.getState().hydrationToken).toBe(token)
    for (const wall of scene.walls) register(wall)
    runWallBuildFrame()
    expect(stats().wallsConsumedThisFrame).toBe(12)
  } finally { stopStair(); stopElevator() }
})

test('locked snapshot hydration does not defer derived writes beyond the mutation lock', async () => {
  const scene = buildingWithOpenings()
  useScene.setState({ readOnly: true })
  useScene.getState().setScene(scene.nodes, [scene.building.id])
  useScene.setState({ readOnly: false })
  const token = useScene.getState().hydrationToken
  await new Promise<void>(resolve => queueMicrotask(resolve))
  expect(useScene.getState().hydrationToken).toBe(token)
  expect((useScene.getState().nodes[scene.segment.id] as StairSegmentNode).height).toBe(1)
  expect((useScene.getState().nodes[scene.slab.id] as SlabNode).holes).toEqual([])
})

test('replacing a hydration before its normalization runs cannot publish an obsolete token', async () => {
  const first = buildingWithOpenings()
  const second = buildingWithOpenings()
  useScene.getState().setScene(first.nodes, [first.building.id])
  useScene.getState().setScene(second.nodes, [second.building.id])
  const identity = useScene.getState().hydrationId
  await new Promise<void>(resolve => queueMicrotask(resolve))
  expect(useScene.getState().hydrationToken).toBe(identity)
  expect(useScene.getState().nodes[first.building.id]).toBeUndefined()
  expect((useScene.getState().nodes[second.segment.id] as StairSegmentNode).height).toBe(3)
})

test('replacing an already-known level completes space reconciliation before issuing its token', () => {
  const level = LevelNode.parse({ height: 3 })
  const points = [[0, 0], [12, 0], [12, 8], [0, 8]]
  const walls = points.map((start, index) => WallNode.parse({ parentId: level.id, start, end: points[(index + 1) % 4] }))
  const slab = SlabNode.parse({ parentId: level.id, polygon: points, autoFromWalls: true })
  level.children = [...walls.map(wall => wall.id), slab.id]
  const nodes = Object.fromEntries([level, slab, ...walls].map(node => [node.id, node]))
  useScene.getState().setScene(nodes, [level.id])
  const editorState = { spaces: {}, setSpaces(spaces: object) { this.spaces = spaces } }
  const stop = initSpaceDetectionSync(useScene, { getState: () => editorState })
  try {
    const next = { ...nodes, [walls[0]!.id]: { ...walls[0]!, end: [12, 1] }, [walls[1]!.id]: { ...walls[1]!, start: [12, 1] } }
    useScene.getState().setScene(next as Record<string, AnyNode>, [level.id])
    expect((useScene.getState().nodes[slab.id] as SlabNode).polygon).not.toEqual(slab.polygon)
    expect(isWallInitialBuildActive()).toBe(true)
    for (const wall of walls) register(wall)
    runWallBuildFrame()
    expect(stats().firstBuilds).toBe(4)
  } finally { stop() }
})

test('snapshot clears stale live maps before its token is published', () => {
  const walls = hydrate(12)
  useLiveNodeOverrides.getState().set(walls[0]!.id, { height: 9 })
  useLiveTransforms.getState().set(walls[0]!.id, { position: [0, 2, 0], rotation: 0 })
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  useScene.temporal.getState().resume()
  applySceneSnapshot({ nodes, rootNodeIds, collections, materials, installedPlugins }, { origin: 'load' })
  expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
  expect(useLiveTransforms.getState().transforms.size).toBe(0)
  expect(isWallInitialBuildActive()).toBe(true)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(12)
})

test('pre-consumer wheel revokes the owner token and cannot be revived on mount', () => {
  hydrate(12)
  canvas.dispatchEvent(new Event('wheel'))
  expect(useScene.getState().hydrationToken).toBeNull()
  unsubscribe()
  unsubscribe = subscribeWallBuildInteractions(canvas)!
  expect(isWallInitialBuildActive()).toBe(false)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(8)
  expect(stats().firstBuilds).toBe(8)
  expect(stats().reinvalidationBuilds).toBe(0)
})

test('reattaching mid-drain preserves the hydration counters and one continuous span', () => {
  const spans: number[] = []
  const stop = subscribePerfSamples((track, ms) => { if (track === 'wall-initial-build') spans.push(ms) })
  try {
    hydrate(12)
    const token = useScene.getState().hydrationToken
    rebuildCost = 4
    runWallBuildFrame()
    expect(stats().firstBuilds).toBe(2)
    unsubscribe()
    now += 20
    unsubscribe = subscribeWallBuildInteractions(canvas)!
    expect(useScene.getState().hydrationToken).toBe(token)
    expect(stats().firstBuilds).toBe(2)
    expect(stats().budgetExits).toBe(1)
    expect(spans).toEqual([])
    rebuildCost = 0
    runWallBuildFrame()
    expect(stats().firstBuilds).toBe(12)
    expect(spans).toEqual([28])
  } finally { stop() }
})

test('an unregistered dirty wall loses privilege after the renderer grace period without being cleared', () => {
  const walls = hydrate(1, -1, 0)
  for (let i = 0; i < WALL_PLACEHOLDER_SWEEP_INTERVAL - 1; i++) runWallBuildFrame()
  expect(isWallInitialBuildActive()).toBe(true)
  runWallBuildFrame()
  expect(isWallInitialBuildActive()).toBe(false)
  expect(useScene.getState().hydrationToken).toBeNull()
  expect(useScene.getState().dirtyNodes.has(walls[0]!.id)).toBe(true)
  expect(stats().drainedExits).toBe(0)
  register(walls[0]!)
  runWallBuildFrame()
  expect(stats().firstBuilds).toBe(1)
  expect(useScene.getState().dirtyNodes.has(walls[0]!.id)).toBe(false)
})

test('a missing renderer does not strand pending neighbours', () => {
  const walls = hydrate(4, -1, 3)
  runWallBuildFrame()
  useScene.getState().markDirty(walls[0]!.id)
  runWallBuildFrame()
  expect(getPendingWallRebuildCount()).toBe(1)
  now += 80
  runWallBuildFrame()
  expect(getPendingWallRebuildCount()).toBe(0)
  expect(useScene.getState().dirtyNodes.has(walls[3]!.id)).toBe(true)
})

test('a hydration interrupted before publication still resets first-ever counters', async () => {
  const scene = buildingWithOpenings()
  useScene.getState().setScene(scene.nodes, [scene.building.id])
  await new Promise<void>(resolve => queueMicrotask(resolve))
  for (const wall of scene.walls) register(wall)
  runWallBuildFrame()
  expect(stats().firstBuilds).toBe(12)
  const stop = initializeStairOpeningSync()
  try {
    useScene.getState().setScene(scene.nodes, [scene.building.id])
    canvas.dispatchEvent(new Event('wheel'))
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(useScene.getState().hydrationToken).toBeNull()
    expect(stats().firstBuilds).toBe(0)
    runWallBuildFrame()
    expect(stats().firstBuilds).toBe(8)
    expect(stats().reinvalidationBuilds).toBe(0)
  } finally { stop() }
})

test('setScene starts initial build; more than eight cheap walls drain in one frame', () => {
  hydrate()
  expect(isWallInitialBuildActive()).toBe(true)
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  expect(isWallInitialBuildActive()).toBe(true)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(20)
  expect(stats().firstBuilds).toBe(20)
  expect(stats().neighbourEnqueues).toBe(0)
  expect(stats().drainedExits).toBe(1)
  expect(isWallInitialBuildActive()).toBe(false)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(0)
  expect(stats().drainedExits).toBe(1)
})

test('checks the eight millisecond budget between walls and skips first-build neighbour invalidation across frames', () => {
  hydrate(12)
  rebuildCost = 4
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(2)
  expect(stats().budgetExits).toBe(1)
  expect(isWallInitialBuildActive()).toBe(true)
  rebuildCost = 0
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(10)
  expect(stats().firstBuilds).toBe(12)
  expect(stats().reinvalidationBuilds).toBe(0)
  expect(stats().neighbourEnqueues).toBe(0)
  expect(getPendingWallRebuildCount()).toBe(0)
  expect(isWallInitialBuildActive()).toBe(false)
})

test('a heavy wall gets its own frame even with budget left and cheap walls following it', () => {
  hydrate(12, 1)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(1)
  expect(stats().heavyExits).toBe(1)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(1)
  expect(stats().heavyExits).toBe(2)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(10)
  expect(isWallInitialBuildActive()).toBe(false)
})

test.each([
  'edit',
  'pointerdown',
  'pointermove',
  'wheel',
  'override',
  'transform',
])('%s ends initial build immediately and restores the interactive cap', (interaction) => {
  const walls = hydrate()
  if (interaction === 'edit') useScene.getState().updateNode(walls[0]!.id, { height: 4 })
  else if (interaction === 'override')
    useLiveNodeOverrides.getState().set(walls[0]!.id, { height: 4 } as Partial<AnyNode>)
  else if (interaction === 'transform')
    useLiveTransforms.getState().set(walls[0]!.id, { position: [0, 1, 0], rotation: 0 })
  else canvas.dispatchEvent(new Event(interaction))
  expect(isWallInitialBuildActive()).toBe(false)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(8)
  expect(stats().capExits).toBe(1)
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  expect(isWallInitialBuildActive()).toBe(false)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(8)
  expect(stats().neighbourEnqueues).toBeGreaterThan(0)
})

test('opening completion can re-dirty a parent; initial build waits for pending neighbours after dirty drains', () => {
  const walls = hydrate(3, -1, 2)
  runWallBuildFrame()
  expect(isWallInitialBuildActive()).toBe(true)
  useScene.getState().markDirty(walls[0]!.id)
  runWallBuildFrame()
  expect(stats().reinvalidationBuilds).toBe(1)
  expect(getPendingWallRebuildCount()).toBe(1)
  register(walls[2]!)
  runWallBuildFrame()
  expect(isWallInitialBuildActive()).toBe(true)
  expect(stats().firstBuilds).toBe(3)
  now += 79
  runWallBuildFrame()
  expect(getPendingWallRebuildCount()).toBe(1)
  now += 1
  runWallBuildFrame()
  expect(getPendingWallRebuildCount()).toBe(0)
  expect(isWallInitialBuildActive()).toBe(false)
})

test('a late mount sees hydration, but cannot revive it after an edit', () => {
  unsubscribe()
  const walls = hydrate()
  unsubscribe = subscribeWallBuildInteractions(canvas)
  expect(isWallInitialBuildActive()).toBe(true)
  unsubscribe()
  useScene.getState().updateNode(walls[0]!.id, { height: 4 })
  unsubscribe = subscribeWallBuildInteractions(canvas)
  expect(isWallInitialBuildActive()).toBe(false)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(8)
})

test('first builds across frames use the complete junction solution', () => {
  const level = LevelNode.parse({ height: 3 })
  const walls = [
    WallNode.parse({ parentId: level.id, start: [0, 0], end: [12, 0], height: 3 }),
    WallNode.parse({ parentId: level.id, start: [12, 0], end: [12, 8], height: 3 }),
    WallNode.parse({ parentId: level.id, start: [12, 0], end: [20, -6], height: 3 }),
  ]
  level.children = walls.map((wall) => wall.id)
  useScene.getState().setScene(
    Object.fromEntries([level, ...walls].map((node) => [node.id, node])), [level.id],
  )
  const built = walls.map(register)
  rebuildCost = 8
  for (let index = 0; index < walls.length; index++) runWallBuildFrame()
  expect(stats().firstBuilds).toBe(3)
  expect(stats().reinvalidationBuilds).toBe(0)
  expect(isWallInitialBuildActive()).toBe(false)
  const geometrySnapshot = () => built.map(({ geometry }) => ({
    positions: Array.from(geometry.getAttribute('position').array),
    normals: Array.from(geometry.getAttribute('normal').array),
    uvs: Array.from(geometry.getAttribute('uv').array),
    groups: geometry.groups,
  }))
  const initialGeometry = geometrySnapshot()
  for (const wall of walls) useScene.getState().markDirty(wall.id)
  runWallBuildFrame()
  expect(stats().wallsConsumedThisFrame).toBe(3)
  expect(geometrySnapshot()).toEqual(initialGeometry)
  expect(getPendingWallRebuildCount()).toBe(0)
})

test.each(['action', 'host', 'paused'])('first %s document write invalidates hydration in one notification', (write) => {
  const walls = hydrate(3)
  runWallBuildFrame()
  const notifications: Array<object | null> = []
  const stop = useScene.subscribe((state) => notifications.push(state.hydrationToken))
  try {
    if (write === 'paused') useScene.temporal.getState().pause()
    if (write === 'host') {
      useScene.setState((state) => ({
        nodes: { ...state.nodes, [walls[0]!.id]: { ...state.nodes[walls[0]!.id], height: 4 } as AnyNode },
      }))
    } else useScene.getState().updateNode(walls[0]!.id, { height: 4 })
    expect(notifications).toEqual([null])
  } finally {
    stop()
    useScene.temporal.getState().resume()
  }
})

test.each([false, true])('a drained scene keeps its first endpoint edit local (token already invalid: %s)', (invalidated) => {
  const level = LevelNode.parse({ height: 3 })
  const walls = Array.from({ length: 12 }, (_, room) => {
    const x = room * 20
    const points = [[x, 0], [x + 12, 0], [x + 12, 8], [x, 8]]
    return points.map((start, index) => WallNode.parse({
      parentId: level.id, start, end: points[(index + 1) % 4], height: 3,
    }))
  }).flat()
  const surfaces = Array.from({ length: 12 }, (_, room) => {
    const polygon = walls.slice(room * 4, room * 4 + 4).map((wall) => wall.start)
    return [SlabNode.parse({ parentId: level.id, polygon, autoFromWalls: true }), CeilingNode.parse({ parentId: level.id, polygon, autoFromWalls: true })]
  }).flat()
  level.children = [...walls, ...surfaces].map((node) => node.id)
  useScene.getState().setScene(Object.fromEntries([level, ...walls, ...surfaces].map((node) => [node.id, node])), [level.id])
  for (const wall of walls) register(wall)
  const editorState = { spaces: {}, setSpaces(spaces: object) { this.spaces = spaces } }
  const stopDetection = initSpaceDetectionSync(useScene, { getState: () => editorState })
  try {
    runWallBuildFrame()
    expect(isWallInitialBuildActive()).toBe(false)
    expect(getPendingWallRebuildCount()).toBe(0)
    if (invalidated) useScene.setState({ hydrationToken: null })
    useScene.getState().dirtyNodes.clear()
    useScene.getState().updateNodes([
      { id: walls[0]!.id, data: { end: [12, 1] } },
      { id: walls[1]!.id, data: { start: [12, 1] } },
    ])
    for (const [id, callback] of rafs) { rafs.delete(id); callback(now) }
    const dirtyWalls = [...useScene.getState().dirtyNodes].filter((id) => useScene.getState().nodes[id]?.type === 'wall')
    expect(dirtyWalls.length).toBe(4)
    const before = stats().reinvalidationBuilds
    runWallBuildFrame()
    now += 80
    runWallBuildFrame()
    expect(stats().reinvalidationBuilds - before).toBe(4)
    expect(getPendingWallRebuildCount()).toBe(0)
  } finally {
    stopDetection()
  }
})

test('a new hydration resets counters and pending neighbours; node stats preserve wall counters', () => {
  const walls = hydrate(3)
  canvas.dispatchEvent(new Event('pointerdown'))
  useScene.getState().dirtyNodes.clear()
  useScene.getState().markDirty(walls[0]!.id)
  runWallBuildFrame()
  expect(getPendingWallRebuildCount()).toBe(1)
  hydrate(12)
  expect(getPendingWallRebuildCount()).toBe(0)
  expect(stats().firstBuilds).toBe(0)
  runWallBuildFrame()
  publishPerfBatchStats({ items: 5, instances: 10, containers: 1 })
  expect(stats().firstBuilds).toBe(12)
  expect(readPerfBatchStats().items).toBe(5)
})

    `,
    )
    const result = Bun.spawnSync(
      [process.execPath, 'test', '--preload', preload, probe, '--randomize', '--seed=1'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    expect({
      code: result.exitCode,
      failures: result.exitCode ? result.stderr.toString() : '',
    }).toEqual({ code: 0, failures: '' })
    const mountPreload = join(directory, 'mount-preload.ts')
    writeFileSync(
      mountPreload,
      `
import { mock } from 'bun:test'
const react = require('react')
mock.module('react', () => ({ ...react, default: react, useEffect: (effect) => { globalThis.wallCleanup = effect() } }))
mock.module('@react-three/fiber', () => ({ useFrame: (frame) => { globalThis.wallFrame = frame } }))
const core = require(${sourcePath('packages/core/src/index.ts')})
const storeWithoutHooks = (store) => Object.assign((selector) => selector(store.getState()), store)
mock.module('@pascal-app/core', () => ({ ...core, useScene: storeWithoutHooks(core.useScene), useLiveNodeOverrides: storeWithoutHooks(core.useLiveNodeOverrides) }))
mock.module(${sourcePath('packages/viewer/src/lib/gpu-perf.ts')}, () => ({ PERF_OVERLAY_ENABLED: process.env.WALL_TEST_PERF !== 'off' }))
`,
    )
    const mountProbe = join(directory, 'mount.test.ts')
    writeFileSync(
      mountProbe,
      `
import { expect, spyOn, test } from 'bun:test'
import { LevelNode, WallNode, useScene, useLiveNodeOverrides, useLiveTransforms, sceneRegistry } from '@pascal-app/core'
import { BoxGeometry, Mesh } from 'three'
import { subscribeWallBuildInteractions, isWallInitialBuildActive, drainStats } from ${sourcePath('packages/viewer/src/systems/wall/wall-build-lifecycle.ts')}
import * as perfStore from ${sourcePath('packages/viewer/src/lib/perf-panel-store.ts')}
import { subscribePerfSamples } from ${sourcePath('packages/viewer/src/lib/perf-tracks.ts')}

test('canvas and live-state owner precede the lazy wall consumer; remount retains drain identity', async () => {
  let now = 0
  const clock = spyOn(performance, 'now').mockImplementation(() => now)
  const publish = spyOn(perfStore, 'publishPerfWallDrainStats')
  const spans: number[] = []
  const stopSamples = subscribePerfSamples((track, ms) => { if (track === 'wall-initial-build') spans.push(ms) })
  const canvas = new EventTarget()
  const stopInput = subscribeWallBuildInteractions(canvas)!
  const level = LevelNode.parse({})
  const walls = Array.from({ length: 12 }, (_, i) => WallNode.parse({ parentId: level.id, start: [i * 12, 0], end: [(i + 1) * 12, 0] }))
  level.children = walls.map(wall => wall.id)
  const nodes = Object.fromEntries([level, ...walls].map(node => [node.id, node]))
  const meshes = walls.map(wall => {
    const mesh = new Mesh(new BoxGeometry())
    mesh.geometry.addEventListener('dispose', () => { now += 4 })
    sceneRegistry.nodes.set(wall.id, mesh)
    sceneRegistry.byType.wall.add(wall.id)
    return mesh
  })
  let cleanup: (() => void) | undefined
  try {
    for (const interaction of ['wheel', 'override', 'transform']) {
      useScene.getState().setScene(nodes, [level.id])
      if (interaction === 'wheel') canvas.dispatchEvent(new Event('wheel'))
      if (interaction === 'override') {
        useLiveNodeOverrides.getState().set(walls[0]!.id, { height: 5 })
        useLiveNodeOverrides.getState().clearAll()
      }
      if (interaction === 'transform') {
        useLiveTransforms.getState().set(walls[0]!.id, { position: [0, 1, 0], rotation: 0 })
        useLiveTransforms.getState().clearAll()
      }
      expect(useScene.getState().hydrationToken).toBeNull()
    }
    const { WallSystem } = await import(${sourcePath('packages/viewer/src/systems/wall/wall-system.tsx')})
    WallSystem()
    cleanup = globalThis.wallCleanup
    expect(isWallInitialBuildActive()).toBe(false)
    useScene.getState().setScene(nodes, [level.id])
    spans.length = 0
    const start = now
    const token = useScene.getState().hydrationToken
    globalThis.wallFrame()
    expect(drainStats.firstBuilds).toBe(2)
    expect(drainStats.budgetExits).toBe(1)
    cleanup!()
    now += 20
    WallSystem()
    cleanup = globalThis.wallCleanup
    expect(useScene.getState().hydrationToken).toBe(token)
    expect(drainStats.firstBuilds).toBe(2)
    expect(spans).toEqual([])
    for (let i = 0; i < 5; i++) globalThis.wallFrame()
    expect(drainStats.firstBuilds).toBe(12)
    expect(isWallInitialBuildActive()).toBe(false)
    const perf = process.env.WALL_TEST_PERF !== 'off'
    expect(spans).toEqual(perf ? [now - start] : [])
    if (perf) {
      const snapshot = perfStore.readPerfBatchStats().wallDrain
      globalThis.wallFrame()
      expect(perfStore.readPerfBatchStats().wallDrain).toBe(snapshot)
    } else {
      for (let i = 0; i < 40; i++) globalThis.wallFrame()
      expect(publish).not.toHaveBeenCalled()
      expect(perfStore.readPerfBatchStats().wallDrain).toBeUndefined()
    }
  } finally {
    cleanup?.()
    stopInput()
    stopSamples()
    publish.mockRestore()
    clock.mockRestore()
    useScene.getState().unloadScene()
    sceneRegistry.clear()
    for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose() }
  }
})
`,
    )
    for (const perf of ['on', 'off']) {
      const mountResult = Bun.spawnSync(
        [process.execPath, 'test', '--preload', mountPreload, mountProbe],
        { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, WALL_TEST_PERF: perf } },
      )
      expect({
        code: mountResult.exitCode,
        failures: mountResult.exitCode ? mountResult.stderr.toString() : '',
      }).toEqual({ code: 0, failures: '' })
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 10000)
