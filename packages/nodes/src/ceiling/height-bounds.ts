import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  getCeilingClampBound,
  getCeilingMinHeight,
} from '@pascal-app/core'

/** Handle floor for a ceiling at grade: keeps the drag arrow off the floor. */
export const CEILING_HANDLE_MIN_HEIGHT = 0.5
/** Panel slider floor for a ceiling at grade. */
export const CEILING_PANEL_MIN_HEIGHT = 0

export type CeilingHeightRange = { min: number; max: number }

/**
 * Where a ceiling's stored height may go. `max` clamps under the storey
 * plane and any covering slab from the level above (clamp, never ask);
 * `min` lets a ceiling on a level above grade hang down to grade, and
 * keeps `atGradeMin` on the ground storey.
 */
export function ceilingHeightRange(
  ceiling: Pick<CeilingNode, 'parentId' | 'polygon'>,
  nodes: Record<AnyNodeId, AnyNode>,
  atGradeMin: number,
): CeilingHeightRange {
  const parent = ceiling.parentId ? nodes[ceiling.parentId as AnyNodeId] : undefined
  if (parent?.type !== 'level') return { min: atGradeMin, max: Number.POSITIVE_INFINITY }
  return {
    min: getCeilingMinHeight(parent.id, nodes, atGradeMin),
    max: getCeilingClampBound(parent.id, nodes, ceiling.polygon ?? []),
  }
}

/** Same order as the slider and handle clamps: the upper bound wins a conflict. */
export function clampCeilingHeight(height: number, range: CeilingHeightRange): number {
  return Math.min(range.max, Math.max(range.min, height))
}
