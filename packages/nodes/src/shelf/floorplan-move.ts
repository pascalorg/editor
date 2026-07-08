import {
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  movingFootprintAnchors,
  type ShelfNode,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  getFloorStackPreviewPosition,
  isMagneticSnapActive,
  triggerSFX,
  useEditor,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'

/**
 * 2D floor-plan move handler for shelf — mirrors `itemFloorplanMoveTarget`,
 * because shelf is a `position`-field kind (it carries its location in
 * `node.position`, not in polygon vertices):
 *
 *   - Each pointermove writes the absolute world-plan position straight
 *     to `useScene` (history is paused by the overlay). This is the single
 *     source of truth: the 2D `FloorplanRegistryLayer` and the 3D
 *     `ParametricNodeRenderer` group transform both follow it reactively,
 *     so 2D and 3D can never diverge.
 *   - On commit, the overlay's snapshot-diff reverts to baseline, resumes
 *     history, and re-applies the final position as one undoable step.
 *     `canCommit` only validates.
 *
 * Earlier this used the `useLiveTransforms` + imperative-mesh pattern that
 * `slab` / `ceiling` use. That works for polygon kinds because their commit
 * rebuilds geometry (the vertices change), which forces the 3D group to
 * reconcile. Shelf's `geometryKey` excludes `position`, so its commit
 * `markDirty` is a no-op and nothing reconciled the 3D group off the cleared
 * live transform — the 2D SVG moved but the 3D mesh stayed put. Writing the
 * scene directly removes that second source of truth entirely.
 */
export const shelfFloorplanMoveTarget: FloorplanMoveTarget<ShelfNode> = ({ node, nodes }) => {
  const shelfId = node.id as AnyNodeId
  const originalPosition: [number, number, number] = [...node.position] as [number, number, number]
  const originalRotationY = node.rotation[1] ?? 0
  const resolveCursor = createFloorplanCursorResolver({
    original: [originalPosition[0], originalPosition[2]],
    metadata: node.metadata,
  })
  let lastPosition: [number, number, number] = originalPosition
  let lastSnapKey: string | null = null

  // Alignment candidates — corner/edge/segment anchors of every OTHER node
  // (incl. wall faces). Gathered once: the scene is stable during the drag
  // (only the shelf moves), so re-collecting per tick is wasted work.
  const candidates = collectAlignmentAnchors(nodes, shelfId)

  const session: FloorplanMoveTargetSession = {
    affectedIds: [shelfId],
    apply({ planPoint, modifiers }) {
      const snap = (value: number) => {
        if (modifiers.shiftKey) return value
        const step = useEditor.getState().gridSnapStep
        return Math.round(value / step) * step
      }
      const gridSnapped = resolveCursor(planPoint, { snap }) as WallPlanPoint
      // Figma-style alignment layered on the grid snap — the shelf footprint
      // edges snap to neighbours / wall faces and a guide is published. Alt
      // bypasses alignment; Shift bypasses all snap.
      const { point: snapped } = applyFloorplanAlignment(
        gridSnapped,
        movingFootprintAnchors(
          node as unknown as AnyNode,
          gridSnapped[0],
          gridSnapped[1],
          originalRotationY,
        ),
        candidates,
        { applySnap: isMagneticSnapActive(), bypass: modifiers.altKey || modifiers.shiftKey },
      )
      const next: [number, number, number] = [snapped[0], originalPosition[1], snapped[1]]
      lastPosition = next

      // Grid-snap SFX on cell crossings — matches the 3D `MoveSlabTool`
      // and the placement coordinators. Item / slab / wall flows fire
      // the same cue, so the shelf following along is the expected UX.
      const snapKey = `${snapped[0]},${snapped[1]}`
      if (!modifiers.shiftKey && snapKey !== lastSnapKey) {
        triggerSFX('sfx:grid-snap')
        lastSnapKey = snapKey
      }
      const visualPosition = getFloorStackPreviewPosition({
        node,
        position: next,
        rotation: node.rotation,
        levelId: node.parentId ?? null,
      })
      // Single source of truth — write the absolute position straight to
      // the scene (history is paused by the overlay). Both the 2D SVG and
      // the 3D group transform read `node.position` reactively, so they
      // stay in lockstep. The overlay's snapshot-diff turns the whole drag
      // into one undoable step on commit.
      useScene.getState().updateNodes([
        {
          id: shelfId,
          data: { position: visualPosition },
        },
      ])
    },
    canCommit() {
      const live = useScene.getState().nodes[shelfId] as ShelfNode | undefined
      if (live?.type !== 'shelf') return false
      return !(lastPosition[0] === originalPosition[0] && lastPosition[2] === originalPosition[2])
    },
  }
  return session
}
