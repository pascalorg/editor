import type { AnyNodeId, FloorplanMoveTarget, RockNode } from '@pascal-app/core'
import { isGridSnapActive, useDrawingView, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { planToSite } from '../shared/site-frame'
import { createRockPolygonSession } from './edit-session'

/** Rebuild at the proposed ground, not a translated copy of the old terrain-dependent mesh. */
export const createRockMoveSession: FloorplanMoveTarget<RockNode> = ({ node }) => {
  const centre: [number, number] = [
    node.polygon.reduce((sum, [x]) => sum + x, 0) / node.polygon.length,
    node.polygon.reduce((sum, [, z]) => sum + z, 0) / node.polygon.length,
  ]
  const resolveCursor = createFloorplanCursorResolver({ original: centre, metadata: node.metadata })
  const session = createRockPolygonSession(node)
  let moved = false
  return {
    affectedIds: session.affectedIds,
    apply({ planPoint, modifiers }) {
      const step = !modifiers.altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const target = resolveCursor(planPoint, {
        snap: (value) => (step > 0 ? Math.round(value / step) * step : value),
      })
      const [dx, dz] = [target[0] - centre[0], target[1] - centre[1]]
      moved = dx !== 0 || dz !== 0
      if (moved) session.preview(node.polygon.map(([x, z]) => [x + dx, z + dz]))
      else session.clear()
    },
    canCommit: () => moved && session.canCommit(),
    commit() {
      if (moved) session.commit()
      else session.clear()
    },
  }
}

/** The plan's cursor lives in the building frame; only a Site plan is already Site-local. */
export const rockFloorplanMoveTarget: FloorplanMoveTarget<RockNode> = (args) => {
  const session = createRockMoveSession(args)
  const toSite = rockPlanToSite(args.node, args.nodes)
  return {
    ...session,
    apply({ planPoint, modifiers }) {
      session.apply({ planPoint: toSite([planPoint[0], planPoint[1]]), modifiers })
    },
  }
}

export function rockPlanToSite(
  node: RockNode,
  nodes: Parameters<FloorplanMoveTarget<RockNode>>[0]['nodes'],
) {
  const levelId = useViewer.getState().selection.levelId
  const level = levelId ? nodes[levelId] : undefined
  const parent = level?.parentId ? nodes[level.parentId as AnyNodeId] : undefined
  const building = parent?.type === 'building' && parent.parentId === node.parentId ? parent : null
  const frame = useDrawingView.getState().drawingType === 'site-plan' ? null : building
  return (point: [number, number]) => planToSite(frame, point)
}
