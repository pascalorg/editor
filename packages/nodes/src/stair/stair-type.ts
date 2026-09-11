import {
  type AnyNode,
  type AnyNodeId,
  createStairFlightFromStair,
  type StairNode,
  type StairSegmentNode,
  type StairType,
} from '@pascal-app/core'
import { DEFAULT_SPIRAL_STAIR_SWEEP_ANGLE } from '@pascal-app/editor'

export type StairTypeChange = {
  updates: Partial<StairNode>
  /** A flight to create under the stair, or null when the stair already has segments. */
  segment: StairSegmentNode | null
}

/**
 * Computes the stair patch for a type switch.
 *
 * Straight stairs are drawn from their `stair-segment` children while curved
 * and spiral stairs are drawn parametrically from the stair's own fields, so a
 * stair that reaches `straight` without segments has nothing to draw at all.
 * Switching to straight therefore materializes the flight the stair already
 * describes. Switching away keeps the segments — they simply go unused until
 * the stair comes back, which makes the round trip lossless.
 */
export function getStairTypeChange(
  stair: StairNode,
  nextType: StairType,
  nodes: Record<string, AnyNode>,
): StairTypeChange {
  const updates: Partial<StairNode> =
    nextType === 'spiral' && stair.stairType !== 'spiral'
      ? {
          stairType: nextType,
          sweepAngle: DEFAULT_SPIRAL_STAIR_SWEEP_ANGLE,
          position: [stair.position[0], 0, stair.position[2]],
        }
      : { stairType: nextType }

  if (nextType !== 'straight') return { updates, segment: null }

  const hasSegment = (stair.children ?? []).some(
    (childId) => nodes[childId as AnyNodeId]?.type === 'stair-segment',
  )
  return { updates, segment: hasSegment ? null : createStairFlightFromStair(stair, nodes) }
}
