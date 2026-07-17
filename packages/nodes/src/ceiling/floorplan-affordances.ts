import { type AnyNode, type CeilingNode, resolveLevelId } from '@pascal-app/core'
import { resolveCeilingPlanPointSnap } from '@pascal-app/editor'
import {
  createPolygonAddVertexAffordance,
  createPolygonDeleteVertexAffordance,
  createPolygonMoveEdgeAffordance,
  createPolygonVertexAffordance,
  type PolygonAffordanceSnapContext,
} from '../shared/polygon-vertex-affordance'

/**
 * 2D affordances for ceiling. Same four operations as slab
 * (`move-vertex`, `add-vertex`, `move-edge`, `delete-vertex`), each accepting an
 * optional `holeIndex`. See `slab/floorplan-affordances.ts` for the
 * full contract.
 */
const ceilingSnapOptions = {
  extraCommitData: { autoFromWalls: false },
  resolvePlanPoint({
    node,
    nodes,
    rawPoint,
    fallbackPoint,
  }: PolygonAffordanceSnapContext<CeilingNode>) {
    const sceneNodes = nodes as Record<string, AnyNode>
    return resolveCeilingPlanPointSnap({
      rawPoint,
      fallbackPoint,
      levelId: resolveLevelId(node, sceneNodes),
      excludeId: node.id,
      nodes: sceneNodes,
      // Magnetic wall-snap/alignment gates on `isMagneticSnapActive()` (the
      // `lines` mode), so no Shift or Alt snap bypass.
    }).point
  },
}

export const ceilingMoveVertexAffordance = createPolygonVertexAffordance<CeilingNode>(
  'ceiling',
  ceilingSnapOptions,
)
export const ceilingAddVertexAffordance = createPolygonAddVertexAffordance<CeilingNode>(
  'ceiling',
  ceilingSnapOptions,
)
export const ceilingMoveEdgeAffordance = createPolygonMoveEdgeAffordance<CeilingNode>(
  'ceiling',
  ceilingSnapOptions,
)
export const ceilingDeleteVertexAffordance = createPolygonDeleteVertexAffordance<CeilingNode>(
  'ceiling',
  ceilingSnapOptions,
)
