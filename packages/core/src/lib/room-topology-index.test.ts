import { describe, expect, test } from 'bun:test'
import { LevelNode, WallNode } from '../schema'
import { sampleWallPointsForRoomDetection } from './room-graph'
import { RoomTopologyIndex } from './room-topology-index'
import { createRoomTopologyIndex } from './space-detection'

const levelId = 'level_grid' as const

function wall(id: string, start: [number, number], end: [number, number]) {
  return WallNode.parse({ id: `wall_${id}`, parentId: levelId, start, end })
}

function scene(walls: WallNode[]) {
  const level = LevelNode.parse({ id: levelId, children: walls.map((node) => node.id) })
  return Object.fromEntries([level, ...walls].map((node) => [node.id, node]))
}

function gridIndex() {
  return new RoomTopologyIndex({
    detectRooms: () => [],
    sampleWall: (node) => [node.start, node.end],
    junctionTolerance: 0.1,
  })
}

describe('bounded topology grid', () => {
  test.each([
    { start: [0, 0], end: [1e6, 1e6] },
    { start: [0, 0], end: [6.635e287, 6.635e287] },
    { start: [1e100, 1e100], end: [1e100, 1e100] },
    { start: [-1e308, -1e308], end: [1e308, 1e308] },
  ])('falls back before enumerating extreme bounds: %j', ({ start, end }) => {
    const index = gridIndex()
    const extreme = wall('extreme', start as [number, number], end as [number, number])
    const nodes = scene([extreme])
    const level = index.rebuildLevel(levelId, nodes)
    expect(level.flat).toBe(true)
    expect(level.wallIdsByCell.size).toBe(0)
    expect(level.cellKeysByWallId.size).toBe(0)
    expect(level.cellEntries).toBe(0)
    const delta = index.applyWallDelta(levelId, new Set([extreme.id]), nodes, nodes)
    expect(delta.examinedWallIds).toEqual([extreme.id])
  })

  test('bounds total cell entries even when individual wall bounds are small', () => {
    const walls = Array.from({ length: 1100 }, (_, i) => wall(`${i}`, [0, 0], [1, 0]))
    const index = gridIndex()
    const level = index.rebuildLevel(levelId, scene(walls.slice(0, 1024)))
    expect(level.flat).toBe(false)
    expect(level.cellEntries).toBe(4096)
    index.applyWallDelta(
      levelId,
      new Set([walls[1024]!.id]),
      scene(walls.slice(0, 1024)),
      scene(walls.slice(0, 1025)),
    )
    expect(level.flat).toBe(true)
    expect(level.wallIdsByCell.size).toBe(0)
    expect(level.cellKeysByWallId.size).toBe(0)
    expect(level.cellEntries).toBe(0)
  })

  test('counts removals and finds connected walls across grid-to-flat transitions', () => {
    const first = wall('first', [0, 0], [1, 0])
    const neighbor = wall('neighbor', [1, 0], [1, 1])
    const remote = wall('remote', [20, 20], [21, 20])
    const before = scene([first, neighbor, remote])
    const index = gridIndex()
    const level = index.rebuildLevel(levelId, before)
    expect(level.flat).toBe(false)
    const oldEntries = level.cellEntries
    const unchanged = index.applyWallDelta(levelId, new Set([first.id]), before, before)
    expect(unchanged.examinedWallIds).toEqual([first.id, neighbor.id])
    expect(level.cellEntries).toBe(oldEntries)

    const long = { ...first, end: [100_000, 100_000] as [number, number] }
    const after = scene([long, neighbor, remote])
    const delta = index.applyWallDelta(levelId, new Set([first.id]), before, after)
    expect(level.flat).toBe(true)
    expect(delta.examinedWallIds).toEqual([first.id, neighbor.id, remote.id])
    index.applyWallDelta(levelId, new Set([first.id]), after, before)
    expect(level.cellEntries).toBe(0)
    const restored = index.applyWallDelta(levelId, new Set([first.id]), before, before)
    expect(restored.examinedWallIds).toEqual(unchanged.examinedWallIds)

    const rebuilt = index.rebuildLevel(levelId, before)
    expect(rebuilt.flat).toBe(false)
    index.applyWallDelta(levelId, new Set([remote.id]), before, scene([first, neighbor]))
    expect(rebuilt.cellEntries).toBeLessThan(oldEntries)
  })

  test.each([false, true])('ordinary room deltas match a full rebuild (flat=%s)', (flat) => {
    const enclosure = [
      wall('bottom', [0, 0], [4, 0]),
      wall('right', [4, 0], [4, 3]),
      wall('top', [4, 3], [0, 3]),
      wall('left', [0, 3], [0, 0]),
    ]
    const remote = flat ? [wall('remote', [100, 100], [100_000, 100_000])] : []
    const divider = wall('divider', [2, 0], [2, 3])
    const before = scene([...enclosure, ...remote])
    const after = scene([...enclosure, ...remote, divider])
    const index = createRoomTopologyIndex()
    const level = index.rebuildLevel(levelId, before)
    expect(level.flat).toBe(flat)
    const delta = index.applyWallDelta(levelId, new Set([divider.id]), before, after)
    expect(delta.currentRooms).toHaveLength(2)
    expect(delta.examinedWallIds).not.toContain('wall_remote')
    const rebuilt = createRoomTopologyIndex()
    rebuilt.rebuild(after)
    const snapshot = (source: typeof index) =>
      source.getLevelTopology(levelId)!.rooms.map(({ id, polygon, holes, spans }) => ({
        id,
        polygon,
        holes,
        spans,
      }))
    expect(snapshot(index)).toEqual(snapshot(rebuilt))
  })
})

