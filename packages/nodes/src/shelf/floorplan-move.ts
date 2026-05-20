import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  type ShelfNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { snapPointToGrid, triggerSFX, type WallPlanPoint } from '@pascal-app/editor'
import type * as THREE from 'three'

/**
 * 2D floor-plan move handler for shelf — behaves like items in the
 * floor-plan move flow:
 *
 *   - Each pointermove writes the absolute world-plan target position
 *     to `useLiveTransforms` (so the 2D layer's `effectiveNode` override
 *     re-renders the SVG at the new position) AND mutates the
 *     registered mesh's `position` directly (so the 3D view mirrors the
 *     drag in real time).
 *   - On commit, `canCommit` writes the final position to `scene` as a
 *     single tracked update — the dispatcher's snapshot-diff captures
 *     it as one undoable step.
 *   - On any non-commit unmount (escape, abnormal teardown) the
 *     dispatcher clears `useLiveTransforms` for affectedIds, so the 3D
 *     visual snaps back to the reverted scene state.
 *
 * Unlike `slab` / `ceiling`, this writes the **absolute** position (the
 * shelf carries its location in `node.position`, not in polygon
 * vertices). The 2D layer's override branch for `shelf` mirrors `item`'s
 * world-plan handling.
 */
const GRID_STEP = 0.5

export const shelfFloorplanMoveTarget: FloorplanMoveTarget<ShelfNode> = ({ node }) => {
  const shelfId = node.id as AnyNodeId
  const originalPosition: [number, number, number] = [...node.position] as [number, number, number]
  const originalRotationY = node.rotation[1] ?? 0
  let lastPosition: [number, number, number] = originalPosition
  let lastSnapKey: string | null = null

  const session: FloorplanMoveTargetSession = {
    affectedIds: [shelfId],
    apply({ planPoint, modifiers }) {
      const snapped: WallPlanPoint = modifiers.shiftKey
        ? ([planPoint[0], planPoint[1]] as WallPlanPoint)
        : snapPointToGrid([planPoint[0], planPoint[1]] as WallPlanPoint, GRID_STEP)
      const next: [number, number, number] = [snapped[0], originalPosition[1], snapped[1]]
      lastPosition = next

      // Grid-snap SFX on cell crossings — matches the 3D `MoveSlabTool`
      // and the placement coordinators. Item / slab / wall flows fire
      // the same cue, so the shelf following along is the expected UX.
      const snapKey = `${snapped[0]},${snapped[1]}`
      if (snapKey !== lastSnapKey) {
        triggerSFX('sfx:grid-snap')
        lastSnapKey = snapKey
      }
      // Live preview — same shape items use. `useLiveTransforms.position`
      // holds world-plan coords (level-local); the 2D `FloorplanRegistryLayer`
      // override for `shelf` reads this and re-renders the SVG entry.
      useLiveTransforms.getState().set(shelfId, {
        position: next,
        rotation: originalRotationY,
      })
      // Mirror to the 3D mesh so split-view follows the cursor without
      // touching scene state per tick (no CSG, no React re-render of
      // geometry — same imperative live-drag pattern as the 3D
      // `MoveRegistryNodeTool`).
      const mesh = sceneRegistry.nodes.get(shelfId) as THREE.Object3D | undefined
      if (mesh) mesh.position.set(next[0], next[1], next[2])
    },
    canCommit() {
      const live = useScene.getState().nodes[shelfId] as ShelfNode | undefined
      if (!live || live.type !== 'shelf') return false
      if (lastPosition[0] === originalPosition[0] && lastPosition[2] === originalPosition[2]) {
        return false
      }
      // Side-effect commit — write final position. The dispatcher's
      // snapshot-diff right after `canCommit` returns picks this up as
      // the single tracked change for undo. `useLiveTransforms` is
      // cleared in the dispatcher's commit path (and in our
      // abnormal-unmount cleanup) so the 3D view reconciles to the
      // committed scene position on the next render.
      useScene.getState().updateNodes([
        {
          id: shelfId,
          data: { position: lastPosition },
        },
      ])
      // The shelf's geometry doesn't depend on `position` (it's the
      // group's transform, not the build inputs), but we mark dirty so
      // any sibling-aware system that does watch position re-runs.
      useScene.getState().markDirty(shelfId)
      useLiveTransforms.getState().clear(shelfId)
      return true
    },
  }
  return session
}
