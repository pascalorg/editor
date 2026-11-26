import type { FloorplanMoveTarget, RockNode } from '@pascal-app/core'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import {
  sitePlanToSite,
  sitePointsCenter,
  snapSiteCursorValue,
  wrapSiteFloorplanMoveTarget,
} from '../shared/site-floorplan-move'
import { createRockPolygonSession } from './edit-session'

/** Rebuild at the proposed ground, not a translated copy of the old terrain-dependent mesh. */
export const createRockMoveSession: FloorplanMoveTarget<RockNode> = ({ node }) => {
  const centre = sitePointsCenter(node.polygon)
  const resolveCursor = createFloorplanCursorResolver({ original: centre, metadata: node.metadata })
  const session = createRockPolygonSession(node)
  let moved = false
  return {
    affectedIds: session.affectedIds,
    apply({ planPoint, modifiers }) {
      const target = resolveCursor(planPoint, { snap: snapSiteCursorValue(modifiers) })
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
export const rockFloorplanMoveTarget: FloorplanMoveTarget<RockNode> =
  wrapSiteFloorplanMoveTarget(createRockMoveSession)

export function rockPlanToSite(
  node: RockNode,
  nodes: Parameters<FloorplanMoveTarget<RockNode>>[0]['nodes'],
) {
  return sitePlanToSite(node, nodes)
}
