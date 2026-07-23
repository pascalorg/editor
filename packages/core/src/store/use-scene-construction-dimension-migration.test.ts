import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import useScene from './use-scene'

describe('scene construction-dimension migrations', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  test('normalizes the legacy reference presentation before parsing', () => {
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
          children: ['construction-dimension_test'],
          level: 0,
        },
        'construction-dimension_test': {
          object: 'node',
          id: 'construction-dimension_test',
          type: 'construction-dimension',
          parentId: 'level_test',
          visible: true,
          metadata: {},
          reference: true,
          referenceStyle: 'suffix',
          drawingOverrides: [{ drawingType: 'roof-plan', presentation: 'reference' }],
        },
      } as unknown as Record<string, AnyNode>,
      ['site_test'] as never,
    )

    const dimension = useScene.getState().nodes['construction-dimension_test'] as AnyNode &
      Record<string, unknown>
    expect(dimension.reference).toBeUndefined()
    expect(dimension.referenceStyle).toBeUndefined()
    expect(dimension.drawingOverrides).toEqual([
      { drawingType: 'roof-plan', presentation: 'shown' },
    ])
  })
})
