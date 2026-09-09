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
  subscribeWallBuildInteractions,
} from ${sourcePath('packages/viewer/src/systems/wall/wall-system.tsx')}

let now = 0
let rebuildCost = 0
let restoreClock: () => void
let restoreRaf: () => void
let unsubscribe: () => void
let canvas: EventTarget
const meshes: Mesh[] = []

beforeEach(() => {
  const request = globalThis.requestAnimationFrame
  const cancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
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
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 10000)
