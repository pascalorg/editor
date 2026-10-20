import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
} from '../schema'
import {
  belowGradeFloorY,
  belowGradeFootprints,
  coveredBelowGradeFootprints,
  GROUND_PIT_PLATE_CLEARANCE,
  groundPitFloorY,
} from './below-grade-footprints'
import { levelGradeStanding } from './grade-standing'
import { levelGroundBox, levelStackGroundBox, terrainBetweenEyeAndBox } from './ground-window'
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
 * A hillside house: flat ground at 0 m west of x = 0, `riseCm` east of it (the ground climbs between
 * x = -1 and 0). The cellar (-2, floor at -2.8, x -2..5) is under the ground everywhere; the
 * walk-out over it (-1, floor at 0.2, x -9..`walkoutEast`) is buried only on the east, its west part
 * (x < 0) standing out of the hill. With `named`, a main floor over them is the building's ground
 * line, so both are below it whatever the ground does.
 */
function houseOnHillside({
  walkoutEast = 5,
  riseCm = 400,
  named = false,
}: {
  walkoutEast?: number
  riseCm?: number
  named?: boolean
} = {}) {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1)
    for (let col = 0; col < field.cols; col += 1)
      if (field.origin[0] + col * field.spacing >= 0) heights[row * field.cols + col] = riseCm
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
      children: ['level_cellar', 'level_walkout', ...(named ? ['level_main'] : [])],
      ...(named ? { groundLevelId: 'level_main' } : {}),
    }),
    ...(named
      ? [
          LevelNode.parse({
            id: 'level_main',
            parentId: 'building_a',
            level: 0,
            height: 3,
            children: [],
          }),
        ]
      : []),
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
      polygon: rect(-9, walkoutEast),
    }),
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

test('a walk-out between the level shown and grade is opened over the part the ground stands over, not its whole plate', () => {
  const nodes = houseOnHillside()
  expect(levelGradeStanding(nodes, 'level_cellar')).toBe('below-grade')
  expect(levelGradeStanding(nodes, 'level_walkout')).toBe('partly-below-grade')
  // The cellar shown: the walk-out adds nothing the cellar does not hold (x -2..5), and its valley
  // side (x < 0, where the ground is at 0 m, under its floor) stays closed. A fully buried level
  // gives its whole floor.
  expect(belowGradeFootprints(nodes, 'level_cellar').map(extent)).toEqual([
    { x: [-2, 5], z: [-4, 4] },
  ])
})

test('a walk-out whose buried part is wider than the cellar opens it, the edge following the slope', () => {
  const nodes = houseOnHillside({ walkoutEast: 9 })
  // The cellar's west edge (-2) and the walk-out's buried east part (to 9): one outline.
  expect(belowGradeFootprints(nodes, 'level_cellar').map(extent)).toEqual([
    { x: [-2, 9], z: [-4, 4] },
  ])
  // The walk-out alone: its floor is 0.2 m, so the ground has to stand over 0.5 m (the floor and
  // the tolerance). It climbs 4 m between x = -1 and x = 0: that height is reached at x = -0.875.
  const [outline] = belowGradeFootprints(nodes, 'level_walkout')
  const { x, z } = extent(outline ?? [])
  expect(x[0]).toBeCloseTo(-0.875, 3)
  expect(x[1]).toBe(9)
  expect(z).toEqual([-4, 4])
  expect(belowGradeFootprints(nodes, 'level_walkout')).toHaveLength(1)
})

test('a level under the ground line that the ground leaves out of the ground opens nothing', () => {
  // A flat site at 0 m, the walk-out's floor at 0.2 m: the main floor over it is the ground line,
  // so the walk-out reads partly below grade, and nothing stands over it.
  const nodes = houseOnHillside({ riseCm: 0, named: true })
  expect(levelGradeStanding(nodes, 'level_walkout')).toBe('partly-below-grade')
  expect(belowGradeFootprints(nodes, 'level_walkout')).toEqual([])
})

test('the fog box of the underground still holds the walk-out whole: it is where the world stays clear, not where the ground opens', () => {
  const nodes = houseOnHillside()
  const box = levelStackGroundBox(nodes, 'level_walkout')
  expect(box?.min[0]).toBe(-9)
  expect(box?.max[0]).toBe(5)
})

