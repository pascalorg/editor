import { expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools/refusal'
import { BuildingNode, LevelNode, SiteNode, SlabNode } from '../schema'
import { AGENT_OPERATIONS, applySceneChanges } from './index'
import type { SceneNodes } from './types'

const site = SiteNode.parse({})
const building = BuildingNode.parse({ parentId: site.id })
const level = LevelNode.parse({ parentId: building.id, level: 0 })
const slab = SlabNode.parse({
  parentId: level.id,
  polygon: [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ],
})
const nodes: SceneNodes = {
  [site.id]: { ...site, children: [building.id] },
  [building.id]: { ...building, children: [level.id] },
  [level.id]: { ...level, children: [slab.id] },
  [slab.id]: slab,
}
const call = (x: number, z: number) => ({
  tool: 'add_tree',
  input: { trees: [{ at: [x, z] }] },
})
const run = (calls: ReturnType<typeof call>[], onRefusal?: 'stop' | 'skip') =>
  AGENT_OPERATIONS.run_batch(nodes, { calls, onRefusal }, { activeLevelId: null })

test('a batch runs tree calls against one scene and returns their merged changes', () => {
  const outcome = run([call(-8, 0), call(8, 0)])
  expect(outcome.result).toMatchObject({
    status: 'applied',
    applied: 2,
    refused: 0,
    calls: [
      { tool: 'add_tree', status: 'ok' },
      { tool: 'add_tree', status: 'ok' },
    ],
  })
  const after = applySceneChanges(nodes, outcome.changes)
  expect(Object.values(after).filter((node) => node.type === 'tree')).toHaveLength(2)
  expect(Object.values(nodes).some((node) => node.type === 'tree')).toBe(false)
})

test('a later trunk refusal stops a batch without applying its earlier tree', () => {
  const before = JSON.stringify(nodes)
  let failure: unknown
  try {
    run([call(8, 0), call(0, 0)])
  } catch (error) {
    failure = error
  }
  expect(isAgentRefusal(failure)).toBe(true)
  expect(failure).toMatchObject({
    code: 'batch_call_refused',
    details: {
      index: 1,
      tool: 'add_tree',
      refusal: 'tree_inside_building',
    },
  })
  expect(JSON.stringify(nodes)).toBe(before)
})

test('skip retains valid tree calls and reports the refused tree call separately', () => {
  const outcome = run([call(8, 0), call(0, 0), call(-8, 0)], 'skip')
  expect(outcome.result).toMatchObject({
    applied: 2,
    refused: 1,
    calls: [
      { status: 'ok' },
      { status: 'refused', code: 'tree_inside_building' },
      { status: 'ok' },
    ],
  })
  expect(outcome.changes?.create).toHaveLength(2)
})
