import { expect, test } from 'bun:test'
import { slabFootprint } from '../lib/floor-plates'
import { area, containsPoint, difference } from '../lib/polygon-boolean'
import { type AnyNode, LevelNode, SlabNode, WallNode, type ZoneNode } from '../schema'
import type { FloorPlateMigrationReport } from './floor-plate-migration'
import * as migrations from './scene-migrations'

type Nodes = Record<string, AnyNode>

// Two rooms (0..4 and 4..8 by 0..4) inside 0.2 m walls: outer faces at -0.1 / 8.1 / 4.1.
function house(pieces: Array<Partial<SlabNode> & { id: string; polygon: [number, number][] }>) {
  const ring: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 4],
    [0, 4],
  ]
  const walls = [
    ...ring.map((start, i) =>
      WallNode.parse({
        id: `wall_${i}`,
        parentId: 'level_house',
        start,
        end: ring[(i + 1) % 4],
        thickness: 0.2,
      }),
    ),
    WallNode.parse({
      id: 'wall_divider',
      parentId: 'level_house',
      start: [4, 0],
      end: [4, 4],
      thickness: 0.2,
    }),
  ]
  const slabs = pieces.map((piece) => SlabNode.parse({ parentId: 'level_house', ...piece }))
  const level = LevelNode.parse({
    id: 'level_house',
    children: [...walls, ...slabs].map((node) => node.id),
  })
  return Object.fromEntries([level, ...walls, ...slabs].map((node) => [node.id, node])) as Nodes
}

function load(source: Nodes) {
  const vertical = migrations.migrateVerticalSceneNodes(
    migrations.healSceneNodes(migrations.normalizeLegacyStructure(source)).nodes,
  ).nodes
  const rooms = migrations.migrateCeilingRoomLinks(
    migrations.migrateRoomZones(vertical).nodes,
  ).nodes
  const plates = migrations.migrateFloorPlates(rooms)
  const openings = migrations.ensureSceneOpenings(
    migrations.migrateSlabSlots(plates.nodes).nodes,
  ).nodes
  const walls = migrations.migrateWallFaceBands(
    migrations.migrateWallFaceKeys(openings).nodes,
  ).nodes
  return {
    reports: plates.reports as FloorPlateMigrationReport[],
    nodes: migrations.reconcileStructureOnLoad(walls, vertical).nodes as Nodes,
  }
}

const slabs = (nodes: Nodes) =>
  Object.values(nodes).filter((node): node is SlabNode => node.type === 'slab')
const rooms = (nodes: Nodes) =>
  Object.values(nodes).filter((node): node is ZoneNode => node.type === 'zone')
const roomAt = (nodes: Nodes, x: number) =>
  rooms(nodes).find((room) => containsPoint([slabFootprint(room)], [x, 2]))!

const left = (overrides: Partial<SlabNode> = {}) => ({
  id: 'slab_left',
  // Drawn 8 cm past the north facade: more than the renderer snaps to the wall.
  polygon: [
    [-0.1, -0.1],
    [4, -0.1],
    [4, 4.18],
    [-0.1, 4.18],
  ] as [number, number][],
  slots: { surface: 'library:oak' },
  ...overrides,
})
const right = (overrides: Partial<SlabNode> = {}) => ({
  id: 'slab_right',
  polygon: [
    [4, -0.1],
    [8.1, -0.1],
    [8.1, 4.1],
    [4, 4.1],
  ] as [number, number][],
  slots: { surface: 'library:tiles' },
  ...overrides,
})

// Furniture standing on a piece moves onto the plate.
function furnished() {
  const source = house([left(), right()])
  source.item_chair = {
    id: 'item_chair',
    type: 'item',
    object: 'node',
    parentId: 'level_house',
    position: [6, 0.05, 2],
    supportSlabId: 'slab_right',
  } as unknown as AnyNode
  return source
}

test('hand-drawn floor slabs covering the house become one generated floor plate', () => {
  const source = furnished()
  const { nodes, reports } = load(source)
  const floors = slabs(nodes)
  expect(floors).toHaveLength(1)
  const [plate] = floors
  expect(plate).toMatchObject({
    plateRole: 'base',
    boundary: 'auto',
    elevation: 0.05,
    thickness: 0.05,
    referenceFloorElevation: 0.05,
  })
  expect(plate!.zoneIds).toHaveLength(2)
  // Each room keeps the finish its piece showed.
  expect(roomAt(nodes, 2).floor?.finish).toBe('library:oak')
  expect(roomAt(nodes, 6).floor?.finish).toBe('library:tiles')
  expect((nodes.item_chair as { supportSlabId?: string }).supportSlabId).toBe(plate!.id)
  // Only the 8 cm overshoot past the facade is dropped.
  const [absorbed] = reports.filter((report) => report.code === 'floor-pieces-absorbed')
  expect(absorbed).toMatchObject({ nodeId: 'level_house', holes: 0, closed: 0 })
  expect(absorbed!.pieces!.sort()).toEqual(['slab_left', 'slab_right'])
  expect(absorbed!.trimmed).toBeGreaterThan(0.2)
  expect(absorbed!.trimmed).toBeLessThan(0.4)
  // Idempotent and deterministic: a second load and an independent first load agree.
  expect(load(nodes).nodes).toEqual(nodes)
  expect(load(furnished()).nodes).toEqual(nodes)
})

test('an uncovered closet inside a room stays open, as a hole in the plate', () => {
  // The left piece skips a 1 m square in the room's corner.
  const { nodes } = load(
    house([
      left({
        polygon: [
          [-0.1, -0.1],
          [4, -0.1],
          [4, 4.1],
          [1.1, 4.1],
          [1.1, 3],
          [-0.1, 3],
        ],
      }),
      right(),
    ]),
  )
  const [plate] = slabs(nodes)
  expect(plate!.plateRole).toBe('base')
  const top = difference(slabFootprint(plate!), [])
  expect(containsPoint(top, [0.5, 3.5])).toBe(false)
  expect(containsPoint(top, [2, 2])).toBe(true)
  expect(area(top)).toBeLessThan(8.2 * 4.2 - 0.9)
})

test('a floor drawn on through the facade as a terrace keeps the hand-drawn slabs', () => {
  const source = house([
    left({
      polygon: [
        [-0.1, -0.1],
        [4, -0.1],
        [4, 6],
        [-0.1, 6],
      ],
    }),
    right(),
  ])
  const { nodes, reports } = load(source)
  expect(reports.some((report) => report.code === 'floor-pieces-absorbed')).toBe(false)
  expect(nodes.slab_left).toMatchObject({ polygon: (source.slab_left as SlabNode).polygon })
  expect(nodes.slab_right).toBeDefined()
  expect(slabs(nodes).some((slab) => slab.plateRole === 'base')).toBe(false)
})

test('a raised platform inside a room keeps the hand-drawn slabs', () => {
  const { nodes, reports } = load(
    house([
      left(),
      right(),
      {
        id: 'slab_stage',
        elevation: 0.3,
        thickness: 0.3,
        polygon: [
          [5, 1],
          [7, 1],
          [7, 3],
          [5, 3],
        ],
      },
    ]),
  )
  expect(reports.some((report) => report.code === 'floor-pieces-absorbed')).toBe(false)
  expect(nodes.slab_left).toBeDefined()
  expect(nodes.slab_right).toBeDefined()
  expect(nodes.slab_stage).toBeDefined()
})
