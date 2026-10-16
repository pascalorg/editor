import { describe, expect, test } from 'bun:test'
import { CATALOG_SOURCE, isAgentRefusal, runBatchTool } from '../agent-tools'
import { type AgentRefusal, refuse } from '../agent-tools/refusal'
import type { AnyNode, CompiledGeometryScript } from '../schema'
import { ADD_OBJECT_CASES, compiledSolid } from './__fixtures__/add-object-cases'
import { AGENT_OPERATIONS, applySceneChanges, buildBatchObjects } from './index'
import type { AgentOperationOutcome } from './types'

// run_batch builds objects in one call: the owner's study measured 8 to 11 objects over 8 to 11
// steps, about six times the credits of one parallel step. The host builds every module first, a
// few at a time (a compile is async, the operations are not), and the batch places what was built.

const CODE = 'export default function build({ THREE }) { return new THREE.Group() }'
const scene = () => ADD_OBJECT_CASES[0]!.scene().nodes as Record<string, AnyNode>
const context = { activeLevelId: 'level_0' }

type Call = { tool: string; input?: Record<string, unknown> }
const object = (name: string, extra: Record<string, unknown> = {}): Call => ({
  tool: 'add_object',
  input: {
    code: CODE,
    name,
    category: 'table',
    reason: `${name}: nothing in the catalog`,
    ...extra,
  },
})

/** A host's compile in place of the chat's or the MCP's: the module's name decides its fate. */
function fakeBuild(log: string[] = []) {
  let inFlight = 0
  let peak = 0
  const build = async (input: {
    code?: string
    name?: string
    nodeId?: string
  }): Promise<CompiledGeometryScript> => {
    if (!(input.code || input.nodeId)) refuse('code_required', 'Pass code to build a new object.')
    inFlight++
    peak = Math.max(peak, inFlight)
    await Promise.resolve()
    inFlight--
    log.push(input.name ?? '?')
    if (input.name?.includes('broken')) throw new Error('ReferenceError: Foo is not defined')
    const mount = input.name?.includes('wall') ? 'wall' : 'floor'
    return {
      ...compiledSolid([0.8, 0.7, 0.8], mount),
      nodeId: `item_${(input.name ?? 'x').replace(/\W/g, '_')}`,
    }
  }
  return { build, peak: () => peak }
}

async function runBatch(calls: Call[], onRefusal?: 'stop' | 'skip', build = fakeBuild().build) {
  const batchObjects = await buildBatchObjects(calls, build)
  const nodes = scene()
  let outcome: AgentOperationOutcome | undefined
  let refusal: AgentRefusal | undefined
  try {
    outcome = AGENT_OPERATIONS.run_batch(
      nodes,
      { calls, ...(onRefusal ? { onRefusal } : {}) } as never,
      { ...context, batchObjects },
    )
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    refusal = error
  }
  return {
    outcome,
    refusal,
    after: outcome ? applySceneChanges(nodes, outcome.changes) : nodes,
    reports: (outcome?.result.calls ?? []) as {
      status: string
      code?: string
      error?: string
      result?: Record<string, unknown>
    }[],
  }
}

