import type { FloorplanMoveTarget, SlabNode } from '@pascal-app/core'
import { createPolygonCentroidMoveTarget } from '../shared/polygon-centroid-move'

/**
 * 2D floor-plan move handler for slab. Delegates to the shared polygon
 * centroid-pivot mover: the slab's centroid snaps to the (grid-snapped,
 * Figma-aligned) cursor — the same pivot semantics as a regular item's
 * origin — instead of the old grab-relative delta. See
 * `shared/polygon-centroid-move.ts` for the live-drag / commit rationale.
 *
 * `meshY = 0`: `GeometrySystem` parks the slab group at y=0 on rebuild.
 */
export const slabFloorplanMoveTarget: FloorplanMoveTarget<SlabNode> = ({ node, nodes }) =>
  createPolygonCentroidMoveTarget({
    node,
    nodes,
    meshY: 0,
    // A user-dragged slab is a manual edit. Clear `autoFromWalls` so the
    // space-detection sync doesn't recompute the polygon from the wall loop
    // and snap the slab back to its original position.
    extraCommitData: node.autoFromWalls ? { autoFromWalls: false } : undefined,
  })
