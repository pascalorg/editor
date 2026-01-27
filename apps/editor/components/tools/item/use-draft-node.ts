import { useCallback, useMemo, useRef } from 'react'
import { ItemNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { Vector3 } from 'three'
import type { Asset } from '../../../../../packages/core/src/schema/nodes/item'
import { stripTransient } from './placement-math'

export interface DraftNodeHandle {
  /** Current draft item, or null */
  readonly current: ItemNode | null
  /** Create a new draft item at the given position. Returns the created node or null. */
  create: (gridPosition: Vector3, asset: Asset) => ItemNode | null
  /** Commit the current draft: resume temporal, strip transient, update node, clear ref. Returns committed ID. */
  commit: (finalUpdate: Partial<ItemNode>) => string | null
  /** Destroy the current draft: delete node, resume temporal. */
  destroy: () => void
}

/**
 * Hook that manages the lifecycle of a transient (draft) item node.
 * Handles temporal pause/resume for undo/redo isolation.
 */
export function useDraftNode(): DraftNodeHandle {
  const draftRef = useRef<ItemNode | null>(null)

  const create = useCallback((gridPosition: Vector3, asset: Asset): ItemNode | null => {
    const currentLevelId = useViewer.getState().selection.levelId
    if (!currentLevelId) return null

    useScene.temporal.getState().pause()

    const node = ItemNode.parse({
      position: [gridPosition.x, gridPosition.y, gridPosition.z],
      name: asset.name,
      asset,
      metadata: { isTransient: true },
    })

    useScene.getState().createNode(node, currentLevelId)
    draftRef.current = node
    return node
  }, [])

  const commit = useCallback((finalUpdate: Partial<ItemNode>): string | null => {
    const draft = draftRef.current
    if (!draft) return null

    useScene.temporal.getState().resume()

    const update = {
      ...finalUpdate,
      metadata: finalUpdate.metadata ?? stripTransient(draft.metadata),
    }

    useScene.getState().updateNode(draft.id, update)
    const committedId = draft.id
    draftRef.current = null

    return committedId
  }, [])

  const destroy = useCallback(() => {
    if (draftRef.current) {
      useScene.getState().deleteNode(draftRef.current.id)
      draftRef.current = null
    }
    useScene.temporal.getState().resume()
  }, [])

  return useMemo(
    () => ({
      get current() {
        return draftRef.current
      },
      create,
      commit,
      destroy,
    }),
    [create, commit, destroy],
  )
}
