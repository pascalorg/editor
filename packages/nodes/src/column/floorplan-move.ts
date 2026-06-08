import {
  type AnyNode,
  type AnyNodeId,
  type ColumnNode,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  movingFootprintAnchors,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  snapBuildingLocalToWorldGrid,
  triggerSFX,
  type WallPlanPoint,
} from '@pascal-app/editor'

/**
 * 2D floor-plan move handler for column — mirrors `itemFloorplanMoveTarget`:
 * each pointermove writes the absolute world-plan position straight to
 * `useScene` (history paused by the overlay). The 2D SVG and the 3D group
 * transform both read `node.position` reactively, so they stay in lockstep;
 * the overlay's snapshot-diff makes the drag one undoable step. `canCommit`
 * only validates.
 *
 * Columns previously fell through to the overlay's generic free-translate
 * path, which aligned a column by its bbox *centre* and gathered candidates
 * from SVG bounding boxes only (missing wall faces / diagonal walls). Routing
 * through a kind-specific target gives column the same footprint-edge
 * alignment as shelf / item — including snapping flush to wall faces (the
 * pillar↔wall case this whole feature targets).
 *
 * Earlier this used the `useLiveTransforms` + imperative-mesh pattern; for a
 * `position`-field kind that leaves the 3D group stuck at the old spot on
 * commit (nothing reconciles it off the cleared live transform, since the
 * geometry doesn't rebuild on a position-only change). See the shelf handler
 * for the full rationale.
 *
 * Column stores rotation as a scalar (not a tuple); position is `[x, y, z]`.
 */

const GRID_STEP = 0.5

export const columnFloorplanMoveTarget: FloorplanMoveTarget<ColumnNode> = ({ node, nodes }) => {
  const columnId = node.id as AnyNodeId
  const originalPosition: [number, number, number] = [...node.position] as [number, number, number]
  const rotationY = node.rotation ?? 0
  let lastPosition: [number, number, number] = originalPosition
  let lastSnapKey: string | null = null

  // Alignment candidates gathered once — scene is stable during the drag.
  const candidates = collectAlignmentAnchors(nodes, columnId)

  const session: FloorplanMoveTargetSession = {
    affectedIds: [columnId],
    apply({ planPoint, modifiers }) {
      const gridSnapped: WallPlanPoint = modifiers.shiftKey
        ? ([planPoint[0], planPoint[1]] as WallPlanPoint)
        : (snapBuildingLocalToWorldGrid(
            [planPoint[0], planPoint[1]] as WallPlanPoint,
            GRID_STEP,
          ) as WallPlanPoint)
      // Figma-style alignment layered on the grid snap (Alt bypasses).
      const { point: snapped } = applyFloorplanAlignment(
        gridSnapped,
        movingFootprintAnchors(
          node as unknown as AnyNode,
          gridSnapped[0],
          gridSnapped[1],
          rotationY,
        ),
        candidates,
        { bypass: modifiers.altKey },
      )
      const next: [number, number, number] = [snapped[0], originalPosition[1], snapped[1]]
      lastPosition = next

      const snapKey = `${snapped[0]},${snapped[1]}`
      if (snapKey !== lastSnapKey) {
        triggerSFX('sfx:grid-snap')
        lastSnapKey = snapKey
      }
      // Single source of truth — write the absolute position straight to the
      // scene (history paused by the overlay). 2D SVG and 3D group transform
      // both follow `node.position` reactively, so they can't diverge.
      useScene.getState().updateNodes([{ id: columnId, data: { position: next } }])
    },
    canCommit() {
      const live = useScene.getState().nodes[columnId] as ColumnNode | undefined
      if (!live || live.type !== 'column') return false
      return !(lastPosition[0] === originalPosition[0] && lastPosition[2] === originalPosition[2])
    },
  }
  return session
}
