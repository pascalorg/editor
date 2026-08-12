import {
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  movingFootprintAnchors,
  type ShelfNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  getFloorStackPreviewPosition,
  getSegmentGridStep,
  isGridSnapActive,
  isMagneticSnapActive,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'

/**
 * 2D floor-plan move handler for shelf — mirrors `itemFloorplanMoveTarget`,
 * because shelf is a `position`-field kind (it carries its location in
 * `node.position`, not in polygon vertices):
 *
 *   - Each pointermove previews through `useLiveNodeOverrides`.
 *   - On commit, the final position is written once as one undoable step.
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
  let lastVisualPosition: [number, number, number] = originalPosition
  let lastSnapKey: string | null = null

  // Alignment candidates — corner/edge/segment anchors of every OTHER node
  // (incl. wall faces). Gathered once: the scene is stable during the drag
  // (only the shelf moves), so re-collecting per tick is wasted work.
  const candidates = collectAlignmentAnchors(nodes, shelfId)

  const session: FloorplanMoveTargetSession = {
    affectedIds: [shelfId],
    apply({ planPoint }) {
      const gridSnapActive = isGridSnapActive()
      const step = gridSnapActive ? getSegmentGridStep() : 0
      const snap = (value: number) => (step > 0 ? Math.round(value / step) * step : value)
      const gridSnapped = resolveCursor(planPoint, { snap }) as WallPlanPoint
      // Figma-style alignment layered on the grid snap — the shelf footprint
      // edges snap to neighbours / wall faces and a guide is published.
      const { point: snapped } = applyFloorplanAlignment(
        gridSnapped,
        movingFootprintAnchors(
          node as unknown as AnyNode,
          gridSnapped[0],
          gridSnapped[1],
          originalRotationY,
        ),
        candidates,
        { applySnap: isMagneticSnapActive() },
      )
      const next: [number, number, number] = [snapped[0], originalPosition[1], snapped[1]]
      lastPosition = next

      // Grid-snap SFX on cell crossings — matches the 3D `MoveSlabTool`
      // and the placement coordinators. Item / slab / wall flows fire
      // the same cue, so the shelf following along is the expected UX.
      const snapKey = `${snapped[0]},${snapped[1]}`
      if (gridSnapActive && snapKey !== lastSnapKey) {
        lastSnapKey = snapKey
      }
      const visualPosition = getFloorStackPreviewPosition({
        node,
        position: next,
        rotation: node.rotation,
        levelId: node.parentId ?? null,
      })
      lastVisualPosition = visualPosition
      useLiveNodeOverrides.getState().set(shelfId, { position: visualPosition })
      useScene.getState().markDirty(shelfId)
    },
    canCommit() {
      const live = useScene.getState().nodes[shelfId] as ShelfNode | undefined
      if (live?.type !== 'shelf') return false
      return !(lastPosition[0] === originalPosition[0] && lastPosition[2] === originalPosition[2])
    },
    commit() {
      useLiveNodeOverrides.getState().clear(shelfId)
      useScene.getState().updateNodes([{ id: shelfId, data: { position: lastVisualPosition } }])
    },
  }
  return session
}
