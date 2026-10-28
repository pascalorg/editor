import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  FoundationNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
} from '../schema'
import { DEFAULT_RAISED_FLOOR_BUILD_UP } from './build-up'
import {
  type BuildingFoundationRecord,
  buildingFoundationOf,
  resolveBuildingFoundation,
  slabEdgeTaper,
} from './building-foundation'
import { foundationOutlines } from './designed-foundation'
import {
  designedFoundationReport,
  type FoundationMember,
  foundationGradingPads,
  foundationRimBottom,
  foundationRimSteps,
  genericFoundation,
} from './generic-foundation'
import { FLAT_GROUND_Y, groundHeightAt } from './site-ground-height'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField } from './terrain-field'

const IN = 0.0254
/** A raised floor's framing: ¾ in flooring, ⅝ in sheathing, 2x12 joists, 1½ in sill. */
const FRAMING = 0.75 + 0.625 + 11.25 + 1.5
/** The least a raised floor stands over grade: its stem 8 in out, the framing on it. */
const RAISED_FF = 8 + FRAMING
type Nodes = Record<AnyNodeId, AnyNode>
const keyed = (nodes: AnyNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n])) as Nodes
const ofKind = (members: FoundationMember[], kind: FoundationMember['kind']) =>
  members.filter((member) => member.kind === kind)

function ring(corners: Array<[number, number]>, thickness = 0.1) {
  return corners.map((start, index) =>
    WallNode.parse({
      id: `wall_g_${index}`,
      parentId: 'level_g',
      start,
      end: corners[(index + 1) % corners.length],
      thickness,
    }),
  )
}

const BOX: Array<[number, number]> = [
  [0, 0],
  [10, 0],
  [10, 8],
  [0, 8],
]

/**
 * A one-storey house, its floor top 0.05 m over the level plane, standing on the record given; `y`
 * lifts the building (seats it over the ground).
 */
function house(
  record: BuildingFoundationRecord | null,
  {
    terrain,
    corners = BOX,
    y = 0,
  }: { terrain?: string; corners?: Array<[number, number]>; y?: number } = {},
) {
  const walls = ring(corners)
  return keyed([
    SiteNode.parse({ id: 'site_a', children: ['building_a'], ...(terrain ? { terrain } : {}) }),
    BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_a',
      children: ['level_g'],
      position: [0, y, 0],
      ...(record ? { metadata: { foundation: record } } : {}),
    }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      children: [...walls.map((w) => w.id), 'slab_g'],
    }),
    SlabNode.parse({
      id: 'slab_g',
      parentId: 'level_g',
      plateRole: 'base',
      polygon: corners,
      elevation: 0.05,
      thickness: 0.05,
    }),
    ...walls,
  ])
}

/** The east part of the site (x >= 5) stands 1 m over the west, the house across the step. */
function eastStep() {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1)
    for (let col = 0; col < field.cols; col += 1)
      if (field.origin[0] + col * field.spacing >= 5) heights[row * field.cols + col] = 100
  return encodeTerrainField({ ...field, heights })
}

test('a record left empty takes the code numbers, by storeys', () => {
  const one = resolveBuildingFoundation(null, 1)
  // On unless switched off: a building with no record stands on a slab.
  expect(one.enabled).toBe(true)
  expect(resolveBuildingFoundation({ enabled: false }, 1).enabled).toBe(false)
  expect(one.type).toBe('slab')
  // The edge's taper is left to the rule (`slabEdgeTaper`).
  expect([one.slabThicknessIn, one.edgeDepthIn, one.edgeWidthIn, one.edgeTaperIn]).toEqual([
    4,
    12,
    12,
    null,
  ])
  expect([one.stemThicknessIn, one.footingWidthIn, one.footingThicknessIn]).toEqual([6, 12, 8])
  expect(one.ffAboveGradeIn).toBe(8)
  const two = resolveBuildingFoundation({ type: 'raised' }, 2)
  expect([two.stemThicknessIn, two.footingWidthIn]).toEqual([8, 15])
  // The stem's top 8 in over grade, the floor framing on it.
  expect(two.ffMinIn).toBe(RAISED_FF)
  expect(two.ffAboveGradeIn).toBe(RAISED_FF)
})

