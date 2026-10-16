import { afterEach, expect, test } from 'bun:test'
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

/** The villa's shape: a Lower Ground at -3.63 m under a ground floor, both ringed by walls. */
function houseOverBasement() {
  const lower = ring('level_b')
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

test('a level with no walls draws nothing, and a hidden wall is not carried', () => {
  const none = keyed([
    BuildingNode.parse({ id: 'building_a', children: ['level_g'] }),
    LevelNode.parse({ id: 'level_g', parentId: 'building_a', level: 0, children: [] }),
  ])
  expect(genericFoundation(none)).toEqual([])
  const hidden = flatHouse({ wallExtra: { visible: false } })
  expect(genericFoundation(hidden)).toEqual([])
})

test('the answer is worked out once per scene state', () => {
  const nodes = flatHouse()
  expect(genericFoundation(nodes)).toBe(genericFoundation(nodes))
})

afterEach(() => nodeRegistry._reset())
