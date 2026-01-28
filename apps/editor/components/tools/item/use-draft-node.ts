import { type AnyNodeId, ItemNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useMemo, useRef } from 'react'
import type { Vector3 } from 'three'
import type { Asset } from '../../../../../packages/core/src/schema/nodes/item'
import { stripTransient } from './placement-math'

export interface DraftNodeHandle {
  /** Current draft item, or null */
  readonly current: ItemNode | null
  /** Create a new draft item at the given position. Returns the created node or null. */
  create: (gridPosition: Vector3, asset: Asset) => ItemNode | null
  /** Commit the current draft: delete draft (paused), resume, create fresh node (tracked), re-pause. */
  commit: (finalUpdate: Partial<ItemNode>) => string | null
  /** Destroy the current draft: delete node (stays paused, no undo entry). */
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

    const node = ItemNode.parse({
      position: [gridPosition.x, gridPosition.y, gridPosition.z],
      name: asset.name,
      asset,
      metadata: { isTransient: true },
    })
    console.log('create node', node)

    useScene.getState().createNode(node, currentLevelId)
    draftRef.current = node
    return node
  }, [])

  const commit = useCallback((finalUpdate: Partial<ItemNode>): string | null => {
    const draft = draftRef.current
    if (!draft) return null

    const { parentId: newParentId, ...updateProps } = finalUpdate
    const parentId = (newParentId ?? useViewer.getState().selection.levelId) as AnyNodeId
    if (!parentId) return null

    // Delete draft while paused (invisible to undo)
    useScene.getState().deleteNode(draft.id)
    draftRef.current = null

    // Briefly resume → create fresh node (the single undoable action)
    useScene.temporal.getState().resume()

    const finalNode = ItemNode.parse({
      name: draft.name,
      asset: draft.asset,
      position: updateProps.position ?? draft.position,
      rotation: updateProps.rotation ?? draft.rotation,
      side: updateProps.side ?? draft.side,
      metadata: updateProps.metadata ?? stripTransient(draft.metadata),
    })
    useScene.getState().createNode(finalNode, parentId)

    // Re-pause for next draft cycle
    useScene.temporal.getState().pause()

    return finalNode.id
  }, [])

  const destroy = useCallback(() => {
    if (draftRef.current) {
      useScene.getState().deleteNode(draftRef.current.id)
      draftRef.current = null
    }
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