describe('near-miss corners through incremental edits', () => {
  test('closing a room a few centimetres short of its corner matches a full rebuild', () => {
    const walls = [
      wall('south', [0, 0], [4, 0]),
      wall('east', [4, 0], [4, 3]),
      wall('north', [4, 3], [0, 3]),
      wall('west', [0, 3], [0, 1]),
      // A free wall across the west wall: it touches no end, yet the edit must see it.
      wall('cross', [-1, 2], [1, 2]),
    ]
    const index = createRoomTopologyIndex()
    const before = scene(walls)
    index.rebuildLevel(levelId, before)
    expect(index.getLevelTopology(levelId)!.rooms).toHaveLength(0)
    const closed = { ...walls[3]!, end: [0, 0.05] as [number, number] }
    const after = scene([...walls.slice(0, 3), closed, walls[4]!])
    index.applyWallDelta(levelId, new Set([closed.id]), before, after)
    const full = createRoomTopologyIndex()
    full.rebuildLevel(levelId, after)
    const rooms = (topology: typeof index) =>
      topology
        .getLevelTopology(levelId)!
        .rooms.map((room) => room.id)
        .sort()
    expect(rooms(index)).toEqual(rooms(full))
    // Detection declines a near-miss join on a wall another wall crosses.
    expect(rooms(full)).toHaveLength(0)
    const clear = scene([...walls.slice(0, 3), closed])
    full.rebuildLevel(levelId, clear)
    expect(rooms(full)).toHaveLength(1)
  })
})

test('a curve crossing a wall exactly at one of its samples joins that wall’s component', () => {
  const arc = WallNode.parse({
    id: 'wall_arc',
    parentId: levelId,
    start: [-1, 1.5],
    end: [1, 1.5],
    curveOffset: 0.5,
  })
  // The west wall runs exactly through the arc's middle sample vertex.
  const x = sampleWallPointsForRoomDetection(arc)[2]!.x
  const walls = [
    wall('south', [0, 0], [4, 0]),
    wall('east', [4, 0], [4, 3]),
    wall('north', [4, 3], [x, 3]),
    wall('west', [x, 3], [x, 0.04]),
    arc,
  ]
  const before = scene(walls)
  const index = createRoomTopologyIndex()
  index.rebuildLevel(levelId, before)
  const thicker = { ...walls[3]!, thickness: 0.2 }
  const after = scene([...walls.slice(0, 3), thicker, walls[4]!])
  index.applyWallDelta(levelId, new Set([thicker.id]), before, after)
  const full = createRoomTopologyIndex()
  full.rebuildLevel(levelId, after)
  const rooms = (topology: typeof index) =>
    topology
      .getLevelTopology(levelId)!
      .rooms.map((room) => room.id)
      .sort()
  expect(rooms(index)).toEqual(rooms(full))
})

test('a wall end moved inside a thick wall body rebuilds like a full detection', () => {
  const walls = [
    wall('south', [0, 0], [4, 0]),
    wall('east', [4, 0], [4, 2]),
    WallNode.parse({
      id: 'wall_thick',
      parentId: levelId,
      start: [5, 3],
      end: [-1, 3],
      thickness: 0.3,
    }),
    wall('west', [0, 3], [0, 0]),
  ]
  const before = scene(walls)
  const index = createRoomTopologyIndex()
  index.rebuildLevel(levelId, before)
  expect(index.getLevelTopology(levelId)!.rooms).toHaveLength(0)
  // 10 cm off the thick wall's line: beyond the junction tolerance, inside its body.
  const reaching = { ...walls[1]!, end: [4, 2.9] as [number, number] }
  const after = scene([walls[0]!, reaching, walls[2]!, walls[3]!])
  index.applyWallDelta(levelId, new Set([reaching.id]), before, after)
  const full = createRoomTopologyIndex()
  full.rebuildLevel(levelId, after)
  const rooms = (topology: typeof index) =>
    topology
      .getLevelTopology(levelId)!
      .rooms.map((room) => room.id)
      .sort()
  expect(rooms(full)).toHaveLength(1)
  expect(rooms(index)).toEqual(rooms(full))
})