test('a finish floor asked under the least the type allows is held at it, and sizes stay in range', () => {
  const raised = resolveBuildingFoundation(
    { type: 'raised', ffAboveGradeIn: 12, stemThicknessIn: 1, footingDepthIn: 30 },
    1,
  )
  expect(raised.ffAboveGradeIn).toBe(RAISED_FF)
  expect(raised.stemThicknessIn).toBe(4)
  expect(raised.footingDepthIn).toBe(30)
  expect(resolveBuildingFoundation({ ffAboveGradeIn: 24 }, 1).ffAboveGradeIn).toBe(24)
  // A slab edge's taper is held to 6 to 12 in.
  expect(
    [3, 9, 20].map((edgeTaperIn) => resolveBuildingFoundation({ edgeTaperIn }, 1).edgeTaperIn),
  ).toEqual([6, 9, 12])
})

test("a slab edge's 45° taper runs half the edge's depth under the slab, 6 to 12 in, never more than that depth", () => {
  // Depth under the slab's underside → the taper, and the plumb inside face under it, inches.
  for (const [depth, taper, plumb] of [
    [12, 6, 6],
    [20, 10, 10],
    [30, 12, 18],
    [8, 6, 2],
    [4, 4, 0],
  ]) {
    expect(slabEdgeTaper(depth! * IN) / IN).toBeCloseTo(taper!, 9)
    expect((depth! * IN - slabEdgeTaper(depth! * IN)) / IN).toBeCloseTo(plumb!, 9)
  }
  // One the record sets stands, as far as the depth allows.
  expect(slabEdgeTaper(20 * IN, 7 * IN) / IN).toBeCloseTo(7, 9)
  expect(slabEdgeTaper(4 * IN, 10 * IN) / IN).toBeCloseTo(4, 9)
})

test('the outline runs on the walls’ outside faces, counter-clockwise, every corner of a box turning out', () => {
  const [outline] = foundationOutlines(ring(BOX))
  expect(outline?.edges).toHaveLength(4)
  expect(outline?.convex).toEqual([true, true, true, true])
  const xs = outline!.edges.map((edge) => edge.a[0])
  const zs = outline!.edges.map((edge) => edge.a[1])
  expect(Math.min(...xs)).toBeCloseTo(-0.051, 9)
  expect(Math.max(...xs)).toBeCloseTo(10.051, 9)
  expect(Math.min(...zs)).toBeCloseTo(-0.051, 9)
  expect(Math.max(...zs)).toBeCloseTo(8.051, 9)
})

test('an L-shaped house has one inside corner', () => {
  const [outline] = foundationOutlines(
    ring([
      [0, 0],
      [10, 0],
      [10, 4],
      [5, 4],
      [5, 8],
      [0, 8],
    ]),
  )
  expect(outline?.convex.filter((convex) => !convex)).toHaveLength(1)
})

test('switched off, the record leaves the generic foundation as it was', () => {
  const generic = genericFoundation(house({ enabled: false }))
  expect(ofKind(generic, 'stem').length).toBeGreaterThan(0)
  expect(genericFoundation(house({ enabled: false, type: 'raised', ffAboveGradeIn: 18 }))).toEqual(
    generic,
  )
  expect(designedFoundationReport(house({ enabled: false }), 'building_a')).toBeNull()
})

test('with no record the house stands on the default slab, as one switched on does', () => {
  expect(genericFoundation(house(null))).toEqual(genericFoundation(house({ enabled: true })))
  expect(ofKind(genericFoundation(house(null)), 'turndown')).toHaveLength(4)
  expect(designedFoundationReport(house(null), 'building_a')?.foundation.type).toBe('slab')
})

