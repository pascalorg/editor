import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import useScene from './use-scene'

describe('scene elevator migrations', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  test('normalizes legacy level-parented elevators into building-scoped nodes', () => {
    useScene.getState().setScene(
      {
        site_test: {
          object: 'node',
          id: 'site_test',
          type: 'site',
          parentId: null,
          visible: true,
          metadata: {},
          children: ['building_test'],
        },
        building_test: {
          object: 'node',
          id: 'building_test',
          type: 'building',
          parentId: 'site_test',
          visible: true,
          metadata: {},
          children: ['level_test'],
        },
        level_test: {
          object: 'node',
          id: 'level_test',
          type: 'level',
          parentId: 'building_test',
          visible: true,
          metadata: {},
          children: ['elevator_test'],
          level: 0,
        },
        elevator_test: {
          object: 'node',
          id: 'elevator_test',
          type: 'elevator',
          parentId: 'level_test',
          visible: true,
          metadata: {},
        },
      } as unknown as Record<string, AnyNode>,
      ['site_test'] as never,
    )

    const nodes = useScene.getState().nodes
    const elevator = nodes.elevator_test as Extract<AnyNode, { type: 'elevator' }>
    const level = nodes.level_test as Extract<AnyNode, { type: 'level' }>
    const building = nodes.building_test as Extract<AnyNode, { type: 'building' }>

    expect(elevator.parentId).toBe('building_test')
    expect(elevator.position).toEqual([0, 0, 0])
    expect(elevator.rotation).toBe(0)
    expect(level.children).not.toContain('elevator_test')
    expect(building.children).toContain('elevator_test')
  })

  test('migrates level-parented elevators when the level parentId is missing', () => {
    useScene.getState().setScene(
      {
        site_test: {
          object: 'node',
          id: 'site_test',
          type: 'site',
          parentId: null,
          visible: true,
          metadata: {},
          children: ['building_test'],
        },
        building_test: {
          object: 'node',
          id: 'building_test',
          type: 'building',
          parentId: 'site_test',
          visible: true,
          metadata: {},
          children: ['level_test'],
        },
        level_test: {
          object: 'node',
          id: 'level_test',
          type: 'level',
          parentId: null,
          visible: true,
          metadata: {},
          children: ['elevator_test'],
          level: 0,
        },
        elevator_test: {
          object: 'node',
          id: 'elevator_test',
          type: 'elevator',
          parentId: 'level_test',
          visible: true,
          metadata: {},
        },
      } as unknown as Record<string, AnyNode>,
      ['site_test'] as never,
    )

    const nodes = useScene.getState().nodes
    const elevator = nodes.elevator_test as Extract<AnyNode, { type: 'elevator' }>
    const level = nodes.level_test as Extract<AnyNode, { type: 'level' }>
    const building = nodes.building_test as Extract<AnyNode, { type: 'building' }>

    expect(elevator.parentId).toBe('building_test')
    expect(level.children).not.toContain('elevator_test')
    expect(building.children).toContain('elevator_test')
  })
})
