import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { DuctSegmentNode, LevelNode, nodeRegistry, registerNode } from '@pascal-app/core'
import { ductFittingDefinition } from '../duct-fitting/definition'
import * as autoFitting from '../shared/auto-fitting'
import { ductSegmentDefinition } from './definition'
import { editDuct } from './edit-operation'

let restore: ReturnType<typeof nodeRegistry._snapshot>
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  registerNode(ductSegmentDefinition)
  registerNode(ductFittingDefinition)
})
afterEach(() => restore())

const level = LevelNode.parse({})
const duct = DuctSegmentNode.parse({
  parentId: level.id,
  shape: 'round',
  diameter: 6,
  path: [
    [0, 0, 0],
    [6, 0, 0],
  ],
})
const offset = { nodeId: duct.id, action: 'offset' as const, from: 1, to: 4, offset: 1 }

test('an obstacle offset whose bends cannot be planned refuses without partial edits', () => {
  const nodes = { [level.id]: level, [duct.id]: duct }
  const before = JSON.stringify(nodes)
  const plan = spyOn(autoFitting, 'planElbowAtPort').mockReturnValue(null)
  let error: unknown
  let planned = 0
  try {
    editDuct(nodes, offset)
  } catch (caught) {
    error = caught
  } finally {
    planned = plan.mock.calls.length
    plan.mockRestore()
  }
  expect(planned).toBeGreaterThan(0)
  expect(error).toMatchObject({ name: 'AgentRefusal', code: 'duct_offset_angle' })
  expect(JSON.stringify(nodes)).toBe(before)
  expect(() => editDuct(nodes, offset)).not.toThrow()
})
