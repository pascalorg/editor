import type { AnyNode, AnyNodeId, StairNode, StairSegmentNode } from '../../schema'

export type StairMirrorResult = {
  stairUpdates: Partial<StairNode>
  segmentUpdates: Array<{ id: AnyNodeId; updates: Partial<StairSegmentNode> }>
}

function mirrorSide<T extends string>(side: T): T | 'left' | 'right' {
  if (side === 'left') return 'right'
  if (side === 'right') return 'left'
  return side
}

/**
 * Computes updates to mirror a stair's handedness in place.
 *
 * - Straight stairs (segment-based, e.g. Cut Back / U-shape / L-shape):
 *   inverts child segment attachment sides and winder turns ('left' <-> 'right').
 * - Curved & spiral stairs: inverts the sweep angle sign (same as switching
 *   between Clockwise and Counterclockwise).
 * - Guards and handrails: inverts one-sided modes ('left' <-> 'right').
 *
 * Preserves all other dimensions, elevations, step counts, and positions.
 * Both result collections are empty when mirroring would change nothing.
 */
export function getStairMirrorUpdates(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
): StairMirrorResult {
  const stairUpdates: Partial<StairNode> = {}
  const segmentUpdates: StairMirrorResult['segmentUpdates'] = []

  const railingMode = mirrorSide(stair.railingMode)
  if (railingMode !== stair.railingMode) stairUpdates.railingMode = railingMode

  if (stair.handrail) {
    const handrailMode = mirrorSide(stair.handrail.mode)
    if (handrailMode !== stair.handrail.mode) {
      stairUpdates.handrail = { ...stair.handrail, mode: handrailMode }
    }
  }

  if (stair.stairType === 'straight') {
    for (const childId of stair.children) {
      const segment = nodes[childId as AnyNodeId]
      if (segment?.type !== 'stair-segment') continue
      const updates: Partial<StairSegmentNode> = {}
      const attachmentSide = mirrorSide(segment.attachmentSide)
      if (attachmentSide !== segment.attachmentSide) updates.attachmentSide = attachmentSide
      if (segment.winder) {
        updates.winder = { ...segment.winder, turn: mirrorSide(segment.winder.turn) }
      }
      if (Object.keys(updates).length > 0) {
        segmentUpdates.push({ id: segment.id as AnyNodeId, updates })
      }
    }
  } else if (stair.sweepAngle !== 0) {
    stairUpdates.sweepAngle = -stair.sweepAngle
  }

  return { stairUpdates, segmentUpdates }
}

export function hasStairMirrorUpdates({ stairUpdates, segmentUpdates }: StairMirrorResult) {
  return Object.keys(stairUpdates).length > 0 || segmentUpdates.length > 0
}
