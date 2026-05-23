import type { SlabNode } from '@pascal-app/core'
import {
  createPolygonAddVertexAffordance,
  createPolygonMoveEdgeAffordance,
  createPolygonVertexAffordance,
} from '../shared/polygon-vertex-affordance'

/**
 * 2D drag affordances for slab. Three operations, each accepting an
 * optional `holeIndex` in the payload so they target the boundary
 * polygon or a specific hole:
 *
 *   - `move-vertex` — drag an existing vertex.
 *   - `add-vertex` — insert a new vertex at a midpoint then drag.
 *   - `move-edge` — drag a whole edge perpendicular to itself.
 *
 * Holes are surfaced inline alongside the boundary in `def.floorplan`
 * (no separate "hole edit mode" state machine like the legacy) — when
 * the slab is selected, every hole's handles appear at the same time.
 * Simpler model, no UX downside in practice.
 */
export const slabMoveVertexAffordance = createPolygonVertexAffordance<SlabNode>('slab')
export const slabAddVertexAffordance = createPolygonAddVertexAffordance<SlabNode>('slab')
export const slabMoveEdgeAffordance = createPolygonMoveEdgeAffordance<SlabNode>('slab')
