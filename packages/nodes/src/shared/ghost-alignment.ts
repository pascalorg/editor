import {
  type AlignmentAnchor,
  type AnyNode,
  bboxCornerAnchors,
  collectAlignmentAnchors,
  resolveAlignment,
} from '@pascal-app/core'

/** XZ axis-aligned bounds (level-local meters). */
export type Aabb2D = { minX: number; minZ: number; maxX: number; maxZ: number }

/**
 * Figma-style alignment-snap threshold (meters), matching the generic
 * `MoveRegistryNodeTool` and the 2D overlay — 8 cm gives a magnetic pull
 * without fighting grid snap.
 */
export const GHOST_ALIGNMENT_THRESHOLD_M = 0.08

/**
 * Alignment anchors of every OTHER node on the level — gathered once at
 * drag-start (the scene graph is stable during an imperative ghost drag).
 */
export function collectGhostAlignmentCandidates(
  nodes: Readonly<Record<string, AnyNode>>,
  excludeId: string,
  levelId: string | null | undefined,
): AlignmentAnchor[] {
  return collectAlignmentAnchors(nodes, excludeId, levelId)
}

/**
 * Resolve the alignment snap for a moving ghost whose footprint is the
 * axis-aligned box `aabb`. Returns the XZ delta that snaps the box's edges
 * onto a candidate plus the guide lines to publish (relative to the box's
 * corners — "placement guideline shown relative to the bounding box").
 */
export function resolveGhostAlignment(
  nodeId: string,
  aabb: Aabb2D,
  candidates: AlignmentAnchor[],
): { dx: number; dz: number; guides: ReturnType<typeof resolveAlignment>['guides'] } {
  const moving = bboxCornerAnchors(nodeId, aabb.minX, aabb.minZ, aabb.maxX, aabb.maxZ)
  const result = resolveAlignment({
    moving,
    candidates,
    threshold: GHOST_ALIGNMENT_THRESHOLD_M,
  })
  return { dx: result.snap?.dx ?? 0, dz: result.snap?.dz ?? 0, guides: result.guides }
}
