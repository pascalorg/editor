import { type AnyNodeId, ItemNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useMemo, useRef } from 'react'
import type { Vector3 } from 'three'
import type { AssetInput } from '@pascal-app/core'
import { stripTransient } from './placement-math'

interface OriginalState {
  position: [number, number, number]
  rotation: [number, number, number]
  side: ItemNode['side']
  parentId: string | null
  metadata: ItemNode['metadata']
}

export interface DraftNodeHandle {
  /** Current draft item, or null */
  readonly current: ItemNode | null
  /** Whether the current draft was adopted (move mode) vs created (create mode) */
  readonly isAdopted: boolean
  /** Create a new draft item at the given position. Returns the created node or null. */
  create: (gridPosition: Vector3, asset: AssetInput, rotation?: [number, number, number]) => ItemNode | null
  /** Take ownership of an existing scene node as the draft (for move mode). */
  adopt: (node: ItemNode) => void
  /** Commit the current draft. Create mode: delete+recreate. Move mode: update in place. */
  commit: (finalUpdate: Partial<ItemNode>) => string | null
  /** Destroy the current draft. Create mode: delete node. Move mode: restore original state. */
  destroy: () => void
}

/**
 * Hook that manages the lifecycle of a transient (draft) item node.
 * Handles temporal pause/resume for undo/redo isolation.
 *
 * Supports two modes:
 * - Create mode (via `create()`): draft is a new transient node. Commit = delete+recreate (undo removes node).
 * - Move mode (via `adopt()`): draft is an existing node. Commit = update in place (undo reverts position).
 */
export function useDraftNode(): DraftNodeHandle {
  const draftRef = useRef<ItemNode | null>(null)
  const adoptedRef = useRef(false)
  const originalStateRef = useRef<OriginalState | null>(null)

  const create = useCallback((gridPosition: Vector3, asset: AssetInput, rotation?: [number, number, number]): ItemNode | null => {
    const currentLevelId = useViewer.getState().selection.levelId
    if (!currentLevelId) return null

    const node = ItemNode.parse({
      position: [gridPosition.x, gridPosition.y, gridPosition.z],
      rotation: rotation ?? [0, 0, 0],
      name: asset.name,
      asset,
      parentId: currentLevelId,
      metadata: { isTransient: true },
    })

    useScene.getState().createNode(node, currentLevelId)
    draftRef.current = node
    adoptedRef.current = false
    originalStateRef.current = null
    return node
  }, [])

  const adopt = useCallback((node: ItemNode): void => {
    // Save original state so destroy() can restore it
    const meta = (typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata))
      ? node.metadata as Record<string, unknown>
      : {}

    originalStateRef.current = {
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      side: node.side,
      parentId: node.parentId,
      metadata: node.metadata,
    }

    draftRef.current = node
    adoptedRef.current = true

    // Mark as transient so it renders as a draft
    useScene.getState().updateNode(node.id, {
      metadata: { ...meta, isTransient: true },
    })
  }, [])

  const commit = useCallback((finalUpdate: Partial<ItemNode>): string | null => {
    const draft = draftRef.current
    if (!draft) return null

    if (adoptedRef.current) {
      // Move mode: update in place (single undoable action)
      const { parentId: newParentId, ...updateProps } = finalUpdate
      const parentId = newParentId ?? originalStateRef.current?.parentId ?? useViewer.getState().selection.levelId
      const original = originalStateRef.current!

      // Restore original state while paused — so the undo baseline is clean
      useScene.getState().updateNode(draft.id, {
        position: original.position,
        rotation: original.rotation,
        side: original.side,
        parentId: original.parentId,
        metadata: original.metadata,
      })

      // Resume → tracked update (undo reverts to original)
      useScene.temporal.getState().resume()

      useScene.getState().updateNode(draft.id, {
        position: updateProps.position ?? draft.position,
        rotation: updateProps.rotation ?? draft.rotation,
        side: updateProps.side ?? draft.side,
        metadata: updateProps.metadata ?? stripTransient(draft.metadata),
        parentId: parentId as string,
      })

      useScene.temporal.getState().pause()

      const id = draft.id
      draftRef.current = null
      adoptedRef.current = false
      originalStateRef.current = null
      return id
    }

    // Create mode: delete draft (paused), resume, create fresh node (tracked), re-pause
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

    adoptedRef.current = false
    originalStateRef.current = null
    return finalNode.id
  }, [])

  const destroy = useCallback(() => {
    if (!draftRef.current) return

    if (adoptedRef.current && originalStateRef.current) {
      // Move mode: restore original state instead of deleting
      const original = originalStateRef.current

      useScene.getState().updateNode(draftRef.current.id, {
        position: original.position,
        rotation: original.rotation,
        side: original.side,
        parentId: original.parentId,
        metadata: original.metadata,
      })
    } else {
      // Create mode: delete the transient node
      useScene.getState().deleteNode(draftRef.current.id)
    }

    draftRef.current = null
    adoptedRef.current = false
    originalStateRef.current = null
  }, [])

  return useMemo(
    () => ({
      get current() {
        return draftRef.current
      },
      get isAdopted() {
        return adoptedRef.current
      },
      create,
      adopt,
      commit,
      destroy,
    }),
    [create, adopt, commit, destroy],
  )
}
