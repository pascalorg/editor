import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { addObjectTool } from '../agent-tools'
import { type AgentRefusal, isAgentRefusal } from '../agent-tools/refusal'
import type { AnyNode } from '../schema'
import { ADD_OBJECT_CASES } from './__fixtures__/add-object-cases'
import { addObject, applySceneChanges } from './index'

// Layer 1 of 3: the core operation, handed the case's compile in place of a surface's.
describe('add_object', () => {
  for (const c of ADD_OBJECT_CASES) {
    if (c.surfaces && !c.surfaces.includes('core')) continue
    test(c.name, () => {
      const nodes = c.scene().nodes as Record<string, AnyNode>
      const input = { ...z.object(addObjectTool.input).parse(c.input), compiled: c.compiled }
      const context = { activeLevelId: c.context?.activeLevelId ?? null }
      if ('refusal' in c.expect) {
        let error: unknown
        try {
          addObject(nodes, input, context)
        } catch (thrown) {
          error = thrown
        }
        expect(isAgentRefusal(error)).toBe(true)
        expect((error as AgentRefusal).code).toBe(c.expect.refusal)
        for (const text of c.expect.mentions ?? []) expect((error as Error).message).toContain(text)
        return
      }
      const outcome = addObject(nodes, input, context)
      expect(outcome.result).toMatchObject(c.expect.result)
      const after = applySceneChanges(nodes, outcome.changes)
      if (c.expect.node) expect(after[outcome.result.nodeId]).toMatchObject(c.expect.node)
      for (const text of c.expect.mentions ?? [])
        expect(JSON.stringify(outcome.result)).toContain(text)
    })
  }
})
