import {
  type AnyNodeId,
  type AssetInput,
  beginSceneHistoryDraft,
  ItemNode,
  resolveSupportSlabPatch,
  runSceneHistoryDraftWrite,
  type SurfaceRejectReason,
  sceneHistoryDraftRevertUpdates,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { beginPerfAction, commitPerfAction, useViewer } from '@pascal-app/viewer'
import { useCallback, useMemo, useRef } from 'react'
import type { Vector3 } from 'three'
import { commitFreshPlacementSubtree } from '../../../lib/fresh-planar-placement'
import { isFreshPlacementMetadata } from '../../../lib/placement-metadata'
import {
  surfaceAttachmentId,
  surfaceAttachmentUpdates,
  surfaceFramePose,
  updateSurfaceNode,
} from '../../../lib/surface-attachment'
import useInteractionScope, {
  isInteractionSubtreeDraft,
} from '../../../store/use-interaction-scope'
import usePlacementPreview from '../../../store/use-placement-preview'
import { stripTransient } from './placement-math'

function releaseHistoryDraft(end: { current: (() => void) | null }): void {
  end.current?.()
  end.current = null
}

/**
 * A placement's own write: under a short pause, and the carried draft's fields it changes stay
 * recorded as they were before the carry (core's `runSceneHistoryDraftWrite`).
 */
export const pausedDraftWrite = runSceneHistoryDraftWrite

/**
 * Puts back what the carry still holds on an adopted item (its own writes, core's
 * `sceneHistoryDraftRevertUpdates`), as a carry write: a position, name or host a collaborator
 * wrote meanwhile stays. A host deleted mid-carry is never a parent again (nor its face, roof
 * or surface): the item stays on its live parent, else the level. Returns its parent after.
 */
function restoreOriginalState(
  id: AnyNodeId,
  original: OriginalState,
  draftParentId: string | null | undefined,
): string | null {
  const nodes = useScene.getState().nodes
  const exists = (parentId: string | null | undefined): parentId is string =>
    Boolean(parentId && nodes[parentId as AnyNodeId])
  const hostGone = original.parentId != null && !exists(original.parentId)
  const updates = sceneHistoryDraftRevertUpdates([id])
  const own = updates.find((update) => update.id === id)
  if (hostGone && own) {
    for (const key of ['roofSegmentId', 'roofFace', 'blockFaceId']) delete own.data[key]
  }
  const liveParentId = nodes[id]?.parentId
  if (!exists(liveParentId)) {
    const fallback = [draftParentId, useViewer.getState().selection.levelId].find(exists)
    if (fallback) {
      if (own) own.data.parentId = fallback
      else updates.push({ id, data: { parentId: fallback } })
    }
  }
  if (updates.length > 0) {
    pausedDraftWrite(() => useScene.getState().updateNodes(updates as never))
  }
  return useScene.getState().nodes[id]?.parentId ?? null
}

interface OriginalState {
  surfaceId: string | null
  position: [number, number, number]
  rotation: [number, number, number]
  side: ItemNode['side']
  parentId: string | null
  // Roof-segment wall hosting — cleared/changed by surface transitions
  // mid-move, so reverts must restore it alongside parentId.
  roofSegmentId: ItemNode['roofSegmentId']
  roofFace: ItemNode['roofFace']
  blockFaceId: ItemNode['blockFaceId']
  metadata: ItemNode['metadata']
}

export interface DraftNodeHandle {
  updateSurface: (data: Partial<ItemNode>, surfaceId: string | null) => void
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
   *  The final write is the one undo step, recorded only while no owner pauses history:
   *  a caller holding a pause lifts it around this call (`SceneHistoryPauseSession.commitStep`).
   *  `supportElevationCap` (floor commits) is the pointer-decided surface
   *  elevation — it caps the persisted `supportSlabId` election so the
   *  commit lands on the surface the cursor pointed at. */
  commit: (
    finalUpdate: Partial<ItemNode>,
    options?: {
      supportElevationCap?: number | null
      preferredSupportSlabId?: string | null
      onReject?: (reason: SurfaceRejectReason) => void
      pinSupport?: boolean
    },
  ) => string | null
  /** Destroy the current draft. Create mode: delete node. Move mode: restore original state. */
  destroy: () => void
}

/**
 * Hook that manages the lifecycle of a transient (draft) item node.
 * The draft is registered with core's history drafts from create/adopt until
 * commit/destroy, so history records it as absent (created) or as it was
 * (adopted) and no draft write becomes an undo step; the draft's own writes
 * also run under a short balanced pause. `commit` ends the registration right
 * before its one tracked write.
 *
 * Supports two modes:
 * - Create mode (via `create()`): draft is a new transient node. Commit = delete+recreate (undo removes node).
 * - Move mode (via `adopt()`): draft is an existing node. Commit = update in place (undo reverts position).
 */
export function useDraftNode(): DraftNodeHandle {
  const draftRef = useRef<ItemNode | null>(null)
  const adoptedRef = useRef(false)
  const ownsSubtreeRef = useRef(false)
  const originalStateRef = useRef<OriginalState | null>(null)
  const endHistoryDraftRef = useRef<(() => void) | null>(null)

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

      releaseHistoryDraft(endHistoryDraftRef)
      endHistoryDraftRef.current = beginSceneHistoryDraft(node.id, null)
      pausedDraftWrite(() => useScene.getState().createNode(node, currentLevelId))
      usePlacementPreview
        .getState()
        .set(node, useScene.getState().nodes[currentLevelId as AnyNodeId] ?? null)
      draftRef.current = node
      adoptedRef.current = false
      ownsSubtreeRef.current = false
      originalStateRef.current = null
      return node
    },
    [],
  )

  const adopt = useCallback((node: ItemNode): void => {
    releaseHistoryDraft(endHistoryDraftRef)
    endHistoryDraftRef.current = beginSceneHistoryDraft(
      node.id,
      isFreshPlacementMetadata(node.metadata) ? null : node,
    )
    ownsSubtreeRef.current =
      useInteractionScope.getState().adoptSubtree(node.id) || isInteractionSubtreeDraft(node.id)
    // Save original state so destroy() can restore it
    const meta =
      typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
        ? (node.metadata as Record<string, unknown>)
        : {}

    originalStateRef.current = {
      surfaceId: surfaceAttachmentId(node),
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      side: node.side,
      parentId: node.parentId,
      roofSegmentId: node.roofSegmentId,
      roofFace: node.roofFace,
      blockFaceId: node.blockFaceId,
      metadata: node.metadata,
    }

    draftRef.current = {
      ...node,
      ...surfaceFramePose(node.parentId, surfaceAttachmentId(node), node, false),
    }
    adoptedRef.current = true

    // Mark as transient so it renders as a draft
    pausedDraftWrite(() =>
      useScene.getState().updateNode(node.id, {
        metadata: { ...meta, isTransient: true },
      }),
    )
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
      options?: {
        supportElevationCap?: number | null
        preferredSupportSlabId?: string | null
        onReject?: (reason: SurfaceRejectReason) => void
        pinSupport?: boolean
      },
    ): string | null => {
      const draft = draftRef.current
      if (!draft) return null

      const surfaceId = surfaceAttachmentId(useScene.getState().nodes[draft.id] ?? draft)
      const stored = surfaceFramePose(
        finalUpdate.parentId ?? draft.parentId,
        surfaceId,
        { ...draft, ...finalUpdate },
        true,
      )
      finalUpdate = { ...finalUpdate, ...stored }
      if (isFreshPlacementMetadata(originalStateRef.current?.metadata)) {
        releaseHistoryDraft(endHistoryDraftRef)
        const effectiveNode = ItemNode.parse({ ...draft, ...finalUpdate })
        const id = commitFreshPlacementSubtree(
          draft.id,
          {
            ...finalUpdate,
            ...resolveSupportSlabPatch(effectiveNode, useScene.getState().nodes, {
              maxElevation: options?.supportElevationCap,
              preferredSlabId: options?.preferredSupportSlabId,
              pinSupport: options?.pinSupport,
            }),
          },
          options?.onReject,
        )
        if (!id) return null
        if (usePlacementPreview.getState().node?.id === draft.id) {
          usePlacementPreview.getState().clear()
        }
        draftRef.current = null
        adoptedRef.current = false
        originalStateRef.current = null
        return id
      }
      if (adoptedRef.current) {
        // Move mode: update in place (single undoable action)
        const { parentId: newParentId, ...updateProps } = finalUpdate
        const original = originalStateRef.current!
        const nodesNow = useScene.getState().nodes
        const restoredParentId = restoreOriginalState(draft.id, original, draft.parentId)
        const parentId =
          [newParentId, restoredParentId].find((id) => id && nodesNow[id as AnyNodeId]) ??
          restoredParentId

        // The original is restored above (a carry write), so the one tracked write below has
        // the true baseline as its undo state.
        releaseHistoryDraft(endHistoryDraftRef)

        const effectiveNode = ItemNode.parse({
          ...draft,
          ...updateProps,
          parentId,
          metadata: updateProps.metadata ?? stripTransient(draft.metadata),
        })

        updateSurfaceNode(
          draft.id,
          {
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
            blockFaceId: updateProps.blockFaceId,
            // Only when the strategy decided about wallId (roof commits clear
            // it) — floor/ceiling commits never managed the field.
            ...('wallId' in updateProps ? { wallId: updateProps.wallId } : {}),
            ...resolveSupportSlabPatch(effectiveNode, useScene.getState().nodes, {
              maxElevation: options?.supportElevationCap,
              preferredSlabId: options?.preferredSupportSlabId,
              pinSupport: options?.pinSupport,
            }),
          },
          surfaceId,
        )

        const id = draft.id
        if (usePlacementPreview.getState().node?.id === id) {
          usePlacementPreview.getState().clear()
        }
        draftRef.current = null
        adoptedRef.current = false
        originalStateRef.current = null
        return id
      }

      // Create mode: delete the draft (paused), then create the fresh node (the tracked write)
      const { parentId: newParentId, ...updateProps } = finalUpdate
      const parentId = (newParentId ?? useViewer.getState().selection.levelId) as AnyNodeId
      if (!parentId) return null

      beginPerfAction('place:item', draft.id)
      pausedDraftWrite(() => {
        updateSurfaceNode(draft.id, {}, null)
        useScene.getState().deleteNode(draft.id)
      })
      releaseHistoryDraft(endHistoryDraftRef)
      draftRef.current = null

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
        blockFaceId: updateProps.blockFaceId,
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
          {
            maxElevation: options?.supportElevationCap,
            preferredSlabId: options?.preferredSupportSlabId,
            pinSupport: options?.pinSupport,
          },
        ),
      })
      useScene.getState().applyNodeChanges({
        create: [{ node: committedNode, parentId }],
        update: surfaceAttachmentUpdates(committedNode.id, parentId, surfaceId),
      })
      if (usePlacementPreview.getState().node?.id === draft.id) {
        usePlacementPreview.getState().clear()
      }

      adoptedRef.current = false
      originalStateRef.current = null
      commitPerfAction()
      return committedNode.id
    },
    [],
  )

  const destroy = useCallback(() => {
    if (!draftRef.current) return

    const draftId = draftRef.current.id
    if (ownsSubtreeRef.current) {
      releaseHistoryDraft(endHistoryDraftRef)
      draftRef.current = null
      adoptedRef.current = false
      originalStateRef.current = null
      return
    } else if (adoptedRef.current && originalStateRef.current) {
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
        !live?.metadata?.isTransient &&
        !!livePosition &&
        (livePosition[0] !== original.position[0] ||
          livePosition[1] !== original.position[1] ||
          livePosition[2] !== original.position[2])
      if (externallyMoved) {
        releaseHistoryDraft(endHistoryDraftRef)
        draftRef.current = null
        adoptedRef.current = false
        originalStateRef.current = null
        if (usePlacementPreview.getState().node?.id === draftId) {
          usePlacementPreview.getState().clear()
        }
        return
      }

      restoreOriginalState(id, original, draftRef.current.parentId)

      // Also reset the Three.js mesh directly — the store update triggers a React
      // re-render but the mesh position was mutated by useFrame and may not reset
      // until the next render cycle, leaving a visual glitch.
      const mesh = sceneRegistry.nodes.get(id as AnyNodeId)
      const restored = useScene.getState().nodes[id as AnyNodeId] as ItemNode | undefined
      if (mesh && restored) {
        mesh.position.set(restored.position[0], restored.position[1], restored.position[2])
        mesh.rotation.y = restored.rotation[1] ?? 0
        mesh.visible = true
      }
    } else {
      // Create mode: delete the transient node
      const id = draftRef.current.id
      pausedDraftWrite(() => {
        updateSurfaceNode(id, {}, null)
        useScene.getState().deleteNode(id)
      })
    }

    releaseHistoryDraft(endHistoryDraftRef)
    draftRef.current = null
    adoptedRef.current = false
    originalStateRef.current = null
    if (usePlacementPreview.getState().node?.id === draftId) {
      usePlacementPreview.getState().clear()
    }
  }, [])

  const updateSurface = useCallback((data: Partial<ItemNode>, surfaceId: string | null) => {
    const draft = draftRef.current
    if (!draft) return
    const pose = { ...draft, ...data }
    pausedDraftWrite(() =>
      updateSurfaceNode(
        draft.id,
        { ...data, ...surfaceFramePose(pose.parentId, surfaceId, pose, true) },
        surfaceId,
      ),
    )
  }, [])

  return useMemo(
    () => ({
      get current() {
        return draftRef.current
      },
      get isAdopted() {
        return adoptedRef.current
      },
      updateSurface,
      create,
      adopt,
      commit,
      destroy,
    }),
    [create, adopt, commit, destroy, updateSurface],
  )
}
