/**
 * Self-healing backstop for wall geometry: every registered wall whose mesh
 * still carries the mount-time PLACEHOLDER geometry must eventually rebuild,
 * no matter what consumed its dirty mark or when the wall system mounted.
 *
 * Why it exists: a live session (QA f2 probe5/probe6 — scene loaded with
 * the Bones X-ray already active) surfaced all 24 walls stuck on their
 * degenerate placeholder collision meshes indefinitely: no wall on the
 * level ever became a ray target, so the hidden-wall selection gate could
 * not engage even in principle. The renderer marks a wall dirty exactly
 * once, on mount — if that one mark is consumed while the rebuild loop
 * isn't looking (system mounted late, mark cleared by an unrelated flow,
 * suspense unmount/remount), nothing ever re-marks it. This sweep closes
 * that class: placeholder + not dirty → re-mark, and the normal rebuild
 * path takes it from there. Idempotent and cheap (one geometry probe per
 * wall, run every `WALL_PLACEHOLDER_SWEEP_INTERVAL` frames).
 *
 * Placeholder detection: `createPlaceholderGeometry` (packages/nodes,
 * shared/placeholder-geometry.ts) mints a 3-vertex degenerate triangle and
 * stamps `userData.placeholder`. Real wall extrusions always carry far more
 * vertices, so the vertex-count signature doubles as a fallback for
 * placeholders minted before the stamp existed.
 */

export const WALL_PLACEHOLDER_SWEEP_INTERVAL = 30

type GeometryLike = {
  userData?: { placeholder?: unknown }
  getAttribute?: (name: string) => { count: number } | undefined
} | null

/** Is this still the mount-time placeholder (never built by the system)? */
export const isPlaceholderWallGeometry = (geometry: GeometryLike): boolean => {
  if (!geometry) return false
  if (geometry.userData?.placeholder === true) return true
  const position = geometry.getAttribute?.('position')
  return position !== undefined && position.count === 3
}

/**
 * Re-mark every registered wall still on placeholder geometry that carries
 * no dirty mark. Returns the ids it marked (for tests / diagnostics).
 */
export const sweepUnbuiltWalls = ({
  wallIds,
  geometryOf,
  isDirty,
  markDirty,
}: {
  /** Registered wall node ids (sceneRegistry.byType.wall). */
  wallIds: Iterable<string>
  /** The wall root mesh's current geometry, or null when unmounted. */
  geometryOf: (wallId: string) => GeometryLike
  /** Whether the id already has a dirty mark (rebuild pending). */
  isDirty: (wallId: string) => boolean
  markDirty: (wallId: string) => void
}): string[] => {
  const marked: string[] = []
  for (const wallId of wallIds) {
    if (isDirty(wallId)) continue
    if (!isPlaceholderWallGeometry(geometryOf(wallId))) continue
    markDirty(wallId)
    marked.push(wallId)
  }
  return marked
}
