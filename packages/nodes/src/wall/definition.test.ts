import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { getFloorplanNodeExtension } from '@pascal-app/editor'
import { wallDefinition } from './definition'

test('wallDefinition records the lean-to child schema migration', () => {
  expect(wallDefinition.schemaVersion).toBe(8)
})

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

test('wall top surface follows the effective level-bound height', () => {
  const level = {
    object: 'node',
    id: 'level_test',
    type: 'level',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    level: 0,
    height: 3.2,
  } as AnyNode
  const wall = wallDefinition.schema.parse({
    id: 'wall_test',
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
  })
  const nodes = { [level.id]: level, [wall.id]: wall }
  const height = wallDefinition.capabilities.surfaces?.top?.height

  expect(typeof height).toBe('function')
  expect(typeof height === 'function' ? height(wall, { nodes }) : height).toBe(3.2)
})
