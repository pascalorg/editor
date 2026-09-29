import { afterEach, beforeEach, expect, test } from 'bun:test'
import { area, type Ring } from '../lib/polygon-boolean'
import { initSpaceDetectionSync, type Space } from '../lib/space-detection'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CeilingNode,
  LevelNode,
  SeparatorNode,
  SlabNode,
  WallNode,
  type ZoneNode,
} from '../schema'
import useScene, { clearSceneHistory } from './use-scene'

const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
let previousState: ReturnType<typeof useScene.getState>
let stopDetection = () => {}

beforeEach(() => {
  previousState = useScene.getState()
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  useScene.setState({ readOnly: false })
  clearSceneHistory()
})
afterEach(() => {
  stopDetection()
  useScene.setState(previousState, true)
  clearSceneHistory()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})

const polygon: Ring = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]
function loadRoom(extra: AnyNode[] = []) {
  const walls = polygon.map((start, i) =>
    WallNode.parse({
      id: `wall_outer_${i}`,
      parentId: 'level_room',
      start,
      end: polygon[(i + 1) % 4],
      height: 2.5,
    }),
  )
  const zone = {
    id: 'zone_adopted',
    type: 'zone',
    parentId: 'level_room',
    name: 'Kitchen',
    polygon,
  } as ZoneNode
  const ceiling = CeilingNode.parse({
    id: 'ceiling_room',
    parentId: 'level_room',
    polygon,
    height: 2.5,
    autoFromWalls: true,
  })
  const children = [...walls, zone, ceiling, ...extra]
  const level = LevelNode.parse({
    id: 'level_room',
    parentId: 'building_room',
    children: children.map((node) => node.id),
  })
  const building = BuildingNode.parse({ id: 'building_room', children: [level.id] })
  const source = Object.fromEntries(
    [building, level, ...children].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  useScene.getState().setScene(source, [building.id])
  clearSceneHistory()
  const editor = {
    spaces: {} as Record<string, Space>,
    setSpaces(spaces: Record<string, Space>) {
      this.spaces = spaces
    },
  }
  stopDetection = initSpaceDetectionSync(useScene, { getState: () => editor })
}
function moveEastWall() {
  useScene.getState().updateNodes([
    { id: 'wall_outer_0', data: { end: [10, 0] } },
    { id: 'wall_outer_1', data: { start: [10, 0], end: [10, 4] } },
    { id: 'wall_outer_2', data: { start: [10, 4] } },
  ])
}
function rooms() {
  return Object.values(useScene.getState().nodes).filter(
    (node): node is ZoneNode => node.type === 'zone' && node.spaceRole === 'room',
  )
}

test('load runs vertical → M3 → M6 → M4/M5, and a wall move refits the adopted zone in one undo step', () => {
  loadRoom()
  const before = useScene.getState().nodes
  expect(before.level_room).toMatchObject({ height: 2.5 })
  expect(before.zone_adopted).toMatchObject({
    spaceRole: 'room',
    autoFromWalls: true,
    seed: [4, 2],
    boundarySeparatorIds: [],
    holes: [],
  })
  expect(before.ceiling_room).toMatchObject({
    zoneId: 'zone_adopted',
    boundary: 'auto',
    autoFromWalls: true,
  })
  expect(Object.hasOwn(before.ceiling_room!, 'height')).toBe(false)
  moveEastWall()
  expect(rooms()).toHaveLength(1)
  expect(rooms()[0]).toMatchObject({
    id: 'zone_adopted',
    seed: [4, 2],
    polygon: [
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ],
  })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(rooms()[0]!.polygon).toEqual(polygon)
  expect(rooms()[0]!.id).toBe('zone_adopted')
})

test('wall moves refit migrated nested rooms without dropping their holes or ids', () => {
  const inner: Ring = [
    [2, 1],
    [4, 1],
    [4, 3],
    [2, 3],
  ]
  loadRoom([
    SlabNode.parse({ parentId: 'level_room', polygon, autoFromWalls: true }),
    SlabNode.parse({ parentId: 'level_room', polygon: inner, autoFromWalls: true }),
    CeilingNode.parse({ parentId: 'level_room', polygon: inner, autoFromWalls: true }),
    ...inner.map((start, i) =>
      WallNode.parse({
        id: `wall_inner_${i}`,
        parentId: 'level_room',
        start,
        end: inner[(i + 1) % 4],
      }),
    ),
  ])
  const manualCeilings = Object.values(useScene.getState().nodes).filter(
    (node): node is CeilingNode => node.type === 'ceiling' && node.boundary !== 'auto',
  )
  expect(manualCeilings).toHaveLength(1)
  const ceilingIds = Object.values(useScene.getState().nodes)
    .filter((node) => node.type === 'ceiling')
    .map((node) => node.id)
    .sort()
  const before = rooms()
  expect(before).toHaveLength(2)
  const outer = before.find((room) => room.holes.length === 1)!
  moveEastWall()
  const after = rooms().find((room) => room.id === outer.id)!
  expect(after.holes).toEqual(outer.holes)
  expect(area([{ outer: after.polygon, holes: after.holes }])).toBe(36)
  expect(rooms().map((room) => room.id)).toEqual(before.map((room) => room.id))
  const slabs = Object.values(useScene.getState().nodes).filter(
    (node): node is SlabNode => node.type === 'slab',
  )
  expect(slabs).toHaveLength(1)
  expect(slabs[0]!.holeMetadata).toEqual([])
  expect(slabs[0]!.zoneIds).toEqual(
    rooms()
      .map((room) => room.id)
      .sort(),
  )
  expect(area([{ outer: slabs[0]!.polygon, holes: slabs[0]!.holes }])).toBeCloseTo(10.1 * 4.1)
  const ceilings = Object.values(useScene.getState().nodes).filter(
    (node): node is CeilingNode => node.type === 'ceiling',
  )
  expect(ceilings.map((ceiling) => ceiling.id).sort()).toEqual(ceilingIds)
  for (const ceiling of manualCeilings)
    expect(useScene.getState().nodes[ceiling.id]).toMatchObject({
      polygon: ceiling.polygon,
      holes: ceiling.holes,
    })
})

test('wall moves refit migrated separator-bounded rooms without changing their ids', () => {
  loadRoom([
    SeparatorNode.parse({
      id: 'separator_split',
      parentId: 'level_room',
      start: [4, 0],
      end: [4, 4],
    }),
  ])
  const before = rooms()
  expect(before).toHaveLength(2)
  const right = before.find((room) => room.seed![0] > 4)!
  moveEastWall()
  const after = rooms().find((room) => room.id === right.id)!
  expect(after.boundarySeparatorIds).toEqual(['separator_split'])
  expect(area([{ outer: after.polygon, holes: after.holes }])).toBe(24)
  expect(rooms().map((room) => room.id)).toEqual(before.map((room) => room.id))
})