test('a slab on grade: a 4 in slab on its pad 8 in under its top, its edge turned down 12 in under that, 12 in wide, plumb inside from a square bottom, then in at 45 degrees', () => {
  const nodes = house({ enabled: true, type: 'slab' })
  const members = genericFoundation(nodes)
  expect(ofKind(members, 'footing')).toHaveLength(0)
  expect(ofKind(members, 'stem')).toHaveLength(0)
  const edges = ofKind(members, 'turndown')
  expect(edges).toHaveLength(4)
  const [slab] = ofKind(members, 'slab')
  expect(slab?.bottomY).toBeCloseTo(0.05 - 4 * IN, 9)
  // The floor stands 4 in over the flat ground: the pad cuts it to 8 in under the slab's top.
  const pad = 0.05 - 8 * IN
  expect(pad).toBeLessThan(FLAT_GROUND_Y)
  expect(foundationGradingPads(nodes).map((p) => p.y)).toEqual([pad])
  for (const edge of edges) {
    const section = edge.section!
    const bottom = Math.min(...section.map(([, y]) => y))
    expect(bottom).toBeCloseTo(pad - 12 * IN, 9)
    // The outer face reaches the floor top, a millimetre under it.
    expect(Math.max(...section.map(([, y]) => y))).toBeCloseTo(0.049, 9)
    const [bottomLeft, bottomRight, plumbTop, slopeTop] = section
    expect(bottomLeft).toEqual([0, bottom])
    expect(bottomRight?.[0]).toBeCloseTo(12 * IN, 9)
    // 16 in under the slab's underside: plumb 8 in, square to the flat bottom, then 8 in at 45
    // degrees, as far in as it rises.
    expect(plumbTop?.[0]).toBeCloseTo(12 * IN, 9)
    expect((plumbTop?.[1] ?? 0) - bottom).toBeCloseTo(8 * IN, 9)
    expect((slopeTop?.[0] ?? 0) - 12 * IN).toBeCloseTo(8 * IN, 9)
    expect((slopeTop?.[1] ?? 0) - (plumbTop?.[1] ?? 0)).toBeCloseTo(8 * IN, 9)
    expect(slopeTop?.[1]).toBeCloseTo(0.05 - 4 * IN, 9)
    expect(edge.width).toBeCloseTo(20 * IN, 9)
  }
  expect(foundationRimBottom(nodes, 'wall_g_0')).toBeNull()
})

test('a deeper edge grows plumb, not wider; a taper the record sets stands', () => {
  /** Each side's taper across, the plumb face under it and the taper's rise, inches. */
  const profile = (record: BuildingFoundationRecord) =>
    ofKind(genericFoundation(house({ enabled: true, type: 'slab', ...record })), 'turndown').map(
      (edge) => {
        const section = edge.section!
        const [bottom, plumbTop, top] = [section[1]![1], section[2]![1], section[3]![1]]
        const across = section[3]![0]
        return [
          Math.round(((across - 12 * IN) / IN) * 1e6) / 1e6,
          Math.round(((plumbTop - bottom) / IN) * 1e6) / 1e6,
          Math.round(((top - plumbTop) / IN) * 1e6) / 1e6,
        ]
      },
    )
  // 26 in under grade is 30 in under the slab: a 12 in taper on 18 in of plumb face.
  for (const side of profile({ edgeDepthIn: 26 })) expect(side).toEqual([12, 18, 12])
  // 16 in under the slab, the taper set to 10 in: 6 in of plumb face under it.
  for (const side of profile({ edgeTaperIn: 10 })) expect(side).toEqual([10, 6, 10])
  // 4 in under grade is 8 in under the slab: the least taper, 6 in, on 2 in of plumb face.
  for (const side of profile({ edgeDepthIn: 4 })) expect(side).toEqual([6, 2, 6])
})

/** `nodes` with `extra` added to the ground level. */
function withOnLevel(nodes: Nodes, ...extra: AnyNode[]): Nodes {
  const level = nodes['level_g' as AnyNodeId] as LevelNode
  return {
    ...nodes,
    ...keyed(extra),
    level_g: { ...level, children: [...level.children, ...extra.map((node) => node.id)] },
  } as Nodes
}

