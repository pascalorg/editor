import type { ItemNode } from '@pascal-app/core'
import { create } from 'zustand'

type NavigationDraftState = {
  robotCopySourceIds: Partial<Record<ItemNode['id'], ItemNode['id']>>
  setRobotCopySourceId: (draftId: ItemNode['id'], sourceId: ItemNode['id'] | null) => void
}

const useNavigationDraftState = create<NavigationDraftState>((set) => ({
  robotCopySourceIds: {},
  setRobotCopySourceId: (draftId, sourceId) =>
    set((state) => {
      const currentSourceId = state.robotCopySourceIds[draftId] ?? null
      if (currentSourceId === sourceId) {
        return state
      }

      const robotCopySourceIds = { ...state.robotCopySourceIds }
      if (sourceId === null) {
        delete robotCopySourceIds[draftId]
      } else {
        robotCopySourceIds[draftId] = sourceId
      }

      return { robotCopySourceIds }
    }),
}))

export function getNavigationDraftRobotCopySourceId(
  draftId: ItemNode['id'] | null | undefined,
): ItemNode['id'] | null {
  if (!draftId) {
    return null
  }

  return useNavigationDraftState.getState().robotCopySourceIds[draftId] ?? null
}

export function getNavigationDraftRobotCopySourceIdFromNode(
  draft: Pick<ItemNode, 'id' | 'metadata'> | null | undefined,
): ItemNode['id'] | null {
  if (!draft) {
    return null
  }

  const stateSourceId = getNavigationDraftRobotCopySourceId(draft.id)
  if (stateSourceId) {
    return stateSourceId
  }

  const metadata =
    typeof draft.metadata === 'object' && draft.metadata !== null
      ? (draft.metadata as Record<string, unknown>)
      : null
  const metadataSourceId = metadata?.robotCopySourceId
  return typeof metadataSourceId === 'string' ? (metadataSourceId as ItemNode['id']) : null
}

export function setNavigationDraftRobotCopySourceId(
  draftId: ItemNode['id'],
  sourceId: ItemNode['id'] | null,
) {
  useNavigationDraftState.getState().setRobotCopySourceId(draftId, sourceId)
}

export default useNavigationDraftState
