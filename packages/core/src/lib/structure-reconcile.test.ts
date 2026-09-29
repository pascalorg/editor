import { afterEach, beforeEach, expect, test } from 'bun:test'
import * as Bun from 'bun'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CeilingNode,
  LevelNode,
  SeparatorNode,
  SiteNode,
  SlabNode,
  WallNode,
  type ZoneNode,
} from '../schema'
import { type SceneCommit, subscribeSceneCommits } from '../store/history-control'
import useLiveTerrain from '../store/use-live-terrain'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { initSpaceDetectionSync } from './space-detection'
import type { SceneNodes } from './structure-kernel'
import { reconcileSceneStructure, type StructureIdFactory } from './structure-reconcile'
import { createTerrainField } from './terrain-field'
import { commitTerrainField } from './terrain-source-persisted'

const levelId = 'level_reconcile'
const polygon: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]
function room(closed = true, id = levelId) {
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      id: `wall_${id}_${index}`,
      parentId: id,
      start,
      end: polygon[(index + 1) % 4],
      thickness: 0.2,
    }),
  )
  const kept = closed ? walls : walls.slice(0, 3)
  const level = LevelNode.parse({ id, children: kept.map((wall) => wall.id) })
  return { walls, nodes: Object.fromEntries([level, ...kept].map((node) => [node.id, node])) }
}
function factory(start = 0): StructureIdFactory {
  let sequence = start
  return (kind) => `${kind}_authority_${sequence++}`
}
function ofKind(nodes: SceneNodes, kind: AnyNode['type']) {
  return Object.values(nodes).filter((node) => node.type === kind)
}
function assertIdempotent(nodes: SceneNodes) {
  const result = reconcileSceneStructure({
    nodes,
    mintId: () => {
      throw new Error('Idempotent reconciliation must not mint')
    },
  })
  expect(result.patches).toEqual([])
  expect(result.events).toEqual([])
  expect(result.nodes).toBe(nodes)
}
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
let previousState: ReturnType<typeof useScene.getState>
let stop = () => {}
let stopCommits = () => {}
beforeEach(() => {
  previousState = useScene.getState()
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
})
afterEach(() => {
  stop()
  stopCommits()
  useLiveTerrain.getState().endAll()
  useScene.setState(previousState, true)
  clearSceneHistory()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})
function watch(nodes: SceneNodes, mintId: StructureIdFactory) {
  useScene.setState({
    nodes,
    rootNodeIds: [levelId],
    dirtyNodes: new Set<AnyNodeId>(),
    readOnly: false,
  })
  clearSceneHistory()
  const editor = {
    spaces: {},
    setSpaces(spaces: Record<string, unknown>) {
      this.spaces = spaces
    },
  }
  stop = initSpaceDetectionSync(useScene, { getState: () => editor }, { mintId })
}

test('snapshot reconciliation and the closing store commit produce the identical graph and mint sequence', () => {
  const open = room(false)
  const closed = room().nodes
  const before = JSON.stringify(closed)
  const result = reconcileSceneStructure({ nodes: closed, mintId: factory() })
  expect(
    ['zone', 'ceiling', 'slab'].map((kind) =>
      ofKind(result.nodes, kind as AnyNode['type']).map((node) => node.id),
    ),
  ).toEqual([['zone_authority_0'], ['ceiling_authority_1'], [expect.stringMatching(/^slab_/)]])
  watch(open.nodes, factory())
  const commits: SceneCommit[] = []
  stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
  useScene.getState().createNode(open.walls[3]!, levelId)
  expect(useScene.getState().nodes).toEqual(result.nodes)
  expect(commits).toHaveLength(1)
  expect(commits[0]!.current.nodes).toEqual(result.nodes)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(open.nodes)
  expect(JSON.stringify(closed)).toBe(before)
  assertIdempotent(result.nodes)
})

test('all-level and explicit-level reconciliation use stable ordering and leave excluded levels alone', () => {
  const nodes = { ...room(true, 'level_z').nodes, ...room(true, 'level_a').nodes }
  const all = reconcileSceneStructure({ nodes, mintId: factory() })
  expect(
    reconcileSceneStructure({
      nodes: Object.fromEntries(Object.entries(nodes).reverse()),
      levelIds: ['level_z', 'level_a', 'level_z'],
      mintId: factory(),
    }),
  ).toEqual(all)
  const only = reconcileSceneStructure({ nodes, levelIds: ['level_a'], mintId: factory() })
  expect(ofKind(only.nodes, 'zone')).toHaveLength(1)
  expect(only.nodes.level_z).toBe(nodes.level_z)
  for (const wall of room(true, 'level_z').walls) expect(only.nodes[wall.id]).toBe(nodes[wall.id])
  assertIdempotent(all.nodes)
})