describe('add_object in run_batch', () => {
  test('is a tool a batch runs, and the description says the objects are independent', () => {
    expect(runBatchTool.description).toContain('add_object')
    expect(runBatchTool.description).toContain('independent')
  })

  test('three objects, one of which fails: the two others are placed, each with its own receipt', async () => {
    const { outcome, after, reports } = await runBatch([
      object('Low oak table'),
      object('broken bench'),
      object('Paper lantern'),
    ])
    expect(outcome?.result).toMatchObject({ status: 'applied', applied: 2, refused: 1 })
    expect(reports.map((report) => report.status)).toEqual(['ok', 'refused', 'ok'])
    expect(reports[1]).toMatchObject({ code: 'script_failed' })
    expect(reports[1]!.error).toContain('Foo is not defined')
    expect(reports[1]!.error).toContain(CATALOG_SOURCE)
    expect(after.item_Low_oak_table).toBeDefined()
    expect(after.item_Paper_lantern).toBeDefined()
    expect(after.item_broken_bench).toBeUndefined()
    // The receipt a lone add_object gives: what it made, its size, and what the scene holds.
    for (const index of [0, 2]) {
      expect(reports[index]!.result).toMatchObject({ nodeId: expect.stringMatching(/^item_/) })
      expect(reports[index]!.result).toHaveProperty('achieved')
    }
    // Its own: one object, not the two the batch made.
    expect(reports[0]!.result?.achieved).toMatchObject({ created: { item: 1 } })
    expect(reports[2]!.result?.achieved).toMatchObject({ created: { item: 1 } })
  })

  test('a refused object does not stop the batch under the default onRefusal either', async () => {
    const { outcome, after } = await runBatch([object('wall panel'), object('Side table')], 'stop')
    expect(outcome?.result).toMatchObject({ applied: 1, refused: 1 })
    expect(outcome?.result.calls).toMatchObject([{ status: 'refused', code: 'wrong_host' }, {}])
    expect(after.item_Side_table).toBeDefined()
  })

  test('a missing reason and an invalid input are each that object’s own report', async () => {
    const { outcome, after, reports } = await runBatch([
      { tool: 'add_object', input: { code: CODE, name: 'No reason', category: 'table' } },
      { tool: 'add_object', input: { name: 'No code', category: 'table', reason: 'x' } },
      { tool: 'add_object', input: { code: '', name: 'Empty code', reason: 'x' } },
      object('Side table'),
    ])
    expect(reports.map((report) => report.code)).toEqual([
      'reason_required',
      'code_required',
      'invalid_input',
      undefined,
    ])
    expect(reports[2]!.error).toContain('call 3')
    expect(outcome?.result).toMatchObject({ applied: 1, refused: 3 })
    expect(after.item_Side_table).toBeDefined()
  })

  test('a refusal of another tool still stops the batch: nothing is applied, objects included', async () => {
    const { refusal, outcome, after } = await runBatch([
      object('Side table'),
      { tool: 'delete_node', input: { id: 'wall_missing' } },
    ])
    expect(outcome).toBeUndefined()
    expect(refusal?.code).toBe('batch_call_refused')
    expect(after.item_Side_table).toBeUndefined()
  })

  test('objects and other tools share one change set, in order', async () => {
    const { outcome, after } = await runBatch([
      object('Side table'),
      { tool: 'delete_node', input: { id: 'item_screen' } },
    ])
    expect(outcome?.result).toMatchObject({ applied: 2, refused: 0 })
    expect(after.item_Side_table).toBeDefined()
    expect(after.item_screen).toBeUndefined()
  })

  test('a host that built nothing says to call add_object on its own', async () => {
    const outcome = AGENT_OPERATIONS.run_batch(
      scene(),
      { calls: [object('Side table')] } as never,
      context,
    )
    expect(outcome.result.calls).toMatchObject([{ status: 'refused', code: 'object_not_built' }])
  })

  test('a repeated edit is refused before compiling stale stored parameters, without stopping other objects', async () => {
    const compiled: string[] = []
    const built = await buildBatchObjects(
      [
        object('Wider', { nodeId: 'item_existing', params: { width: 2 } }),
        object('Taller', { nodeId: 'item_existing', params: { height: 3 } }),
        object('Other object'),
      ],
      async (input) => {
        compiled.push(input.name!)
        return compiledSolid([0.8, 0.7, 0.8])
      },
    )
    expect(compiled).toEqual(['Wider', 'Other object'])
    expect(built[0]).toHaveProperty('compiled')
    expect(built[1]).toMatchObject({ failure: { code: 'object_edit_conflict' } })
    expect(built[2]).toHaveProperty('compiled')
  })

  test('modules compile three at a time, each once', async () => {
    const log: string[] = []
    const host = fakeBuild(log)
    const names = Array.from({ length: 8 }, (_, i) => `Shelf ${i}`)
    const built = await buildBatchObjects(
      [...names.map((name) => object(name)), { tool: 'paint', input: {} }],
      host.build,
    )
    expect(Object.keys(built)).toHaveLength(8)
    expect([...log].sort()).toEqual([...names].sort())
    expect(host.peak()).toBe(3)
  })
})
