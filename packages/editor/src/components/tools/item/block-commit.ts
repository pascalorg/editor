import type { BlockEvent, ItemNode } from '@pascal-app/core'
import { stripTransient } from './placement-math'
import { blockFaceStrategy } from './placement-strategies'
import type { CommitResult, PlacementContext } from './placement-types'

export type BlockClickCommitOutcome = {
  committedId: string | null
  wasAdopted: boolean
}

export function commitBlockClick({
  commitDraft,
  enterBlockFace,
  event,
  getContext,
}: {
  commitDraft: (nodeUpdate: Partial<ItemNode>) => BlockClickCommitOutcome
  enterBlockFace: (event: BlockEvent) => boolean
  event: BlockEvent
  getContext: () => PlacementContext
}): BlockClickCommitOutcome | null {
  let result = blockFaceStrategy.click(getContext(), event)
  if (!result && enterBlockFace(event)) {
    result = blockFaceStrategy.click(getContext(), event)
  }
  if (!result) return null
  const outcome = commitDraft(result.nodeUpdate)
  event.stopPropagation()
  return outcome
}

export function resolveBlockPreviewCommit(context: PlacementContext): CommitResult | null {
  const { draftItem, gridPosition, state } = context
  if (state.surface !== 'block-face' || !state.blockId || !draftItem?.blockFaceId) {
    return null
  }

  return {
    nodeUpdate: {
      position: [gridPosition.x, gridPosition.y, gridPosition.z],
      parentId: state.blockId,
      blockFaceId: draftItem.blockFaceId,
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