test('edit parity preserves deleted surfaces, persisted ceiling opt-out, and subsequent wall moves', () => {
  const initial = reconcileSceneStructure({ nodes: room().nodes, mintId: factory() }).nodes
  watch(initial, factory(3))
  const slab = ofKind(initial, 'slab')[0]!
  const ceiling = ofKind(initial, 'ceiling')[0]!
  const current = { ...initial }
  delete current[slab.id]
  delete current[ceiling.id]
  const level = current[levelId] as LevelNode
  current[levelId] = {
    ...level,
    children: level.children.filter((id) => id !== slab.id && id !== ceiling.id),
  }
  const result = reconcileSceneStructure({
    nodes: current,
    previousNodes: initial,
    mintId: factory(3),
  })
  useScene.getState().deleteNodes([slab.id, ceiling.id])
  expect(useScene.getState().nodes).toEqual(result.nodes)
  expect(ofKind(result.nodes, 'slab')).toEqual([])
  expect(ofKind(result.nodes, 'ceiling')).toEqual([])
  expect(ofKind(result.nodes, 'zone')[0]).toMatchObject({ hasCeiling: false })
  assertIdempotent(result.nodes)
  const moved = { ...result.nodes }
  const updates = ofKind(moved, 'wall').map((node) => {
    const wall = node as WallNode
    const data = {
      start: [wall.start[0] * 1.1, wall.start[1]] as [number, number],
      end: [wall.end[0] * 1.1, wall.end[1]] as [number, number],
    }
    moved[wall.id] = { ...wall, ...data }
    return { id: wall.id, data }
  })
  const next = reconcileSceneStructure({
    nodes: moved,
    previousNodes: result.nodes,
    mintId: factory(3),
  })
  useScene.getState().updateNodes(updates)
  expect(useScene.getState().nodes).toEqual(next.nodes)
  assertIdempotent(next.nodes)
})

test('edit reconciliation preserves unrelated wall sides even with a serialized prior graph', () => {
  const left = room()
  const right = room(true, 'level_remote_ids')
  const remoteWalls = right.walls.map((wall) => ({
    ...wall,
    parentId: levelId,
    start: [wall.start[0] + 20, wall.start[1]] as [number, number],
    end: [wall.end[0] + 20, wall.end[1]] as [number, number],
  }))
  const previous: Record<string, AnyNode> = { ...left.nodes }
  for (const wall of remoteWalls) previous[wall.id] = wall
  previous[levelId] = {
    ...previous[levelId],
    children: [...left.walls, ...remoteWalls].map((wall) => wall.id),
  } as LevelNode
  const current = { ...previous, [left.walls[0]!.id]: { ...left.walls[0]!, height: 3 } }
  const result = reconcileSceneStructure({
    nodes: current,
    previousNodes: previous,
    mintId: factory(),
  })
  for (const wall of remoteWalls) expect(result.nodes[wall.id]).toBe(previous[wall.id])
  expect(
    reconcileSceneStructure({
      nodes: current,
      previousNodes: structuredClone(previous),
      mintId: factory(),
    }),
  ).toEqual(result)
  expect(
    result.patches.filter((patch) => patch.op === 'update' && current[patch.id]?.type === 'wall'),
  ).toHaveLength(4)
})

test('partition removal preserves plate identity and slab host references in the store and pure result', () => {
  const divider = WallNode.parse({
    id: 'wall_divider',
    parentId: levelId,
    start: [2, 0],
    end: [2, 4],
  })
  const initial = {
    ...reconcileSceneStructure({
      nodes: { ...room().nodes, [divider.id]: divider },
      mintId: factory(),
    }).nodes,
  }
  const smaller = ofKind(initial, 'slab')[0]!
  const wallId = room().walls[0]!.id
  initial[wallId] = { ...initial[wallId], supportSlabId: smaller.id } as WallNode
  const current = { ...initial }
  delete current[divider.id]
  const level = current[levelId] as LevelNode
  current[levelId] = { ...level, children: level.children.filter((id) => id !== divider.id) }
  const result = reconcileSceneStructure({
    nodes: current,
    previousNodes: initial,
    mintId: factory(20),
  })
  expect(result.nodes[smaller.id]).toBeDefined()
  expect((result.nodes[wallId] as WallNode).supportSlabId).toBe(smaller.id)
  watch(initial, factory(20))
  useScene.getState().deleteNode(divider.id)
  expect(useScene.getState().nodes).toEqual(result.nodes)
  assertIdempotent(result.nodes)
})

