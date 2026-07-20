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

const GROUNDED_SLAB_EPSILON = 1e-3

export function applySlabTopChange(slab: SlabNode, newTop: number): Partial<SlabNode> {
  if (slab.recessed) return { elevation: newTop, recessed: newTop < 0 }

  const underside = slab.elevation - slab.thickness
  if (Math.abs(underside) < GROUNDED_SLAB_EPSILON) {
    return newTop > 0
      ? { elevation: newTop, thickness: newTop, recessed: false }
      : { elevation: newTop, recessed: true }
  }

  return { elevation: Math.max(newTop, slab.thickness), recessed: false }
}

export function applySlabElevationPreset(newTop: number): Partial<SlabNode> {
  return newTop < 0
    ? { elevation: newTop, recessed: true }
    : { elevation: newTop, thickness: Math.max(newTop, 0), recessed: false }
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
