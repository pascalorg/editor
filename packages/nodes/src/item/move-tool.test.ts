import { describe, expect, test } from 'bun:test'
import type { AnyNode, ItemNode } from '@pascal-app/core'
import { getInitialState } from './move-tool'

describe('getInitialState', () => {
  test('keeps a floor item hosted on its custom mesh face when moving it again', () => {
    const node = {
      asset: {},
      customMeshFaceId: 'face-top',
      parentId: 'custom-mesh-1',
    } as ItemNode
    const parent = { id: 'custom-mesh-1', type: 'custom-mesh' } as AnyNode

    expect(getInitialState(node, parent)).toMatchObject({
      customMeshId: 'custom-mesh-1',
      surface: 'custom-mesh-face',
    })
  })
})
