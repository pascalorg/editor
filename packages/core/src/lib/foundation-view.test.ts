import { afterEach, expect, test } from 'bun:test'
import { nodeRegistry, registerNode } from '../registry'
import {
  type AnyNode,
  type AnyNodeId,
  BaseNode,
  BuildingNode,
  FootingNode,
  FoundationNode,
  LevelNode,
  nodeType,
  objectId,
  SiteNode,
  SlabNode,
  WallNode,
} from '../schema'
import type { BuildingFoundationRecord } from './building-foundation'
import {
  buildingFoundationNodes,
  type FoundationPlanShape,
  foundationBadge,
  foundationPlan,
  foundationViewHiddenIds,
  foundationViewOf,
  traceFoundationOutlines,
} from './foundation-view'
import { designedFoundationReport, genericFoundation } from './generic-foundation'

afterEach(() => nodeRegistry._reset())

const IN = 0.0254
type Nodes = Record<AnyNodeId, AnyNode>
type P = [number, number]
const keyed = (nodes: AnyNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n])) as Nodes

const BOX: P[] = [
  [0, 0],
  [10, 0],
  [10, 8],
  [0, 8],
]

/**
 * A one-storey house on a flat site standing on `record`; `below` adds an empty level under the
 * ground floor (as a person adds one before drawing in it), `place` moves and turns the building,
 * `outline` draws its foundation outline on the ground floor, `walls: false` leaves the walls out.
 */
function house(
  record: BuildingFoundationRecord | null,
  {
    below = false,
    place,
    outline,
    walls: withWalls = true,
  }: {
    below?: boolean
    place?: { position: [number, number, number]; yaw: number }
    outline?: P[]
    walls?: boolean
  } = {},
) {
  const walls = withWalls
    ? BOX.map((start, index) =>
        WallNode.parse({
          id: `wall_g_${index}`,
          parentId: 'level_g',
          start,
          end: BOX[(index + 1) % BOX.length],
          thickness: 0.1,
        }),
      )
    : []
  const drawn = outline
    ? [FoundationNode.parse({ id: 'foundation_a', parentId: 'level_g', polygon: outline })]
    : []
  return keyed([
    SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
    BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_a',
      children: below ? ['level_b', 'level_g'] : ['level_g'],
      ...(place ? { position: place.position, rotation: [0, place.yaw, 0] } : {}),
      ...(record ? { metadata: { foundation: record } } : {}),
    }),
    ...(below
      ? [LevelNode.parse({ id: 'level_b', parentId: 'building_a', level: -1, children: [] })]
      : []),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      children: [...walls.map((w) => w.id), 'slab_g', ...drawn.map((d) => d.id)],
    }),
    SlabNode.parse({
      id: 'slab_g',
      parentId: 'level_g',
      plateRole: 'base',
      polygon: BOX,
      elevation: 0.05,
      thickness: 0.05,
    }),
    ...walls,
    ...drawn,
  ])
}

const bounds = (points: P[]) => ({
  minX: Math.min(...points.map((p) => p[0])),
  maxX: Math.max(...points.map((p) => p[0])),
  minZ: Math.min(...points.map((p) => p[1])),
  maxZ: Math.max(...points.map((p) => p[1])),
})
const ofKind = (shapes: FoundationPlanShape[], kind: FoundationPlanShape['kind']) =>
  shapes.filter((shape) => shape.kind === kind)
const ringsOf = (shape: FoundationPlanShape | undefined) =>
  shape && 'rings' in shape ? shape.rings : []

test('the badge names the foundation: the default slab with no record, Off only switched off', () => {
  expect(foundationBadge(house(null), 'building_a')).toBe('Slab')
  // A generator's record names its type and never sets the switch.
  expect(foundationBadge(house({ type: 'raised' }), 'building_a')).toBe('Raised')
  expect(foundationBadge(house({ enabled: false, type: 'slab' }), 'building_a')).toBe('Off')
  expect(foundationBadge(house({ enabled: true, type: 'slab' }), 'building_a')).toBe('Slab')
  for (const type of ['slab', 'raised'] as const)
    expect(foundationBadge(house({ type, support: 'piles' }), 'building_a')).toBe('Piles')
  expect(foundationBadge(house(null), 'level_g')).toBe('Off')
})

