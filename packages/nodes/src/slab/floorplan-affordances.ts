import { type AnyNode, resolveLevelId, type SlabNode } from '@pascal-app/core'
import { resolveSlabPlanPointSnap } from '@pascal-app/editor'
import {
  createPolygonAddVertexAffordance,
  createPolygonDeleteVertexAffordance,
  createPolygonMoveEdgeAffordance,
  createPolygonVertexAffordance,
  type PolygonAffordanceSnapContext,
} from '../shared/polygon-vertex-affordance'

/**
 * 2D affordances for slab. Four operations, each accepting an
 * optional `holeIndex` in the payload so they target the boundary
 * polygon or a specific hole:
 *
 *   - `move-vertex` — drag an existing vertex.
 *   - `add-vertex` — insert a new vertex at a midpoint then drag.
 *   - `move-edge` — drag a whole edge perpendicular to itself.
 *   - `delete-vertex` — remove a double-clicked vertex down to three.
 *
 * Holes are surfaced inline alongside the boundary in `def.floorplan`
 * (no separate "hole edit mode" state machine like the legacy) — when
 * the slab is selected, every hole's handles appear at the same time.
 * Simpler model, no UX downside in practice.
 */
const slabSnapOptions = {
  extraCommitData: { autoFromWalls: false },
  resolvePlanPoint({
    node,
    nodes,
    rawPoint,
    fallbackPoint,
  }: PolygonAffordanceSnapContext<SlabNode>) {
    const sceneNodes = nodes as Record<string, AnyNode>
    return resolveSlabPlanPointSnap({
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

export const slabMoveVertexAffordance = createPolygonVertexAffordance<SlabNode>(
  'slab',
  slabSnapOptions,
)
export const slabAddVertexAffordance = createPolygonAddVertexAffordance<SlabNode>(
  'slab',
  slabSnapOptions,
)
export const slabMoveEdgeAffordance = createPolygonMoveEdgeAffordance<SlabNode>(
  'slab',
  slabSnapOptions,
)
export const slabDeleteVertexAffordance = createPolygonDeleteVertexAffordance<SlabNode>(
  'slab',
  slabSnapOptions,
)
