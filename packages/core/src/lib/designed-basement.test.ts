import { expect, test } from 'bun:test'
import { buildBuildingFoundationChanges } from '../building/foundation'
import { buildGroundLevelChanges } from '../building/ground-level'
import { buildLevelBelowChanges } from '../building/level-insertion'
import { buildLevelRemovalChanges } from '../building/level-removal'
import { buildExteriorWallCopy } from '../building/level-wall-copy'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
} from '../schema'
import { levelFloorWorldY, levelPlaneWorldY } from '../services/storey'
import { foundationOutlines } from './designed-foundation'
import { finishedGradeAt, gradeTerrainField, isExcavation } from './foundation-grading'
import {
  designedFoundationReport,
  foundationGradingPads,
  genericFoundation,
} from './generic-foundation'
import { groundSeat } from './ground-seat'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField, heightAt } from './terrain-field'
import { terrainFieldOf } from './terrain-source'

const IN = 0.0254
type Nodes = Record<AnyNodeId, AnyNode>
const keyed = (nodes: AnyNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n])) as Nodes

const CORNERS: Array<[number, number]> = [
  [0, 0],
  [10, 0],
  [10, 8],
  [0, 8],
]

/** Ground falling 1 m in 10 m along x, 0 at x 0. */
function slope() {
  const field = createTerrainField({ cols: 81, rows: 81, spacing: 0.5, origin: [-15, -15] })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++) {
      const x = field.origin[0] + col * field.spacing
      field.heights[row * field.cols + col] = Math.round((-0.1 * x) / field.step)
    }
  return encodeTerrainField(field)
}

/** A 10 × 8 m slab house on its designed foundation (on by default), on flat ground or `terrain`. */
function slabHouse(terrain?: ReturnType<typeof encodeTerrainField>): Nodes {
  const walls = CORNERS.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: 'level_g',
      start,
      end: CORNERS[(index + 1) % 4],
      thickness: 0.15,
    }),
  )
  return keyed([
    SiteNode.parse({ id: 'site_a', children: ['building_a'], ...(terrain ? { terrain } : {}) }),
    BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: ['level_g'] }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      children: [...walls.map((wall) => wall.id), 'slab_g'],
    }),
    SlabNode.parse({
      id: 'slab_g',
      parentId: 'level_g',
      plateRole: 'base',
      polygon: CORNERS,
      elevation: 0.05,
      thickness: 0.05,
    }),
    ...walls,
  ])
}

/** A basement added under the lowest level as the level panel's "+" adds one. */
function withBasement(nodes: Nodes): { nodes: Nodes; basement: LevelNode } {
  const { newLevel, create, update } = buildLevelBelowChanges({
    nodes,
    buildingId: 'building_a',
    height: 2.5,
  })
  const next: Nodes = { ...nodes }
  for (const { node } of create) next[node.id as AnyNodeId] = node
  const building = next['building_a' as AnyNodeId] as BuildingNode
  next[building.id] = { ...building, children: [...building.children, newLevel.id] }
  for (const { id, data } of update) next[id] = { ...next[id], ...data } as AnyNode
  return { nodes: next, basement: newLevel }
}

function apply(nodes: Nodes, update: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>): Nodes {
  const next = { ...nodes }
  for (const { id, data } of update) next[id] = { ...next[id], ...data } as AnyNode
  return next
}

/** The house's foundation outline, the ground floor walls' outside faces (the building at the origin). */
const houseOutline = (nodes: Nodes) =>
  foundationOutlines(
    Object.values(nodes).filter(
      (node): node is WallNode => node.type === 'wall' && node.parentId === 'level_g',
    ),
  )[0]!.edges.map((edge) => edge.a)

