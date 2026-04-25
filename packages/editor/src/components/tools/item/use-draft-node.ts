import {
  type AnyNodeId,
  type AssetInput,
  ItemNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useMemo, useRef } from 'react'
import type { Vector3 } from 'three'
import { PASCAL_TRUCK_ITEM_NODE_ID } from '../../../lib/pascal-truck'
import { stripTransient } from './placement-math'

interface OriginalState {
  id: AnyNodeId
  name?: string
  position: [number, number, number]
  rotation: [number, number, number]
  side: ItemNode['side']
  parentId: string | null
  metadata: ItemNode['metadata']
  scale: [number, number, number]
  visible: boolean
}

type DraftMode = 'adopt' | 'clone' | 'create'

type DraftNodeOptions = {
  id?: ItemNode['id']
}

function withManualPascalTruckPlacement(
  nodeId: string,
  metadata: ItemNode['metadata'],
): ItemNode['metadata'] {
  if (nodeId !== PASCAL_TRUCK_ITEM_NODE_ID) {
    return metadata
  }

  const nextMetadata =
    typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {}
  nextMetadata.manualPlacement = true
  return nextMetadata as ItemNode['metadata']
}

export interface DraftNodeHandle {
  /** Current draft item, or null */
  readonly current: ItemNode | null
  /** Whether the current draft was adopted (move mode) vs created (create mode) */
  readonly isAdopted: boolean
  /** Current draft lifecycle mode. */
  readonly mode: DraftMode | null
  /** Create a new draft item at the given position. Returns the created node or null. */
  create: (
    gridPosition: Vector3,
    asset: AssetInput,
    rotation?: [number, number, number],
    scale?: [number, number, number],
    options?: DraftNodeOptions,
  ) => ItemNode | null
  /** Take ownership of an existing scene node as the draft (for move mode). */
  adopt: (node: ItemNode) => void
  /** Create a transient preview clone while keeping the source item in place. */
  preview: (node: ItemNode, options?: DraftNodeOptions) => ItemNode | null
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
  const modeRef = useRef<DraftMode | null>(null)
  const originalStateRef = useRef<OriginalState | null>(null)

  const create = useCallback(
    (
      gridPosition: Vector3,
      asset: AssetInput,
      rotation?: [number, number, number],
      scale?: [number, number, number],
      options?: DraftNodeOptions,
    ): ItemNode | null => {
      const currentLevelId = useViewer.getState().selection.levelId
      if (!currentLevelId) return null

      const node = ItemNode.parse({
        id: options?.id,
        position: [gridPosition.x, gridPosition.y, gridPosition.z],
        rotation: rotation ?? [0, 0, 0],
        scale: scale ?? [1, 1, 1],
        name: asset.name,
        asset,
        parentId: currentLevelId,
        metadata: { isTransient: true },
      })

      useScene.getState().createNode(node, currentLevelId)
      draftRef.current = node
      modeRef.current = 'create'
      originalStateRef.current = null
      return node
    },
    [],
  )

  const adopt = useCallback((node: ItemNode): void => {
    // Save original state so destroy() can restore it
    const meta =
      typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
        ? (node.metadata as Record<string, unknown>)
        : {}

    originalStateRef.current = {
      id: node.id as AnyNodeId,
      name: node.name,
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      side: node.side,
      parentId: node.parentId,
      metadata: node.metadata,
      scale: [...node.scale] as [number, number, number],
      visible: node.visible ?? true,
    }

    draftRef.current = node
    modeRef.current = 'adopt'

    // Mark as transient so it renders as a draft
    useScene.getState().updateNode(node.id, {
      metadata: { ...meta, isTransient: true },
    })
  }, [])

  const preview = useCallback((node: ItemNode, options?: DraftNodeOptions): ItemNode | null => {
    const meta =
      typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
        ? (node.metadata as Record<string, unknown>)
        : {}

    originalStateRef.current = {
      id: node.id as AnyNodeId,
      name: node.name,
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      side: node.side,
      parentId: node.parentId,
      metadata: node.metadata,
      scale: [...node.scale] as [number, number, number],
      visible: node.visible ?? true,
    }

    const previewNode = ItemNode.parse({
      id: options?.id,
      name: node.name,
      asset: node.asset,
      metadata: { ...meta, isTransient: true },
      parentId: node.parentId,
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      scale: [...node.scale] as [number, number, number],
      side: node.side,
      visible: true,
    })

    if (previewNode.parentId) {
      useScene.getState().createNode(previewNode, previewNode.parentId as AnyNodeId)
    }

    draftRef.current = previewNode
    modeRef.current = 'clone'
    return previewNode
  }, [])