test('the view selects the level footings go on, and ghosts the walls the foundation runs under', () => {
  for (const record of [null, { enabled: false }]) {
    expect(foundationViewOf(house(record), 'building_a')).toMatchObject({
      levelId: 'level_g',
      wallLevelId: 'level_g',
    })
    // An empty level under the ground floor is where footings are drawn; the walls stay the ground floor's.
    expect(foundationViewOf(house(record, { below: true }), 'building_a')).toMatchObject({
      levelId: 'level_b',
      wallLevelId: 'level_g',
    })
  }
  expect(foundationViewOf(house(null), 'nothing')).toEqual({
    levelId: null,
    wallLevelId: null,
    badge: 'Off',
  })
})

test('a slab plan: the slab outlined, its turned-down edge dashed where it ends inside, one ring with open corners', () => {
  const shapes = foundationPlan(house(null), 'building_a')
  const [slab] = ofKind(shapes, 'slab')
  expect(slab).toMatchObject({ hidden: false, filled: true })
  expect(ringsOf(slab)).toHaveLength(1)
  const outer = bounds(ringsOf(slab)[0]!)
  // Under the whole house, to within the walls' outside faces (0.05 m out of the centrelines).
  for (const [value, centreline] of [
    [outer.minX, 0],
    [outer.maxX, 10],
    [outer.minZ, 0],
    [outer.maxZ, 8],
  ] as const)
    expect(Math.abs(value - centreline)).toBeLessThanOrEqual(0.05 + 1e-6)
  // The four sides' edges merge into one band: only its inside line shows, one closed rectangle,
  // nothing drawn across the corners.
  const [edge] = ofKind(shapes, 'turndown')
  expect(edge).toMatchObject({ hidden: true, filled: false })
  expect(ringsOf(edge)).toHaveLength(1)
  const inside = ringsOf(edge)[0]!
  expect(inside).toHaveLength(4)
  const inner = bounds(inside)
  expect(inner.minX).toBeGreaterThan(outer.minX + 12 * IN - 1e-6)
  expect(inner.maxX).toBeLessThan(outer.maxX - 12 * IN + 1e-6)
})

test('a moved and turned building draws the same plan in its own frame', () => {
  const still = foundationPlan(house(null), 'building_a')
  const moved = foundationPlan(
    house(null, { place: { position: [7, 0, -3], yaw: 0.6 } }),
    'building_a',
  )
  expect(moved.length).toBe(still.length)
  const a = bounds(ringsOf(ofKind(still, 'slab')[0])[0]!)
  const b = bounds(ringsOf(ofKind(moved, 'slab')[0])[0]!)
  for (const key of ['minX', 'maxX', 'minZ', 'maxZ'] as const) expect(b[key]).toBeCloseTo(a[key], 6)
})

test('piles are dashed circles of the record’s diameter, under a solid grade beam', () => {
  const shapes = foundationPlan(
    house({ type: 'raised', support: 'piles', pileDiameterIn: 16 }),
    'building_a',
  )
  const piles = ofKind(shapes, 'pile')
  expect(piles.length).toBeGreaterThan(4)
  for (const pile of piles) {
    expect(pile.hidden).toBe(true)
    expect('radius' in pile && pile.radius).toBeCloseTo(8 * IN, 6)
  }
  const [beam] = ofKind(shapes, 'grade-beam')
  // Over a crawl space the beam is cut: its outside and inside, one ring each.
  expect(beam).toMatchObject({ hidden: false, filled: true })
  expect(ringsOf(beam)).toHaveLength(2)
  expect(shapes.at(-1)?.kind).toBe('pile')
})

test('a raised floor: the poured stem wall solid, its footing dashed on both sides of it', () => {
  const shapes = foundationPlan(house({ type: 'raised' }), 'building_a')
  const [stem] = ofKind(shapes, 'stem')
  const [footing] = ofKind(shapes, 'footing')
  expect(stem).toMatchObject({ hidden: false, filled: true })
  expect(footing).toMatchObject({ hidden: true, filled: false })
  expect(ringsOf(stem)).toHaveLength(2)
  expect(ringsOf(footing)).toHaveLength(2)
  const stemOut = bounds(ringsOf(stem)[0]!)
  const footingOut = bounds(ringsOf(footing)[0]!)
  expect(footingOut.minX).toBeLessThan(stemOut.minX)
  for (const member of genericFoundation(house({ type: 'raised' })))
    expect(member.material).toBe('concrete')
})

