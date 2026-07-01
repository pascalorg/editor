import {
  type AnyNode,
  type AnyNodeId,
  type ColumnNode,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  movingFootprintAnchors,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  getFloorStackPreviewPosition,
  isGridSnapActive,
  isMagneticSnapActive,
  triggerSFX,
  useEditor,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'

/**
 * 2D floor-plan move handler for column. Columns need the same footprint-edge
 * alignment as shelf / item, but they must preview through live transforms and
 * commit once on release so the overlay does not churn the scene store on
 * every pointermove.
 *
 * Column stores rotation as a scalar (not a tuple); position is `[x, y, z]`.
 */

export const columnFloorplanMoveTarget: FloorplanMoveTarget<ColumnNode> = ({ node, nodes }) => {
  const columnId = node.id as AnyNodeId
  const originalPosition: [number, number, number] = [...node.position] as [number, number, number]
  const rotationY = node.rotation ?? 0
  const resolveCursor = createFloorplanCursorResolver({
    original: [originalPosition[0], originalPosition[2]],
    metadata: node.metadata,
  })
  let lastPosition: [number, number, number] = originalPosition
  let lastSnapKey: string | null = null

  // Alignment candidates gathered once — scene is stable during the drag.
  const candidates = collectAlignmentAnchors(nodes, columnId)

  const session: FloorplanMoveTargetSession = {
    affectedIds: [columnId],
    apply({ planPoint }) {
      const snap = (value: number) => {
        if (!isGridSnapActive()) return value
        const step = useEditor.getState().gridSnapStep
        return Math.round(value / step) * step
      }
      const gridSnapped = resolveCursor(planPoint, { snap }) as WallPlanPoint
      // Figma-style alignment layered on the active snap mode.
      const { point: snapped } = applyFloorplanAlignment(
        gridSnapped,
        movingFootprintAnchors(
          node as unknown as AnyNode,
          gridSnapped[0],
          gridSnapped[1],
          rotationY,
        ),
        candidates,
        { applySnap: isMagneticSnapActive() },
      )
      const next: [number, number, number] = [snapped[0], originalPosition[1], snapped[1]]
      lastPosition = next

      const snapKey = `${snapped[0]},${snapped[1]}`
      if (snapKey !== lastSnapKey) {
        triggerSFX('sfx:grid-snap')
        lastSnapKey = snapKey
      }
      const visualPosition = getFloorStackPreviewPosition({
        node,
        position: next,
        rotation: rotationY,
        levelId: node.parentId ?? null,
      })
      sceneRegistry.nodes.get(columnId)?.position.set(...visualPosition)
      useLiveTransforms.getState().set(columnId, {
        position: next,
        rotation: rotationY,
      })
    },
    canCommit() {
      const live = useScene.getState().nodes[columnId] as ColumnNode | undefined
      if (live?.type !== 'column') return false
      return !(lastPosition[0] === originalPosition[0] && lastPosition[2] === originalPosition[2])
    },
    commit() {
      useScene.getState().updateNodes([{ id: columnId, data: { position: lastPosition } }])
    },
  }
  return session
}
