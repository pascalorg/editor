import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import useScene from './use-scene'

describe('legacy site child migration', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  test('keeps a flat building subtree referenced by an embedded site child', () => {
    const embeddedBuilding = {
      object: 'node',
      id: 'building_legacy',
      type: 'building',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['level_legacy'],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }

    useScene.getState().setScene(
      {
        site_legacy: {
          object: 'node',
          id: 'site_legacy',
          type: 'site',
          parentId: null,
          visible: true,
          metadata: {},
          children: [embeddedBuilding],
        },
        building_legacy: embeddedBuilding,
        level_legacy: {
          object: 'node',
          id: 'level_legacy',
          type: 'level',
          parentId: null,
          visible: true,
          metadata: {},
          children: ['wall_legacy'],
          level: 0,
        },
        wall_legacy: {
          object: 'node',
          id: 'wall_legacy',
          type: 'wall',
          parentId: 'level_legacy',
          visible: true,
          metadata: {},
          children: [],
          start: [0, 0],
          end: [4, 0],
        },
      } as unknown as Record<string, AnyNode>,
      ['site_legacy'] as never,
    )

    const nodes = useScene.getState().nodes
    expect(Object.keys(nodes).sort()).toEqual([
      'building_legacy',
      'level_legacy',
      'site_legacy',
      'wall_legacy',
    ])
    expect((nodes.site_legacy as { children: string[] }).children).toEqual(['building_legacy'])
  })
})
