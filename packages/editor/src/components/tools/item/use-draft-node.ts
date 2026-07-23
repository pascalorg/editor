import {
  type AnyNodeId,
  type AssetInput,
  ItemNode,
  resolveSupportSlabPatch,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useMemo, useRef } from 'react'
import type { Vector3 } from 'three'
import usePlacementPreview from '../../../store/use-placement-preview'
import { stripTransient } from './placement-math'

interface OriginalState {
  position: [number, number, number]
  rotation: [number, number, number]
  side: ItemNode['side']
  parentId: string | null
  // Roof-segment wall hosting — cleared/changed by surface transitions
  // mid-move, so reverts must restore it alongside parentId.
  roofSegmentId: ItemNode['roofSegmentId']
  roofFace: ItemNode['roofFace']
  metadata: ItemNode['metadata']
}

export interface DraftNodeHandle {
  /** Current draft item, or null */
  readonly current: ItemNode | null
  /** Whether the current draft was adopted (move mode) vs created (create mode) */
  readonly isAdopted: boolean
  /** Create a new draft item at the given position. Returns the created node or null.
   *  `slots` seeds painted slot overrides so duplicates keep their materials. */
  create: (
    gridPosition: Vector3,
    asset: AssetInput,
    rotation?: [number, number, number],
    scale?: [number, number, number],
    slots?: ItemNode['slots'],
  ) => ItemNode | null
  /** Take ownership of an existing scene node as the draft (for move mode). */
  adopt: (node: ItemNode) => void
  /** Commit the current draft. Create mode: delete+recreate. Move mode: update in place.
   *  `supportElevationCap` (floor commits) is the pointer-decided surface
   *  elevation — it caps the persisted `supportSlabId` election so the
   *  commit lands on the surface the cursor pointed at. */
  commit: (
    finalUpdate: Partial<ItemNode>,
    options?: { supportElevationCap?: number | null },
  ) => string | null
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

