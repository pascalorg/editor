import {
  type AnyNode,
  type AnyNodeId,
  clampSlabElevationForWalls,
  getSlabElevationUpperBound,
  getStoredLevelHeight,
  type LevelNode,
  type SlabElevationClamp,
  type SlabNode,
  type WallNode,
} from '@pascal-app/core'

type SlabLevelContext = {
  storeyHeight: number
  walls: WallNode[]
  slabs: SlabNode[]
}

function resolveSlabLevelContext(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  slab: SlabNode,
): SlabLevelContext | null {
  const parent = slab.parentId ? nodes[slab.parentId as AnyNodeId] : undefined
  if (parent?.type !== 'level') return null
  const level = parent as LevelNode
  const children = level.children.map((childId) => nodes[childId as AnyNodeId])
  return {
    storeyHeight: getStoredLevelHeight(level),
    walls: children.filter((child): child is WallNode => child?.type === 'wall'),
    slabs: children.filter((child): child is SlabNode => child?.type === 'slab'),
  }
}

/**
 * Level-context wrapper over the pure core clamp: a slab under
 * plane-bound walls may not rise past the storey plane minus the
 * minimum wall height. Slabs outside a level (no parent) are
 * unconstrained.
 */
export function clampSlabElevation(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  slab: SlabNode,
  proposedElevation: number,
): SlabElevationClamp {
  const context = resolveSlabLevelContext(nodes, slab)
  if (!context) return { elevation: proposedElevation, clamped: false }
  return clampSlabElevationForWalls(
    proposedElevation,
    slab,
    context.walls,
    context.slabs,
    context.storeyHeight,
  )
}

/** Drag-time upper bound for the slab height arrow; +Infinity when unconstrained. */
export function slabElevationUpperBound(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  slab: SlabNode,
): number {
  const context = resolveSlabLevelContext(nodes, slab)
  if (!context) return Number.POSITIVE_INFINITY
  return getSlabElevationUpperBound(slab, context.walls, context.slabs, context.storeyHeight)
}
