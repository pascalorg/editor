import type { FloorplanMoveTarget, ZoneNode } from '@pascal-app/core'
import { createPolygonCentroidMoveTarget } from '../shared/polygon-centroid-move'

/**
 * 2D floor-plan move handler for zone. Delegates to the shared polygon
 * centroid-pivot mover — the zone's centroid snaps to the (grid-snapped,
 * Figma-aligned) cursor. Zone has no `holes`, which the helper handles.
 *
 * Previously zone had no move target and fell through to the overlay's
 * generic free-translate path, which committed a `position` field zone
 * doesn't have (the polygon never moved on commit). Routing through this
 * polygon mover translates the actual vertices. `meshY = 0`.
 */
export const zoneFloorplanMoveTarget: FloorplanMoveTarget<ZoneNode> = ({ node, nodes }) =>
  createPolygonCentroidMoveTarget({ node, nodes, meshY: 0 })
