import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type ConstructionDrawingType,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { z } from 'zod'
import { resolveNodeForDrawingType } from './drawing-coordination'
import { FLOORPLAN_NODE_EXTENSION_KEY } from './floorplan-extension'

describe('resolveNodeForDrawingType', () => {
  afterEach(() => nodeRegistry._reset())

  test('dispatches drawing coordination through the registered extension', () => {
    const node = {
      id: 'drawing-test_main',
      type: 'drawing-test',
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
    } as unknown as AnyNode
    registerNode({
      kind: 'drawing-test',
      schemaVersion: 1,
      schema: z.object({ type: z.literal('drawing-test') }) as never,
      category: 'utility',
      defaults: () => ({}) as never,
      extensions: {
        [FLOORPLAN_NODE_EXTENSION_KEY]: {
          resolveForDrawing: ({ drawingType }: { drawingType: ConstructionDrawingType }) =>
            drawingType === 'floor-plan' ? null : node,
        },
      },
    } as never)

    expect(resolveNodeForDrawingType(node, { [node.id]: node }, 'floor-plan')).toBeNull()
    expect(resolveNodeForDrawingType(node, { [node.id]: node }, 'foundation-plan')).toBe(node)
  })

  test('leaves nodes without a drawing extension unchanged', () => {
    const node = { id: 'unknown', type: 'unknown' } as unknown as AnyNode
    expect(resolveNodeForDrawingType(node, { [node.id]: node }, 'floor-plan')).toBe(node)
  })
})
