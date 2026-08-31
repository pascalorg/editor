import {
  type AnyNode,
  type AnyNodeId,
  type StairNode,
  type StairSegmentNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import { commitFreshPlacementSubtree, createFreshPlacementSubtree } from './fresh-planar-placement'

type DuplicateStairOptions = {
  mode?: 'select' | 'move'
  offset?: [number, number, number]
  parentId?: AnyNodeId
}

type DuplicateStairResult = {
  stair: StairNode
  segmentIds: StairSegmentNode['id'][]
}

/**
 * Duplicates a stair through the shared fresh-subtree placement path.
 *
 * The draft passed to the move tool is the exact node stored in the scene,
 * so its geometry, descendants, selection identity, and eventual commit all
 * use one fresh ID graph.
 */
export function duplicateStairSubtree(
  sourceStairId: AnyNodeId,
  options: DuplicateStairOptions = {},
): DuplicateStairResult {
  const { mode = 'move', offset = [1, 0, 1], parentId: explicitParentId } = options
  const sourceStair = useScene.getState().nodes[sourceStairId]

  if (sourceStair?.type !== 'stair') {
    throw new Error(`Node "${sourceStairId}" is not a stair`)
  }

  const parentId = explicitParentId ?? (sourceStair.parentId as AnyNodeId | null)
  if (!parentId) {
    throw new Error(`Stair "${sourceStairId}" is missing a parent level`)
  }

  const temporal = useScene.temporal.getState()
  const wasTracking = (temporal as { isTracking?: boolean }).isTracking !== false
  if (wasTracking) temporal.pause()

  let draftId: AnyNodeId | null = null
  try {
    draftId = createFreshPlacementSubtree(sourceStairId, {
      parentId,
      position: [
        sourceStair.position[0] + offset[0],
        sourceStair.position[1] + offset[1],
        sourceStair.position[2] + offset[2],
      ],
    } as Partial<AnyNode>)
    const draft = draftId ? useScene.getState().nodes[draftId] : null
    if (draft?.type !== 'stair') {
      throw new Error(`Duplicated stair "${sourceStairId}" was not created`)
    }

    if (mode === 'select') {
      const committedId = commitFreshPlacementSubtree(draft.id as AnyNodeId, {})
      const committed = committedId ? useScene.getState().nodes[committedId] : null
      if (committed?.type !== 'stair') {
        throw new Error(`Duplicated stair "${sourceStairId}" could not be committed`)
      }
      if (wasTracking) temporal.resume()
      useViewer.getState().setSelection({ selectedIds: [committed.id] })
      return {
        stair: committed,
        segmentIds: stairSegmentIds(committed),
      }
    }

    useViewer.getState().setSelection({ selectedIds: [] })
    useEditor.getState().setMovingNode(draft)
    return {
      stair: draft,
      segmentIds: stairSegmentIds(draft),
    }
  } catch (error) {
    if (draftId && useScene.getState().nodes[draftId]) {
      useScene.getState().deleteNode(draftId)
    }
    if (wasTracking) temporal.resume()
    throw error
  }
}

function stairSegmentIds(stair: StairNode): StairSegmentNode['id'][] {
  return (stair.children ?? []).filter((childId): childId is StairSegmentNode['id'] => {
    return useScene.getState().nodes[childId as AnyNodeId]?.type === 'stair-segment'
  })
}