  const create = useCallback(
    (
      gridPosition: Vector3,
      asset: AssetInput,
      rotation?: [number, number, number],
      scale?: [number, number, number],
      slots?: ItemNode['slots'],
    ): ItemNode | null => {
      const currentLevelId = useViewer.getState().selection.levelId
      if (!currentLevelId) return null

      const node = ItemNode.parse({
        position: [gridPosition.x, gridPosition.y, gridPosition.z],
        rotation: rotation ?? [0, 0, 0],
        scale: scale ?? [1, 1, 1],
        name: asset.name,
        asset,
        parentId: currentLevelId,
        metadata: { isTransient: true },
        ...(slots ? { slots } : {}),
      })

      useScene.getState().createNode(node, currentLevelId)
      usePlacementPreview
        .getState()
        .set(node, useScene.getState().nodes[currentLevelId as AnyNodeId] ?? null)
      draftRef.current = node
      adoptedRef.current = false
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
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      side: node.side,
      parentId: node.parentId,
      roofSegmentId: node.roofSegmentId,
      roofFace: node.roofFace,
      metadata: node.metadata,
    }

    draftRef.current = node
    adoptedRef.current = true

    // Mark as transient so it renders as a draft
    useScene.getState().updateNode(node.id, {
      metadata: { ...meta, isTransient: true },
    })
    usePlacementPreview
      .getState()
      .set(
        node,
        node.parentId ? (useScene.getState().nodes[node.parentId as AnyNodeId] ?? null) : null,
      )
  }, [])

  const commit = useCallback(
    (
      finalUpdate: Partial<ItemNode>,
      options?: { supportElevationCap?: number | null },
    ): string | null => {
      const draft = draftRef.current
      if (!draft) return null

      if (adoptedRef.current) {
        // Move mode: update in place (single undoable action)
        const { parentId: newParentId, ...updateProps } = finalUpdate
        const parentId =
          newParentId ??
          originalStateRef.current?.parentId ??
          useViewer.getState().selection.levelId
        const original = originalStateRef.current!

        // Restore original state while paused — so the undo baseline is clean
        useScene.getState().updateNode(draft.id, {
          position: original.position,
          rotation: original.rotation,
          side: original.side,
          parentId: original.parentId,
          roofSegmentId: original.roofSegmentId,
          roofFace: original.roofFace,
          metadata: original.metadata,
        })

        // Resume → tracked update (undo reverts to original)
        useScene.temporal.getState().resume()

        const effectiveNode = ItemNode.parse({
          ...draft,
          ...updateProps,
          parentId,
          metadata: updateProps.metadata ?? stripTransient(draft.metadata),
        })

        useScene.getState().updateNode(draft.id, {
          position: updateProps.position ?? draft.position,
          rotation: updateProps.rotation ?? draft.rotation,
          side: updateProps.side ?? draft.side,
          metadata: updateProps.metadata ?? stripTransient(draft.metadata),
          parentId: parentId as string,
          // Forward the roof host explicitly: strategies set it on every
          // commit (segment id on a roof face, undefined elsewhere), and
          // dropping it here strands the item in the roof frame without
          // the segment transform.
          roofSegmentId: updateProps.roofSegmentId,
          roofFace: updateProps.roofFace,
          // Only when the strategy decided about wallId (roof commits clear
          // it) — floor/ceiling commits never managed the field.
          ...('wallId' in updateProps ? { wallId: updateProps.wallId } : {}),
          ...resolveSupportSlabPatch(effectiveNode, useScene.getState().nodes, {
            maxElevation: options?.supportElevationCap,
          }),
        })

        useScene.temporal.getState().pause()

        const id = draft.id
        if (usePlacementPreview.getState().node?.id === id) {
          usePlacementPreview.getState().clear()
        }
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
        scale: updateProps.scale ?? draft.scale,
        side: updateProps.side ?? draft.side,
        // Carry painted slot overrides so a duplicated item keeps its materials.
        ...(draft.slots ? { slots: draft.slots } : {}),
        // Roof host — see the move-mode commit above for why this must be
        // forwarded explicitly.
        roofSegmentId: updateProps.roofSegmentId,
        roofFace: updateProps.roofFace,
        ...('wallId' in updateProps ? { wallId: updateProps.wallId } : {}),
        metadata: updateProps.metadata ?? stripTransient(draft.metadata),
        parentId,
      })
      const nodes = useScene.getState().nodes
      const committedNode = ItemNode.parse({
        ...finalNode,
        ...resolveSupportSlabPatch(
          finalNode,
          { ...nodes, [finalNode.id]: finalNode },
          { maxElevation: options?.supportElevationCap },
        ),
      })
      useScene.getState().createNode(committedNode, parentId)
      if (usePlacementPreview.getState().node?.id === draft.id) {
        usePlacementPreview.getState().clear()
      }

      // Re-pause for next draft cycle
      useScene.temporal.getState().pause()

      adoptedRef.current = false
      originalStateRef.current = null
      return committedNode.id
    },
    [],
  )

  const destroy = useCallback(() => {
    if (!draftRef.current) return

    const draftId = draftRef.current.id

    if (adoptedRef.current && originalStateRef.current) {
      // Move mode: restore original state instead of deleting — but only
      // if no other system has already committed a new position for this
      // node. The 2D `FloorplanRegistryMoveOverlay` commits via
      // `useScene.updateNodes` before unmounting the legacy mover, and
      // an unconditional restore here would wipe that commit. By
      // comparing the live state to the snapshot we took in `adopt()`,
      // we let an external committer's write stick.
      const original = originalStateRef.current
      const id = draftRef.current.id
      const live = useScene.getState().nodes[id as AnyNodeId] as ItemNode | undefined
      const livePosition = live?.position
      const externallyMoved =
        !!livePosition &&
        (livePosition[0] !== original.position[0] ||
          livePosition[1] !== original.position[1] ||
          livePosition[2] !== original.position[2])
      if (externallyMoved) {
        draftRef.current = null
        adoptedRef.current = false
        originalStateRef.current = null
        if (usePlacementPreview.getState().node?.id === draftId) {
          usePlacementPreview.getState().clear()
        }
        return
      }

      useScene.getState().updateNode(id, {
        position: original.position,
        rotation: original.rotation,
        side: original.side,
        parentId: original.parentId,
        roofSegmentId: original.roofSegmentId,
        roofFace: original.roofFace,
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
    } else {
      // Create mode: delete the transient node
      useScene.getState().deleteNode(draftRef.current.id)
    }

    draftRef.current = null
    adoptedRef.current = false
    originalStateRef.current = null
    if (usePlacementPreview.getState().node?.id === draftId) {
      usePlacementPreview.getState().clear()
    }
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
