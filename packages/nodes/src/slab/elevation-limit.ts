import {
  type AnyNode,
  type AnyNodeId,
  clampSlabElevationForWalls,
  getSlabElevationUpperBound,
  getSlabSlopePlane,
  getStoredLevelHeight,
  type LevelNode,
  MAX_SLAB_SLOPE_DEGREES,
  MIN_SLAB_THICKNESS,
  normalizeSlabSlopeDirection,
  type SlabElevationClamp,
  type SlabNode,
  type SlabSlope,
  type WallNode,
} from '@pascal-app/core'

type SlabLevelContext = {
  storeyHeight: number
  walls: WallNode[]
  slabs: SlabNode[]
}

const GROUNDED_SLAB_EPSILON = 1e-3

/** Level-local Y of a solid slab's underside (its placement anchor). */
export function getSlabBaseElevation(slab: Pick<SlabNode, 'elevation' | 'thickness'>): number {
  return (slab.elevation ?? 0.05) - (slab.thickness ?? 0.05)
}

/** Stable vertical reference used by relative slab presets. */
export function getSlabAnchorElevation(
  slab: Pick<SlabNode, 'elevation' | 'thickness' | 'recessed' | 'recessedRimElevation'>,
): number {
  return slab.recessed ? (slab.recessedRimElevation ?? 0) : getSlabBaseElevation(slab)
}

/**
 * Translate a solid slab to a new underside elevation without changing its
 * authored thickness. Recessed slabs use a different rim/depth contract and
 * keep the existing top/depth control instead.
 */
export function applySlabBaseElevationChange(
  slab: Pick<SlabNode, 'thickness'>,
  newBase: number,
): Pick<SlabNode, 'elevation'> {
  return { elevation: newBase + (slab.thickness ?? 0.05) }
}

/** Translate a solid underside or recessed rim without resizing the body. */
export function applySlabAnchorElevationChange(
  slab: Pick<SlabNode, 'elevation' | 'thickness' | 'recessed' | 'recessedRimElevation'>,
  newAnchor: number,
): Partial<SlabNode> {
  if (!slab.recessed) return applySlabBaseElevationChange(slab, newAnchor)
  const rim = getSlabAnchorElevation(slab)
  return {
    elevation: slab.elevation + (newAnchor - rim),
    recessedRimElevation: newAnchor,
  }
}

export function getSlabRecessDepth(
  slab: Pick<SlabNode, 'elevation' | 'recessedRimElevation'>,
): number {
  return Math.max(MIN_SLAB_THICKNESS, (slab.recessedRimElevation ?? 0) - slab.elevation)
}

/** Resize a recess downward while keeping its rim anchor fixed. */
export function applySlabRecessDepthChange(
  slab: Pick<SlabNode, 'recessedRimElevation'>,
  newDepth: number,
): Pick<SlabNode, 'elevation'> {
  const depth = Math.max(MIN_SLAB_THICKNESS, newDepth)
  return { elevation: (slab.recessedRimElevation ?? 0) - depth }
}

/**
 * Resize a solid slab upward from its underside. The occupied interval changes
 * from [base, old top] to [base, base + new thickness], so anything hosted on
 * the walking surface observes the new elevation.
 */
export function applySlabThicknessChange(
  slab: Pick<SlabNode, 'elevation' | 'thickness'>,
  newThickness: number,
): Pick<SlabNode, 'elevation' | 'thickness' | 'recessed'> {
  const thickness = Math.max(MIN_SLAB_THICKNESS, newThickness)
  return {
    elevation: getSlabBaseElevation(slab) + thickness,
    thickness,
    recessed: false,
  }
}

/**
 * Move a slab's authored top while preserving thickness. Recessed slabs keep
 * their pool-depth gesture; a grounded solid crossing below datum becomes
 * recessed. Solid slab thickness is edited separately.
 */
