import type { ItemNode, NodeEvent } from '@pascal-app/core'
import { nodeRegistry, useScene } from '@pascal-app/core'
import { stripTransient } from './placement-math'
import { faceHostStrategy } from './placement-strategies'
import type { CommitResult, PlacementContext } from './placement-types'

export type FaceHostClickCommitOutcome = {
  committedId: string | null
  wasAdopted: boolean
}

export function commitFaceHostClick({
  commitDraft,
  enterFaceHost,
  event,
  getContext,
}: {
  commitDraft: (nodeUpdate: Partial<ItemNode>) => FaceHostClickCommitOutcome
  enterFaceHost: (event: NodeEvent) => boolean
  event: NodeEvent
  getContext: () => PlacementContext
}): FaceHostClickCommitOutcome | null {
  let result = faceHostStrategy.click(getContext(), event)
  if (!result && enterFaceHost(event)) {
    result = faceHostStrategy.click(getContext(), event)
  }
  if (!result) return null
  const outcome = commitDraft(result.nodeUpdate)
  event.stopPropagation()
  return outcome
}

export function resolveFaceHostPreviewCommit(context: PlacementContext): CommitResult | null {
  const { draftItem, gridPosition, state } = context
  if (state.surface !== 'block-face' || !state.blockId || !draftItem) {
    return null
  }
  const host = useScene.getState().nodes[state.blockId]
  const faceHost = host ? nodeRegistry.get(host.type)?.capabilities.faceHost : undefined
  if (!(host && faceHost)) return null
  const nodeUpdate = faceHost?.storedPlacementPatch({
    host,
    item: draftItem,
    position: [gridPosition.x, gridPosition.y, gridPosition.z],
  })
  if (!nodeUpdate) return null

  return {
    nodeUpdate: {
      ...nodeUpdate,
      metadata: stripTransient(draftItem.metadata),
    },
    stopPropagation: true,
    dirtyNodeId: null,
  }
}
