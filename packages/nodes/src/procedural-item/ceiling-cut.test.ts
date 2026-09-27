import { afterEach, beforeEach, expect, test } from 'bun:test'
import { type AnyNode, CeilingNode, nodeRegistry, registerNode } from '@pascal-app/core'
import {
  ProceduralItemNode,
  parseRecipe,
  type Recipe,
  shelfRecipe,
} from '@pascal-app/core/procedural-items'
import { proceduralItemDefinition } from './definition'

// A 0.2 m square trim flush with the ceiling and a can recessed 0.1 m above it, inside the cut.
const recessed = parseRecipe({
  version: 2,
  name: 'Recessed can',
  description: 'Trim below the ceiling plane, can above it.',
  mounting: { attachTo: 'ceiling', reference: 'plane' },
  cuts: [{ shape: 'rect', size: [0.16, 0.16] }],
  surfaces: [{ id: 'plane', label: 'Plane', position: [0, 0.01, 0], size: [0.2, 0.2] }],
  parameters: [
    { id: 'depth', label: 'Depth', default: 0.1, min: 0.05, max: 0.2, step: 0.01, unit: 'm' },
  ],
  slots: [{ id: 'trim', label: 'Trim', color: '#ffffff' }],
  parts: [
    {
      id: 'trim',
      label: 'Trim',
      count: 1,
      shapes: [
        {
          id: 'plate',
          primitive: 'box',
          slot: 'trim',
          size: [0.2, 0.01, 0.2],
          position: [0, 0.005, 0],
        },
      ],
    },
    {
      id: 'can',
      label: 'Can',
      count: 1,
      shapes: [
        {
          id: 'body',
          primitive: 'box',
          slot: 'trim',
          size: [0.15, 'depth', 0.15],
          position: [0, { op: 'add', args: [0.01, { op: 'div', args: ['depth', 2] }] }, 0],
        },
      ],
    },
  ],
  constraints: [],
} satisfies Recipe)

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  registerNode(proceduralItemDefinition)
})
afterEach(() => restore())

test('a recessed design publishes its ceiling hole through the registry capability', () => {
  const ceiling = CeilingNode.parse({
    id: 'ceiling_recessed',
    polygon: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ],
  })
  const node = ProceduralItemNode.parse({
    id: 'procedural-item_recessed',
    recipe: recessed,
    parentId: ceiling.id,
    position: [0.5, 0, -0.25],
    rotation: [0, Math.PI / 4, 0],
  })
  const cut = nodeRegistry.get('procedural-item')?.capabilities.ceilingCut
  const ring = cut?.buildCeilingHole(node as unknown as AnyNode)
  expect(ring).toHaveLength(4)
  for (const [x, z] of ring!) expect(Math.hypot(x - 0.5, z + 0.25)).toBeCloseTo(0.08 * Math.SQRT2)
  // A quarter-turn-by-half puts the square's corners on the axes through the node.
  expect(Math.max(...ring!.map(([x]) => x))).toBeCloseTo(0.5 + 0.08 * Math.SQRT2)

  const flush = ProceduralItemNode.parse({ ...node, recipe: shelfRecipe, parentId: null })
  expect(cut?.buildCeilingHole(flush as unknown as AnyNode)).toBe(null)
})
