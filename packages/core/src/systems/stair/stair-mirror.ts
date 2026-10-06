import type { AnyNode, AnyNodeId, StairNode, StairSegmentNode } from '../../schema'

export type StairMirrorResult = {
  stairUpdates: Partial<StairNode>
  segmentUpdates: Array<{ id: AnyNodeId; updates: Partial<StairSegmentNode> }>
}

/**
 * Computes updates to mirror a stair's handedness in place.
 *
 * - Straight stairs (segment-based, e.g. Cut Back / U-shape / L-shape):
 *   inverts child segment attachment sides ('left' <-> 'right').
 * - Curved & spiral stairs:
 *   inverts the sweep angle sign (-sweepAngle).
 * - Railings:
 *   inverts asymmetric railing side ('left' <-> 'right').
 *
 * Preserves all other dimensions, elevations, step counts, and positions.
 */
export function getStairMirrorUpdates(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
): StairMirrorResult {
  const stairUpdates: Partial<StairNode> = {}
  const segmentUpdates: Array<{ id: AnyNodeId; updates: Partial<StairSegmentNode> }> = []

  // 1. Invert asymmetric railing mode
  if (stair.railingMode === 'left') {
    stairUpdates.railingMode = 'right'
  } else if (stair.railingMode === 'right') {
    stairUpdates.railingMode = 'left'
  }

  // 2. Invert segment attachment sides for straight stairs
  if (stair.stairType === 'straight' || !stair.stairType) {
    const children = stair.children ?? []
    for (const childId of children) {
      const segment = nodes[childId as AnyNodeId] as StairSegmentNode | undefined
      if (segment?.type === 'stair-segment') {
        if (segment.attachmentSide === 'left') {
          segmentUpdates.push({
            id: segment.id as AnyNodeId,
            updates: { attachmentSide: 'right' },
          })
        } else if (segment.attachmentSide === 'right') {
          segmentUpdates.push({
            id: segment.id as AnyNodeId,
            updates: { attachmentSide: 'left' },
          })
        }
      }
    }
  } else if (stair.stairType === 'curved' || stair.stairType === 'spiral') {
    const defaultSweep = stair.stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2
    const currentSweep = stair.sweepAngle ?? defaultSweep
    stairUpdates.sweepAngle = -currentSweep
  }

  return { stairUpdates, segmentUpdates }
}
