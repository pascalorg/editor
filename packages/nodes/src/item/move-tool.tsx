'use client'

import { type AnyNodeId, type ItemNode, useScene } from '@pascal-app/core'
import {
  type PlacementState,
  triggerSFX,
  useDraftNode,
  useEditor,
  usePlacementCoordinator,
} from '@pascal-app/editor'
import { Vector3 } from 'three'

/**
 * Phase 5 Stage D — item's registry-driven 3D move affordance.
 *
 * Replaces the legacy `MoveItemContent` in `editor/src/components/tools/
 * item/move-tool.tsx`. Behaviour is identical: it adopts the moving node
 * (or creates a draft for duplicates flagged `isNew`), runs the placement
 * coordinator with surface strategies for floor / wall / ceiling / item-
 * surface, and commits via `useScene.updateNode` on click.
 *
 * Registered via `def.affordanceTools.move`. The editor's
 * `MoveTool` dispatcher picks this up through `getRegistryAffordance
 * Tool('item', 'move')` before its legacy chain reaches `<MoveItemContent>`
 * — so the legacy fallback can now go away.
 *
 * Closes the 2D ↔ 3D coexistence bugs from last session: when both
 * paths mounted, the legacy mover's `destroy()` would clobber the 2D
 * commit; with this tool owning the move, only one path is alive at a
 * time.
 *
 * Placement primitives (`useDraftNode`, `usePlacementCoordinator`,
 * `PlacementState`) are re-exported from `@pascal-app/editor` — same
 * hooks the legacy code used. When `ItemTool` (item placement, not
 * move) also ports to `def.tool`, the primitives can be inlined here
 * and dropped from editor.
 */
function getInitialState(node: ItemNode): PlacementState {
  const attachTo = node.asset.attachTo
  if (attachTo === 'wall' || attachTo === 'wall-side') {
    if (node.roofSegmentId) {
      return {
        surface: 'roof-wall',
        wallId: null,
        roofSegmentId: node.roofSegmentId,
        ceilingId: null,
        surfaceItemId: null,
        shelfId: null,
      }
    }
    return {
      surface: 'wall',
      wallId: node.parentId,
      roofSegmentId: null,
      ceilingId: null,
      surfaceItemId: null,
      shelfId: null,
    }
  }
  if (attachTo === 'ceiling') {
    return {
      surface: 'ceiling',
      wallId: null,
      roofSegmentId: null,
      ceilingId: node.parentId,
      surfaceItemId: null,
      shelfId: null,
    }
  }
  // A floor item resting on a host surface (table / counter / shelf) starts in
  // that surface, not 'floor', so the first pointer move runs the surface move
  // handler — which preserves the grab offset — instead of a fresh `enter()`
  // that snaps the item's origin under the cursor. Without this the item
  // teleports the instant it's grabbed.
  const parent = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : undefined
  if (parent?.type === 'item') {
    return {
      surface: 'item-surface',
      wallId: null,
      roofSegmentId: null,
      ceilingId: null,
      surfaceItemId: node.parentId,
      shelfId: null,
    }
  }
  if (parent?.type === 'shelf') {
    return {
      surface: 'shelf-surface',
      wallId: null,
      roofSegmentId: null,
      ceilingId: null,
      surfaceItemId: null,
      shelfId: node.parentId,
    }
  }
  return {
    surface: 'floor',
    wallId: null,
    roofSegmentId: null,
    ceilingId: null,
    surfaceItemId: null,
    shelfId: null,
  }
}

export function MoveItemTool({ node }: { node: ItemNode }) {
  const draftNode = useDraftNode()

  const meta =
    typeof node.metadata === 'object' && node.metadata !== null
      ? (node.metadata as Record<string, unknown>)
      : {}
  const isNew = !!meta.isNew

  const cursor = usePlacementCoordinator({
    asset: node.asset,
    draftNode,
    // Carry painted slot overrides onto the duplicate's draft (wall/ceiling
    // items create their draft lazily inside the coordinator).
    slots: node.slots,
    // Duplicates start fresh in floor mode; wall/ceiling draft is created lazily by ensureDraft.
    initialState: isNew
      ? {
          surface: 'floor',
          wallId: null,
          roofSegmentId: null,
          ceilingId: null,
          surfaceItemId: null,
          shelfId: null,
        }
      : getInitialState(node),
    // Preserve the original item's scale so Y-position calculations use the correct height.
    defaultScale: isNew ? node.scale : undefined,
    preserveDragOffset: true,
    initDraft: (gridPosition) => {
      if (isNew) {
        // Duplicate: floor items get a draft immediately; wall/ceiling
        // items are created lazily on surface entry.
        gridPosition.copy(new Vector3(...node.position))
        if (!node.asset.attachTo) {
          draftNode.create(gridPosition, node.asset, node.rotation, node.scale, node.slots)
        }
      } else {
        draftNode.adopt(node)
        gridPosition.copy(new Vector3(...node.position))
      }
    },
    onCommitted: () => {
      triggerSFX('sfx:item-place')
      useEditor.getState().setMovingNode(null)
      return false
    },
    onCancel: () => {
      draftNode.destroy()
      useEditor.getState().setMovingNode(null)
    },
  })

  return <>{cursor}</>
}

export default MoveItemTool
