import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
} from '../schema'
import {
  FOUNDATION_GRADING,
  finishedGradeAt,
  type GradingPad,
  gradedTerrainFieldOf,
  gradeTerrainField,
} from './foundation-grading'
import {
  designedFoundationReport,
  foundationGradingPads,
  genericFoundation,
} from './generic-foundation'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField, heightAt } from './terrain-field'

const IN = 0.0254
const FT = 12 * IN
type Nodes = Record<AnyNodeId, AnyNode>
const keyed = (nodes: AnyNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n])) as Nodes

const PAD: GradingPad = {
  outline: [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ],
  y: 0,
}

test('under and along a pad the grade is the pad’s; it falls 6 in over the first 10 ft', () => {
  expect(finishedGradeAt([PAD], 5, 4, -3)).toBe(0)
  expect(finishedGradeAt([PAD], 10, 4, -3)).toBe(0)
  expect(finishedGradeAt([PAD], 10 + 5 * FT, 4, -3)).toBeCloseTo(-3 * IN, 9)
  expect(finishedGradeAt([PAD], 10 + 10 * FT, 4, 5)).toBeCloseTo(-6 * IN, 9)
})

test('past the apron a bank of 2:1 meets the natural ground: fill below it, cut above it, untouched past it', () => {
  const toe = -FOUNDATION_GRADING.fall
  const at = (run: number, natural: number) =>
    finishedGradeAt([PAD], 10 + FOUNDATION_GRADING.apron + run, 4, natural)
  // 2 m past the toe the bank stands 1 m off it: lower ground is filled up to it, higher cut down.
  expect(at(2, toe - 3)).toBeCloseTo(toe - 1, 9)
  expect(at(2, toe + 3)).toBeCloseTo(toe + 1, 9)
  // Ground the bank already reaches stays as it is.
  expect(at(2, toe + 0.4)).toBeCloseTo(toe + 0.4, 9)
  expect(finishedGradeAt([], 50, 50, 1.23)).toBe(1.23)
})

/** A 10 × 8 m slab house on ground falling 1 m in 10 m along x, its floor top `floor` over the plane. */
function slopedHouse(floor = 0.05) {
  const field = createTerrainField({ cols: 81, rows: 81, spacing: 0.5, origin: [-15, -15] })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++) {
      const x = field.origin[0] + col * field.spacing
      field.heights[row * field.cols + col] = Math.round((-0.1 * x) / field.step)
    }
  const corners: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: 'level_g',
      start,
      end: corners[(index + 1) % 4],
      thickness: 0.1,
    }),
  )
  return keyed([
    SiteNode.parse({ id: 'site_a', children: ['building_a'], terrain: encodeTerrainField(field) }),
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
      plateRole: 'base',
      polygon: corners,
      elevation: floor,
      thickness: 0.05,
    }),
    ...walls,
  ])
}

test('on a slope the ground round a slab is held 8 in under its top: filled on the low side, cut on the high', () => {
  const nodes = slopedHouse()
  const site = nodes['site_a' as AnyNodeId]
  const graded = gradedTerrainFieldOf(nodes, site as never)!
  const report = designedFoundationReport(nodes, 'building_a')!
  const pad = report.floorTopY - 8 * IN
  expect(foundationGradingPads(nodes).map((p) => p.y)).toEqual([pad])
  // Natural: 0 at the high side (x 0), -1 m at the low side (x 10).
  expect(report.highestGradeY).toBeCloseTo(0.0051, 2)
  // Along both sides the finished grade is the pad: cut where the ground stood higher, filled
  // where it fell away.
  expect(heightAt(graded, -0.06, 4)).toBeCloseTo(pad, 1)
  expect(heightAt(graded, 10.06, 4)).toBeCloseTo(pad, 1)
  // The low side's edge stands its 8 in out of the fill, no more.
  for (const edge of genericFoundation(nodes).filter((m) => m.kind === 'turndown')) {
    const top = Math.max(...edge.section!.map(([, y]) => y))
    expect(top - pad).toBeCloseTo(8 * IN - 0.001, 3)
  }
  // Far off the ground is as it was.
  expect(heightAt(graded, -14, 4)).toBeCloseTo(1.4, 2)
})

test('a porch slab beside the house stands down in the ground graded round it, 1.5 in under the house', () => {
  const house = slopedHouse()
  const porch = SlabNode.parse({
    id: 'slab_porch',
    parentId: 'level_g',
    plateRole: 'sunken',
    polygon: [
      [0, 8],
      [10, 8],
      [10, 10],
      [0, 10],
    ],
    elevation: 0.05 - 1.5 * IN,
    thickness: 0.05,
    metadata: { floor: 'porch-slab' },
  })
  const level = house['level_g' as AnyNodeId] as LevelNode
  const nodes = {
    ...house,
    [level.id]: { ...level, children: [...level.children, porch.id] },
    [porch.id]: porch,
  } as Nodes
  const report = designedFoundationReport(nodes, 'building_a')!
  const pad = report.floorTopY - 8 * IN
  const pads = foundationGradingPads(nodes)
  // The house's pad, and the porch's at the same grade: its top 6.5 in over it.
  expect(pads.map((p) => p.y)).toEqual([pad, expect.closeTo(pad, 9)] as never)
  expect(pads[1]!.outline).toEqual(porch.polygon)
  const graded = gradedTerrainFieldOf(nodes, nodes['site_a' as AnyNodeId] as never)!
  expect(heightAt(graded, 5, 10.06)).toBeCloseTo(pad, 1)
  // An ordinary plate a step down inside the house grades nothing of its own.
  const sunken = { ...porch, metadata: {} }
  expect(foundationGradingPads({ ...nodes, [porch.id]: sunken } as Nodes)).toHaveLength(1)
})

test('round a raised floor the ground is only cut, and its crawl space dug out inside its stem walls', () => {
  const cut: GradingPad = { ...PAD, kind: 'cut' }
  const pit: GradingPad = {
    outline: [
      [1, 1],
      [9, 1],
      [9, 7],
      [1, 7],
    ],
    y: -0.5,
    kind: 'pit',
  }
  // Higher ground is cut to the grade, lower ground left as it lies, along the apron and the bank.
  expect(finishedGradeAt([cut], 10 + 5 * FT, 4, 2)).toBeCloseTo(-3 * IN, 9)
  expect(finishedGradeAt([cut], 10 + 5 * FT, 4, -2)).toBe(-2)
  expect(finishedGradeAt([cut], 10 + FOUNDATION_GRADING.apron + 2, 4, -3)).toBe(-3)
  // Inside the stem walls the dirt is dug down to the pit, never raised to it.
  expect(finishedGradeAt([cut, pit], 5, 4, 0.3)).toBe(-0.5)
  expect(finishedGradeAt([cut, pit], 5, 4, -0.8)).toBe(-0.8)
  // Between the pit and the outline (the stem walls) only the cut.
  expect(finishedGradeAt([cut, pit], 0.5, 4, 0.3)).toBe(0)
  // A pit alone grades nothing outside it.
  expect(finishedGradeAt([pit], 12, 4, 0.3)).toBe(0.3)
})

test('the same field and pads grade once; no pads leave the field itself', () => {
  const field = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
  expect(gradeTerrainField(field, [])).toBe(field)
  const once = gradeTerrainField(field, [PAD])
  expect(gradeTerrainField(field, [PAD])).toBe(once)
  expect(once).not.toBe(field)
})
