import { afterEach, expect, test } from 'bun:test'
import { emitter } from '../events/bus'
import { isCaptureSessionOn } from '../events/capture-sessions'
import { nodeRegistry, registerNode } from '../registry'
import {
  type AnyNode,
  type AnyNodeId,
  BaseNode,
  BuildingNode,
  LevelNode,
  nodeType,
  objectId,
  SiteNode,
  SlabNode,
  WallNode,
} from '../schema'
import { GROUND_PIT_PLATE_CLEARANCE, groundPitFloorY } from './below-grade-footprints'
import { FOUNDATION_STANDARD } from './foundation-standard'
import { type FoundationMember, genericFoundation } from './generic-foundation'
import { FLAT_GROUND_Y } from './site-ground-height'
import { encodeTerrainField } from './terrain-codec'

import { createTerrainField } from './terrain-field'

const IN = 0.0254
const { footingThickness, footingBelowGrade, stemThickness } = FOUNDATION_STANDARD

type Nodes = Record<AnyNodeId, AnyNode>
const keyed = (nodes: AnyNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n])) as Nodes

/** A 10 × 8 m ring of walls on `level`, 0.1 m thick unless told. */
function ring(level: string, extra: Partial<WallNode> = {}, thickness = 0.1) {
  const corners: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  return corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${level}_${index}`,
      parentId: level,
      start,
      end: corners[(index + 1) % 4],
      thickness,
      ...extra,
    }),
  )
}

type House = {
  terrain?: string
  slab?: Partial<SlabNode>
  wallExtra?: Partial<WallNode>
  thickness?: number
}

/** A house on a flat site: one level at grade (the floor at the datum), the site above it. */
function flatHouse({ slab, wallExtra, thickness, terrain }: House = {}) {
  const walls = ring('level_g', wallExtra, thickness)
  return keyed([
    SiteNode.parse({ id: 'site_a', children: ['building_a'], ...(terrain ? { terrain } : {}) }),
    BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: ['level_g'] }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      children: [...walls.map((w) => w.id), 'slab_g'],
    }),
    SlabNode.parse({
      id: 'slab_g',
      parentId: 'level_g',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      elevation: 0.05,
      thickness: 0.05,
      ...slab,
    }),
    ...walls,
  ])
}

/**
 * The villa's shape: a Lower Ground at -3.63 m under a ground floor, both ringed by walls (the
 * Lower Ground's first `basementWalls` of them, to leave its outline open while it is drawn).
 */
function houseOverBasement(basementWalls = 4) {
  const lower = ring('level_b').slice(0, basementWalls)
  const ground = ring('level_g')
  const plate = (id: string, parentId: string) =>
    SlabNode.parse({
      id,
      parentId,
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      elevation: 0.2,
    })
  return keyed([
    BuildingNode.parse({ id: 'building_a', children: ['level_b', 'level_g'] }),
    LevelNode.parse({
      id: 'level_b',
      parentId: 'building_a',
      level: -1,
      baseElevation: -3.63,
      height: 3.4,
      children: [...lower.map((w) => w.id), 'slab_b'],
    }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      children: [...ground.map((w) => w.id), 'slab_g'],
    }),
    plate('slab_b', 'level_b'),
    plate('slab_g', 'level_g'),
    ...lower,
    ...ground,
  ])
}

/** Two storeys at grade, both ringed by walls (the ground floor's first `groundWalls` of them). */
function twoStoreys(groundWalls = 4) {
  const ground = ring('level_g').slice(0, groundWalls)
  const upper = ring('level_u')
  return keyed([
    BuildingNode.parse({ id: 'building_a', children: ['level_g', 'level_u'] }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      children: ground.map((w) => w.id),
    }),
    LevelNode.parse({
      id: 'level_u',
      parentId: 'building_a',
      level: 1,
      children: upper.map((w) => w.id),
    }),
    ...ground,
    ...upper,
  ])
}

const ofKind = (members: FoundationMember[], kind: FoundationMember['kind']) =>
  members.filter((member) => member.kind === kind)

test('a house on a flat site gets a 16 x 8 in footing 12 in under grade and an 8 in wall to its floor', () => {
  const members = genericFoundation(flatHouse())
  const [footing] = ofKind(members, 'footing')
  const [stem] = ofKind(members, 'stem')
  expect(ofKind(members, 'footing')).toHaveLength(4)
  expect(ofKind(members, 'stem')).toHaveLength(4)
  expect(footing?.width).toBeCloseTo(FOUNDATION_STANDARD.footingWidth, 9)
  expect(footing ? footing.topY - footing.bottomY : 0).toBeCloseTo(footingThickness, 9)
  expect(footing?.bottomY).toBeCloseTo(FLAT_GROUND_Y - footingBelowGrade, 9)
  expect(stem?.width).toBeCloseTo(stemThickness, 9)
  expect(stem?.bottomY).toBeCloseTo(footing?.topY ?? Number.NaN, 9)
})

test('the foundation wall rises to the underside of the lowest floor', () => {
  // A floor top at 0.05 on a 0.1 m slab: its underside is 0.05 m under the level plane.
  const [stem] = ofKind(
    genericFoundation(flatHouse({ slab: { elevation: 0.05, thickness: 0.1 } })),
    'stem',
  )
  expect(stem?.topY).toBeCloseTo(-0.05, 9)
})

test('the wall stops at the level plane when the floor stands higher, never inside the room', () => {
  const stems = ofKind(
    genericFoundation(flatHouse({ slab: { elevation: 0.35, thickness: 0.05 } })),
    'stem',
  )
  expect(stems).toHaveLength(4)
  for (const stem of stems) expect(stem.topY).toBe(0)
})

test('a floor deeper than the footing would sit leaves no wall: the footing takes the floor', () => {
  const members = genericFoundation(flatHouse({ slab: { elevation: 0.05, thickness: 0.4 } }))
  expect(ofKind(members, 'stem')).toHaveLength(0)
  for (const footing of ofKind(members, 'footing')) expect(footing.topY).toBeCloseTo(-0.35, 9)
})

/** The east half of the site (x >= 5) stands 1 m over the west half, the house across the step. */
function eastStep() {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1)
    for (let col = 0; col < field.cols; col += 1)
      if (field.origin[0] + col * field.spacing >= 5) heights[row * field.cols + col] = 100
  return encodeTerrainField({ ...field, heights })
}

test('on a slope the footing sits under the lowest grade of the whole house, one level all round', () => {
  const footings = ofKind(genericFoundation(flatHouse({ terrain: eastStep() })), 'footing')
  expect(footings).toHaveLength(4)
  for (const footing of footings) expect(footing.bottomY).toBeCloseTo(0 - footingBelowGrade, 2)
})

test('runs are carried past the wall ends so the corners close', () => {
  const [bottomWall] = ofKind(genericFoundation(flatHouse()), 'stem').filter(
    (stem) => stem.from[1] === stem.to[1] && Math.abs(stem.from[1]) < 1,
  )
  expect(bottomWall?.from[0]).toBeCloseTo(-stemThickness / 2, 9)
  expect(bottomWall?.to[0]).toBeCloseTo(10 + stemThickness / 2, 9)
})

test('a wall thicker than the stem is not overhanging it, and the footing keeps 4 in each side', () => {
  const thick = flatHouse({ thickness: 0.3 })
  const [stem] = ofKind(genericFoundation(thick), 'stem')
  const [footing] = ofKind(genericFoundation(thick), 'footing')
  expect(stem?.width).toBeCloseTo(0.3, 9)
  expect(footing?.width).toBeCloseTo(0.3 + 8 * IN, 9)
})

test('a level below grade is its own foundation wall: only the footing, under its floor', () => {
  const members = genericFoundation(houseOverBasement())
  expect(ofKind(members, 'stem')).toHaveLength(0)
  const footings = ofKind(members, 'footing')
  expect(footings).toHaveLength(4)
  // The floor top is -3.63 + 0.2 on a 0.05 m slab; the wall's base (-3.63) is lower than the
  // underside, so the footing top meets the wall's base.
  for (const footing of footings) {
    expect(footing.levelId).toBe('level_b')
    expect(footing.topY).toBeCloseTo(-3.63, 9)
    expect(footing.bottomY).toBeCloseTo(-3.63 - footingThickness, 9)
  }
})

/**
 * A basement with the default 0.05 m plate, as a person draws one: the building seated 2.697 m
 * down, walls 0.25 m thick on the plate's edge, a ground floor over it.
 */
function seatedBasement(slab: Partial<SlabNode> = {}) {
  const lower = ring('level_b', {}, 0.25)
  const ground = ring('level_g', {}, 0.25)
  const polygon: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  return keyed([
    SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
    BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_a',
      position: [0, -2.697, 0],
      children: ['level_b', 'level_g'],
    }),
    LevelNode.parse({
      id: 'level_b',
      parentId: 'building_a',
      level: -1,
      height: 2.9,
      children: [...lower.map((w) => w.id), 'slab_b'],
    }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      height: 2.8,
      children: [...ground.map((w) => w.id), 'slab_g'],
    }),
    SlabNode.parse({
      id: 'slab_b',
      parentId: 'level_b',
      polygon,
      elevation: 0.05,
      thickness: 0.05,
      ...slab,
    }),
    SlabNode.parse({ id: 'slab_g', parentId: 'level_g', polygon, elevation: 0.05 }),
    ...lower,
    ...ground,
  ])
}

test('the footing under a basement floor stands on the pit floor, never on its plane', () => {
  // The default plate (0.05 on 0.05), a thick one, a thin one, a plate whose top is the level plane.
  for (const slab of [
    {},
    { thickness: 0.2 },
    { thickness: 0.03 },
    { elevation: 0, thickness: 0.05 },
  ]) {
    const nodes = seatedBasement(slab)
    const pitFloor = groundPitFloorY(nodes, 'level_b') ?? Number.NaN
    const footings = ofKind(genericFoundation(nodes), 'footing')
    expect(footings).toHaveLength(4)
    for (const footing of footings)
      expect(Math.abs(footing.topY - pitFloor)).toBeGreaterThanOrEqual(GROUND_PIT_PLATE_CLEARANCE)
  }
})

test('the footing follows the house’s floor, not a driveway laid deeper on its level', () => {
  const plain = seatedBasement()
  const level = plain.level_b as LevelNode
  const drive = SlabNode.parse({
    id: 'slab_drive',
    parentId: 'level_b',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ],
    elevation: 0,
    thickness: 0.4,
    metadata: { flatwork: 'driveway' },
  })
  const withDrive = {
    ...plain,
    slab_drive: drive,
    level_b: { ...level, children: [...level.children, 'slab_drive'] },
  } as typeof plain
  const tops = (nodes: typeof plain) =>
    ofKind(genericFoundation(nodes), 'footing').map((footing) => footing.topY)
  expect(tops(withDrive)).toEqual(tops(plain))
})

test('a basement still being drawn does not take the foundation away: the lowest level with a closed outline carries it', () => {
  for (const walls of [1, 3]) {
    const members = genericFoundation(houseOverBasement(walls))
    expect(new Set(members.map((member) => member.levelId))).toEqual(new Set(['level_g']))
    expect(ofKind(members, 'footing')).toHaveLength(4)
  }
  // Its outline closed, the basement is the lowest level that carries one.
  expect(new Set(genericFoundation(houseOverBasement()).map((member) => member.levelId))).toEqual(
    new Set(['level_b']),
  )
})

test('a ground floor at grade with an open outline stands on nothing drawn, the storey over it does not take the foundation', () => {
  expect(new Set(genericFoundation(twoStoreys()).map((member) => member.levelId))).toEqual(
    new Set(['level_g']),
  )
  // One wall taken out of the ground floor: no stem rises to the upper floor's underside.
  expect(genericFoundation(twoStoreys(3))).toEqual([])
})

test('each building stands on the footing of its own lowest level only', () => {
  const members = genericFoundation(houseOverBasement())
  expect(new Set(members.map((member) => member.levelId))).toEqual(new Set(['level_b']))
})

test('a wall that stores its own stem keeps it: the footing goes under the stem, no second wall', () => {
  const nodes = flatHouse({ wallExtra: { underpinning: { rim: 0.1, stem: 0.35 } } })
  const members = genericFoundation(nodes)
  expect(ofKind(members, 'stem')).toHaveLength(0)
  const footings = ofKind(members, 'footing')
  expect(footings).toHaveLength(4)
  // The stem's bottom is 0.45 m under the wall base; the grade is 0.05 under it, which is higher.
  for (const footing of footings) {
    expect(footing.topY).toBeCloseTo(-0.45, 9)
    expect(footing.bottomY).toBeCloseTo(-0.45 - footingThickness, 9)
  }
})

test('a slab that stores a solid foundation skirt is the foundation: nothing is drawn beside it', () => {
  const nodes = flatHouse({ slab: { plateRole: 'base', foundation: { type: 'solid' } } })
  expect(genericFoundation(nodes)).toEqual([])
})

test('a stored stem still gets its footing under a solid skirt', () => {
  const nodes = flatHouse({
    slab: { plateRole: 'base', foundation: { type: 'solid' } },
    wallExtra: { underpinning: { rim: 0, stem: 0.3 } },
  })
  expect(ofKind(genericFoundation(nodes), 'footing')).toHaveLength(4)
})

test('a framing plugin that draws the foundation itself takes the generic one away', () => {
  const Framer = BaseNode.extend({ id: objectId('framer'), type: nodeType('test:framer') })
  nodeRegistry._reset()
  registerNode({
    kind: 'test:framer',
    schemaVersion: 1,
    schema: Framer,
    category: 'utility',
    defaults: () => ({}),
    capabilities: { drawsFoundation: (node) => (node as { shown?: boolean }).shown === true },
  })
  const house = flatHouse()
  const withFramer = (shown: boolean) => {
    const framer = { ...Framer.parse({ id: 'framer_g', parentId: 'level_g' }), shown } as AnyNode
    const level = house['level_g' as AnyNodeId]
    if (level?.type !== 'level') throw new Error('fixture')
    return {
      ...house,
      level_g: { ...level, children: [...level.children, framer.id] },
      framer_g: framer,
    } as Nodes
  }
  expect(genericFoundation(withFramer(true))).toEqual([])
  expect(genericFoundation(withFramer(false)).length).toBeGreaterThan(0)
})

test('a plugin that steps aside from a picture gives the generic foundation back for as long as a capture session is on', () => {
  const Framer = BaseNode.extend({ id: objectId('framer'), type: nodeType('test:picture-framer') })
  nodeRegistry._reset()
  registerNode({
    kind: 'test:picture-framer',
    schemaVersion: 1,
    schema: Framer,
    category: 'utility',
    defaults: () => ({}),
    capabilities: { drawsFoundation: () => !isCaptureSessionOn() },
  })
  const house = flatHouse()
  const level = house['level_g' as AnyNodeId]
  if (level?.type !== 'level') throw new Error('fixture')
  // the same scene state throughout: a session starting changes no node
  const nodes = {
    ...house,
    level_g: { ...level, children: [...level.children, 'framer_g'] },
    framer_g: Framer.parse({ id: 'framer_g', parentId: 'level_g' }),
  } as Nodes
  const session = (active: boolean) =>
    emitter.emit('camera-controls:capture-session', { owner: 'generic-foundation-test', active })
  expect(genericFoundation(nodes)).toEqual([])
  session(true)
  try {
    expect(genericFoundation(nodes)).toHaveLength(8)
    expect(genericFoundation(nodes)).toBe(genericFoundation(nodes))
  } finally {
    session(false)
  }
  expect(genericFoundation(nodes)).toEqual([])
})

test('a level with no walls draws nothing, and a hidden wall is not carried', () => {
  const none = keyed([
    BuildingNode.parse({ id: 'building_a', children: ['level_g'] }),
    LevelNode.parse({ id: 'level_g', parentId: 'building_a', level: 0, children: [] }),
  ])
  expect(genericFoundation(none)).toEqual([])
  const hidden = flatHouse({ wallExtra: { visible: false } })
  expect(genericFoundation(hidden)).toEqual([])
})

test('a hidden building carries no foundation', () => {
  const house = flatHouse()
  const building = house['building_a' as AnyNodeId]
  if (building?.type !== 'building') throw new Error('fixture')
  expect(
    genericFoundation({ ...house, building_a: { ...building, visible: false } } as Nodes),
  ).toEqual([])
})

test('the answer is worked out once per scene state', () => {
  const nodes = flatHouse()
  expect(genericFoundation(nodes)).toBe(genericFoundation(nodes))
})

afterEach(() => nodeRegistry._reset())
