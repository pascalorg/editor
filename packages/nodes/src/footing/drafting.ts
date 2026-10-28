import {
  type AnyNode,
  type AnyNodeId,
  FOOTING_SIZES,
  FootingNode,
  type FootingShape,
  footingPlan,
  type WallNode,
} from '@pascal-app/core'
import type { WallPlanPoint } from '@pascal-app/editor'

/**
 * A footing as the wall snap reads a wall: a strip's centreline, a pad's centre (a segment of no
 * length, so its ends and middle are the centre). The wall snap's corners, midpoints, crossings
 * and bodies then catch footings as they catch walls.
 */
function snapReference(footing: FootingNode): WallNode | null {
  const plan = footingPlan(footing)
  if (!plan) return null
  const [start, end] = plan.shape === 'strip' ? [plan.start, plan.end] : [plan.center, plan.center]
  return {
    object: 'node',
    id: footing.id as unknown as WallNode['id'],
    type: 'wall',
    parentId: footing.parentId,
    visible: true,
    metadata: {},
    children: [],
    start,
    end,
    frontSide: 'unknown',
    backSide: 'unknown',
  }
}

/**
 * What a footing drafted on `levelId` snaps to, through the wall snap (`snapWallDraftPoint`): the
 * level's wall centrelines and its footings.
 */
export function footingSnapTargets(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: string,
  ignoreIds: readonly string[] = [],
): WallNode[] {
  const targets: WallNode[] = []
  for (const node of Object.values(nodes)) {
    if (node.parentId !== levelId || node.visible === false || ignoreIds.includes(node.id)) continue
    if (node.type === 'wall') targets.push(node)
    else if (node.type === 'footing') {
      const reference = snapReference(node)
      if (reference) targets.push(reference)
    }
  }
  return targets
}

/** The footing a draft makes: a strip `start` → `end`, or a pad at `end`, at its shape's sizes. */
export function draftFooting(
  shape: FootingShape,
  start: WallPlanPoint | null,
  end: WallPlanPoint,
  fields: Partial<FootingNode> = {},
): FootingNode | null {
  if (shape === 'pad')
    return FootingNode.parse({ ...FOOTING_SIZES.pad, ...fields, shape, center: end })
  if (!start) return null
  return FootingNode.parse({ ...FOOTING_SIZES.strip, ...fields, shape, start, end })
}