export function applySlabTopChange(slab: SlabNode, newTop: number): Partial<SlabNode> {
  if (slab.recessed) {
    const rim = getSlabAnchorElevation(slab)
    if (newTop < rim) return { elevation: newTop, recessed: true }
    return {
      elevation: Math.max(newTop, rim + MIN_SLAB_THICKNESS),
      thickness: Math.max(MIN_SLAB_THICKNESS, newTop - rim),
      recessed: false,
      recessedRimElevation: undefined,
    }
  }

  const grounded = Math.abs(slab.elevation - slab.thickness) < GROUNDED_SLAB_EPSILON
  if (grounded && newTop <= 0) return { elevation: newTop, recessed: true, slope: undefined }

  return { elevation: newTop, recessed: false }
}

/**
 * Apply a signed surface preset around the current anchor. Negative values make
 * a recess below the anchor; positive values make a solid upward from it.
 */
export function applySlabElevationPreset(slab: SlabNode, signedDepth: number): Partial<SlabNode> {
  const anchor = getSlabAnchorElevation(slab)
  if (signedDepth < 0) {
    return {
      elevation: anchor + signedDepth,
      recessed: true,
      recessedRimElevation: anchor,
      fillToTerrain: undefined,
      slope: undefined,
    }
  }
  const thickness = Math.max(MIN_SLAB_THICKNESS, signedDepth)
  return {
    elevation: anchor + thickness,
    thickness,
    recessed: false,
    recessedRimElevation: undefined,
  }
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
    nodes,
  )
}

/** Drag-time upper bound for the slab height arrow; +Infinity when unconstrained. */
export function slabElevationUpperBound(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  slab: SlabNode,
): number {
  const context = resolveSlabLevelContext(nodes, slab)
  if (!context) return Number.POSITIVE_INFINITY
  return getSlabElevationUpperBound(slab, context.walls, context.slabs, context.storeyHeight, nodes)
}

/**
 * Clamp a proposed slab slope so its high edge never squeezes a plane-bound
 * wall below MIN_WALL_HEIGHT. Unconstrained slabs pass through normalized.
 */
export function clampSlabSlope(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  slab: SlabNode,
  proposedSlope: SlabSlope | undefined,
): SlabSlope | undefined {
  if (!proposedSlope) return undefined
  const pitch = Math.min(Math.max(proposedSlope.pitch, 0), MAX_SLAB_SLOPE_DEGREES)
  if (pitch <= 1e-6) return undefined
  const direction = normalizeSlabSlopeDirection(proposedSlope.direction)
  const flatUpper = slabElevationUpperBound(nodes, { ...slab, slope: undefined })
  if (!Number.isFinite(flatUpper)) return { direction, pitch }

  const candidate: SlabNode = { ...slab, slope: { direction, pitch } }
  const plane = getSlabSlopePlane(candidate)
  if (plane.span <= 1e-6) return { direction, pitch }

  const slopedUpper = slabElevationUpperBound(nodes, candidate)
  const currentElevation = slab.elevation ?? 0.05
  if (!Number.isFinite(slopedUpper) || currentElevation <= slopedUpper + 1e-9) {
    return { direction, pitch }
  }

  // Derive the exact span along the uphill direction to the highest overlapping
  // plane-bound wall rather than capping against the slab's full polygon span.
  const wallLocalRise = Math.max(0, flatUpper - slopedUpper)
  const wallSpan = plane.grade > 1e-9 ? wallLocalRise / plane.grade : 0
  if (wallSpan <= 1e-6) return { direction, pitch }

  const maxRise = Math.max(0, flatUpper - currentElevation)
  const maxPitch = (Math.atan(maxRise / wallSpan) * 180) / Math.PI
  // Floor to 0.01° so rounding never overshoots flatUpper.
  const clampedPitch = Math.floor(Math.min(pitch, maxPitch) * 100) / 100
  if (clampedPitch <= 1e-4) return undefined
  return { direction, pitch: clampedPitch }
}
