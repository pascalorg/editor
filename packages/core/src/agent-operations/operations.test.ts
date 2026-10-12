import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { AGENT_TOOL_CONTRACTS } from '../agent-tools'
import { type AgentRefusal, isAgentRefusal } from '../agent-tools/refusal'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import { nodeRegistry, registerNode } from '../registry'
import {
  type AnyNode,
  BaseNode,
  generateId,
  LevelNode,
  StairNode,
  StairSegmentNode,
} from '../schema'
import { AGENT_TOOL_CASES, finiteReadbackProblems } from './__fixtures__/cases'
import { paintedKitchenScene } from './__fixtures__/room-cases'
import { applyAgentOutcome } from './apply-outcome'
import { AGENT_OPERATIONS, applySceneChanges } from './index'

// Layer 1 of 3: the core operations, on every shared tool's edge cases.
describe('agent operations', () => {
  for (const c of AGENT_TOOL_CASES) {
    if (c.surfaces && !c.surfaces.includes('core')) continue
    test(`${c.tool}: ${c.name}`, () => {
      const nodes = c.scene().nodes as Record<string, AnyNode>
      const readBefore = ['get_walls', 'get_zones', 'get_level_summary'].includes(c.tool)
        ? structuredClone(nodes)
        : undefined
      const operation = AGENT_OPERATIONS[c.tool as keyof typeof AGENT_OPERATIONS]
      expect(operation).toBeDefined()
      const context = {
        activeLevelId: c.context?.activeLevelId ?? null,
        catalog: c.context?.catalog,
      }
      // As on both surfaces, the operation gets the input its contract parsed ("36 in" → metres).
      const contract = AGENT_TOOL_CONTRACTS.find((candidate) => candidate.name === c.tool)!
      const input = z.object(contract.input).parse(c.input)
      if ('refusal' in c.expect) {
        let error: unknown
        try {
          operation(nodes, input as never, context)
        } catch (thrown) {
          error = thrown
        }
        expect(isAgentRefusal(error)).toBe(true)
        expect((error as AgentRefusal).code).toBe(c.expect.refusal)
        for (const text of c.expect.mentions ?? []) expect((error as Error).message).toContain(text)
        return
      }
      // Applied as both surfaces apply it: a scene without a store, derived by the pure reconciler.
      let after: Record<string, AnyNode> = nodes
      const outcome = operation(nodes, input as never, context)
      if (readBefore) {
        expect(outcome.changes).toBeUndefined()
        expect(outcome.afterReconcile).toBeUndefined()
        expect(nodes).toEqual(readBefore)
      }
      const result = applyAgentOutcome(outcome, {
        getNodes: () => after,
        applyChanges: (changes) => {
          after = applySceneChanges(after, changes)
        },
        reconcile: () => {
          after = reconcileSceneStructure({ nodes: after, mintId: (kind) => generateId(kind) })
            .nodes as Record<string, AnyNode>
        },
      })
      expect(result).toMatchObject(c.expect.result)
      if (readBefore) {
        expect(after).toEqual(readBefore)
        expect(finiteReadbackProblems(result)).toEqual([])
        expect(JSON.parse(JSON.stringify(result))).toMatchObject(c.expect.result)
      }
      for (const id of c.expect.present ?? []) expect(after[id]).toBeDefined()
      for (const id of c.expect.absent ?? []) expect(after[id]).toBeUndefined()
      for (const [id, fields] of Object.entries(c.expect.after ?? {}))
        expect(after[id]).toMatchObject(fields)
      for (const [key, entries] of Object.entries(c.expect.contains ?? {}))
        for (const entry of entries)
          expect((result as Record<string, unknown[]>)[key]).toContainEqual(
            expect.objectContaining(entry),
          )
      for (const [key, entries] of Object.entries(c.expect.lacks ?? {}))
        for (const entry of entries)
          expect((result as Record<string, unknown[]>)[key]).not.toContainEqual(
            expect.objectContaining(entry),
          )
      for (const text of c.expect.mentions ?? []) expect(JSON.stringify(result)).toContain(text)
      expect(c.expect.check?.(result, after) ?? []).toEqual([])
    })
  }
})

