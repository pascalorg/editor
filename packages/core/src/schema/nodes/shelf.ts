import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Parametric shelf — a free-standing or table-top horizontal surface.
 *
 * v1: free-standing only. Wall-mount via a `mount` discriminator lands in
 * Phase 5 alongside item migration. Until then, position is the world
 * (or level-local) position of the shelf's center; rotation is yaw only.
 *
 * Schema lives in core because `AnyNode` (also in core) needs to reference
 * it via the hand-maintained discriminated union. Phase 6 derives `AnyNode`
 * from `nodeRegistry.schemas()` and this file moves entirely into
 * `@pascal-app/nodes/shelf/`.
 */
export const ShelfNode = BaseNode.extend({
  id: objectId('shelf'),
  type: nodeType('shelf'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // Dimensions (meters)
  width: z.number().min(0.3).max(3.0).default(1.2),
  depth: z.number().min(0.1).max(1.0).default(0.3),
  thickness: z.number().min(0.01).max(0.1).default(0.04),
  /** Distance from the floor to the bottom of the shelf top board. */
  height: z.number().min(0.05).max(2.5).default(0.9),

  bracketStyle: z.enum(['minimal', 'industrial', 'hidden']).default('minimal'),
  color: z.string().default('#a07050'),
})

export type ShelfNode = z.infer<typeof ShelfNode>
