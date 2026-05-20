import type { CeilingNode } from '@pascal-app/core'
import {
  createPolygonAddVertexAffordance,
  createPolygonMoveEdgeAffordance,
  createPolygonVertexAffordance,
} from '../shared/polygon-vertex-affordance'

/**
 * 2D drag affordances for ceiling. Same three operations as slab
 * (`move-vertex`, `add-vertex`, `move-edge`), each accepting an
 * optional `holeIndex`. See `slab/floorplan-affordances.ts` for the
 * full contract.
 */
export const ceilingMoveVertexAffordance = createPolygonVertexAffordance<CeilingNode>('ceiling')
export const ceilingAddVertexAffordance = createPolygonAddVertexAffordance<CeilingNode>('ceiling')
export const ceilingMoveEdgeAffordance = createPolygonMoveEdgeAffordance<CeilingNode>('ceiling')