test('room intent writes round-trip through readback without deleting local paint', () => {
  let nodes = paintedKitchenScene().nodes as Record<string, AnyNode>
  const context = { activeLevelId: 'level_rooms' }
  const expectedOverrides = [{ wallId: 'wall_north', face: 'a', finish: 'library:local-tile' }]
  const transitions = [
    [{ wallMaterial: null }, null],
    [{ wallMaterial: 'library:preset-white' }, 'library:preset-white'],
    [{ name: 'Studio' }, 'library:preset-white'],
    [{ wallMaterial: '' }, ''],
    [{ wallMaterial: null }, null],
  ] as const
  for (const [patch, expected] of transitions) {
    const contract = AGENT_TOOL_CONTRACTS.find((entry) => entry.name === 'set_zone_intent')!
    const input = z.object(contract.input).parse({ zoneId: 'zone_kitchen', patch })
    applyAgentOutcome(AGENT_OPERATIONS.set_zone_intent(nodes, input as never, context), {
      getNodes: () => nodes,
      applyChanges: (changes) => {
        nodes = applySceneChanges(nodes, changes)
      },
      reconcile: () => {
        nodes = reconcileSceneStructure({ nodes, mintId: (kind) => generateId(kind) })
          .nodes as Record<string, AnyNode>
      },
    })
    const before = structuredClone(nodes)
    const outcome = AGENT_OPERATIONS.get_zones(nodes, { levelId: 'level_rooms' }, context)
    const result = outcome.result as { zones: Record<string, unknown>[] }
    expect(result.zones.find((zone) => zone.id === 'zone_kitchen')).toMatchObject({
      wallMaterial: expected,
      wallOverrides: expectedOverrides,
    })
    expect(result.zones.find((zone) => zone.id === 'zone_pantry')).toMatchObject({
      wallMaterial: 'library:pantry-blue',
      wallOverrides: [{ wallId: 'wall_south', face: 'a', finish: 'library:pantry-tile' }],
    })
    expect(nodes.wall_north).toMatchObject({
      faceRegions: [{ id: 'wainscot', face: 'a', v1: 0.9, finish: 'library:wood' }],
    })
    expect(outcome.changes).toBeUndefined()
    expect(nodes).toEqual(before)
  }
})

test('stair design targets stay informational in scene verification', () => {
  const level = LevelNode.parse({})
  const flight = StairSegmentNode.parse({ height: 3, length: 3, stepCount: 10 })
  const stair = StairNode.parse({ parentId: level.id, totalRise: 3, children: [flight.id] })
  flight.parentId = stair.id
  level.children = [stair.id]
  const nodes = Object.fromEntries([level, stair, flight].map((node) => [node.id, node]))
  const verified = AGENT_OPERATIONS.verify_scene(nodes, {}, { activeLevelId: level.id }).result
  expect(verified.issues).toContainEqual(
    expect.objectContaining({ type: 'stair_riser_target', severity: 'info' }),
  )
  // The circulation check also names a stair with no landing in this bare scene: what must hold is
  // that the design targets are informational, never an issue that fails the scene.
  expect(
    verified.issues.filter((issue) => issue.type.endsWith('_target') && issue.severity !== 'info'),
  ).toEqual([])
})

test('scene verification validates registered plugin kinds without accepting malformed or unknown nodes', () => {
  const restore = nodeRegistry._snapshot()
  const schema = BaseNode.extend({
    type: z.literal('diagnostic-pool').default('diagnostic-pool'),
    depth: z.number().positive(),
  })
  try {
    registerNode({
      kind: 'diagnostic-pool',
      schemaVersion: 1,
      schema,
      category: 'utility',
      defaults: () => schema.parse({ id: 'pool_test', depth: 1.5 }),
      capabilities: {},
    })
    const pool = schema.parse({ id: 'pool_test', depth: 1.5 })
    const verify = (node: unknown) =>
      AGENT_OPERATIONS.verify_scene(
        { [pool.id]: node } as Record<string, AnyNode>,
        {},
        { activeLevelId: null },
      ).result
    expect(verify(pool)).toMatchObject({ valid: true, issues: [], hasIssues: false })
    for (const node of [
      { ...pool, depth: -1 },
      { ...pool, type: 'unknown-pool' },
      { ...pool, type: 'wall' },
    ]) {
      const result = verify(node)
      expect(result.valid).toBe(false)
      expect(result.issues).toContainEqual(expect.objectContaining({ type: 'schema_invalid' }))
    }
  } finally {
    restore()
  }
})