test('a slab past the walls (a patio in the outline) is flush with the floor: no raised edge where no wall stands', () => {
  const patio = FoundationNode.parse({
    id: 'foundation_patio',
    parentId: 'level_g',
    polygon: [
      [-0.051, -0.051],
      [14, -0.051],
      [14, 8.051],
      [-0.051, 8.051],
    ],
  })
  const members = genericFoundation(withOnLevel(house({ enabled: true, type: 'slab' }), patio))
  const slabs = ofKind(members, 'slab')
  expect(slabs).toHaveLength(1)
  // The floor's top (0.05), a hair under: the walking surface where no plate lies over it.
  expect(slabs[0]?.topY).toBeCloseTo(0.048, 9)
  const top = (edge: FoundationMember) => Math.max(...edge.section!.map(([, y]) => y))
  const east = ofKind(members, 'turndown').filter((edge) => edge.from[0] > 13 && edge.to[0] > 13)
  expect(east).toHaveLength(1)
  expect(top(east[0]!)).toBeCloseTo(0.048, 9)
  // Under the west wall the edge comes up to the floor's top, a millimetre under it.
  const west = ofKind(members, 'turndown').filter((edge) => edge.from[0] < 0 && edge.to[0] < 0)
  expect(top(west[0]!)).toBeCloseTo(0.049, 9)
})

test('under a floor a step down (a garage) the slab drops to its underside, round it at the floor top', () => {
  const garage = SlabNode.parse({
    id: 'slab_garage',
    parentId: 'level_g',
    polygon: [
      [6, 1],
      [9, 1],
      [9, 4],
      [6, 4],
    ],
    elevation: -0.1,
    thickness: 0.05,
  })
  const slabs = ofKind(
    genericFoundation(withOnLevel(house({ enabled: true, type: 'slab' }), garage)),
    'slab',
  )
  expect(slabs).toHaveLength(2)
  const [main, sunk] = slabs
  expect(main?.topY).toBeCloseTo(0.048, 9)
  expect(main?.holes).toHaveLength(1)
  // The garage's plate from -0.15 to -0.1: the concrete a millimetre over its underside.
  expect(sunk?.topY).toBeCloseTo(-0.149, 9)
  expect(sunk?.bottomY).toBeCloseTo(-0.149 - 4 * IN, 9)
})

test('the ground is dug out under a floor set down in the slab, and under a slab thicker than its pad allows', () => {
  const garage = SlabNode.parse({
    id: 'slab_garage',
    parentId: 'level_g',
    polygon: [
      [6, 1],
      [9, 1],
      [9, 4],
      [6, 4],
    ],
    elevation: -0.1,
    thickness: 0.05,
  })
  const pads = foundationGradingPads(withOnLevel(house({ enabled: true, type: 'slab' }), garage))
  // The house's pad 8 in under its top; the 4 in slab leaves gravel under it, nothing to dig.
  expect(pads[0]?.y).toBeCloseTo(0.05 - 8 * IN, 9)
  const pits = pads.filter((pad) => pad.kind === 'pit')
  expect(pits).toHaveLength(1)
  // Under the garage the dirt goes down to its concrete's underside.
  expect(pits[0]?.y).toBeCloseTo(-0.149 - 4 * IN, 9)
  expect(Math.min(...pits[0]!.outline.map(([x]) => x))).toBeCloseTo(6, 6)

  // A 10 in slab on a pad 8 in under its top: the dirt under it goes down to its underside.
  const thick = foundationGradingPads(house({ enabled: true, type: 'slab', slabThicknessIn: 10 }))
  expect(thick.filter((pad) => pad.kind === 'pit').map((pad) => pad.y)).toEqual([
    expect.closeTo(0.05 - 10 * IN, 9),
  ])
})

test('a raised floor reads its framing off its layers; a record that set only the depth keeps it', () => {
  const tenInch = {
    ...DEFAULT_RAISED_FLOOR_BUILD_UP,
    structure: { system: 'joists', size: '2x10', spacing: 16 * IN },
  } as const
  const layered = resolveBuildingFoundation({ type: 'raised', floorBuildUp: tenInch }, 1)
  expect(layered.floorFramingDepthIn).toBeCloseTo(0.75 + 0.625 + 9.25 + 1.5, 4)
  expect(layered.ffAboveGradeIn).toBeCloseTo(8 + 0.75 + 0.625 + 9.25 + 1.5, 4)
  const { flooring: _, ...bare } = DEFAULT_RAISED_FLOOR_BUILD_UP
  const flooringOff = resolveBuildingFoundation({ type: 'raised', floorBuildUp: bare }, 1)
  expect(flooringOff.floorFramingDepthIn).toBeCloseTo(0.625 + 11.25 + 1.5, 4)
  const legacy = resolveBuildingFoundation({ type: 'raised', floorFramingDepthIn: 11.5 }, 1)
  expect(legacy.floorFramingDepthIn).toBe(11.5)
  expect(legacy.floorBuildUp).toEqual(DEFAULT_RAISED_FLOOR_BUILD_UP)
})

