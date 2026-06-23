import { beforeAll, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core'
import { z } from 'zod'
import { classifyParticipant, collectParticipants } from './group-transform-shared'

const BUILDING_SCOPED_KIND = 'group-transform-building-scoped-test'

function registerBuildingScopedTestKind() {
  if (nodeRegistry.has(BUILDING_SCOPED_KIND)) return

  registerNode({
    kind: BUILDING_SCOPED_KIND,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(BUILDING_SCOPED_KIND) }) as never,
    category: 'structure',
    defaults: () => ({}),
    capabilities: {},
    floorplanScope: 'building',
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition)
}

function registerElevatorTestKind() {
  if (nodeRegistry.has('elevator')) return

  registerNode({
    kind: 'elevator',
    schemaVersion: 1,
    schema: z.object({ type: z.literal('elevator') }) as never,
    category: 'structure',
    defaults: () => ({}),
    capabilities: { selectable: {} },
    floorplanScope: 'building',
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition)
}

describe('group transform participants', () => {
  beforeAll(() => {
    registerBuildingScopedTestKind()
    registerElevatorTestKind()
  })

  test('includes building-scoped positioned nodes for the active level building', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test', 'elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: BUILDING_SCOPED_KIND,
        parentId: 'building_test',
        position: [1, 0, 2],
        rotation: 0,
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')

    const participants = collectParticipants(['elevator_test'], nodes, 'level_test')
    expect(participants.starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [1, 0, 2],
        rotation: 0,
      },
    ])
  })

  test('excludes building-scoped positioned nodes from other buildings', () => {
    const nodes = {
      building_active: {
        id: 'building_active',
        type: 'building',
        children: ['level_test'],
      },
      building_other: {
        id: 'building_other',
        type: 'building',
        children: ['elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_active',
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: BUILDING_SCOPED_KIND,
        parentId: 'building_other',
        position: [1, 0, 2],
        rotation: 0,
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBeNull()
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([])
  })

  test('uses current elevator defaults for legacy elevators with no saved rotation', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test', 'elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: 'elevator',
        parentId: 'building_test',
        position: [3, 0, 4],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [3, 0, 4],
        rotation: 0,
      },
    ])
  })

  test('resolves building-scoped elevators when legacy level parentId is missing', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test', 'elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: null,
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: 'elevator',
        parentId: 'building_test',
        position: [7, 0, 8],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [7, 0, 8],
        rotation: 0,
      },
    ])
  })

  test('supports legacy level-parented elevators already loaded in the editor', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: ['elevator_test'],
      },
      elevator_test: {
        id: 'elevator_test',
        type: 'elevator',
        parentId: 'level_test',
        position: [5, 0, 6],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [5, 0, 6],
        rotation: 0,
      },
    ])
  })
})
