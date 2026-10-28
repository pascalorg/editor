import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  FootingNode,
  LevelNode,
  SiteNode,
  SlabNode,
} from '../schema'
import type { BuildingFoundationRecord } from './building-foundation'
import { footingDesign, footingLevelOf, footingMembers } from './footing'
import type { FoundationMember } from './generic-foundation'
import { FLAT_GROUND_Y } from './site-ground-height'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField } from './terrain-field'

const IN = 0.0254
type Nodes = Record<AnyNodeId, AnyNode>
const keyed = (nodes: AnyNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n])) as Nodes
const ofKind = (members: FoundationMember[], kind: FoundationMember['kind']) =>
  members.filter((member) => member.kind === kind)

const STRIP = FootingNode.parse({
  id: 'footing_strip',
  parentId: 'level_g',
  shape: 'strip',
  start: [2, 4],
  end: [8, 4],
})
const PAD = FootingNode.parse({
  id: 'footing_pad',
  parentId: 'level_g',
  shape: 'pad',
  center: [5, 4],
  width: 24 * IN,
  length: 30 * IN,
  thickness: 10 * IN,
})

/** A storey whose floor top stands 0.05 m over its plane, the building lifted `y` over the site. */
function house(
  record: BuildingFoundationRecord | null,
  footings: FootingNode[],
  y = 0,
  terrain?: string,
) {
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
      children: ['slab_g', ...footings.map((f) => f.id)],
    }),
    SlabNode.parse({
      id: 'slab_g',
      parentId: 'level_g',
      plateRole: 'base',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      elevation: 0.05,
      thickness: 0.05,
    }),
    ...footings,
  ])
}

test('on a slab a footing thickens the slab: under the record’s slab, or the floor plate as built', () => {
  // Switched on, a generator's or no record (the default slab), the record's 4 in slab under the
  // floor top; one the panel switched off (it keeps the type it wrote), the plate's own underside.
  for (const [record, top] of [
    [{ enabled: true, type: 'slab' as const }, 0.05 - 4 * IN],
    [{ type: 'slab' as const, ffAboveGradeIn: 8 }, 0.05 - 4 * IN],
    [null, 0.05 - 4 * IN],
    [{ enabled: false, type: 'slab' as const, ffAboveGradeIn: 8 }, 0],
  ] as const) {
    const design = footingDesign(house(record, [STRIP]), STRIP)!
    expect(design.foundation.type).toBe('slab')
    expect(design.topY).toBeCloseTo(top, 6)
    expect(design.bottomY).toBeCloseTo(top - 8 * IN, 6)
    expect(design.members.map((m) => m.kind)).toEqual(['footing'])
    expect(design.members[0]!.width).toBeCloseTo(12 * IN, 6)
    expect(design.members[0]!.from).toEqual([2, 4])
    expect(design.members[0]!.to).toEqual([8, 4])
  }
})

test('with the record switched off, a footing under a floor raised on its own foundation carries a stem to its underside', () => {
  for (const record of [
    { enabled: false },
    { enabled: false, type: 'slab' as const, ffAboveGradeIn: 8 },
  ]) {
    const nodes = house(record, [STRIP, PAD])
    const plate = nodes['slab_g' as AnyNodeId] as SlabNode
    // The plate 0.6 m up on its foundation, its top 0.65 m over the plane.
    nodes[plate.id] = { ...plate, elevation: 0.65, foundation: { type: 'solid' } } as SlabNode
    const strip = footingDesign(nodes, STRIP)!
    expect(strip.foundation.type).toBe('raised')
    expect(strip.bottomY).toBeCloseTo(FLAT_GROUND_Y - 12 * IN, 6)
    expect(ofKind(strip.members, 'stem')[0]!.topY).toBeCloseTo(0.6, 6)
    expect(ofKind(footingDesign(nodes, PAD)!.members, 'stem')[0]!.topY).toBeCloseTo(0.6, 6)
  }
})

test('on a slope a footing under the slab goes down to the ground, or its own depth under it', () => {
  // The ground 1 m under the site's datum: the slab stands on fill over it.
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  const terrain = encodeTerrainField({
    ...field,
    heights: new Int16Array(field.heights).fill(-100),
  })
  const nodes = house({ enabled: true, type: 'slab' }, [STRIP], 0, terrain)
  const design = footingDesign(nodes, STRIP)!
  expect(design.gradeY).toBeCloseTo(-1, 6)
  expect(design.topY).toBeCloseTo(0.05 - 4 * IN, 6)
  expect(design.bottomY).toBeCloseTo(-1, 6)
  const deep = FootingNode.parse({ ...STRIP, depth: 0.3 })
  expect(footingDesign(house({ type: 'slab' }, [deep], 0, terrain), deep)!.bottomY).toBeCloseTo(
    -1.3,
    6,
  )
})

