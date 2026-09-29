import { afterEach, beforeEach, expect, test } from 'bun:test'
import { initSpaceDetectionSync, type SpaceTopologyReconcileEvent } from '../lib/space-detection'
import {
  AnyNode,
  type AnyNodeId,
  BuildingNode,
  CeilingNode,
  LevelNode,
  SlabNode,
  WallNode,
} from '../schema'
import { migrateCeilingRoomLinks, migrateRoomZones } from '../utils/room-zone-migration'
import fixture from './fixtures/maxi-8x-endpoint.json'
import { runAsSingleSceneHistoryStep } from './history-control'
import useScene, { clearSceneHistory } from './use-scene'

const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
})

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  useScene.getState().unloadScene()
  clearSceneHistory()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})

function watch(nodes: Record<AnyNodeId, AnyNode>) {
  useScene.setState({
    nodes: migrateCeilingRoomLinks(migrateRoomZones(nodes).nodes).nodes as Nodes,
    rootNodeIds: [],
    readOnly: false,
  })
  clearSceneHistory()
  const events: SpaceTopologyReconcileEvent[] = []
  const editor = {
    spaces: {},
    setSpaces(spaces: Record<string, unknown>) {
      this.spaces = spaces
    },
  }
  const stop = initSpaceDetectionSync(
    useScene,
    { getState: () => editor },
    { onTopologyReconcile: (event) => events.push(event) },
  )
  cleanups.push(stop)
  return { events, stop, editor }
}

function canonicalPolygon(points: number[][]) {
  const rotations = points.map((_, i) =>
    JSON.stringify([...points.slice(i), ...points.slice(0, i)]),
  )
  return rotations.sort()[0]
}

function graph(nodes: Record<AnyNodeId, AnyNode>) {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [
      id,
      'polygon' in node && Array.isArray(node.polygon)
        ? { ...node, polygon: canonicalPolygon(node.polygon) }
        : node,
    ]),
  )
}

const baseline = () =>
  Object.fromEntries(
    fixture.nodes.map((node) => {
      const parsed = AnyNode.parse(node)
      return [parsed.id, parsed]
    }),
  ) as Record<AnyNodeId, AnyNode>

function forward() {
  runAsSingleSceneHistoryStep(useScene, () =>
    useScene.getState().updateNodes(fixture.updates as { id: AnyNodeId; data: Partial<AnyNode> }[]),
  )
}

test('Maxi 8× endpoint undo/redo restores the saved graph without reminting identities', () => {
  const initial = baseline()
  const indexed = watch(initial)
  forward()
  const moved = useScene.getState().nodes
  const target = useScene.temporal.getState().pastStates.at(-1)!.nodes
  indexed.events.length = 0
  useScene.temporal.getState().undo()
  const undone = useScene.getState().nodes
  expect(indexed.events).toHaveLength(0)
  const remoteSlab = 'slab_02warzosdw17ko2n' as AnyNodeId
  expect(undone[remoteSlab]).toBe(target[remoteSlab])
  const undoGraph = graph(undone)
  useScene.temporal.getState().redo()
  const redoGraph = graph(useScene.getState().nodes)
  expect(indexed.events).toHaveLength(0)
  expect(undoGraph).toEqual(graph(target))
  expect(redoGraph).toEqual(graph(moved))
  indexed.stop()
  // The 8× fixture takes 5–6 s on the shared CI runner, past bun's 5 s default.
}, 30_000)

type Nodes = Record<AnyNodeId, AnyNode>
type Transition = { before: Nodes; target: Nodes; actual: Nodes }

function rooms() {
  const building = BuildingNode.parse({ id: 'building_temporal', children: ['level_temporal'] })
  const level = LevelNode.parse({ id: 'level_temporal', parentId: building.id, height: 2.5 })
  const nodes: Nodes = { [building.id]: building, [level.id]: level }
  for (const [label, x] of [
    ['left', 0],
    ['right', 20],
  ] as const) {
    const polygon: [number, number][] = [
      [x, 0],
      [x + 4, 0],
      [x + 4, 3],
      [x, 3],
    ]
    const walls = polygon.map((start, i) =>
      WallNode.parse({
        id: `wall_${label}_${i}`,
        parentId: level.id,
        start,
        end: polygon[(i + 1) % 4],
        frontSide: 'interior',
        backSide: 'exterior',
      }),
    )
    const slab = SlabNode.parse({
      id: `slab_${label}`,
      parentId: level.id,
      polygon,
      autoFromWalls: true,
      boundary: 'auto',
    })
    const ceiling = CeilingNode.parse({
      id: `ceiling_${label}`,
      parentId: level.id,
      polygon,
      autoFromWalls: true,
    })
    for (const node of [...walls, slab, ceiling]) {
      nodes[node.id] = node
      level.children.push(node.id)
    }
  }
  return { nodes, level }
}

function surfaces(nodes: Nodes) {
  return Object.values(nodes).filter(
    (node): node is SlabNode | CeilingNode =>
      (node.type === 'slab' || node.type === 'ceiling') && node.autoFromWalls,
  )
}

function assertSurfaces(nodes: Nodes, rooms: number) {
  const auto = surfaces(nodes)
  expect(auto.filter((node) => node.type === 'slab')).toHaveLength(Math.min(rooms, 2))
  expect(auto.filter((node) => node.type === 'ceiling')).toHaveLength(rooms)
  for (const node of auto) {
    expect((nodes[node.parentId!] as LevelNode).children.filter((id) => id === node.id)).toEqual([
      node.id,
    ])
    expect(node.polygon.length).toBeGreaterThanOrEqual(4)
    if (node.type === 'ceiling') expect(node.height).toBeUndefined()
    else expect(node.elevation).toBeCloseTo(0.05)
  }
}

