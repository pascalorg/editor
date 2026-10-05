import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { AGENT_TOOL_CONTRACTS } from '../agent-tools'
import { type AgentRefusal, isAgentRefusal } from '../agent-tools/refusal'
import type { AnyNode } from '../schema'
import { AGENT_TOOL_CASES } from './__fixtures__/cases'
import { AGENT_OPERATIONS, applySceneChanges } from './index'

// Layer 1 of 3: the core operations, on every shared tool's edge cases.
describe('agent operations', () => {
  for (const c of AGENT_TOOL_CASES) {
    if (c.surfaces && !c.surfaces.includes('core')) continue
    test(`${c.tool}: ${c.name}`, () => {
      const nodes = c.scene().nodes as Record<string, AnyNode>
      const operation = AGENT_OPERATIONS[c.tool as keyof typeof AGENT_OPERATIONS]
      expect(operation).toBeDefined()
      const context = { activeLevelId: c.context?.activeLevelId ?? null }
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
      const outcome = operation(nodes, input as never, context)
      expect(outcome.result).toMatchObject(c.expect.result)
      const after = applySceneChanges(nodes, outcome.changes)
      for (const id of c.expect.present ?? []) expect(after[id]).toBeDefined()
      for (const id of c.expect.absent ?? []) expect(after[id]).toBeUndefined()
      for (const [id, fields] of Object.entries(c.expect.after ?? {}))
        expect(after[id]).toMatchObject(fields)
      for (const [key, entries] of Object.entries(c.expect.contains ?? {}))
        for (const entry of entries)
          expect((outcome.result as Record<string, unknown[]>)[key]).toContainEqual(
            expect.objectContaining(entry),
          )
      for (const [key, entries] of Object.entries(c.expect.lacks ?? {}))
        for (const entry of entries)
          expect((outcome.result as Record<string, unknown[]>)[key]).not.toContainEqual(
            expect.objectContaining(entry),
          )
      for (const text of c.expect.mentions ?? [])
        expect(JSON.stringify(outcome.result)).toContain(text)
    })
  }
})