test('under a raised floor a strip sits its depth under the crawl space dirt and carries a stem to the stem top', () => {
  const floorTop = 0.65
  // ¾ in flooring, ⅝ in sheathing, 2x12 joists and the 1½ in sill.
  const stemTop = floorTop - 14.125 * IN
  // The crawl space dug 18 in under the joists, lower than the ground outside here.
  const crawl = stemTop + 1.5 * IN - 18 * IN
  const nodes = house({ type: 'raised' }, [STRIP, PAD], 0.6)
  const strip = footingDesign(nodes, STRIP)!
  // The ground it goes down from is the crawl space's dirt, dug lower than the ground outside here.
  expect(crawl).toBeLessThan(FLAT_GROUND_Y)
  expect(strip.gradeY).toBeCloseTo(crawl, 6)
  expect(strip.bottomY).toBeCloseTo(crawl - 12 * IN, 6)
  expect(strip.topY).toBeCloseTo(crawl - 12 * IN + 8 * IN, 6)
  const [stem] = ofKind(strip.members, 'stem')
  expect(stem!.width).toBeCloseTo(6 * IN, 6)
  expect(stem!.bottomY).toBeCloseTo(strip.topY, 6)
  expect(stem!.topY).toBeCloseTo(stemTop, 6)

  // A pad carries a square pier, the stem's thickness on a side.
  const pad = footingDesign(nodes, PAD)!
  const [pier] = ofKind(pad.members, 'stem')
  expect(pier!.width).toBeCloseTo(6 * IN, 6)
  expect(Math.hypot(pier!.to[0] - pier!.from[0], pier!.to[1] - pier!.from[1])).toBeCloseTo(
    6 * IN,
    6,
  )
  expect(pier!.topY).toBeCloseTo(stemTop, 6)
})

test("a footing's own depth wins over the building's", () => {
  const deep = FootingNode.parse({ ...STRIP, depth: 0.6 })
  const design = footingDesign(house({ type: 'raised' }, [deep], 0.6), deep)!
  expect(design.depth).toBe(0.6)
  // Its depth under the crawl space's dirt, 18 in under the joists.
  const crawl = 0.65 - 14.125 * IN + 1.5 * IN - 18 * IN
  expect(design.bottomY).toBeCloseTo(Math.min(FLAT_GROUND_Y, crawl) - 0.6, 6)
})

test('on piles a strip is a grade beam with a pile at each end and none further apart than the spacing', () => {
  const nodes = house({ type: 'raised', support: 'piles' }, [STRIP, PAD], 0.6)
  const strip = footingDesign(nodes, STRIP)!
  const [beam] = ofKind(strip.members, 'grade-beam')
  expect(beam!.width).toBeCloseTo(12 * IN, 6)
  const piles = ofKind(strip.members, 'pile')
  // 6 m at 8 ft: three bays.
  expect(piles.map((p) => p.from[0])).toEqual([2, 4, 6, 8])
  for (const pile of piles) {
    expect(pile.topY).toBeCloseTo(beam!.bottomY, 6)
    expect(pile.topY - pile.bottomY).toBeCloseTo(120 * IN, 6)
  }

  // A pad is a cap on one pile.
  const pad = footingDesign(nodes, PAD)!
  expect(pad.members.map((m) => m.kind)).toEqual(['footing', 'pile'])
  expect(pad.members[1]!.from).toEqual([5, 4])
})

test('a footing on no building pours nothing', () => {
  const loose = FootingNode.parse({ ...STRIP, parentId: 'level_x' })
  expect(footingMembers(keyed([loose]), loose)).toEqual([])
})

test("footings drawn from any storey go on the building's lowest", () => {
  const nodes = house(null, [])
  const upper = LevelNode.parse({ id: 'level_1', parentId: 'building_a', level: 1 })
  const building = nodes['building_a' as AnyNodeId] as BuildingNode
  const scene = keyed([
    ...Object.values(nodes),
    { ...building, children: ['level_g', 'level_1'] } as BuildingNode,
    upper,
  ])
  expect(footingLevelOf(scene, 'level_1')?.id).toBe('level_g')
  expect(footingLevelOf(scene, 'level_g')?.id).toBe('level_g')
  expect(footingLevelOf(scene, 'level_x')).toBeNull()
})