test('switched off, the plan is the generic footing dashed round the poured stem wall', () => {
  const shapes = foundationPlan(house({ enabled: false }), 'building_a')
  expect(ofKind(shapes, 'stem')[0]).toMatchObject({ hidden: false, filled: true })
  expect(ofKind(shapes, 'footing')[0]).toMatchObject({ hidden: true, filled: false })
  expect(ofKind(shapes, 'slab')).toEqual([])
  expect(foundationPlan(house(null), 'level_g')).toEqual([])
})

test('a drawn outline replaces the walls’ and needs none; tracing the walls gives their outside faces', () => {
  const traced = traceFoundationOutlines(house(null), 'building_a')
  expect(traced).toHaveLength(1)
  const faces = bounds(traced[0]!)
  expect(faces.minX).toBeCloseTo(-0.051, 3)
  expect(faces.maxX).toBeCloseTo(10.051, 3)
  expect(traceFoundationOutlines(house(null, { walls: false }), 'building_a')).toEqual([])

  // Stretched 2 m out on the right, past the walls (a porch slab).
  const stretched: P[] = [
    [-0.05, -0.05],
    [12, -0.05],
    [12, 8.05],
    [-0.05, 8.05],
  ]
  const nodes = house(null, { outline: stretched })
  expect(buildingFoundationNodes(nodes, 'building_a').map((node) => node.id)).toEqual([
    'foundation_a',
  ])
  const slab = bounds(ringsOf(ofKind(foundationPlan(nodes, 'building_a'), 'slab')[0])[0]!)
  expect(slab.maxX).toBeCloseTo(12 - 0.01, 3)
  // Drawn in either direction it is the same foundation.
  const reversed = house(null, { outline: [...stretched].reverse() })
  expect(genericFoundation(reversed)).toEqual(genericFoundation(nodes))
  // With no walls at all the drawn outline still stands, on its own level.
  const bare = house(null, { outline: stretched, walls: false })
  expect(designedFoundationReport(bare, 'building_a')?.levelId).toBe('level_g')
  expect(ofKind(foundationPlan(bare, 'building_a'), 'turndown')).toHaveLength(1)
  // Switched off, the generic foundation follows the walls again.
  const off = house({ enabled: false }, { outline: stretched })
  expect(genericFoundation(off)).toEqual(genericFoundation(house({ enabled: false })))
})

test('3D hides the house on every level but its footings, its outline and a plugin drawing the foundation', () => {
  const Framer = BaseNode.extend({ id: objectId('framer'), type: nodeType('test:framer') })
  registerNode({
    kind: 'test:framer',
    schemaVersion: 1,
    schema: Framer,
    category: 'utility',
    defaults: () => ({}),
    capabilities: { drawsFoundation: () => true },
  })
  const base = house(null, { below: true, outline: BOX })
  const footing = FootingNode.parse({
    id: 'footing_a',
    parentId: 'level_b',
    start: [2, 4],
    end: [8, 4],
  })
  const framer = Framer.parse({ id: 'framer_g', parentId: 'level_g' }) as AnyNode
  const ground = base['level_g' as AnyNodeId]
  const lower = base['level_b' as AnyNodeId]
  if (ground?.type !== 'level' || lower?.type !== 'level') throw new Error('fixture')
  const nodes = {
    ...base,
    level_g: { ...ground, children: [...ground.children, framer.id] },
    level_b: { ...lower, children: [footing.id] },
    footing_a: footing,
    framer_g: framer,
  } as Nodes
  const hidden = foundationViewHiddenIds(nodes, 'building_a')
  expect([...hidden].sort()).toEqual(
    ['slab_g', 'wall_g_0', 'wall_g_1', 'wall_g_2', 'wall_g_3'].sort(),
  )
  // Worked out once per scene state.
  expect(foundationViewHiddenIds(nodes, 'building_a')).toBe(hidden)
  expect(foundationViewHiddenIds(nodes, 'level_g')).toEqual([])
})