  const commit = useCallback((finalUpdate: Partial<ItemNode>): string | null => {
    const draft = draftRef.current
    if (!draft) return null

    if (modeRef.current === 'adopt') {
      // Move mode: update in place (single undoable action)
      const { parentId: newParentId, ...updateProps } = finalUpdate
      const parentId =
        newParentId ?? originalStateRef.current?.parentId ?? useViewer.getState().selection.levelId
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
        metadata: withManualPascalTruckPlacement(
          draft.id,
          (updateProps.metadata ?? stripTransient(draft.metadata)) as ItemNode['metadata'],
        ),
        parentId: parentId as string,
      })

      useScene.temporal.getState().pause()

      const id = draft.id
      draftRef.current = null
      modeRef.current = null
      originalStateRef.current = null
      return id
    }

    if (modeRef.current === 'clone') {
      const { parentId: newParentId, ...updateProps } = finalUpdate
      const original = originalStateRef.current
      if (!original) {
        return null
      }

      const parentId = newParentId ?? original.parentId ?? useViewer.getState().selection.levelId

      draftRef.current = null

      useScene.temporal.getState().resume()

      if (draft.id in useScene.getState().nodes) {
        useScene.getState().deleteNode(draft.id)
      }

      useScene.getState().updateNode(original.id, {
        metadata: withManualPascalTruckPlacement(
          original.id,
          (updateProps.metadata ?? original.metadata) as ItemNode['metadata'],
        ),
        parentId: parentId as string,
        position: updateProps.position ?? original.position,
        rotation: updateProps.rotation ?? original.rotation,
        side: updateProps.side ?? original.side,
        visible: true,
      })

      useScene.temporal.getState().pause()

      modeRef.current = null
      originalStateRef.current = null
      return original.id
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
      metadata: withManualPascalTruckPlacement(
        draft.id,
        (updateProps.metadata ?? stripTransient(draft.metadata)) as ItemNode['metadata'],
      ),
    })
    useScene.getState().createNode(finalNode, parentId)

    // Re-pause for next draft cycle
    useScene.temporal.getState().pause()

    modeRef.current = null
    originalStateRef.current = null
    return finalNode.id
  }, [])

  const destroy = useCallback(() => {
    if (!draftRef.current) return

    if (modeRef.current === 'adopt' && originalStateRef.current) {
      // Move mode: restore original state instead of deleting
      const original = originalStateRef.current
      const id = draftRef.current.id

      useScene.getState().updateNode(id, {
        position: original.position,
        rotation: original.rotation,
        side: original.side,
        parentId: original.parentId,
        metadata: original.metadata,
      })

      // Also reset the Three.js mesh directly — the store update triggers a React
      // re-render but the mesh position was mutated by useFrame and may not reset
      // until the next render cycle, leaving a visual glitch.
      const mesh = sceneRegistry.nodes.get(id as AnyNodeId)
      if (mesh) {
        mesh.position.set(original.position[0], original.position[1], original.position[2])
        mesh.rotation.y = original.rotation[1] ?? 0
        mesh.visible = true
      }
    } else if (modeRef.current === 'clone' && originalStateRef.current) {
      if (draftRef.current.id in useScene.getState().nodes) {
        useScene.getState().deleteNode(draftRef.current.id)
      }
      const originalMesh = sceneRegistry.nodes.get(originalStateRef.current.id)
      if (originalMesh) {
        originalMesh.visible = true
      }
    } else {
      // Create mode: delete the transient node
      useScene.getState().deleteNode(draftRef.current.id)
    }

    draftRef.current = null
    modeRef.current = null
    originalStateRef.current = null
  }, [])

  return useMemo(
    () => ({
      get current() {
        return draftRef.current
      },
      get isAdopted() {
        return modeRef.current === 'adopt'
      },
      get mode() {
        return modeRef.current
      },
      create,
      adopt,
      preview,
      commit,
      destroy,
    }),
    [create, adopt, commit, destroy, preview],
  )
}
