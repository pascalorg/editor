import { afterEach, expect, test } from 'bun:test'
import {
  initSpaceDetectionSync,
  pauseSpaceDetection,
  resumeSpaceDetection,
} from '../../lib/space-detection'
import {
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  UnitNode,
  WallNode,
  type ZoneNode,
} from '../../schema'
import { type SceneCommit, subscribeSceneCommits } from '../../store/history-control'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import { createZone, planWallDeletion, structureChangeBatch } from './index'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}
let stop = () => {}
afterEach(() => {
  stop()
  useScene.temporal.getState().resume()
})
const all = () => Object.values(useScene.getState().nodes)
const walls = () => all().filter((n) => n.type === 'wall')
const zones = () => all().filter((n) => n.type === 'zone')
const separators = () => all().filter((n) => n.type === 'separator')
function setup() {
  const level = LevelNode.parse({ id: 'level_deletion', parentId: 'building_deletion' })
  const building = BuildingNode.parse({ id: 'building_deletion', children: [level.id] })
  useScene.setState({
    nodes: { [level.id]: level, [building.id]: building },
    rootNodeIds: [building.id],
    collections: {},
    materials: {},
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  let i = 0
  const plan = createZone(useScene.getState().nodes, {
    levelId: level.id,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ],
    enclose: true,
    name: 'Balcony',
    intent: { floor: { finish: 'tile' }, wallMaterial: 'paint' },
    mintId: (kind) => `${kind}_deletion${++i}`,
  })
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  clearSceneHistory()
  return { level, building, zoneId: plan.zoneId as ZoneNode['id'] }
}

test('exterior wall deletion preserves zone, finishes, plate and ceiling in one commit and undo', () => {
  const { zoneId } = setup()
  const wall = walls()[0]!
  const door = DoorNode.parse({ parentId: wall.id, wallId: wall.id, position: [2, 0, 0] })
  useScene.getState().createNode(door, wall.id)
  clearSceneHistory()
  const before = useScene.getState().nodes
  const surfaces = all().filter((n) => n.type === 'slab' || n.type === 'ceiling')
  const commits: SceneCommit[] = []
  const unsubscribe = subscribeSceneCommits((c) => commits.push(c))
  try {
    useScene.getState().deleteNode(wall.id)
    expect(separators()).toHaveLength(1)
    expect(separators()[0]).toMatchObject({ start: wall.start, end: wall.end })
    expect(useScene.getState().nodes[door.id]).toBeUndefined()
    expect(zones()).toHaveLength(1)
    expect(zones()[0]).toMatchObject({
      id: zoneId,
      name: 'Balcony',
      enclosureStatus: 'enclosed',
      floor: { finish: 'tile' },
      wallMaterial: 'paint',
    })
    for (const surface of surfaces)
      expect(useScene.getState().nodes[surface.id]?.type).toBe(surface.type)
    expect(commits).toHaveLength(1)
    expect(commits[0]!.current.nodes[separators()[0]!.id]).toBeDefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const after = useScene.getState().nodes
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(after)
  } finally {
    unsubscribe()
  }
})

test('shared wall deletion merges rooms, retaining largest overlap and unit membership', () => {
  const { level, building, zoneId } = setup()
  const partition = WallNode.parse({ parentId: level.id, start: [2, 0], end: [2, 4] })
  useScene.getState().createNode(partition, level.id)
  expect(zones()).toHaveLength(2)
  const smaller = zones().find((n) => n.id !== zoneId)!
  const unit = UnitNode.parse({ parentId: building.id, members: [smaller.id] })
  useScene.getState().createNode(unit, building.id)
  useScene.getState().deleteNode(partition.id)
  expect(separators()).toHaveLength(0)
  expect(zones()).toHaveLength(1)
  expect(zones()[0]!.id).toBe(zoneId)
  expect(useScene.getState().nodes[unit.id]).toMatchObject({ members: [zoneId] })
})

test('free wall deletion creates no separator', () => {
  const { level } = setup()
  const wall = WallNode.parse({ parentId: level.id, start: [10, 0], end: [12, 0] })
  useScene.getState().createNode(wall, level.id)
  useScene.getState().deleteNode(wall.id)
  expect(useScene.getState().nodes[wall.id]).toBeUndefined()
  expect(separators()).toHaveLength(0)
  expect(zones()).toHaveLength(1)
})

test('multi-wall deletion preserves each exterior span until every boundary is deleted', () => {
  setup()
  useScene.getState().deleteNodes(
    walls()
      .slice(0, 2)
      .map((n) => n.id),
  )
  expect(separators()).toHaveLength(2)
  expect(zones()[0]!.enclosureStatus).toBe('enclosed')
  useScene.getState().deleteNodes(walls().map((n) => n.id))
  expect(zones()).toHaveLength(0)
  expect(separators()).toHaveLength(0)
})

test('deleting all room walls removes zone, finishes, contents and derived surfaces', () => {
  const { level, building, zoneId } = setup()
  const item = ItemNode.parse({
    parentId: level.id,
    position: [2, 0, 2],
    asset: { id: 'chair', name: 'Chair', category: 'chairs', src: '/chair.glb', thumbnail: '' },
  })
  const unit = UnitNode.parse({ parentId: building.id, members: [zoneId] })
  useScene.getState().createNodes([
    { node: item, parentId: level.id },
    { node: unit, parentId: building.id },
  ])
  clearSceneHistory()
  const before = useScene.getState().nodes
  useScene.getState().deleteNodes(walls().map((n) => n.id))
  expect(
    all().filter((n) => ['zone', 'slab', 'ceiling', 'separator', 'item'].includes(n.type)),
  ).toHaveLength(0)
  expect(useScene.getState().nodes[unit.id]).toMatchObject({ members: [] })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})

test('partial long wall deletion replaces only the derived room span despite stale mirrors', () => {
  setup()
  const wall = walls().find((n) => n.start[1] === 0 && n.end[1] === 0)!
  useScene.getState().updateNode(wall.id, { start: [-4, 0], end: [12, 0] })
  const nodes = { ...useScene.getState().nodes }
  for (const zone of zones()) nodes[zone.id] = { ...zone, boundaryWallIds: [] }
  const before = JSON.stringify(nodes)
  const plan = planWallDeletion(nodes, { nodeIds: [wall.id], mintId: () => 'separator_partial' })
  expect(JSON.stringify(nodes)).toBe(before)
  expect(plan.changes.filter((c) => c.op === 'create')).toMatchObject([
    { node: { type: 'separator', start: [0, 0], end: [8, 0] } },
  ])
  useScene.getState().deleteNode(wall.id)
  expect(separators()).toHaveLength(1)
  expect(zones()[0]!.enclosureStatus).toBe('enclosed')
})

test('deleting a level cascades without preserving room boundaries', () => {
  const { level } = setup()
  useScene.getState().deleteNode(level.id)
  expect(all().map((n) => n.type)).toEqual(['building'])
})

test('a wall shared on only part of its length merges there and preserves its exterior span', () => {
  const { level, zoneId } = setup()
  const bottom = walls().find((n) => n.start[1] === 0 && n.end[1] === 0)!
  const points: [number, number][] = [
    [0, 0],
    [0, -4],
    [4, -4],
    [4, 0],
  ]
  useScene.getState().createNodes(
    points.slice(0, 3).map((start, i) => ({
      node: WallNode.parse({ parentId: level.id, start, end: points[i + 1] }),
      parentId: level.id,
    })),
  )
  expect(zones()).toHaveLength(2)
  useScene.getState().deleteNode(bottom.id)
  expect(separators()).toHaveLength(1)
  expect(separators()[0]).toMatchObject({ start: [4, 0], end: [8, 0] })
  expect(zones()).toHaveLength(1)
  expect(zones()[0]).toMatchObject({ id: zoneId, enclosureStatus: 'enclosed' })
})

test('P4a: deleting every wall of A preserves surviving neighbour B with separators', () => {
  const { level } = setup()
  const partition = WallNode.parse({ parentId: level.id, start: [2, 0], end: [2, 4] })
  useScene.getState().createNode(partition, level.id)
  const a = zones().find((z) => Math.max(...z.polygon.map((p) => p[0])) === 2)!
  const b = zones().find((z) => z.id !== a.id)!
  useScene.getState().deleteNodes(a.boundaryWallIds)
  expect(zones()).toHaveLength(1)
  expect(zones()[0]).toMatchObject({ id: b.id, enclosureStatus: 'enclosed' })
  expect(separators().some((s) => s.start[0] === 2 && s.end[0] === 2)).toBe(true)
  expect(all().filter((n) => n.type === 'slab')).toHaveLength(1)
})

test('P11: cancelling an in-place duplicate leaves no separator beneath its original wall', () => {
  const { level } = setup()
  const original = walls()[0]!
  const duplicate = WallNode.parse({ ...original, id: 'wall_000_duplicate' })
  useScene.getState().createNode(duplicate, level.id)
  useScene.getState().deleteNode(duplicate.id)
  expect(separators()).toHaveLength(0)
  expect(useScene.getState().nodes[original.id]).toBeDefined()
  expect(zones()).toHaveLength(1)
})

test('P9: cancelling a partition while space detection is paused restores the unsplit room', () => {
  const { level, zoneId } = setup()
  pauseSpaceDetection()
  try {
    const partition = WallNode.parse({ parentId: level.id, start: [4, 0], end: [4, 4] })
    useScene.getState().createNode(partition, level.id)
    const draft = useScene.getState().nodes
    expect(
      planWallDeletion(draft, {
        nodeIds: [partition.id],
        mintId: () => 'separator_stale',
      }).changes.filter((c) => c.op === 'create'),
    ).toEqual([])
    useScene.getState().deleteNode(partition.id)
  } finally {
    resumeSpaceDetection()
  }
  expect(separators()).toHaveLength(0)
  expect(zones()).toHaveLength(1)
  expect(zones()[0]!.id).toBe(zoneId)
})

test('deleting walls one by one retains a separator-only terrace with its floor', () => {
  const { zoneId } = setup()
  const ids = walls().map((w) => w.id)
  for (const id of ids) useScene.getState().deleteNode(id)
  expect(walls()).toHaveLength(0)
  expect(separators()).toHaveLength(4)
  expect(zones()).toHaveLength(1)
  expect(zones()[0]).toMatchObject({ id: zoneId, enclosureStatus: 'enclosed' })
  expect(all().filter((n) => n.type === 'slab')).toHaveLength(1)
})

test('a wall drawn over an open edge absorbs only the covered separator span', () => {
  const { level, zoneId } = setup()
  const bottom = walls().find((w) => w.start[1] === 0 && w.end[1] === 0)!
  useScene.getState().deleteNode(bottom.id)
  const replacement = WallNode.parse({ parentId: level.id, start: [2, 0], end: [6, 0] })
  useScene.getState().createNode(replacement, level.id)
  expect(
    separators()
      .map((s) => [s.start, s.end])
      .sort(),
  ).toEqual([
    [
      [0, 0],
      [2, 0],
    ],
    [
      [6, 0],
      [8, 0],
    ],
  ])
  expect(zones()).toHaveLength(1)
  expect(zones()[0]!.id).toBe(zoneId)
  const before = useScene.getState().nodes
  useScene.getState().createNode(WallNode.parse({ ...bottom }), level.id)
  expect(separators()).toHaveLength(0)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})