test('an explicitly associated manual floor suppresses a duplicate plate and opening a room retires its plate', () => {
  const manual = SlabNode.parse({ id: 'slab_manual', parentId: levelId, polygon })
  const supplied = reconcileSceneStructure({ nodes: room().nodes, mintId: factory() }).nodes
  const zone = Object.values(supplied).find((node) => node.type === 'zone') as ZoneNode
  const covered = reconcileSceneStructure({
    nodes: {
      ...supplied,
      [zone.id]: { ...zone, floor: { ...zone.floor, sourceSlabId: manual.id } },
      [manual.id]: manual,
    },
    mintId: factory(),
  })
  expect(ofKind(covered.nodes, 'slab')).toEqual([manual])
  assertIdempotent(covered.nodes)
  const initial = reconcileSceneStructure({ nodes: room().nodes, mintId: factory() }).nodes
  const current = { ...initial }
  delete current[`wall_${levelId}_3`]
  const result = reconcileSceneStructure({
    nodes: current,
    previousNodes: initial,
    mintId: factory(3),
  })
  expect(ofKind(result.nodes, 'slab')).toHaveLength(0)
  expect(ofKind(result.nodes, 'ceiling')).toEqual([])
  expect(ofKind(result.nodes, 'zone')[0]).toMatchObject({ enclosureStatus: 'open' })
  assertIdempotent(result.nodes)
})

test('separator splits have two zones and ceilings but one shared plate', () => {
  const separator = SeparatorNode.parse({
    id: 'separator_split',
    parentId: levelId,
    start: [2, 0],
    end: [2, 4],
  })
  const result = reconcileSceneStructure({
    nodes: { ...room().nodes, [separator.id]: separator },
    mintId: factory(),
  })
  expect(ofKind(result.nodes, 'zone')).toHaveLength(2)
  expect(ofKind(result.nodes, 'ceiling')).toHaveLength(2)
  expect(ofKind(result.nodes, 'slab')).toHaveLength(1)
  assertIdempotent(result.nodes)
})

test('zone elevation remains authoritative through wall support edits', () => {
  for (const custom of [false, true]) {
    const initial = { ...reconcileSceneStructure({ nodes: room().nodes, mintId: factory() }).nodes }
    const slab = ofKind(initial, 'slab')[0] as SlabNode
    if (custom) {
      const zone = ofKind(initial, 'zone')[0]!
      initial[zone.id] = { ...zone, floor: { elevation: 0.42 } } as AnyNode
    }
    const nodes = Object.fromEntries(
      Object.values(initial).map((node) => [
        node.id,
        node.type === 'wall' ? { ...node, supportOffset: 0.6 } : node,
      ]),
    )
    const result = reconcileSceneStructure({ nodes, previousNodes: initial, mintId: factory(3) })
    expect(result.nodes[slab.id]).toMatchObject({ plateRole: 'base', elevation: 0.65 })
    if (custom)
      expect(
        ofKind(result.nodes, 'slab').find(
          (node) => node.type === 'slab' && node.plateRole === 'sunken',
        ),
      ).toMatchObject({ elevation: 0.42 })
    assertIdempotent(result.nodes)
  }
})

