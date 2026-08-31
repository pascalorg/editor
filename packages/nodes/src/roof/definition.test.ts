import { describe, expect, test } from 'bun:test'
import type { HandleDescriptor, RoofNode } from '@pascal-app/core'
import { roofDefinition } from './definition'

function roof(overrides: Partial<RoofNode> = {}): RoofNode {
  return {
    object: 'node',
    id: 'roof_test',
    type: 'roof',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    children: [],
    ...overrides,
  } as RoofNode
}

function handles(node: RoofNode = roof()): HandleDescriptor<RoofNode>[] {
  const descriptors = roofDefinition.handles
  return (
    typeof descriptors === 'function' ? descriptors(node, undefined as never) : descriptors
  ) as HandleDescriptor<RoofNode>[]
}

describe('roof handles', () => {
  test('hides direct move handle for managed lean-to roofs', () => {
    expect(handles(roof()).length).toBeGreaterThan(0)
    expect(
      handles(
        roof({
          metadata: {
            managedByLeanTo: 'lean_to_test',
            leanToRole: 'roof',
          },
        }),
      ),
    ).toEqual([])
  })
})