test('on flat ground a basement grades nothing: the ground is dug out inside its walls’ outside faces to its slab’s underside', () => {
  expect(foundationGradingPads(slabHouse()).map((pad) => pad.kind ?? 'pad')).toEqual(['pad'])
  const { nodes, basement } = withBasement(slabHouse())
  const pads = foundationGradingPads(nodes)
  expect(pads.map((pad) => pad.kind)).toEqual(['excavation'])
  const report = designedFoundationReport(nodes, 'building_a')!
  expect(report.levelId).toBe(basement.id)
  expect(report.basement?.ownWalls).toBe(false)
  // The empty basement's floor is its plane: its 4 in slab under it, dug out to the slab's underside.
  expect(report.floorTopY).toBeCloseTo(levelPlaneWorldY(nodes, basement.id)!, 9)
  const slabBottom = report.floorTopY - 4 * IN
  expect(pads[0]!.y).toBeCloseTo(slabBottom, 9)
  expect(report.basement!.excavationY).toBeCloseTo(slabBottom, 9)
  // The dig's polygon is the foundation's outer outline.
  const outline = houseOutline(nodes)
  expect(pads[0]!.outline).toHaveLength(outline.length)
  pads[0]!.outline.forEach(([x, z], index) => {
    expect(x).toBeCloseTo(outline[index]![0], 9)
    expect(z).toBeCloseTo(outline[index]![1], 9)
  })
  // Poured walls from the footings up to the floor framing over the basement, the slab inside.
  const members = genericFoundation(nodes)
  const walls = members.filter((member) => member.kind === 'stem')
  expect(walls).toHaveLength(4)
  for (const wall of walls) {
    expect(wall.width).toBeCloseTo(8 * IN, 9)
    expect(wall.bottomY).toBeCloseTo(slabBottom, 9)
    expect(wall.topY).toBeCloseTo(report.basement!.wallTopY, 9)
    expect(wall.levelId).toBe(basement.id)
  }
  const footings = members.filter((member) => member.kind === 'footing')
  expect(footings).toHaveLength(4)
  for (const footing of footings) expect(footing.bottomY).toBeCloseTo(slabBottom - 8 * IN, 9)
  const slab = members.find((member) => member.kind === 'slab')!
  expect(slab.bottomY).toBeCloseTo(slabBottom, 9)
  expect(slab.topY).toBeCloseTo(report.floorTopY - 0.002, 9)
  expect(members.some((member) => member.kind === 'turndown')).toBe(false)
  // The walls carry the floor framed over the basement: their top under its joists, by the sill.
  const floor = levelFloorWorldY(nodes, 'level_g')!
  expect(report.basement!.wallTopY).toBeCloseTo(floor - (13.125 - 0.5 + 1.5) * IN, 6)
})

test('on a slope the ground outside a basement lies as it was; the house is seated with its walls’ top 8 in over the high side, adjustably', () => {
  const house = slabHouse(slope())
  const { nodes } = withBasement(house)
  const natural = terrainFieldOf(nodes['site_a' as AnyNodeId] as SiteNode)!
  // The insertion seats the house in the same change set: the framed floor over the basement
  // would stand in the ground where the slab stood, so the house rises.
  const position = (scene: Nodes) => (scene['building_a' as AnyNodeId] as BuildingNode).position
  expect(position(nodes)[1]).toBeGreaterThan(position(house)[1] + 0.3)
  expect(
    buildBuildingFoundationChanges({ nodes, buildingId: 'building_a', patch: {} })!.moveBy,
  ).toBeCloseTo(0, 6)
  const report = designedFoundationReport(nodes, 'building_a')!
  expect(report.basement!.wallTopY - report.highestGradeY).toBeCloseTo(8 * IN, 6)
  // The high side is x 0, the ground there about at 0; about 1 m lower at x 10.
  expect(report.highestGradeY).toBeCloseTo(0.0075, 2)
  expect(report.lowestGradeY).toBeCloseTo(-1.0075, 2)
  const pads = foundationGradingPads(nodes)
  expect(pads.map((pad) => pad.kind)).toEqual(['excavation'])
  // Nothing is graded: the ground drawn is the natural ground, open over the dig.
  expect(
    gradeTerrainField(
      natural,
      pads.filter((pad) => !isExcavation(pad)),
    ),
  ).toBe(natural)
  for (const [x, z] of [
    [-0.2, 4],
    [-3, 4],
    [10.2, 4],
    [13, 4],
    [5, -0.2],
    [5, 8.2],
    [-2, -2],
    [12, 10],
  ] as Array<[number, number]>) {
    const ground = heightAt(natural, x, z)
    expect(finishedGradeAt(pads, x, z, ground)).toBe(ground)
  }
  // Inside the walls' outside faces the ground is dug down to the slab's underside.
  expect(finishedGradeAt(pads, 5, 4, heightAt(natural, 5, 4))).toBeCloseTo(
    report.basement!.excavationY,
    9,
  )
  // A daylight basement: its walls' top 30 in over the high side, the house raised in one change.
  const daylight = buildBuildingFoundationChanges({
    nodes,
    buildingId: 'building_a',
    patch: { basementTopAboveGradeIn: 30 },
  })!
  expect(daylight.moveBy).toBeCloseTo(22 * IN, 6)
  const raised = designedFoundationReport(apply(nodes, daylight.update), 'building_a')!
  expect(raised.basement!.wallTopY - raised.highestGradeY).toBeCloseTo(30 * IN, 6)
})

