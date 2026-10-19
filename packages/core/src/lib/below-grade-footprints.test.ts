import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
} from '../schema'
import { belowGradeFloorY, belowGradeFootprints } from './below-grade-footprints'
import { levelGradeStanding } from './grade-standing'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField } from './terrain-field'

const square = (size: number): Array<[number, number]> => [
  [0, 0],
  [size, 0],
  [size, size],
  [0, size],
]

/**
 * A house over a basement, the owner's villa numbers (13 Oct): the Lower Ground at -3.63 m on a
 * 0.28 m plate, two plates side by side; the ground floor on its own 10 m plate.
 */
function houseOverBasement(position: [number, number, number], yaw: number) {
  const plate = (id: string, parentId: string, polygon: Array<[number, number]>) =>
    SlabNode.parse({ id, parentId, polygon, elevation: 0.28 })
  const nodes: AnyNode[] = [
    BuildingNode.parse({
      id: 'building_a',
      children: ['level_b', 'level_g'],
      position,
      rotation: [0, yaw, 0],
    }),
    LevelNode.parse({
      id: 'level_b',
      parentId: 'building_a',
      level: -1,
      baseElevation: -3.63,
      height: 3.4,
      children: ['slab_b1', 'slab_b2'],
    }),
    LevelNode.parse({ id: 'level_g', parentId: 'building_a', level: 0, children: ['slab_g'] }),
    plate('slab_b1', 'level_b', square(4)),
    plate('slab_b2', 'level_b', [
      [4, 0],
      [8, 0],
      [8, 4],
      [4, 4],
    ]),
    plate('slab_g', 'level_g', square(10)),
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

const extent = (ring: Array<[number, number]>) => ({
  x: [Math.min(...ring.map(([x]) => x)), Math.max(...ring.map(([x]) => x))],
  z: [Math.min(...ring.map(([, z]) => z)), Math.max(...ring.map(([, z]) => z))],
})

test("a basement's floor plates make one outline; the ground floor above grade makes none", () => {
  const outlines = belowGradeFootprints(houseOverBasement([0, 0, 0], 0))
  expect(outlines).toHaveLength(1)
  expect(extent(outlines[0] ?? [])).toEqual({ x: [0, 8], z: [0, 4] })
})

test('the outline lies where the building stands on the site, turned with it', () => {
  const [outline] = belowGradeFootprints(houseOverBasement([10, 0, 20], Math.PI / 2))
  const { x, z } = extent(outline ?? [])
  // Turned a quarter about Y, the 8 × 4 m footprint spans 4 m in x and 8 m in z.
  expect(x.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 14])
  expect(z.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([12, 20])
})

/**
 * A house over four basements, 3 m a floor: -1 under the house (0..10 × 0..8), -2 wider than it,
 * -3 under part of it only, -4 offset, poking out past the east side of the house and of -2.
 */
function houseOverFourBasements() {
  const rect = (x0: number, x1: number, z0: number, z1: number): Array<[number, number]> => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  const footprints: Array<[number, Array<[number, number]>]> = [
    [-4, rect(8, 16, 2, 6)],
    [-3, rect(0, 4, 0, 3)],
    [-2, rect(-3, 13, -3, 11)],
    [-1, rect(0, 10, 0, 8)],
  ]
  const nodes: AnyNode[] = [
    BuildingNode.parse({
      id: 'building_a',
      children: ['level_g', ...footprints.map(([index]) => `level_m${-index}`)],
    }),
    LevelNode.parse({ id: 'level_g', parentId: 'building_a', level: 0, children: ['slab_g'] }),
    SlabNode.parse({ id: 'slab_g', parentId: 'level_g', polygon: rect(0, 10, 0, 8) }),
  ]
  for (const [index, polygon] of footprints) {
    nodes.push(
      LevelNode.parse({
        id: `level_m${-index}`,
        parentId: 'building_a',
        level: index,
        height: 3,
        // The lowest level carries the offset that puts the whole stack at its elevation.
        baseElevation: index === -4 ? -12 : 0,
        children: [`slab_m${-index}`],
      }),
      SlabNode.parse({
        id: `slab_m${-index}`,
        parentId: `level_m${-index}`,
        elevation: 0.2,
        polygon,
      }),
    )
  }
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

test('several levels below grade give one set of outlines, not overlapping ones', () => {
  const nodes = houseOverFourBasements()
  const outlines = belowGradeFootprints(nodes)
  expect(outlines).toHaveLength(1)
  expect(extent(outlines[0] ?? [])).toEqual({ x: [-3, 16], z: [-3, 11] })
})

test('with a level shown, only that level and the ones between it and grade are opened', () => {
  const nodes = houseOverFourBasements()
  const of = (levelId: string) => belowGradeFootprints(nodes, levelId)
  // -1 alone: the house's own footprint, and nothing of the wider level under it.
  expect(of('level_m1').map(extent)).toEqual([{ x: [0, 10], z: [0, 8] }])
  // -2 and -3: the wide level covers the ones over it, and -3's own part of the house.
  expect(of('level_m2').map(extent)).toEqual([{ x: [-3, 13], z: [-3, 11] }])
  expect(of('level_m3').map(extent)).toEqual([{ x: [-3, 13], z: [-3, 11] }])
  // -4 shown: the levels over it and its own, which pokes out past them all.
  expect(of('level_m4').map(extent)).toEqual([{ x: [-3, 16], z: [-3, 11] }])
  // A level at grade has nothing below grade between it and the ground.
  expect(of('level_g')).toEqual([])
})

test('a level the author hid is not opened over when a level under it is shown', () => {
  const nodes = houseOverFourBasements()
  nodes.level_m2 = { ...nodes.level_m2, visible: false } as AnyNode
  // -2 was the wide one: without it, -4 shown opens over -4, -3 and -1 only.
  expect(belowGradeFootprints(nodes, 'level_m4').map(extent)).toEqual([{ x: [0, 16], z: [0, 8] }])
  // Not shown by the level display, the scene still has it below grade.
  expect(belowGradeFootprints(nodes).map(extent)).toEqual([{ x: [-3, 16], z: [-3, 11] }])
})

/**
 * Two houses on one site: A at the origin over one basement (-1, 8 × 4 m), B 30 m east over two (-1
 * 8 × 4 m over -2 10 × 4 m, poking out past it), 3 m a floor.
 */
function twoHousesOverBasements() {
  const rect = (x1: number, z1: number): Array<[number, number]> => [
    [0, 0],
    [x1, 0],
    [x1, z1],
    [0, z1],
  ]
  const level = (id: string, parentId: string, index: number, lowest = false) =>
    LevelNode.parse({
      id,
      parentId,
      level: index,
      height: 3,
      baseElevation: lowest ? 3 * index : 0,
      children: [`slab${id.slice('level'.length)}`],
    })
  const plate = (id: string, parentId: string, x1: number) =>
    SlabNode.parse({
      id: `slab${id.slice('level'.length)}`,
      parentId,
      elevation: 0.2,
      polygon: rect(x1, 4),
    })
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_a', children: ['level_a_m1', 'level_a_g'] }),
    level('level_a_m1', 'building_a', -1, true),
    level('level_a_g', 'building_a', 0),
    plate('level_a_m1', 'level_a_m1', 8),
    BuildingNode.parse({
      id: 'building_b',
      position: [30, 0, 0],
      children: ['level_b_m2', 'level_b_m1', 'level_b_g'],
    }),
    level('level_b_m2', 'building_b', -2, true),
    level('level_b_m1', 'building_b', -1),
    level('level_b_g', 'building_b', 0),
    plate('level_b_m2', 'level_b_m2', 10),
    plate('level_b_m1', 'level_b_m1', 8),
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

test('the level display decides by level index alone, so the hole opens over every basement it leaves under the shown one, in every building', () => {
  const nodes = twoHousesOverBasements()
  const byX = (a: Array<[number, number]>, b: Array<[number, number]>) =>
    extent(a).x[0]! - extent(b).x[0]!
  const of = (levelId: string) => belowGradeFootprints(nodes, levelId).sort(byX).map(extent)
  // A's -1 shown: B's -1 is as deep, and B's -2 is deeper than the level shown, so it stays under the ground.
  expect(of('level_a_m1')).toEqual([
    { x: [0, 8], z: [0, 4] },
    { x: [30, 38], z: [0, 4] },
  ])
  // B's -2 shown: B's -1 over it, and A's -1, which the display hides just the same.
  expect(of('level_b_m2')).toEqual([
    { x: [0, 8], z: [0, 4] },
    { x: [30, 40], z: [0, 4] },
  ])
  // B's -1 shown: A's -1 too, B's -2 under it not.
  expect(of('level_b_m1')).toEqual([
    { x: [0, 8], z: [0, 4] },
    { x: [30, 38], z: [0, 4] },
  ])
  // The pit goes down to the floor of the level shown, whichever building it is in.
  expect(belowGradeFloorY(nodes, 'level_a_m1')).toBeCloseTo(-2.8, 2)
  expect(belowGradeFloorY(nodes, 'level_b_m2')).toBeCloseTo(-5.8, 2)
})

/**
 * A hillside house: flat ground at 0 m west of x = 0, 4 m east of it. The cellar (-2, floor at
 * -2.8, x -2..5) is under the ground everywhere; the walk-out over it (-1, floor at 0.2, x -9..5)
 * is buried only on the east, its west part (x < 0) standing out of the hill.
 */
function houseOnHillside() {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1)
    for (let col = 0; col < field.cols; col += 1)
      if (field.origin[0] + col * field.spacing >= 0) heights[row * field.cols + col] = 400
  const rect = (x0: number, x1: number): Array<[number, number]> => [
    [x0, -4],
    [x1, -4],
    [x1, 4],
    [x0, 4],
  ]
  const nodes: AnyNode[] = [
    SiteNode.parse({
      id: 'site_a',
      children: ['building_a'],
      terrain: encodeTerrainField({ ...field, heights }),
    }),
    BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_a',
      children: ['level_cellar', 'level_walkout'],
    }),
    LevelNode.parse({
      id: 'level_cellar',
      parentId: 'building_a',
      level: -2,
      height: 3,
      baseElevation: -3,
      children: ['slab_cellar'],
    }),
    LevelNode.parse({
      id: 'level_walkout',
      parentId: 'building_a',
      level: -1,
      height: 3,
      children: ['slab_walkout'],
    }),
    SlabNode.parse({
      id: 'slab_cellar',
      parentId: 'level_cellar',
      elevation: 0.2,
      polygon: rect(-2, 5),
    }),
    SlabNode.parse({
      id: 'slab_walkout',
      parentId: 'level_walkout',
      elevation: 0.2,
      polygon: rect(-9, 5),
    }),
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

test('a walk-out between the level shown and grade is opened over its whole plate, the part out of the hill included', () => {
  const nodes = houseOnHillside()
  expect(levelGradeStanding(nodes, 'level_cellar')).toBe('below-grade')
  expect(levelGradeStanding(nodes, 'level_walkout')).toBe('partly-below-grade')
  // The cellar shown: the hole is the walk-out's plate (x -9..5), though the ground stands over it
  // only east of x = 0.
  expect(belowGradeFootprints(nodes, 'level_cellar').map(extent)).toEqual([
    { x: [-9, 5], z: [-4, 4] },
  ])
})

test('the pit goes down to the floor of the level shown, and to none when it is at grade', () => {
  const nodes = houseOverBasement([0, 0, 0], 0)
  // The villa's Lower Ground: -3.63 m with its 0.28 m plate.
  expect(belowGradeFloorY(nodes, 'level_b')).toBeCloseTo(-3.35, 2)
  expect(belowGradeFloorY(nodes, 'level_g')).toBeNull()
  expect(belowGradeFloorY(nodes, null)).toBeNull()
  expect(belowGradeFloorY(nodes)).toBeNull()
})
