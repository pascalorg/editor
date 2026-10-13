import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { addObjectTool } from '../agent-tools'
import { type AgentRefusal, isAgentRefusal } from '../agent-tools/refusal'
import { type AnyNode, DoorNode, LevelNode, WallNode } from '../schema'
import { ADD_OBJECT_CASES, compiledUnmeasured } from './__fixtures__/add-object-cases'
import { addColumn, addObject, addWallOpening, applySceneChanges, rescriptOpening } from './index'

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

// The compile's bounds are the size of everything a script builds: a door, a window or a column
// whose bounds are not numbers is refused with the object's own code, not built with a NaN width.
describe('a scripted door, window or column that cannot be measured', () => {
  const wall = WallNode.parse({
    id: 'wall_south',
    parentId: 'level_0',
    start: [0, 0],
    end: [6, 0],
    height: 3,
  })
  const door = DoorNode.parse({
    id: 'door_south',
    parentId: wall.id,
    wallId: wall.id,
    position: [3, 1.05, 0],
  })
  const level = LevelNode.parse({ id: 'level_0', level: 0, height: 3, children: [wall.id] })
  const nodes = Object.fromEntries([level, wall, door].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
  const context = { activeLevelId: level.id }

  function refusedWith(run: () => unknown) {
    let error: unknown
    try {
      run()
    } catch (thrown) {
      error = thrown
    }
    expect(isAgentRefusal(error)).toBe(true)
    return error as AgentRefusal
  }

  for (const hop of ['clone', 'json'] as const) {
    test(`a new door or window built from bounds that are ${hop === 'json' ? 'null' : 'NaN'}`, () => {
      for (const kind of ['door', 'window'] as const) {
        const refusal = refusedWith(() =>
          addWallOpening(nodes, {
            kind,
            wallId: wall.id,
            t: 0.5,
            compiled: compiledUnmeasured(hop, 'wall'),
          }),
        )
        expect(refusal.code).toBe('unmeasurable_object')
        expect(refusal.message).toContain(`call add_${kind} again`)
        expect(refusal.message).toContain('nothing was added')
      }
    })

    test(`a door rebuilt from bounds that are ${hop === 'json' ? 'null' : 'NaN'} stays as it was`, () => {
      const refusal = refusedWith(() =>
        rescriptOpening(
          nodes,
          { nodeId: door.id, compiled: compiledUnmeasured(hop, 'wall') },
          context,
        ),
      )
      expect(refusal.code).toBe('unmeasurable_object')
      expect(refusal.message).toContain('nothing was changed')
    })

    test(`a column built from bounds that are ${hop === 'json' ? 'null' : 'NaN'}`, () => {
      const refusal = refusedWith(() =>
        addColumn(nodes, { x: 2, z: 2, compiled: compiledUnmeasured(hop) } as never, context),
      )
      expect(refusal.code).toBe('unmeasurable_object')
      expect(refusal.message).toContain('call add_column again')
    })
  }
})
