import {
  type AnyNode,
  type ItemNode,
  isPlanDragMovableItem,
  nodeRegistry,
  resolveMovable,
} from '@pascal-app/core'

const BESPOKE_PLAN_DRAG_3D_KINDS = [
  'item',
  'stair',
  'stair-segment',
  'pipe',
  'wall',
  'fence',
  'column',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'elevator',
] as const
const BESPOKE_PLAN_DRAG_3D_KIND_SET = new Set<string>(BESPOKE_PLAN_DRAG_3D_KINDS)

/** Pointer movement before a pending plan drag becomes an active move. */
export const PLAN_DRAG_THRESHOLD_PX = 4

function hasPlanAxes(axes: ReadonlyArray<'x' | 'y' | 'z'> | undefined): boolean {
  return !!axes && axes.includes('x') && axes.includes('z')
}

/**
 * Kinds that support select-and-drag on the 3D canvas (plan X/Z).
 *
 * Keep the legacy bespoke movers (item/stair/wall/fence/pipe) and add every
 * registry kind that declares X/Z movement. This makes primitive geometry
 * follow the same selected-drag contract as stairs without hardcoding each new
 * primitive kind.
 */
export function getPlanDrag3DKinds(): string[] {
  const kinds = new Set<string>(BESPOKE_PLAN_DRAG_3D_KINDS)
  for (const [kind, def] of nodeRegistry.entries()) {
    if (hasPlanAxes(def.capabilities.movable?.axes)) {
      kinds.add(kind)
    }
  }
  return [...kinds]
}

export function isPlanDragMovableNode(node: AnyNode): boolean {
  if (node.type === 'item') return isPlanDragMovableItem(node as ItemNode)
  if (BESPOKE_PLAN_DRAG_3D_KIND_SET.has(node.type)) return true
  return hasPlanAxes(resolveMovable(node)?.axes)
}