function jump(transitions: Transition[], direction: 'undo' | 'redo', steps = 1) {
  const history = useScene.temporal.getState()
  const states = direction === 'undo' ? history.pastStates : history.futureStates
  const target = states.at(-steps)!.nodes
  const before = useScene.getState().nodes
  history[direction](steps)
  const actual = useScene.getState().nodes
  transitions.push({ before, target, actual })
  return actual
}

function assertRestoredSnapshots(transitions: Transition[]) {
  for (const { target, actual } of transitions) expect(graph(actual)).toEqual(graph(target))
}

test('closing-wall deletion, undo and redo retain the full-level surface outcome', () => {
  const { nodes, level } = rooms()
  const sync = watch(nodes)
  const transitions: Transition[] = []
  const before = useScene.getState().nodes
  useScene.getState().deleteNode('wall_left_3')
  const deleted = useScene.getState().nodes
  transitions.push({ before, target: deleted, actual: deleted })
  assertSurfaces(deleted, 2)
  expect((deleted[level.id] as LevelNode).children).not.toContain('wall_left_3')
  const restored = jump(transitions, 'undo')
  assertSurfaces(restored, 2)
  expect(
    surfaces(restored)
      .map((node) => node.id)
      .sort(),
  ).toEqual(
    surfaces(nodes)
      .map((node) => node.id)
      .sort(),
  )
  expect((restored[level.id] as LevelNode).children).toContain('wall_left_3')
  assertSurfaces(jump(transitions, 'redo'), 2)
  sync.stop()
  assertRestoredSnapshots(transitions)
})

test('split, move and merge history preserves surfaces through the complete cycle', () => {
  const { nodes, level } = rooms()
  const sync = watch(nodes)
  const transitions: Transition[] = []
  const divider = WallNode.parse({
    id: 'wall_divider',
    parentId: level.id,
    start: [2, 0],
    end: [2, 3],
  })
  useScene.getState().createNode(divider, level.id)
  assertSurfaces(useScene.getState().nodes, 3)
  useScene.getState().updateNode(divider.id, { start: [3, 0], end: [3, 3] })
  assertSurfaces(useScene.getState().nodes, 3)
  useScene.getState().deleteNode(divider.id)
  assertSurfaces(useScene.getState().nodes, 2)
  assertSurfaces(jump(transitions, 'undo'), 3)
  sync.events.length = 0
  const unmoved = jump(transitions, 'undo')
  assertSurfaces(unmoved, 3)
  expect(sync.events).toHaveLength(0)
  expect((unmoved[divider.id] as WallNode).start).toEqual([2, 0])
  assertSurfaces(jump(transitions, 'undo'), 2)
  for (const count of [3, 3, 2]) assertSurfaces(jump(transitions, 'redo'), count)
  sync.stop()
  assertRestoredSnapshots(transitions)
})

test('two-step temporal jumps reconcile two distinct components against the full-level oracle', () => {
  const { nodes } = rooms()
  const sync = watch(nodes)
  const transitions: Transition[] = []
  for (const [label, x] of [
    ['left', 0],
    ['right', 20],
  ] as const) {
    useScene.getState().updateNodes([
      { id: `wall_${label}_0`, data: { end: [x + 5, 0] } },
      { id: `wall_${label}_1`, data: { start: [x + 5, 0], end: [x + 5, 3] } },
      { id: `wall_${label}_2`, data: { start: [x + 5, 3] } },
    ])
  }
  const moved = useScene.getState().nodes
  sync.events.length = 0
  const undone = jump(transitions, 'undo', 2)
  assertSurfaces(undone, 2)
  expect(sync.events).toHaveLength(0)
  for (const label of ['left', 'right']) {
    expect(canonicalPolygon((undone[`slab_${label}`] as SlabNode).polygon)).toEqual(
      canonicalPolygon((nodes[`slab_${label}`] as SlabNode).polygon),
    )
  }
  const redone = jump(transitions, 'redo', 2)
  assertSurfaces(redone, 2)
  expect(sync.events).toHaveLength(0)
  expect(graph(redone)).toEqual(graph(moved))
  sync.stop()
  assertRestoredSnapshots(transitions)
})

test('level hierarchy changes clamp explicit ceilings; undo and redo restore their saved heights', () => {
  const building = BuildingNode.parse({ id: 'building_heights', children: ['level_heights'] })
  const level = LevelNode.parse({
    id: 'level_heights',
    parentId: building.id,
    height: 2.5,
    children: ['ceiling_heights', 'wall_heights'],
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_heights',
    parentId: level.id,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    height: 9,
  })
  const wall = WallNode.parse({
    id: 'wall_heights',
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
  })
  const nodes: Nodes = {
    [building.id]: building,
    [level.id]: level,
    [ceiling.id]: ceiling,
    [wall.id]: wall,
  }
  const sync = watch(nodes)
  const transitions: Transition[] = []
  useScene.setState({ nodes: { ...nodes, [level.id]: { ...level, height: 4 } } })
  expect((useScene.getState().nodes[ceiling.id] as CeilingNode).height).toBe(3.99)
  expect(useScene.getState().nodes[wall.id]).toBe(wall)
  const undone = jump(transitions, 'undo')
  expect((undone[ceiling.id] as CeilingNode).height).toBe(9)
  expect((undone[level.id] as LevelNode).children).toEqual([ceiling.id, wall.id])
  const redone = jump(transitions, 'redo')
  expect((redone[ceiling.id] as CeilingNode).height).toBe(3.99)
  sync.stop()
  assertRestoredSnapshots(transitions)
})
