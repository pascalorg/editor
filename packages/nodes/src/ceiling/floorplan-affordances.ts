import { type AnyNode, type CeilingNode, resolveLevelId } from '@pascal-app/core'
import { resolveCeilingPlanPointSnap } from '@pascal-app/editor'
import {
  createPolygonAddVertexAffordance,
  createPolygonMoveEdgeAffordance,
  createPolygonVertexAffordance,
  type PolygonAffordanceSnapContext,
} from '../shared/polygon-vertex-affordance'

/**
 * 2D drag affordances for ceiling. Same three operations as slab
 * (`move-vertex`, `add-vertex`, `move-edge`), each accepting an
 * optional `holeIndex`. See `slab/floorplan-affordances.ts` for the
 * full contract.
 */
const ceilingSnapOptions = {
  resolvePlanPoint({
    node,
    nodes,
    rawPoint,
    fallbackPoint,
    modifiers,
  }: PolygonAffordanceSnapContext<CeilingNode>) {
    const sceneNodes = nodes as Record<string, AnyNode>
    return resolveCeilingPlanPointSnap({
      rawPoint,
      fallbackPoint,
      levelId: resolveLevelId(node, sceneNodes),
      excludeId: node.id,
      nodes: sceneNodes,
      // Magnetic wall-snap/alignment gates on `isMagneticSnapActive()` (the
      // `lines` mode), so no Shift bypass — Alt still force-skips alignment.
      altKey: modifiers.altKey,
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
