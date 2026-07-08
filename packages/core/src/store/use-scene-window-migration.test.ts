import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import useScene from './use-scene'

describe('scene window migrations', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  test('fills schema defaults on windows saved before a field existed', () => {
    // Mirrors real legacy scenes (e.g. windows persisted without
    // columnRatios/rowRatios/frameThickness): the mesh builder reads those
    // unconditionally, so a missing array crashed the viewer every frame.
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
          children: ['wall_test'],
          level: 0,
        },
        wall_test: {
          object: 'node',
          id: 'wall_test',
          type: 'wall',
          parentId: 'level_test',
          visible: true,
          metadata: {},
          children: ['window_test'],
          start: [0, 0],
          end: [4, 0],
          height: 2.5,
          thickness: 0.2,
        },
        window_test: {
          object: 'node',
          id: 'window_test',
          type: 'window',
          parentId: 'wall_test',
          visible: true,
          metadata: {},
          wallId: 'wall_test',
          position: [1, 1, 0],
          width: 1.2,
          height: 1.5,
          windowType: 'fixed',
        },
      } as unknown as Record<string, AnyNode>,
      ['site_test'] as never,
    )

    const window = useScene.getState().nodes.window_test as Extract<AnyNode, { type: 'window' }>
    expect(window).toBeDefined()
    // Schema defaults land on load…
    expect(window.columnRatios).toEqual([1])
    expect(window.rowRatios).toEqual([1])
    expect(window.frameThickness).toBe(0.05)
    expect(window.sill).toBe(true)
    // …and authored fields survive.
    expect(window.width).toBe(1.2)
    expect(window.height).toBe(1.5)
    expect(window.wallId).toBe('wall_test')
  })
})
