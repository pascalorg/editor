import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { getFloorplanNodeExtension } from '@pascal-app/editor'
import { wallDefinition } from './definition'

describe('wallDefinition floor-plan extension', () => {
  test('owns curve eligibility for hosted openings', () => {
    const wall = wallDefinition.schema.parse({
      id: 'wall_test',
      children: ['door_test'],
      start: [0, 0],
      end: [4, 0],
    })
    const canCurve = getFloorplanNodeExtension(wallDefinition)?.actionMenu?.canCurve
    const nodes = {
      [wall.id]: wall,
      door_test: {
        object: 'node',
        id: 'door_test',
        type: 'door',
        parentId: wall.id,
        visible: true,
        metadata: {},
      } as AnyNode,
    } as Record<AnyNodeId, AnyNode>

    expect(canCurve?.({ node: wall, nodes })).toBe(false)
    expect(canCurve?.({ node: { ...wall, children: [] }, nodes })).toBe(true)
  })
})
