import { describe, expect, test } from 'bun:test'
import { type AgentRefusal, isAgentRefusal } from '../agent-tools/refusal'
import { addDoorTool, addWindowTool } from '../agent-tools/wall-openings'
import { openingScene, WALL_OPENING_CASES } from './__fixtures__/wall-opening-cases'
import { planWallOpening } from './wall-openings'

// Layer 1 of 3: the operation both agent surfaces call. The cases are the spec.
describe('planWallOpening', () => {
  for (const c of WALL_OPENING_CASES) {
    test(c.name, () => {
      const { nodes } = openingScene()
      const input = { kind: c.tool === 'add_door' ? 'door' : 'window', ...c.input } as never
      if ('refusal' in c.expect) {
        let error: unknown
        try {
          planWallOpening(nodes, input)
        } catch (thrown) {
          error = thrown
        }
        expect(isAgentRefusal(error)).toBe(true)
        expect((error as AgentRefusal).code).toBe(c.expect.refusal)
        for (const text of c.expect.mentions ?? []) expect((error as Error).message).toContain(text)
        return
      }
      const planned = planWallOpening(nodes, input)
      expect(planned.localX).toBeCloseTo(c.expect.localX, 6)
      expect(planned.node.position[0]).toBeCloseTo(c.expect.localX, 6)
      expect(planned.node.position[1]).toBeCloseTo(c.expect.centerY, 6)
      expect(planned.clamped).toBe(c.expect.clamped)
      if (c.expect.glassPanels) expect(JSON.stringify(planned.node)).toContain('"glass"')
      if (c.expect.node) expect(planned.node).toMatchObject(c.expect.node)
    })
  }
})

// Run 3 (2026-10-05) wrote the front door's three glass strips off as "not possible": both tools
// take code, and their descriptions stopped at outline, type and style (L52).
describe('where an opening beyond the fields is made', () => {
  test('add_door and add_window say what outline, type and style cannot express goes in code', () => {
    for (const tool of [addDoorTool, addWindowTool]) {
      expect(tool.description).toContain('code')
      expect(tool.description).toContain('glass strips')
    }
  })
})
