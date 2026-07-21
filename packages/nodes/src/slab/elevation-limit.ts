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
/** Deck thickness an unsticking slab pops to — the schema default. */
const UNSTUCK_DECK_THICKNESS = 0.05
/**
 * Grounded-stretch ceiling for the 3D elevation arrow (m) — above any
 * plausible step/platform height. While grounded, dragging the top up to
 * here stretches the body; dragging past it unsticks the slab into a
 * thin floating deck and the drag continues as pure placement.
 */
export const SLAB_UNSTICK_THRESHOLD = 0.4

export type SlabTopChangeMode = 'drag' | 'panel'

/**
 * The one owner of the slab vertical-editing rules. Both edit surfaces
 * route through it: the viewport arrow as `mode: 'drag'`, the panel
 * elevation input as `mode: 'panel'`.
 *
 * Hysteresis-free state machine (pure in current state + newTop):
 *  - recessed → move the pool floor; rising to ≥ 0 un-recesses.
 *  - grounded, newTop ≤ 0 → pool gesture (both modes).
 *  - grounded drag, newTop ≤ {@link SLAB_UNSTICK_THRESHOLD} → stretch
 *    (elevation and thickness move together, underside stays at 0).
 *  - grounded drag past the threshold → unstick: pop to the default deck
 *    thickness and continue as placement.
 *  - otherwise (floating, or any panel edit) → placement: move the body
 *    preserving thickness, clamping the underside to the level plane —
 *    landing re-grounds the slab, so the way back up stretches again
 *    below the threshold.
 */
export function applySlabTopChange(
  slab: SlabNode,
  newTop: number,
  options: { mode: SlabTopChangeMode },
): Partial<SlabNode> {
  if (slab.recessed) return { elevation: newTop, recessed: newTop < 0 }

  const grounded = Math.abs(slab.elevation - slab.thickness) < GROUNDED_SLAB_EPSILON
  if (grounded && newTop <= 0) return { elevation: newTop, recessed: true }

  if (grounded && options.mode === 'drag') {
    return newTop <= SLAB_UNSTICK_THRESHOLD
      ? { elevation: newTop, thickness: newTop, recessed: false }
      : { elevation: newTop, thickness: UNSTUCK_DECK_THICKNESS, recessed: false }
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
