import type { ZoneNode } from '@pascal-app/core'
import {
  createPolygonAddVertexAffordance,
  createPolygonMoveEdgeAffordance,
  createPolygonVertexAffordance,
} from '../shared/polygon-vertex-affordance'

/**
 * 2D drag affordances for zone — same three polygon-editing operations
 * slabs and ceilings expose. Zones have no `holes` field, but the
 * shared factory accepts that case (holeIndex stays undefined and the
 * boundary polygon is the target).
 *
 *   - `move-vertex` — drag an existing polygon vertex.
 *   - `add-vertex` — insert a new vertex at an edge midpoint, then drag.
 *   - `move-edge` — drag an entire edge perpendicular to itself.
 */
export const zoneMoveVertexAffordance = createPolygonVertexAffordance<ZoneNode>('zone')
export const zoneAddVertexAffordance = createPolygonAddVertexAffordance<ZoneNode>('zone')
export const zoneMoveEdgeAffordance = createPolygonMoveEdgeAffordance<ZoneNode>('zone')
