import { describe, expect, test } from 'bun:test'
import { ItemNode, type LevelNode } from '@pascal-app/core'
import { Vector3 } from 'three'
import { resolveBlockPreviewCommit } from './block-commit'
import type { PlacementContext } from './placement-types'

const BLOCK_ID = 'block_self-click'

describe('resolveBlockPreviewCommit', () => {
  test('commits an intercepted draft click to its active block face', () => {
    const asset = {
      id: 'cactus',
      category: 'decor',
      name: 'Cactus',
      thumbnail: '/cactus.png',
      src: '/cactus.glb',
      dimensions: [0.5, 0.39, 0.5] as [number, number, number],
    }
    const context: PlacementContext = {
      asset,
      levelId: 'level_self-click' as LevelNode['id'],
      draftItem: ItemNode.parse({
        id: 'item_self-click',
        asset,
        parentId: BLOCK_ID,
        position: [0.5, -0.5, 0],
        rotation: [Math.PI / 2, 0, 0],
        blockFaceId: 'face-top',
        metadata: { isTransient: true },
      }),
      gridPosition: new Vector3(0.5, -0.5, 0),
      state: {
        surface: 'block-face',
        blockId: BLOCK_ID,
        wallId: null,
        roofSegmentId: null,
        ceilingId: null,
        surfaceItemId: null,
        shelfId: null,
      },
      currentCursorRotationY: 0,
    }

    expect(resolveBlockPreviewCommit(context)?.nodeUpdate).toMatchObject({
      parentId: BLOCK_ID,
      position: [0.5, -0.5, 0],
      rotation: [Math.PI / 2, 0, 0],
      blockFaceId: 'face-top',
      metadata: {},
    })
  })
})
