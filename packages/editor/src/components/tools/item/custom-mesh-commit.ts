import type { CustomMeshEvent, ItemNode } from '@pascal-app/core'
import { stripTransient } from './placement-math'
import { customMeshFaceStrategy } from './placement-strategies'
import type { CommitResult, PlacementContext } from './placement-types'

export type CustomMeshClickCommitOutcome = {
  committedId: string | null
  wasAdopted: boolean
}

export function commitCustomMeshClick({
  commitDraft,
  enterCustomMeshFace,
  event,
  getContext,
}: {
  commitDraft: (nodeUpdate: Partial<ItemNode>) => CustomMeshClickCommitOutcome
  enterCustomMeshFace: (event: CustomMeshEvent) => boolean
  event: CustomMeshEvent
  getContext: () => PlacementContext
}): CustomMeshClickCommitOutcome | null {
  let result = customMeshFaceStrategy.click(getContext(), event)
  if (!result && enterCustomMeshFace(event)) {
    result = customMeshFaceStrategy.click(getContext(), event)
  }
  if (!result) return null
  const outcome = commitDraft(result.nodeUpdate)
  event.stopPropagation()
  return outcome
}

export function resolveCustomMeshPreviewCommit(context: PlacementContext): CommitResult | null {
  const { draftItem, gridPosition, state } = context
  if (state.surface !== 'custom-mesh-face' || !state.customMeshId || !draftItem?.customMeshFaceId) {
    return null
  }

  return {
    nodeUpdate: {
      position: [gridPosition.x, gridPosition.y, gridPosition.z],
      parentId: state.customMeshId,
      customMeshFaceId: draftItem.customMeshFaceId,
      roofSegmentId: undefined,
      roofFace: undefined,
      wallId: undefined,
      side: 'front',
      rotation: draftItem.rotation,
      metadata: stripTransient(draftItem.metadata),
    },
    stopPropagation: true,
    dirtyNodeId: null,
  }
}
