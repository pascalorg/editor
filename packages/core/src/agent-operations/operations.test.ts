import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { AGENT_TOOL_CONTRACTS } from '../agent-tools'
import { type AgentRefusal, isAgentRefusal } from '../agent-tools/refusal'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import { type AnyNode, generateId } from '../schema'
import { AGENT_TOOL_CASES } from './__fixtures__/cases'
import { applyAgentOutcome } from './apply-outcome'
import { AGENT_OPERATIONS, applySceneChanges } from './index'

// Layer 1 of 3: the core operations, on every shared tool's edge cases.
describe('agent operations', () => {
  for (const c of AGENT_TOOL_CASES) {
    if (c.surfaces && !c.surfaces.includes('core')) continue
    test(`${c.tool}: ${c.name}`, () => {
      const nodes = c.scene().nodes as Record<string, AnyNode>
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
      const result = applyAgentOutcome(operation(nodes, input as never, context), {
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