test('a raised floor: a 6 in stem wall flush with the walls on a 12 x 8 in footing 12 in under the crawl space dirt, the framing on it', () => {
  // Seated: the floor top 22⅛ in over the ground.
  const y = FLAT_GROUND_Y + RAISED_FF * IN - 0.05
  const nodes = house({ enabled: true, type: 'raised' }, { y })
  const members = genericFoundation(nodes)
  const stems = ofKind(members, 'stem')
  const footings = ofKind(members, 'footing')
  expect(stems).toHaveLength(4)
  expect(footings).toHaveLength(4)
  const stemTop = y + 0.05 - FRAMING * IN
  // The stem's top 8 in over the ground.
  expect(stemTop - FLAT_GROUND_Y).toBeCloseTo(8 * IN, 9)
  for (const stem of stems) {
    expect(stem.width).toBeCloseTo(6 * IN, 9)
    expect(stem.topY).toBeCloseTo(stemTop, 9)
  }
  for (const footing of footings) {
    expect(footing.width).toBeCloseTo(12 * IN, 9)
    // The crawl space is dug 18 in under the joists, 8½ in under the ground outside: the footing
    // goes its 12 in under that dirt.
    expect(footing.bottomY).toBeCloseTo(stemTop + 1.5 * IN - 18 * IN - 12 * IN, 9)
    expect(footing.topY - footing.bottomY).toBeCloseTo(8 * IN, 9)
  }
  // The south stem's outer face on the wall's outer face (z = -0.05, a millimetre out).
  const south = stems.find((stem) => Math.abs(stem.from[1] - stem.to[1]) < 1e-9 && stem.from[1] < 1)
  expect((south?.from[1] ?? 0) - 3 * IN).toBeCloseTo(-0.051, 9)
  // Every exterior wall carries its finish down over the framing to the stem.
  for (let index = 0; index < 4; index++)
    expect(foundationRimBottom(nodes, `wall_g_${index}`)).toBeCloseTo(stemTop - y, 9)
  const report = designedFoundationReport(nodes, 'building_a')
  expect(report?.stemTopY).toBeCloseTo(stemTop, 9)
  expect(report?.steps).toBe(0)
})

test('on a slope the footing steps down with the ground, every step deep enough and level', () => {
  const terrain = eastStep()
  // Seated over the high side: the floor 22⅛ in over the 1 m grade.
  const y = 1 + RAISED_FF * IN - 0.05
  const nodes = house({ enabled: true, type: 'raised' }, { terrain, y })
  const footings = ofKind(genericFoundation(nodes), 'footing')
  const site = nodes['site_a' as AnyNodeId]
  const bottoms = new Set(footings.map((footing) => Math.round(footing.bottomY * 1000)))
  expect(bottoms.size).toBeGreaterThan(1)
  for (const footing of footings) {
    // Every point along the step is at least 12 in under the grade over it.
    for (let k = 0; k <= 20; k++) {
      const x = footing.from[0] + ((footing.to[0] - footing.from[0]) * k) / 20
      const z = footing.from[1] + ((footing.to[1] - footing.from[1]) * k) / 20
      expect(footing.bottomY).toBeLessThanOrEqual(groundHeightAt(site, x, z) - 12 * IN + 0.02)
    }
  }
  expect(designedFoundationReport(nodes, 'building_a')?.steps).toBeGreaterThan(0)

  const level = genericFoundation(
    house({ enabled: true, type: 'raised', stepped: false }, { terrain, y }),
  )
  const lowest = Math.min(...ofKind(level, 'footing').map((footing) => footing.bottomY))
  for (const footing of ofKind(level, 'footing')) expect(footing.bottomY).toBeCloseTo(lowest, 9)
})

