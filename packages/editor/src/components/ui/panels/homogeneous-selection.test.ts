import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import {
  resolveHomogeneousSelection,
  resolveUniqueSelectionIds,
} from './homogeneous-selection'

function node(
  id: string,
  type: string,
  metadata?: Record<string, unknown>,
): AnyNode {
  return {
    object: 'node',
    id: id as AnyNodeId,
    type,
    parentId: null,
    visible: true,
    metadata: metadata ?? {},
    children: [],
  } as unknown as AnyNode
}

describe('resolveHomogeneousSelection', () => {
  test('mixed selection is null', () => {
    const nodes = {
      wall_a: node('wall_a', 'wall'),
      slab_a: node('slab_a', 'slab'),
    }
    expect(resolveHomogeneousSelection(['wall_a', 'slab_a'], nodes)).toBeNull()
  })

  test('three walls share the wall type', () => {
    const nodes = {
      wall_a: node('wall_a', 'wall'),
      wall_b: node('wall_b', 'wall'),
      wall_c: node('wall_c', 'wall'),
    }
    expect(resolveHomogeneousSelection(['wall_a', 'wall_b', 'wall_c'], nodes)).toBe('wall')
  })

  test('proxy-promoted children resolve to the parent type', () => {
    const nodes = {
      cabinet_run: node('cabinet_run', 'cabinet'),
      'cabinet-module_a': node('cabinet-module_a', 'cabinet-module', {
        nodeSelectionProxyId: 'cabinet_run',
      }),
      'cabinet-module_b': node('cabinet-module_b', 'cabinet-module', {
        nodeSelectionProxyId: 'cabinet_run',
      }),
      'cabinet-module_c': node('cabinet-module_c', 'cabinet-module', {
        nodeSelectionProxyId: 'cabinet_run',
      }),
      cabinet_run_b: node('cabinet_run_b', 'cabinet'),
      'cabinet-module_d': node('cabinet-module_d', 'cabinet-module', {
        nodeSelectionProxyId: 'cabinet_run_b',
      }),
    }
    expect(resolveHomogeneousSelection(['cabinet-module_a', 'cabinet-module_d'], nodes)).toBe(
      'cabinet',
    )
    expect(resolveUniqueSelectionIds(['cabinet-module_a', 'cabinet-module_b', 'cabinet-module_c'], nodes)).toEqual(
      ['cabinet_run'],
    )
    expect(resolveHomogeneousSelection(['cabinet-module_a', 'cabinet-module_b'], nodes)).toBeNull()
  })

  test('stale ids are skipped without breaking a homogeneous remainder', () => {
    const nodes = {
      wall_a: node('wall_a', 'wall'),
      wall_b: node('wall_b', 'wall'),
    }
    expect(resolveHomogeneousSelection(['wall_a', 'gone', 'wall_b'], nodes)).toBe('wall')
  })

  test('a single live node after skips is not homogeneous', () => {
    const nodes = { wall_a: node('wall_a', 'wall') }
    expect(resolveHomogeneousSelection(['wall_a', 'gone'], nodes)).toBeNull()
  })
})
