import { expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core'
import { z } from 'zod'
import { resolveDirectManipulationNode, resolveMoveActionNode } from './direct-manipulation'
import { resolveCanvasSelectionNode } from './selection-routing'

test('independent hosted children remain the selection and move target', () => {
  const restore = nodeRegistry._snapshot()
  try {
    for (const independent of [true, false]) {
      const kind = `hosted-move-${independent}`
      registerNode({
        kind,
        schemaVersion: 1,
        category: 'furnish',
        schema: z.object({ type: z.literal(kind) }),
        defaults: () => ({ type: kind }),
        capabilities: {
          rotatable: { axes: ['y'] },
          movable: {
            axes: ['x', 'z'],
            parentFrame: {
              independent,
              resolveParent: (node, nodes) =>
                node.parentId ? (nodes[node.parentId] ?? null) : null,
              parentRotationY: () => 0,
              localToPlan: (_parent, local) => [...local],
              planToLocal: (_parent, x, y, z) => [x, y, z],
            },
          },
        },
      } as AnyNodeDefinition)
      const parent = { id: 'host', type: kind } as unknown as AnyNode
      const child = { id: 'child', type: kind, parentId: parent.id } as unknown as AnyNode
      const nodes = { [parent.id]: parent, [child.id]: child }
      const expected = independent ? child : parent
      expect(resolveCanvasSelectionNode({ node: child, nodes, selectedIds: [parent.id] })).toBe(
        expected,
      )
      expect(resolveDirectManipulationNode(child, nodes)).toBe(expected)
      expect(resolveMoveActionNode(child, nodes)).toBe(expected)
    }
  } finally {
    restore()
  }
})