test('deleting the basement brings the slab’s grading back, the house re-seated on its slab', () => {
  const house = slabHouse(slope())
  expect(foundationGradingPads(house).map((pad) => pad.kind ?? 'pad')).toEqual(['pad'])
  const { nodes, basement } = withBasement(house)
  expect(foundationGradingPads(nodes).map((pad) => pad.kind)).toEqual(['excavation'])
  expect(groundSeat(nodes, 'building_a')).toMatchObject({ rule: 'basement', seated: true })
  const after = apply(nodes, buildLevelRemovalChanges({ nodes, levelId: basement.id }))
  delete after[basement.id as AnyNodeId]
  const building = after['building_a' as AnyNodeId] as BuildingNode
  after[building.id] = {
    ...building,
    children: building.children.filter((id) => id !== basement.id),
  }
  // The house the basement raised would float on its slab: it comes down onto it, the slab's top
  // 8 in over the high side, the ground graded to it again.
  const report = designedFoundationReport(after, 'building_a')!
  expect(report.basement).toBeUndefined()
  expect(report.floorTopY - report.highestGradeY).toBeCloseTo(8 * IN, 6)
  const pads = foundationGradingPads(after)
  expect(pads.map((pad) => pad.kind ?? 'pad')).toEqual(['pad'])
  expect(pads[0]!.y).toBeCloseTo(report.floorTopY - 8 * IN, 6)
  expect(groundSeat(after, 'building_a')).toMatchObject({
    rule: 'slab',
    seated: true,
    atFoundationTop: true,
  })
})

test('the ground line seats by each foundation’s own rule: a raised floor, a slab, a basement', () => {
  // A raised floor seated by its panel is seated for the ground line too, not 14 in too high.
  const raised = slabHouse(slope())
  raised['building_a' as AnyNodeId] = {
    ...raised['building_a' as AnyNodeId],
    metadata: { foundation: { enabled: true, type: 'raised' } },
  } as BuildingNode
  const on = apply(
    raised,
    buildBuildingFoundationChanges({ nodes: raised, buildingId: 'building_a', patch: {} })!.update,
  )
  expect(groundSeat(on, 'building_a')).toMatchObject({
    rule: 'raised',
    askedIn: 22.125,
    seated: true,
    atFoundationTop: true,
  })
  // Sunk under its seat, the line's click seats it as the panel does.
  const sunk = apply(on, [
    {
      id: 'building_a' as AnyNodeId,
      data: { position: [0, -0.4, 0], groundLevelId: 'level_g' } as Partial<AnyNode>,
    },
  ])
  expect(groundSeat(sunk, 'building_a')).toMatchObject({ rule: 'raised', seated: false })
  const reseated = apply(sunk, buildGroundLevelChanges({ nodes: sunk, levelId: 'level_g' })!.update)
  const report = designedFoundationReport(reseated, 'building_a')!
  expect(report.floorTopY - report.highestGradeY).toBeCloseTo(22.125 * IN, 6)
  // A basement's walls' top too, and switched off the construction's 8 in again.
  const { nodes } = withBasement(slabHouse(slope()))
  const low = apply(nodes, [
    { id: 'building_a' as AnyNodeId, data: { position: [0, 0, 0] } as Partial<AnyNode> },
  ])
  expect(groundSeat(low, 'building_a')).toMatchObject({ rule: 'basement', seated: false })
  const up = apply(low, buildGroundLevelChanges({ nodes: low, levelId: 'level_g' })!.update)
  const basement = designedFoundationReport(up, 'building_a')!
  expect(basement.basement!.wallTopY - basement.highestGradeY).toBeCloseTo(8 * IN, 6)
  const off = apply(up, [
    {
      id: 'building_a' as AnyNodeId,
      data: { metadata: { foundation: { enabled: false } } } as Partial<AnyNode>,
    },
  ])
  expect(groundSeat(off, 'building_a')?.rule).toBe('construction')
  expect(groundSeat(off, 'building_a')?.askedIn).toBeCloseTo(8, 1)
})

test('a basement with walls of its own stands them on their footing, dug out to its floor along their outside faces', () => {
  const added = withBasement(slabHouse())
  const copies = buildExteriorWallCopy({
    nodes: added.nodes,
    fromLevelId: 'level_g',
    toLevelId: added.basement.id,
  })
  const nodes: Nodes = { ...added.nodes }
  for (const { node } of copies) nodes[node.id as AnyNodeId] = node
  nodes[added.basement.id as AnyNodeId] = {
    ...added.basement,
    children: copies.map(({ node }) => node.id),
  }
  const report = designedFoundationReport(nodes, 'building_a')!
  expect(report.basement?.ownWalls).toBe(true)
  // Only the footing under its walls: they are the foundation walls.
  const members = genericFoundation(nodes)
  expect(new Set(members.map((member) => member.kind))).toEqual(new Set(['footing']))
  expect(members.every((member) => member.levelId === added.basement.id)).toBe(true)
  const pads = foundationGradingPads(nodes)
  expect(pads.map((pad) => pad.kind)).toEqual(['excavation'])
  expect(pads[0]!.y).toBeCloseTo(levelPlaneWorldY(nodes, added.basement.id)!, 9)
  const faces = foundationOutlines(copies.map(({ node }) => node))[0]!.edges.map((edge) => edge.a)
  expect(pads[0]!.outline).toEqual(faces)
})
