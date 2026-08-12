import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  GROUND_SUPPORT_ID,
  type SlabNode,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'
import { createFenceOnCurrentLevel } from './fence-drafting'

const LEVEL_ID = 'level_test' as AnyNodeId

function seedLevel(extraNodes: AnyNode[] = []) {
  useScene.setState({
    nodes: Object.fromEntries([
      [
        LEVEL_ID,
        {
          id: LEVEL_ID,
          type: 'level',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: extraNodes.map((node) => node.id),
          level: 0,
        } as AnyNode,
      ],
      ...extraNodes.map((node) => [node.id, node] as const),
    ]),
    rootNodeIds: [LEVEL_ID],
    dirtyNodes: new Set(),
    collections: {},
  } as never)
}

describe('createFenceOnCurrentLevel', () => {
  beforeEach(() => {
    spatialGridManager.clear()
    useViewer.setState({
      selection: {
        buildingId: null,
        levelId: LEVEL_ID,
        zoneId: null,
        selectedIds: [],
      },
    } as never)
    useEditor.getState().setToolDefaults('fence', null)
    seedLevel()
  })

  test('freezes a custom-mesh top above its underlying slab', () => {
    const slab = {
      id: 'slab_low',
      type: 'slab',
      object: 'node',
      parentId: LEVEL_ID,
      visible: true,
      metadata: {},
      children: [],
      polygon: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
      holes: [],
      holeMetadata: [],
      elevation: 0.25,
      thickness: 0.25,
      recessed: false,
      autoFromWalls: false,
    } as SlabNode
    seedLevel([slab as AnyNode])
    spatialGridManager.handleNodeCreated(slab as AnyNode, LEVEL_ID)

    const fence = createFenceOnCurrentLevel([-1, 0], [1, 0], {
      supportCap: 2,
      preferredSupportSlabId: slab.id,
      constructionElevation: 2,
    })

    expect(fence?.supportSlabId).toBe(slab.id)
    expect(fence?.supportOffset).toBeCloseTo(1.75)
  })

  test('pins ground beneath a custom-mesh top when no slab exists', () => {
    const fence = createFenceOnCurrentLevel([-1, 0], [1, 0], {
      supportCap: 2,
      preferredSupportSlabId: null,
      constructionElevation: 2,
    })

    expect(fence?.supportSlabId).toBe(GROUND_SUPPORT_ID)
    expect(fence?.supportOffset).toBeCloseTo(2)
  })
})
