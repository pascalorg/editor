import { expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, BuildingNode, LevelNode, SlabNode } from '../schema'
import { belowGradeFootprints } from './below-grade-footprints'

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