/**
 * A raised house on ground falling `fall` metres west to east across its 10 m, along its north and
 * south sides, its floor seated 22⅛ in over the high (west) side: the stem's top 8 in over it.
 */
function fallingHouse(fall: number) {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1)
    for (let col = 0; col < field.cols; col += 1)
      heights[row * field.cols + col] = Math.round((10 - (field.origin[0] + col)) * fall * 10)
  const terrain = encodeTerrainField({ ...field, heights })
  const nodes = house(
    { enabled: true, type: 'raised' },
    { terrain, y: fall + RAISED_FF * IN - 0.05 },
  )
  const southOf = (kind: FoundationMember['kind']) =>
    ofKind(genericFoundation(nodes), kind).filter(
      (member) => Math.abs(member.from[1] - member.to[1]) < 1e-9 && member.from[1] < 1,
    )
  return { nodes, southOf, gradeAt: (x: number) => (10 - x) * (fall / 10) }
}

test('a side whose stem stands no more than 36 in out of the ground stays one level run', () => {
  // 0.6 m (23.6 in) of fall: the stem stands 31.6 in out at the low end.
  const { nodes, southOf } = fallingHouse(0.6)
  expect(southOf('footing')).toHaveLength(1)
  expect(southOf('stem')[0]?.topY).toBeCloseTo(0.6 + 8 * IN, 6)
  expect(southOf('cripple')).toHaveLength(0)
  const report = designedFoundationReport(nodes, 'building_a')!
  expect(report.steps).toBe(0)
  expect(report.cripples).toBe(0)
  // Its footing at the deepest need along it, the low end's.
  expect(southOf('footing')[0]?.bottomY).toBeLessThanOrEqual(-12 * IN + 1e-6)
})

test('past 36 in the footing steps down the slope, the stem drops to 8 in over grade, a cripple wall over it', () => {
  // 1.2 m (47 in) of fall: the stem would stand 55 in out at the low end.
  const { nodes, southOf, gradeAt } = fallingHouse(1.2)
  const footings = southOf('footing')
  const report = designedFoundationReport(nodes, 'building_a')!
  expect(footings.length).toBeGreaterThan(1)
  // Steps are counted along a side, not summed round the house, with the tallest one.
  expect(report.steps).toBe(footings.length - 1)
  expect(report.tallestStep).toBeCloseTo(8 * IN, 6)
  const full = report.stemTopY!
  const stems = southOf('stem')
  const cripples = southOf('cripple')
  expect(cripples.length).toBeGreaterThan(0)
  expect(report.cripples).toBeGreaterThanOrEqual(cripples.length)
  for (const stem of stems) {
    // Its top 8 in at least over the highest ground along it, and in whole steps under the framing.
    const high = gradeAt(Math.min(stem.from[0], stem.to[0]))
    expect(stem.topY - high).toBeGreaterThanOrEqual(8 * IN - 0.02)
    const drop = (full - stem.topY) / (8 * IN)
    expect(Math.abs(drop - Math.round(drop))).toBeLessThan(1e-6)
  }
  for (const cripple of cripples) {
    expect(cripple.material).toBe('wood')
    expect(cripple.topY).toBeCloseTo(full, 9)
    // It stands on a stem, the stem's width.
    expect(stems.some((stem) => Math.abs(stem.topY - cripple.bottomY) < 1e-9)).toBe(true)
    expect(cripple.width).toBeCloseTo(6 * IN, 9)
  }
  expect(report.tallestCripple).toBeGreaterThan(0)
  // The high end keeps its stem full height, to the floor framing.
  expect(Math.max(...stems.map((stem) => stem.topY))).toBeCloseTo(full, 9)
  // The south wall carries its siding down over each cripple wall to the stem under it.
  const plane = 1.2 + RAISED_FF * IN - 0.05
  const steps = foundationRimSteps(nodes).get('wall_g_0') ?? []
  expect(steps).toHaveLength(cripples.length)
  for (const step of steps) {
    const cripple = cripples.find(
      (member) =>
        Math.abs(Math.min(member.from[0], member.to[0]) - Math.min(step.a[0], step.b[0])) < 1e-6,
    )
    expect(step.bottom).toBeCloseTo(cripple!.bottomY - plane, 9)
  }
  expect(foundationRimSteps(fallingHouse(0.6).nodes).size).toBe(0)
})