test('upper slab holds its underside when its walls change, independent of requested level order', () => {
  const upper = room(true, 'level_upper')
  const nodes = { ...room().nodes, ...upper.nodes }
  const building = BuildingNode.parse({ id: 'building_stack', children: [levelId, 'level_upper'] })
  nodes[building.id] = building
  nodes[levelId] = { ...nodes[levelId], parentId: building.id } as LevelNode
  nodes.level_upper = { ...nodes.level_upper, parentId: building.id, level: 1 } as LevelNode
  for (const wall of upper.walls) nodes[wall.id] = { ...wall, supportOffset: 0.45 }
  const ceiling = CeilingNode.parse({
    id: 'ceiling_manual',
    parentId: levelId,
    polygon,
    height: 2.4,
  })
  nodes[ceiling.id] = ceiling
  const initial = { ...reconcileSceneStructure({ nodes, mintId: factory() }).nodes }
  const slab = Object.values(initial).find(
    (node): node is SlabNode => node.type === 'slab' && node.parentId === 'level_upper',
  )!
  initial[slab.id] = { ...slab, thickness: 0.5 }
  const current = { ...initial }
  for (const wall of upper.walls)
    current[wall.id] = { ...current[wall.id], supportOffset: 0 } as WallNode
  const result = reconcileSceneStructure({
    nodes: current,
    previousNodes: initial,
    levelIds: [levelId, 'level_upper'],
    mintId: factory(10),
  })
  expect((result.nodes[slab.id] as SlabNode).elevation).toBeCloseTo(0.5)
  expect((result.nodes[ceiling.id] as CeilingNode).height).toBeCloseTo(2.4)
  expect(
    reconcileSceneStructure({
      nodes: current,
      previousNodes: initial,
      levelIds: ['level_upper', levelId],
      mintId: factory(10),
    }),
  ).toEqual(result)
  assertIdempotent(result.nodes)
})

test('plate elevation follows persisted terrain and ignores live uncommitted terrain', () => {
  const nodes = room().nodes
  const terrain = createTerrainField({ spacing: 8, cols: 3, rows: 3 })
  terrain.heights.fill(1000)
  const site = SiteNode.parse({
    id: 'site_terrain',
    terrain: commitTerrainField(terrain),
    children: ['building_terrain'],
  })
  const building = BuildingNode.parse({
    id: 'building_terrain',
    parentId: site.id,
    children: [levelId],
  })
  nodes[site.id] = site
  nodes[building.id] = building
  nodes[levelId] = { ...nodes[levelId], parentId: building.id } as LevelNode
  const expected = reconcileSceneStructure({ nodes, mintId: factory() })
  const live = createTerrainField({ spacing: 8, cols: 3, rows: 3 })
  live.heights.fill(2000)
  useLiveTerrain.getState().begin(site.id, live)
  expect(reconcileSceneStructure({ nodes, mintId: factory() })).toEqual(expected)
  expect((ofKind(expected.nodes, 'slab')[0] as SlabNode).elevation).toBe(10.05)
  const initialPlate = ofKind(expected.nodes, 'slab')[0] as SlabNode
  const sculpted = { ...expected.nodes, [site.id]: { ...site, terrain: commitTerrainField(live) } }
  const updated = reconcileSceneStructure({
    nodes: sculpted,
    previousNodes: expected.nodes,
    mintId: factory(20),
  })
  expect(updated.nodes[initialPlate.id]).toMatchObject({ elevation: 20.05 })
  expect(
    (ofKind(updated.nodes, 'zone')[0] as AnyNode & { floor?: { elevation?: number } }).floor
      ?.elevation,
  ).toBeUndefined()
  assertIdempotent(updated.nodes)
})

test('scene-migrations exports the orchestrator through a clean Node bundle', async () => {
  const loaded = new Set<string>()
  const build = await Bun.build({
    entrypoints: [new URL('../utils/scene-migrations.ts', import.meta.url).pathname],
    target: 'node',
    plugins: [
      {
        name: 'record-imports',
        setup(builder) {
          builder.onLoad({ filter: /\.[tj]sx?$/ }, ({ path }) => {
            loaded.add(path)
            return
          })
        },
      },
    ],
  })
  expect(build.success).toBe(true)
  const source = await build.outputs[0]!.text()
  const fixture = JSON.stringify(room().nodes)
  const probe = `${source}\nlet i = 0; const result = reconcileSceneStructure({ nodes: ${fixture}, mintId: kind => kind + '_probe_' + i++ }); console.log(JSON.stringify(Object.values(result.nodes).map(node => node.type).sort()));`
  const result = Bun.spawnSync(['node', '--input-type=module'], {
    stdin: Buffer.from(probe),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout.toString())).toEqual([
    'ceiling',
    'level',
    'slab',
    'wall',
    'wall',
    'wall',
    'wall',
    'zone',
  ])
  expect(
    [...loaded].filter((path) => /\/store\/|\/node_modules\/(react|zustand|three)\//.test(path)),
  ).toEqual([])
})