test('the pit goes down to the floor of the level shown, and to none when it is at grade', () => {
  const nodes = houseOverBasement([0, 0, 0], 0)
  // The villa's Lower Ground: -3.63 m with its 0.28 m plate.
  expect(belowGradeFloorY(nodes, 'level_b')).toBeCloseTo(-3.35, 2)
  expect(belowGradeFloorY(nodes, 'level_g')).toBeNull()
  expect(belowGradeFloorY(nodes, null)).toBeNull()
  expect(belowGradeFloorY(nodes)).toBeNull()
})

// ── What the house covers ────────────────────────────────────────────────────────────────────

type Plate = {
  id: string
  index: number
  polygon: Array<[number, number]>
  visible?: boolean
  holes?: Array<Array<[number, number]>>
  /** More floor slabs on the same level. */
  more?: Array<Array<[number, number]>>
  /** Site flatwork on the same level (a lawn, a driveway): slabs outdoors, not floors of the building. */
  flatwork?: Array<Array<[number, number]>>
}

const rect = (x0: number, x1: number, z0: number, z1: number): Array<[number, number]> => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

/** One building, 3 m a floor: each level one floor slab, the lowest carrying the offset of the stack. */
function building(
  id: string,
  plates: Plate[],
  placement: { position?: [number, number, number]; yaw?: number; site?: string } = {},
): AnyNode[] {
  const lowest = Math.min(...plates.map((plate) => plate.index))
  return [
    BuildingNode.parse({
      id,
      ...(placement.site ? { parentId: placement.site } : {}),
      children: plates.map((plate) => `level_${id}_${plate.id}`),
      position: placement.position ?? [0, 0, 0],
      rotation: [0, placement.yaw ?? 0, 0],
    }),
    ...plates.flatMap((plate) => [
      LevelNode.parse({
        id: `level_${id}_${plate.id}`,
        parentId: id,
        level: plate.index,
        height: 3,
        baseElevation: plate.index === lowest ? 3 * plate.index : 0,
        ...(plate.visible === false ? { visible: false } : {}),
        children: [
          ...[plate.polygon, ...(plate.more ?? [])].map(
            (_, slab) => `slab_${id}_${plate.id}_${slab}`,
          ),
          ...(plate.flatwork ?? []).map((_, slab) => `slab_${id}_${plate.id}_lawn${slab}`),
        ],
      }),
      ...(plate.flatwork ?? []).map((polygon, slab) =>
        SlabNode.parse({
          id: `slab_${id}_${plate.id}_lawn${slab}`,
          parentId: `level_${id}_${plate.id}`,
          elevation: 0.01,
          polygon,
          metadata: { flatwork: 'lawn' },
        }),
      ),
      ...[plate.polygon, ...(plate.more ?? [])].map((polygon, slab) =>
        SlabNode.parse({
          id: `slab_${id}_${plate.id}_${slab}`,
          parentId: `level_${id}_${plate.id}`,
          elevation: 0.2,
          polygon,
          ...(plate.holes && slab === 0 ? { holes: plate.holes } : {}),
        }),
      ),
    ]),
  ]
}