test('a raised floor cuts the ground round it to hold its stem 8 in out, and digs its crawl space to 18 in under the joists', () => {
  const y = FLAT_GROUND_Y + RAISED_FF * IN - 0.05
  const nodes = house({ enabled: true, type: 'raised' }, { y })
  const report = designedFoundationReport(nodes, 'building_a')!
  const stemTop = y + 0.05 - FRAMING * IN
  // The joists' underside 1½ in over the stem, the dirt 18 in under that.
  expect(report.crawlY).toBeCloseTo(stemTop + 1.5 * IN - 18 * IN, 9)
  const pads = foundationGradingPads(nodes)
  expect(pads.map((pad) => pad.kind)).toEqual(['cut', 'pit'])
  expect(pads[0]?.y).toBeCloseTo(stemTop - 8 * IN, 9)
  expect(pads[1]?.y).toBeCloseTo(report.crawlY!, 9)
  // The pit stands inside the stem walls: its outline 6 in in from the outline's.
  const xs = pads[1]!.outline.map(([x]) => x)
  expect(Math.min(...xs)).toBeCloseTo(-0.051 + 6 * IN, 6)
})

test('piles: a grade beam all round on piles at every corner and no more than 8 ft apart', () => {
  const nodes = house({ enabled: true, type: 'raised', support: 'piles' }, { y: 0.45 })
  const members = genericFoundation(nodes)
  expect(ofKind(members, 'footing')).toHaveLength(0)
  expect(ofKind(members, 'grade-beam')).toHaveLength(4)
  const piles = ofKind(members, 'pile')
  // 10 m sides take 5 bays of 2 m, 8 m sides 4 of 2 m: 18 piles, corners shared.
  expect(piles).toHaveLength(18)
  for (const pile of piles) {
    expect(pile.width).toBeCloseTo(12 * IN, 9)
    expect(pile.topY - pile.bottomY).toBeCloseTo(120 * IN, 9)
  }
  expect(designedFoundationReport(nodes, 'building_a')?.piles).toBe(18)
})

test('piles: the grade beam goes its own depth down, or deeper where the least under grade asks', () => {
  const beamBottom = (record: BuildingFoundationRecord) =>
    Math.min(
      ...ofKind(genericFoundation(house(record, { y: 0.45 })), 'grade-beam').map((m) => m.bottomY),
    )
  const record = { enabled: true, type: 'raised', support: 'piles' } as const
  // The stem top 0.45 + 0.05 less the framing; a 24 in beam reaches further than 12 in under grade.
  const top = 0.5 - FRAMING * IN
  expect(beamBottom(record)).toBeCloseTo(top - 24 * IN, 6)
  expect(beamBottom({ ...record, footingDepthIn: 36 })).toBeCloseTo(FLAT_GROUND_Y - 36 * IN, 6)
})

test('piles: a crawl space dug deeper than the grade beam takes the beam down to its dirt', () => {
  const nodes = house(
    { enabled: true, type: 'raised', support: 'piles', crawlClearanceIn: 48 },
    { y: 0.45 },
  )
  const crawl = designedFoundationReport(nodes, 'building_a')!.crawlY!
  const beams = ofKind(genericFoundation(nodes), 'grade-beam')
  // The stem top 0.5 m less the framing; 48 in under the joists is under the 24 in beam's bottom.
  expect(crawl).toBeLessThan(0.5 - FRAMING * IN - 24 * IN)
  for (const beam of beams) expect(beam.bottomY).toBeLessThanOrEqual(crawl + 1e-9)
})

test('the resolved record reads the storeys the building has', () => {
  expect(buildingFoundationOf(house({ enabled: true }), 'building_a')?.storeys).toBe(1)
})
