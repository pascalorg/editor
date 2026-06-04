import type { CeilingNode, FloorplanMoveTarget } from '@pascal-app/core'
import { createPolygonCentroidMoveTarget } from '../shared/polygon-centroid-move'

/**
 * 2D floor-plan move handler for ceiling. Delegates to the shared polygon
 * centroid-pivot mover (same pivot semantics as slab / items). See
 * `shared/polygon-centroid-move.ts` for the rationale.
 *
 * `meshY = height − 0.01`: `CeilingSystem` parks the ceiling group at that Y
 * on rebuild, so mirroring it during the drag avoids a vertical teleport in
 * split view.
 */
export const ceilingFloorplanMoveTarget: FloorplanMoveTarget<CeilingNode> = ({ node, nodes }) =>
  createPolygonCentroidMoveTarget({ node, nodes, meshY: (node.height ?? 2.5) - 0.01 })
