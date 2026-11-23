import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools/refusal'
import { treeFacts } from '../lib/tree-facts'
import { BuildingNode, LevelNode, RoofNode, RoofSegmentNode, SiteNode, SlabNode } from '../schema'
import { addTree } from './tree'
import type { SceneNodes } from './types'

const site = SiteNode.parse({})
const building = BuildingNode.parse({ parentId: site.id })
const level = LevelNode.parse({ parentId: building.id, level: 0 })
const floor = SlabNode.parse({
  parentId: level.id,
  polygon: [
    [-2.4, -2.4],
    [2.4, -2.4],
    [2.4, 2.4],
    [-2.4, 2.4],
  ],
})
const roof = RoofNode.parse({ parentId: level.id, position: [0, 3, 0] })
const segment = RoofSegmentNode.parse({ parentId: roof.id, width: 6, depth: 6 })
const house: SceneNodes = {
  [site.id]: { ...site, children: [building.id] },
  [building.id]: { ...building, children: [level.id] },
  [level.id]: { ...level, children: [floor.id, roof.id] },
  [floor.id]: floor,
  [roof.id]: { ...roof, children: [segment.id] },
  [segment.id]: segment,
}

function run(input: unknown, nodes: SceneNodes = { [site.id]: site }) {
  return addTree(nodes, input as never, { activeLevelId: null })
}

function refusal(input: unknown, nodes: SceneNodes, code: string) {
  const before = JSON.stringify(nodes)
  let failure: unknown
  try {
    run(input, nodes)
  } catch (error) {
    failure = error
  }
  expect(isAgentRefusal(failure)).toBe(true)
  expect(failure).toMatchObject({ code })
  expect(JSON.stringify(nodes)).toBe(before)
}

test('one call places an alley with shared defaults and distinct, repeatable individual seeds', () => {
  const input = {
    form: 'upright',
    heightM: 8,
    seed: 19,
    trees: Array.from({ length: 8 }, (_, index) => ({ at: [index * 4 - 14, 8] })),
  }
  const first = run(input)
  const second = run(input)
  const created =
    first.changes?.create?.map(({ node }) => node).filter((node) => node.type === 'tree') ?? []
  expect(first.result).toMatchObject({
    siteId: site.id,
    count: 8,
    facts: { heightsM: Array(8).fill(8) },
  })
  expect(created).toHaveLength(8)
  expect(new Set(created.map((node) => node.seed)).size).toBe(8)
  expect(created.map((node) => node.seed)).toEqual(
    second.changes?.create?.map(({ node }) => (node.type === 'tree' ? node.seed : null)),
  )
  expect(created.every((node) => node.parentId === site.id && node.position[1] === 0)).toBe(true)
})

test('individual fields override shared defaults and omitted widths follow each tree form and height', () => {
  const outcome = run({
    form: 'spreading',
    heightM: 6,
    seed: 2,
    trees: [
      { at: [0, 0] },
      { at: [5, 0], form: 'upright', heightM: 4, seed: 42, foliage: '#b65b29', density: 0 },
    ],
  })
  expect(outcome.changes?.create?.map(({ node }) => node)).toMatchObject([
    { form: 'spreading', heightM: 6, spreadM: expect.closeTo(7.2, 12) },
    { form: 'upright', heightM: 4, spreadM: 1.44, seed: 42, foliage: '#b65b29', density: 0 },
  ])
})

test('building-frame points become Site anchors and facts describe nominal crowns and real clearances', () => {
  const moved = {
    ...building,
    position: [8, 0, -2] as [number, number, number],
    rotation: [0, Math.PI / 2, 0] as [number, number, number],
  }
  const nodes = { ...house, [building.id]: moved }
  const outcome = run({ buildingId: building.id, spreadM: 6, trees: [{ at: [4, 0] }] }, nodes)
  expect(outcome.changes?.create?.[0]?.node).toMatchObject({ position: [8, 0, -6] })
  expect(outcome.result).toMatchObject({
    count: 1,
    facts: { heightsM: [8], crownCoverM2: Math.PI * 9, nearestBuildingDistanceM: 1.6 },
  })
})

test('roof overlap and a crown across the lot line are reports, not refusals', () => {
  const outcome = run({ spreadM: 6, trees: [{ at: [4, 0] }, { at: [14, 0] }] }, house)
  expect(outcome.changes?.create).toHaveLength(2)
  expect(outcome.result).toMatchObject({
    facts: {
      reports: expect.arrayContaining([
        expect.objectContaining({ code: 'tree_crown_over_roof', roofIds: [roof.id] }),
        expect.objectContaining({ code: 'tree_crown_crosses_lot' }),
      ]),
    },
  })
})

test('a trunk inside a building refuses the entire call, even after a valid tree', () => {
  refusal({ trees: [{ at: [8, 8] }, { at: [0, 0] }] }, house, 'tree_inside_building')
})

test('a floor courtyard is plantable while its solid floor remains a building footprint', () => {
  const courtyard = {
    ...floor,
    holes: [
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as [number, number][],
    ],
  }
  const nodes = { ...house, [floor.id]: courtyard }
  const outcome = run({ trees: [{ at: [0, 0] }] }, nodes)
  const tree = outcome.changes?.create?.[0]?.node
  expect(tree?.type).toBe('tree')
  if (tree?.type !== 'tree') throw new Error('Expected one tree')
  expect(treeFacts(tree, nodes).nearestBuildingDistanceM).toBe(1)
  refusal({ trees: [{ at: [1.5, 0] }] }, nodes, 'tree_inside_building')
})

describe('tree refusals are atomic', () => {
  test.each([
    {},
    { trees: [] },
    { trees: Array.from({ length: 41 }, () => ({ at: [0, 0] })) },
    { trees: [{ at: [0, 0], heightM: 1001 }] },
    { trees: [{ at: [0, 0], spreadM: 0.05 }] },
    { trees: [{ at: [0, 0], foliage: '#bad' }] },
    { trees: [{ at: [0, 0], density: -1 }] },
    { trees: [{ at: [0, 0], form: 'unknown' }] },
    { trees: [{ at: [Number.NaN, 0] }] },
    { gen: 2, trees: [{ at: [0, 0] }] },
  ])('invalid input produces no writes: %j', (input) => {
    refusal(input, house, 'invalid_input')
  })
  test('requires a unique Site and a matching, upright building frame', () => {
    const trees = [{ at: [8, 8] }]
    refusal({ trees }, {}, 'no_site')
    refusal({ siteId: building.id, trees }, house, 'no_site')
    const other = SiteNode.parse({})
    refusal({ trees }, { ...house, [other.id]: other }, 'ambiguous_site')
    refusal({ buildingId: site.id, trees }, house, 'building_not_found')
    refusal(
      { buildingId: building.id, siteId: other.id, trees },
      { ...house, [other.id]: other },
      'building_site_mismatch',
    )
    refusal(
      { buildingId: building.id, trees },
      {
        ...house,
        [building.id]: { ...building, rotation: [0.1, 0, 0] },
      },
      'tree_transform_unsupported',
    )
  })
})
