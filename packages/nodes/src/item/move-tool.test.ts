import { describe, expect, test } from 'bun:test'
import type { AnyNode, ItemNode } from '@pascal-app/core'
import { getInitialState } from './move-tool'

describe('getInitialState', () => {
  test('keeps a floor item hosted on its block face when moving it again', () => {
    const node = {
      asset: {},
      blockFaceId: 'face-top',
      parentId: 'block-1',
    } as ItemNode
    const parent = { id: 'block-1', type: 'block' } as AnyNode

    expect(getInitialState(node, parent)).toMatchObject({
      blockId: 'block-1',
      surface: 'block-face',
    })
  })
})
