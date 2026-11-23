import { expect, test } from 'bun:test'
import { z } from 'zod'
import { moveNodeOutput } from '../agent-tools/move-duplicate'
import { isAgentRefusal } from '../agent-tools/refusal'
import { encodeTerrainField } from '../lib/terrain-codec'
import { createTerrainField } from '../lib/terrain-field'
import { treeFacts } from '../lib/tree-facts'
import { BuildingNode, LevelNode, SiteNode, SlabNode, TreeNode } from '../schema'
import { applySceneChanges } from './apply-changes'
import { moveNode } from './move-node'
import type { SceneNodes } from './types'

const context = { activeLevelId: null }
const site = SiteNode.parse({ id: 'site_tree_move' })
const tree = TreeNode.parse({
  id: 'tree_move',
  parentId: site.id,
  position: [8, 0, 8],
  form: 'weeping',
  heightM: 9,
  seed: 37,
})
const building = BuildingNode.parse({ id: 'building_tree_move', parentId: site.id })
const level = LevelNode.parse({ id: 'level_tree_move', parentId: building.id, level: 0 })
const floor = SlabNode.parse({
  id: 'slab_tree_move',
  parentId: level.id,
  polygon: [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ],
})
const garden: SceneNodes = {
  [site.id]: { ...site, children: [tree.id, building.id] },
  [tree.id]: tree,
  [building.id]: { ...building, children: [level.id] },
  [level.id]: { ...level, children: [floor.id] },
  [floor.id]: floor,
}

function expectRefusal(input: Parameters<typeof moveNode>[1], code: string, nodes = garden) {
  const before = JSON.stringify(nodes)
  let failure: unknown
  try {
    moveNode(nodes, input, context)
  } catch (error) {
    failure = error
  }
  expect(isAgentRefusal(failure)).toBe(true)
  expect(failure).toMatchObject({ code })
  expect(JSON.stringify(nodes)).toBe(before)
}

test('move_node moves a Site tree absolutely with one position-only update and valid output', () => {
  const before = JSON.stringify(garden)
  const outcome = moveNode(garden, { id: tree.id, to: [12, -4] }, context)
  expect(z.object(moveNodeOutput).safeParse(outcome.result).success).toBe(true)
  expect(outcome.result).toMatchObject({
    host: 'free',
    hostId: site.id,
    position: [12, 0, -4],
    clamped: false,
  })
  expect(outcome.changes).toEqual({
    update: [{ id: tree.id, data: { position: [12, 0, -4] } }],
  })
  expect(applySceneChanges(garden, outcome.changes)[tree.id]).toEqual({
    ...tree,
    position: [12, 0, -4],
  })
  expect(JSON.stringify(garden)).toBe(before)
})

test('move_node deltas remain Site metres even beside a translated, rotated building', () => {
  const nodes = {
    ...garden,
    [building.id]: {
      ...building,
      position: [30, 0, 20] as [number, number, number],
      rotation: [0, Math.PI / 2, 0] as [number, number, number],
    },
  }
  const outcome = moveNode(nodes, { id: tree.id, by: [-3, 2] }, context)
  expect(outcome.result.position).toEqual([5, 0, 10])
  expect(outcome.changes?.update).toEqual([{ id: tree.id, data: { position: [5, 0, 10] } }])
})

test.each([false, true])('a trunk move into a building is refused even with force=%s', (force) => {
  expectRefusal({ id: tree.id, to: [0, 0], force }, 'tree_inside_building')
})

test('a courtyard hole is a valid tree destination while the surrounding floor is refused', () => {
  const nodes = {
    ...garden,
    [floor.id]: {
      ...floor,
      holes: [
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as [number, number][],
      ],
    },
  }
  const outcome = moveNode(nodes, { id: tree.id, to: [0, 0] }, context)
  expect(outcome.result.position).toEqual([0, 0, 0])
  expectRefusal({ id: tree.id, to: [1.5, 0] }, 'tree_inside_building', nodes)
})

test('ground height stays derived after a move onto raised terrain, never stored in position', () => {
  const field = createTerrainField({ origin: [-20, -20], spacing: 5, cols: 9, rows: 9 })
  field.heights.fill(200)
  const nodes = {
    [site.id]: { ...site, terrain: encodeTerrainField(field), children: [tree.id] },
    [tree.id]: tree,
  }
  const outcome = moveNode(nodes, { id: tree.id, to: [4, 5] }, context)
  const next = applySceneChanges(nodes, outcome.changes)
  const moved = next[tree.id]
  if (moved?.type !== 'tree') throw new Error('Expected the moved Site tree')
  expect(moved.position).toEqual([4, 0, 5])
  expect(treeFacts(moved, next).groundY).toBe(2)
})

test('tree movement refuses vertical, rotational and out-of-bounds edits before changes', () => {
  expectRefusal({ id: tree.id, to: [8, 10], y: 1 }, 'height_not_applicable')
  expectRefusal({ id: tree.id, to: [8, 10], rotation: 45 }, 'rotation_not_supported')
  expectRefusal({ id: tree.id, rotation: 45 }, 'rotation_not_supported')
  expectRefusal({ id: tree.id, to: [Number.POSITIVE_INFINITY, 10] }, 'invalid_input')
  expectRefusal({ id: tree.id, to: [100_000, 10] }, 'invalid_input')
})