const sceneOf = (...nodes: AnyNode[][]) =>
  Object.fromEntries(nodes.flat().map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>

test('a basement under the house is covered whole: the ground is open over all of it', () => {
  const nodes = sceneOf(
    building('building_a', [
      { id: 'g', index: 0, polygon: rect(0, 10, 0, 8) },
      { id: 'b', index: -1, polygon: rect(1, 9, 1, 5) },
    ]),
  )
  expect(coveredBelowGradeFootprints(nodes).map(extent)).toEqual([{ x: [1, 9], z: [1, 5] }])
})

test('a basement reaching out under the garden is covered only where the house stands over it', () => {
  const nodes = sceneOf(
    building('building_a', [
      { id: 'g', index: 0, polygon: rect(0, 10, 0, 8) },
      { id: 'b', index: -1, polygon: rect(5, 16, 1, 5) },
    ]),
  )
  // The whole basement is below grade for the hole of the level shown; the cover is its house part.
  expect(belowGradeFootprints(nodes).map(extent)).toEqual([{ x: [5, 16], z: [1, 5] }])
  expect(coveredBelowGradeFootprints(nodes).map(extent)).toEqual([{ x: [5, 10], z: [1, 5] }])
})

test('a basement wholly under the garden, or with no level over it, is covered nowhere', () => {
  const garden = sceneOf(
    building('building_a', [
      { id: 'g', index: 0, polygon: rect(0, 10, 0, 8) },
      { id: 'b', index: -1, polygon: rect(12, 18, 1, 5) },
    ]),
  )
  expect(belowGradeFootprints(garden)).toHaveLength(1)
  expect(coveredBelowGradeFootprints(garden)).toEqual([])
  const alone = sceneOf(building('building_a', [{ id: 'b', index: -1, polygon: rect(0, 6, 0, 4) }]))
  expect(coveredBelowGradeFootprints(alone)).toEqual([])
})

test('the deepest levels are covered by the house at grade, not by the basement over them', () => {
  const nodes = houseOverFourBasements()
  // -2 is wider than the house and -4 pokes out of it: of all of them only the house's own
  // footprint (0..10 × 0..8) is under the ground floor.
  expect(coveredBelowGradeFootprints(nodes).map(extent)).toEqual([{ x: [0, 10], z: [0, 8] }])
  // Without the ground floor nothing stands over the basements: -1 is not a cover, it is buried.
  const bare = { ...nodes, level_g: { ...nodes.level_g, children: [] } } as Record<
    AnyNodeId,
    AnyNode
  >
  expect(coveredBelowGradeFootprints(bare)).toEqual([])
})

test('a stairwell or floor opening in the slab over a basement does not shrink the cover', () => {
  const nodes = sceneOf(
    building('building_a', [
      { id: 'g', index: 0, polygon: rect(0, 10, 0, 8), holes: [rect(4, 6, 3, 5)] },
      { id: 'b', index: -1, polygon: rect(0, 10, 0, 8) },
    ]),
  )
  const covered = coveredBelowGradeFootprints(nodes)
  expect(covered).toHaveLength(1)
  expect(covered.map(extent)).toEqual([{ x: [0, 10], z: [0, 8] }])
})

test('the cover lies where the building stands on the site, turned with it', () => {
  const nodes = sceneOf(
    building(
      'building_a',
      [
        { id: 'g', index: 0, polygon: rect(0, 10, 0, 10) },
        { id: 'b', index: -1, polygon: rect(0, 8, 0, 4) },
      ],
      { position: [10, 0, 20], yaw: Math.PI / 2 },
    ),
  )
  const [outline] = coveredBelowGradeFootprints(nodes)
  const { x, z } = extent(outline ?? [])
  expect(x.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 14])
  expect(z.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([12, 20])
})

test('a level the author hid covers nothing and is covered by nothing', () => {
  const plates = (hide: 'g' | 'b' | null): Plate[] => [
    { id: 'g', index: 0, polygon: rect(0, 10, 0, 8), visible: hide !== 'g' },
    { id: 'b', index: -1, polygon: rect(1, 9, 1, 5), visible: hide !== 'b' },
  ]
  expect(coveredBelowGradeFootprints(sceneOf(building('building_a', plates(null))))).toHaveLength(1)
  // The house hidden: the garden would show a pit over the basement. The basement hidden: an
  // opening onto nothing.
  expect(coveredBelowGradeFootprints(sceneOf(building('building_a', plates('g'))))).toEqual([])
  expect(coveredBelowGradeFootprints(sceneOf(building('building_a', plates('b'))))).toEqual([])
})

test('a building is covered by its own storeys, never by another building over the same ground', () => {
  const nodes = sceneOf(
    // A's ground floor stands over x 0..10; B's basement (5..13) has no storey of B over it.
    building('building_a', [{ id: 'g', index: 0, polygon: rect(0, 10, 0, 8) }]),
    building('building_b', [{ id: 'b', index: -1, polygon: rect(0, 8, 0, 4) }], {
      position: [5, 0, 0],
    }),
  )
  expect(belowGradeFootprints(nodes)).toHaveLength(1)
  expect(coveredBelowGradeFootprints(nodes)).toEqual([])
  // Give B a ground floor over half of it: that half, and in B's own frame.
  const covered = sceneOf(
    building('building_a', [{ id: 'g', index: 0, polygon: rect(0, 10, 0, 8) }]),
    building(
      'building_b',
      [
        { id: 'g', index: 0, polygon: rect(0, 4, 0, 4) },
        { id: 'b', index: -1, polygon: rect(0, 8, 0, 4) },
      ],
      { position: [5, 0, 0] },
    ),
  )
  expect(coveredBelowGradeFootprints(covered).map(extent)).toEqual([{ x: [5, 9], z: [0, 4] }])
})

test('a house wrapped round a courtyard is left closed, not cut around an island of ground', () => {
  const nodes = sceneOf(
    building('building_a', [
      // Four wings, the courtyard (3..7 × 3..7) empty.
      {
        id: 'g',
        index: 0,
        polygon: rect(0, 10, 0, 3),
        more: [rect(0, 10, 7, 10), rect(0, 3, 3, 7), rect(7, 10, 3, 7)],
      },
      { id: 'b', index: -1, polygon: rect(0, 10, 0, 10) },
    ]),
  )
  expect(coveredBelowGradeFootprints(nodes)).toEqual([])
})

test('a cellar under a walk-out is covered by the part of the walk-out that stands out of the hill', () => {
  const nodes = houseOnHillside()
  expect(levelGradeStanding(nodes, 'level_cellar')).toBe('below-grade')
  expect(levelGradeStanding(nodes, 'level_walkout')).toBe('partly-below-grade')
  // The cellar spans x -2..5. The walk-out stands out of the hill west of x = -0.875 (where the
  // ground climbs over its floor and tolerance); east of that the hill is over it, and over the
  // cellar: closed. The walk-out itself, with no storey over it, is not covered by anything.
  const covered = coveredBelowGradeFootprints(nodes)
  expect(covered).toHaveLength(1)
  const { x, z } = extent(covered[0] ?? [])
  expect(x[0]).toBe(-2)
  expect(x[1]).toBeCloseTo(-0.875, 3)
  expect(z).toEqual([-4, 4])
})

test('the pit hangs its floor 5 cm under the plate, and 2 cm under its underside where that would meet it', () => {
  // The villa's Lower Ground: -3.63 m, a 0.28 m plate raised well over the walls' base: the pit's
  // floor keeps its place, 5 cm under the plate's top.
  const raised = houseOverBasement([0, 0, 0], 0)
  expect(groundPitFloorY(raised, 'level_b')).toBeCloseTo(-3.4, 9)
  expect(groundPitFloorY(raised, 'level_g')).toBeNull()
  expect(groundPitFloorY(raised, null)).toBeNull()
  // A basement on the default 0.05 m plate at the level plane: 5 cm under the plate's top is its
  // underside, so the floor goes 2 cm under it.
  const seat = (slab: Partial<SlabNode>) =>
    Object.fromEntries(
      [
        BuildingNode.parse({ id: 'building_a', children: ['level_b'], position: [0, -2.7, 0] }),
        LevelNode.parse({ id: 'level_b', parentId: 'building_a', level: -1, children: ['slab_b'] }),
        SlabNode.parse({ id: 'slab_b', parentId: 'level_b', polygon: square(8), ...slab }),
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
  for (const slab of [{}, { thickness: 0.03 }, { thickness: 0.06 }, { elevation: 0 }]) {
    const nodes = seat(slab)
    const underside = -2.7 + Math.min(0, (slab.elevation ?? 0.05) - (slab.thickness ?? 0.05))
    expect(groundPitFloorY(nodes, 'level_b')).toBeCloseTo(underside - GROUND_PIT_PLATE_CLEARANCE, 9)
  }
  // A thick plate puts its underside well under 5 cm below its top: the floor is not moved.
  expect(groundPitFloorY(seat({ thickness: 0.2 }), 'level_b')).toBeCloseTo(-2.7 + 0.05 - 0.05, 9)
})

type SlabSpec = Partial<SlabNode> & { id: string }

/** The basement's raised part: the default 0.05 m plate. */
const RAISED: SlabSpec = { id: 'slab_up', polygon: square(4), elevation: 0.05, thickness: 0.05 }
/** The room sunk 1.2 m beside it, on a 0.2 m plate. */
const SUNKEN: SlabSpec = {
  id: 'slab_low',
  polygon: [
    [4, 0],
    [8, 0],
    [8, 4],
    [4, 4],
  ],
  elevation: -1.2,
  thickness: 0.2,
}

/** A basement at -2.7 m standing on these slabs, with a ground floor over it. */
function basementOn(slabs: SlabSpec[]) {
  const nodes: AnyNode[] = [
    BuildingNode.parse({
      id: 'building_a',
      children: ['level_b', 'level_g'],
      position: [0, -2.7, 0],
    }),
    LevelNode.parse({
      id: 'level_b',
      parentId: 'building_a',
      level: -1,
      children: slabs.map((slab) => slab.id),
    }),
    LevelNode.parse({ id: 'level_g', parentId: 'building_a', level: 0, children: ['slab_g'] }),
    ...slabs.map((slab) => SlabNode.parse({ parentId: 'level_b', ...slab })),
    SlabNode.parse({ id: 'slab_g', parentId: 'level_g', polygon: square(10), elevation: 0.05 }),
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

test('the pit goes down under the sunken room of a split-level basement, not through it', () => {
  const nodes = basementOn([RAISED, SUNKEN])
  expect(levelGradeStanding(nodes, 'level_b')).toBe('below-grade')
  // The raised part's top is -2.65, the sunken room's -3.9: the pit goes to the lowest floor, and
  // hangs 5 cm under its top (the room's plate is 0.2 m thick, so its underside, -4.1, is further).
  expect(belowGradeFloorY(nodes, 'level_b')).toBeCloseTo(-3.9, 9)
  expect(groundPitFloorY(nodes, 'level_b')).toBeCloseTo(-3.95, 9)
  // Nothing the level stands on lies under the dark floor.
  for (const top of [-2.65, -3.9])
    expect(groundPitFloorY(nodes, 'level_b') ?? Number.NaN).toBeLessThan(top)
})

test('a basin and site flatwork are not floors: they do not take the pit down', () => {
  const nodes = basementOn([
    RAISED,
    SUNKEN,
    // A pool sunk 2 m, and a lawn laid on the level lower than the house's floors.
    { id: 'slab_pool', polygon: square(2), elevation: -2, thickness: 0.3, recessed: true },
    { id: 'slab_lawn', polygon: square(9), elevation: -2.5, metadata: { flatwork: 'lawn' } },
  ])
  expect(belowGradeFloorY(nodes, 'level_b')).toBeCloseTo(-3.9, 9)
  expect(groundPitFloorY(nodes, 'level_b')).toBeCloseTo(-3.95, 9)
})

test('the pit keeps clear of the floor’s underside, not of a driveway laid deeper on the level', () => {
  // The default plate at the level plane: the pit lies 2 cm under its underside (-2.7). A driveway
  // 0.2 m thick beside it, underside -2.9, is not a floor and moves nothing.
  const nodes = basementOn([
    RAISED,
    {
      id: 'slab_drive',
      polygon: square(9),
      elevation: 0,
      thickness: 0.2,
      metadata: { flatwork: 'driveway' },
    },
  ])
  expect(groundPitFloorY(nodes, 'level_b')).toBeCloseTo(-2.7 - GROUND_PIT_PLATE_CLEARANCE, 9)
})

// ── Site flatwork is not a floor of the house ───────────────────────────────────────────────

/** A site with a hill: flat at 0 m west of x = 8, climbing 0.28 m per metre east of it. */
function hillSite() {
  const field = createTerrainField({ origin: [-20, -20], cols: 41, rows: 41, spacing: 1 })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1)
    for (let col = 0; col < field.cols; col += 1) {
      const x = field.origin[0] + col * field.spacing
      heights[row * field.cols + col] = Math.round(Math.max(0, x - 8) * 28)
    }
  return SiteNode.parse({ id: 'site_a', terrain: encodeTerrainField({ ...field, heights }) })
}

/** The house on the flat part, over a basement `basementEast` long; a lot-wide lawn laid on its ground level. */
function houseWithLawn(lawn: 'flatwork' | 'plain-slab', basementEast = 6.1) {
  const lot = rect(-15, 15, -15, 15)
  return sceneOf(
    [hillSite()],
    building(
      'building_a',
      [
        {
          id: 'g',
          index: 0,
          polygon: rect(-6, 6, -5, 5),
          ...(lawn === 'flatwork' ? { flatwork: [lot] } : { more: [lot] }),
        },
        { id: 'b', index: -1, polygon: rect(-6.1, basementEast, -5.1, 5.1) },
      ],
      { site: 'site_a' },
    ),
  )
}

test('a lawn laid on the ground level over a hill is not a floor buried by it: the level stays at grade and the hole is the basement', () => {
  const nodes = houseWithLawn('flatwork')
  expect(levelGradeStanding(nodes, 'level_building_a_g')).toBe('at-grade')
  expect(belowGradeFootprints(nodes, 'level_building_a_b').map(extent)).toEqual([
    { x: [-6.1, 6.1], z: [-5.1, 5.1] },
  ])
  // Control: the same lawn as a plain slab is a floor, and the hill buries its east half.
  const plain = houseWithLawn('plain-slab')
  expect(levelGradeStanding(plain, 'level_building_a_g')).toBe('partly-below-grade')
  const [outline] = belowGradeFootprints(plain, 'level_building_a_b')
  expect(extent(outline ?? []).x[1]).toBe(15)
})

test('a lawn does not cover the basement that reaches under the garden: only the house does', () => {
  const nodes = houseWithLawn('flatwork', 14)
  expect(coveredBelowGradeFootprints(nodes).map(extent)).toEqual([{ x: [-6, 6], z: [-5, 5] }])
  // Control: as a floor the lawn would cover the basement out under the garden, up to where the
  // hill buries it (x = 9.79).
  const plain = houseWithLawn('plain-slab', 14)
  const [covered] = coveredBelowGradeFootprints(plain)
  const { x } = extent(covered ?? [])
  expect(x[0]).toBe(-6.1)
  expect(x[1]).toBeCloseTo(9.786, 2)
})

test('the box the ground floor stands in is the house, not the lawn laid on its level', () => {
  const nodes = houseWithLawn('flatwork')
  const box = levelGroundBox(nodes, 'level_building_a_g')
  expect([box?.min[0], box?.max[0], box?.min[2], box?.max[2]]).toEqual([-6, 6, -5, 5])
})

// ── A split level under a hill: every floor is judged at its own height ───────────────────────

/**
 * One level with two floors, a raised part (top 0.2 m, x -6..0) over flat ground at 0 m, and the
 * room sunk beside it (top -1.2 m, x 0..4) under ground that climbs from 0 m at x = 0 to `peakCm`
 * at x = 4.
 */
function splitLevelOnRamp(peakCm: number) {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1)
    for (let col = 0; col < field.cols; col += 1) {
      const x = field.origin[0] + col * field.spacing
      heights[row * field.cols + col] = Math.round((Math.min(Math.max(x, 0), 4) / 4) * peakCm)
    }
  const rect = (x0: number, x1: number): Array<[number, number]> => [
    [x0, -3],
    [x1, -3],
    [x1, 3],
    [x0, 3],
  ]
  const nodes: AnyNode[] = [
    SiteNode.parse({
      id: 'site_a',
      children: ['building_a'],
      terrain: encodeTerrainField({ ...field, heights }),
    }),
    BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: ['level_split'] }),
    LevelNode.parse({
      id: 'level_split',
      parentId: 'building_a',
      level: -1,
      height: 3,
      children: ['slab_raised', 'slab_sunken'],
    }),
    SlabNode.parse({
      id: 'slab_raised',
      parentId: 'level_split',
      polygon: rect(-6, 0),
      elevation: 0.2,
    }),
    SlabNode.parse({
      id: 'slab_sunken',
      parentId: 'level_split',
      polygon: rect(0, 4),
      elevation: -1.2,
    }),
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

/** The split level without its sunken room: one floor, the raised part. */
function raisedPartOnly(nodes: Record<AnyNodeId, AnyNode>) {
  return {
    ...nodes,
    level_split: { ...nodes.level_split, children: ['slab_raised'] },
  } as unknown as Record<AnyNodeId, AnyNode>
}

test('ground over only the sunken room of a split level buries that room: the level is partly below grade', () => {
  // The ground peaks at 0.4 m over the room's far wall: 1.6 m over its floor (-1.2 m), but only
  // 0.2 m over the raised part's top (0.2 m), which is inside the 0.3 m tolerance.
  const nodes = splitLevelOnRamp(40)
  expect(levelGradeStanding(nodes, 'level_split')).toBe('partly-below-grade')
  // The raised part alone, on the flat ground west of the ramp, is at grade.
  expect(levelGradeStanding(raisedPartOnly(nodes), 'level_split')).toBe('at-grade')
})

test('the hole over a split level opens over the whole sunken room the ground stands over, not from the raised floor’s height', () => {
  // Ground climbing 0 → 1 m across the room (x 0..4): it is over the room's floor (-1.2 m) from its
  // first metre. Judged at the raised part's top (0.2 m) it would only open where the ground is over
  // 0.5 m, from x = 2.
  const nodes = splitLevelOnRamp(100)
  expect(levelGradeStanding(nodes, 'level_split')).toBe('partly-below-grade')
  expect(belowGradeFootprints(nodes, 'level_split').map(extent)).toEqual([
    { x: [0, 4], z: [-3, 3] },
  ])
})

test('the ground box of a split level reaches its lowest floor: the window aims at the sunken room', () => {
  // Ground rising 0 → 0.1 m over the room: over its floor (-1.2 m), but under the raised part's
  // top (0.2 m). It hides the room from an eye out west, low over the ground, yet no sight line to
  // a point at the raised floor meets it.
  const nodes = splitLevelOnRamp(10)
  const box = levelGroundBox(nodes, 'level_split')
  expect(box && terrainBetweenEyeAndBox(nodes, [-12, 3, 0], box)).toBe(true)
  expect(box?.min[1]).toBeCloseTo(-1.2, 9)
  // The ceiling stays where it was: the highest floor and the level's height over it.
  expect(box?.max[1]).toBeCloseTo(3.2, 9)
  // A level with one floor is boxed from that floor, as before.
  expect(levelGroundBox(raisedPartOnly(nodes), 'level_split')?.min[1]).toBeCloseTo(0.2, 9)
})

// ── The same split level on a flat site: every floor against the datum ──────────────────────

/** One level with these slabs on a site with no terrain: the datum (0 m) is the ground everywhere. */
function flatSplitLevel(slabs: SlabSpec[]) {
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_a', children: ['level_split'] }),
    LevelNode.parse({
      id: 'level_split',
      parentId: 'building_a',
      level: 0,
      children: slabs.map((slab) => slab.id),
    }),
    ...slabs.map((slab) => SlabNode.parse({ parentId: 'level_split', ...slab })),
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

test('on a flat site a split level with its raised part at grade is partly below grade, its sunken room buried', () => {
  // The raised part's top is 0.05 m, the sunken room's -1.2 m: 1.2 m under the datum.
  const nodes = flatSplitLevel([RAISED, SUNKEN])
  expect(levelGradeStanding(nodes, 'level_split')).toBe('partly-below-grade')
  // The ring and the hole footprint are the sunken room, not the raised part at grade.
  expect(belowGradeFootprints(nodes, 'level_split').map(extent)).toEqual([{ x: [4, 8], z: [0, 4] }])
  expect(belowGradeFloorY(nodes, 'level_split')).toBeCloseTo(-1.2, 9)
})

test('on a flat site each floor of a level is judged on its own, and a level of one kind reads as it did', () => {
  const sunkenOnly = flatSplitLevel([SUNKEN])
  expect(levelGradeStanding(sunkenOnly, 'level_split')).toBe('below-grade')
  expect(belowGradeFootprints(sunkenOnly, 'level_split').map(extent)).toEqual([
    { x: [4, 8], z: [0, 4] },
  ])
  expect(levelGradeStanding(flatSplitLevel([RAISED]), 'level_split')).toBe('at-grade')
  // A step down inside the tolerance (0.3 m) buries nothing.
  expect(
    levelGradeStanding(flatSplitLevel([RAISED, { ...SUNKEN, elevation: -0.2 }]), 'level_split'),
  ).toBe('at-grade')
  // Two floors both under the ground: the level is below grade as a whole.
  expect(
    levelGradeStanding(
      flatSplitLevel([
        { ...RAISED, elevation: -0.6 },
        { ...SUNKEN, elevation: -1.2 },
      ]),
      'level_split',
    ),
  ).toBe('below-grade')
})
