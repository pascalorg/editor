import { expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, BuildingNode, LevelNode, SlabNode } from '../schema'
import { belowGradeFloorY, belowGradeFootprints } from './below-grade-footprints'

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

test('the pit goes down to the floor of the level shown, and to none when it is at grade', () => {
  const nodes = houseOverBasement([0, 0, 0], 0)
  // The villa's Lower Ground: -3.63 m with its 0.28 m plate.
  expect(belowGradeFloorY(nodes, 'level_b')).toBeCloseTo(-3.35, 2)
  expect(belowGradeFloorY(nodes, 'level_g')).toBeNull()
  expect(belowGradeFloorY(nodes, null)).toBeNull()
  expect(belowGradeFloorY(nodes)).toBeNull()
})
