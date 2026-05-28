import { type AnyNode, type ItemNode, isPlanDragMovableItem } from '@pascal-app/core'

/** Kinds that support select-and-drag on the 3D canvas (plan X/Z). */
export const PLAN_DRAG_3D_KINDS = ['item', 'stair', 'pipe', 'wall', 'fence', 'box'] as const
export type PlanDrag3DKind = (typeof PLAN_DRAG_3D_KINDS)[number]

/** Pointer movement before a pending plan drag becomes an active move. */
export const PLAN_DRAG_THRESHOLD_PX = 4

export function isPlanDragMovableNode(node: AnyNode): node is AnyNode & { type: PlanDrag3DKind } {
  if (node.type === 'stair') return true
  if (node.type === 'pipe') return true
  if (node.type === 'wall') return true
  if (node.type === 'fence') return true
  if (node.type === 'box') return true
  if (node.type === 'item') return isPlanDragMovableItem(node as ItemNode)
  return false
}
