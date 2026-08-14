import { describe, expect, test } from 'bun:test'
import { ItemNode, type LevelNode } from '@pascal-app/core'
import { Vector3 } from 'three'
import { resolveCustomMeshPreviewCommit } from './custom-mesh-commit'
import type { PlacementContext } from './placement-types'

const CUSTOM_MESH_ID = 'custom-mesh_self-click'

describe('resolveCustomMeshPreviewCommit', () => {
  test('commits an intercepted draft click to its active custom-mesh face', () => {
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
        parentId: CUSTOM_MESH_ID,
        position: [0.5, -0.5, 0],
        rotation: [Math.PI / 2, 0, 0],
        customMeshFaceId: 'face-top',
        metadata: { isTransient: true },
      }),
      gridPosition: new Vector3(0.5, -0.5, 0),
      state: {
        surface: 'custom-mesh-face',
        customMeshId: CUSTOM_MESH_ID,
        wallId: null,
        roofSegmentId: null,
        ceilingId: null,
        surfaceItemId: null,
        shelfId: null,
      },
      currentCursorRotationY: 0,
    }

    expect(resolveCustomMeshPreviewCommit(context)?.nodeUpdate).toMatchObject({
      parentId: CUSTOM_MESH_ID,
      position: [0.5, -0.5, 0],
      rotation: [Math.PI / 2, 0, 0],
      customMeshFaceId: 'face-top',
      metadata: {},
    })
  })
})
