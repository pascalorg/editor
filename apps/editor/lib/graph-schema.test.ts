import { describe, expect, test } from 'bun:test'
import { warehousePlugin } from '@ovurrsl/plugin-warehouse'
import { AnyNode } from '@pascal-app/core/schema'
import { apiGraphSchema } from './graph-schema'

/**
 * A real node of the given plugin kind, built by the plugin's own schema so
 * the test breaks if the plugin's contract changes rather than drifting.
 */
function pluginNode(kind: string): Record<string, unknown> {
  const def = warehousePlugin.nodes?.find((d) => d.kind === kind)
  if (!def) throw new Error(`plugin does not register ${kind}`)
  // Node ids are branded per kind: the id prefix is the kind's local part
  // verbatim (`pallet-rack_x`), so derive it rather than guess.
  const local = kind.split(':').pop() ?? kind
  const parsed = def.schema.safeParse({
    object: 'node',
    id: `${local}_t1`,
    type: kind,
    name: 'Test node',
    parentId: 'level_1',
  })
  if (!parsed.success) {
    throw new Error(`could not build a valid ${kind}: ${parsed.error.issues[0]?.message}`)
  }
  return parsed.data as Record<string, unknown>
}

function graphWith(node: Record<string, unknown>) {
  return {
    nodes: { [String(node.id)]: node },
    rootNodeIds: [String(node.id)],
  }
}

describe('apiGraphSchema plugin nodes', () => {
  test('a warehouse pallet is NOT part of the host AnyNode union (the 400 bug)', () => {
    expect(AnyNode.safeParse(pluginNode('warehouse:pallet')).success).toBe(false)
  })

  test('accepts every node kind the warehouse plugin registers', () => {
    for (const def of warehousePlugin.nodes ?? []) {
      const result = apiGraphSchema.safeParse(graphWith(pluginNode(def.kind)))
      expect(
        result.success,
        `${def.kind} rejected: ${JSON.stringify(result.error?.issues[0])}`,
      ).toBe(true)
    }
  })

  test('still accepts built-in nodes', () => {
    const wall = {
      object: 'node',
      id: 'wall_1',
      type: 'wall',
      name: 'Wall',
      visible: true,
      thickness: 0.2,
      start: [0, 0],
      end: [1, 0],
    }
    expect(apiGraphSchema.safeParse(graphWith(wall)).success).toBe(true)
  })

  test('still rejects unknown node kinds', () => {
    const bogus = { object: 'node', id: 'x_1', type: 'not-a-kind', name: 'X' }
    expect(apiGraphSchema.safeParse(graphWith(bogus)).success).toBe(false)
  })

  test('still rejects a malformed plugin node', () => {
    const broken = { ...pluginNode('warehouse:pallet'), position: 'not-a-vector' }
    expect(apiGraphSchema.safeParse(graphWith(broken)).success).toBe(false)
  })
})
