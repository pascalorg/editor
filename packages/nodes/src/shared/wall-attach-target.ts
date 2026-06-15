import {
  type AnyNode,
  type AnyNodeId,
  getScaledDimensions,
  type ItemNode,
  isCurvedWall,
  type WallNode,
} from '@pascal-app/core'

/**
 * Shared helpers for the kinds whose 2D move snaps onto a wall in plan
 * space (door, window, item with `attachTo === 'wall' | 'wall-side'`).
 *
 * The 3D move tools listen to R3F `WallEvent`s (mesh-hit with normal)
 * for wall snapping. The 2D path doesn't have that — pointer events
 * land on the SVG layer, not on the wall meshes. This helper does the
 * equivalent plan-space projection: for each wall on the level, find
 * the perpendicular projection of the pointer onto the wall line and
 * pick the closest one within a reasonable range.
 *
 * Curved walls are excluded — the legacy door / window placement also
 * rejects curved walls (mitering + arc + opening would tear in 3D).
 */

// Max cursor-to-wall distance (metres) for a 2D opening to snap onto a wall.
// Kept tight: plan walls are thin and often close together, so a large radius
// would grab a wall the cursor isn't really near. The wall chosen is always
// the single closest segment to the cursor (true Voronoi nearest), and only if
// it's within this radius.
const WALL_SNAP_DISTANCE_M = 0.4

export type WallHit = {
  wall: WallNode
  /** Distance along the wall from `start` (clamped to [0, length]). */
  localX: number
  /** Signed perpendicular distance from the wall axis (+ on the "front" side). */
  perpDistance: number
  /** Which face of the wall the pointer was on. */
  side: 'front' | 'back'
  /** Wall direction unit vector, x. */
  dirX: number
  /** Wall direction unit vector, y (== z in plan). */
  dirY: number
  /** Wall length in metres. */
  wallLength: number
  /**
   * Rotation around Y in **wall-local** space — 0 for the front face,
   * π for the back. Matches the 3D `calculateItemRotation(normal)`
   * convention (normal +Z → 0, normal -Z → π). Items / doors / windows
   * are children of the wall mesh, so their `rotation.y` is in the
   * wall's local frame; writing a world-space rotation here would mis-
   * orient the node by `wallRotation` (off by 90° on vertical walls).
   */
  itemRotation: number
}

export function projectWallLocalPointToPlan(
  wall: WallNode,
  localX: number,
  localZ = 0,
): [number, number] {
  const angle = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [wall.start[0] + localX * c + localZ * s, wall.start[1] - localX * s + localZ * c]
}

/**
 * Walk every wall under `parentLevelId` and return the closest one to
 * `planPoint`, or `null` if no wall is within `WALL_SNAP_DISTANCE_M`.
 * `excludeWallId` skips a specific wall (e.g. the current parent during
 * a re-parent flow if you want a "must change" guard).
 */
export function findClosestWallInPlan(
  planPoint: readonly [number, number],
  nodes: Record<AnyNodeId, AnyNode>,
  parentLevelId: AnyNodeId | null,
  excludeWallId?: AnyNodeId,
): WallHit | null {
  if (!parentLevelId) return null
  const level = nodes[parentLevelId]
  const childIds = (level as unknown as { children?: AnyNodeId[] })?.children
  if (!Array.isArray(childIds)) return null

  let best: WallHit | null = null
  // Segment distance (cursor → closest point on the wall segment) of `best`.
  // The wall we snap to is the one minimising THIS, so a door never jumps to a
  // farther wall just because the cursor's perpendicular offset to its infinite
  // line happens to be small. `perpDistance` on `WallHit` is the signed offset
  // for the side calc only — never the closeness metric.
  let bestDistance = Number.POSITIVE_INFINITY

  for (const childId of childIds) {
    const node = nodes[childId]
    if (!node || node.type !== 'wall') continue
    if (childId === excludeWallId) continue
    const wall = node as WallNode
    if (isCurvedWall(wall)) continue

    const sx = wall.start[0]
    const sy = wall.start[1]
    const dx = wall.end[0] - sx
    const dy = wall.end[1] - sy
    const wallLength = Math.hypot(dx, dy)
    if (wallLength < 1e-6) continue

    const dirX = dx / wallLength
    const dirY = dy / wallLength

    // Project pointer onto wall axis.
    const px = planPoint[0] - sx
    const py = planPoint[1] - sy
    const along = px * dirX + py * dirY
    const perpRaw = px * -dirY + py * dirX // signed perpendicular distance
    const clampedAlong = Math.max(0, Math.min(wallLength, along))

    // Distance from the pointer to the wall segment (not just the line).
    const closestPointX = sx + dirX * clampedAlong
    const closestPointY = sy + dirY * clampedAlong
    const distance = Math.hypot(planPoint[0] - closestPointX, planPoint[1] - closestPointY)
    if (distance > WALL_SNAP_DISTANCE_M) continue
    // Keep only the single closest wall segment (strict nearest). Compare true
    // segment distances — not perpDistance — so close-together walls resolve to
    // whichever the cursor is actually nearest.
    if (distance >= bestDistance) continue

    // Side determination, calibrated to the 3D wall convention. In
    // wall-local space the wall extends along +X and its +Z axis is the
    // front-face normal. After `mesh.rotation.y = -wallAngle`:
    //   - For a wall going `+X` in plan (wallAngle=0): wall-local +Z
    //     maps to world +Z = plan +Y, so the front face is on plan +Y.
    //     `perpRaw = py` is positive → front.
    //   - For a wall going `+Y` in plan (wallAngle=π/2): wall-local +Z
    //     maps to world -X = plan -X, so the front face is on plan -X.
    //     `perpRaw = -px` is positive there → front.
    // So `perpRaw >= 0` is consistently the front side. The earlier
    // labelling had this flipped, which produced rotations that were
    // off by 90° on non-horizontal walls.
    const side: 'front' | 'back' = perpRaw >= 0 ? 'front' : 'back'

    // Rotation in wall-local space — matches 3D `calculateItemRotation`:
    // 0 when the item faces the front normal (+Z), π for the back. The
    // node is parented to the wall, so this composes with the wall's
    // own rotation when rendered. Don't return a world-space rotation
    // here — the consumer writes this straight into `node.rotation[1]`.
    const itemRotation = side === 'front' ? 0 : Math.PI

    bestDistance = distance
    best = {
      wall,
      localX: clampedAlong,
      perpDistance: perpRaw,
      side,
      dirX,
      dirY,
      wallLength,
      itemRotation,
    }
  }

  return best
}

/** Figma-style along-wall alignment threshold (meters) — parity with the
 *  XZ placement / move threshold. */
const ALONG_WALL_ALIGN_THRESHOLD_M = 0.08

/** The along-wall span of a wall-hosted node (door / window / wall item):
 *  its centre `localX` and half-width. `null` for kinds with no along-wall
 *  footprint. */
function wallAttachmentSpan(node: AnyNode): { center: number; half: number } | null {
  if (node.type === 'door' || node.type === 'window') {
    const n = node as { position: [number, number, number]; width: number }
    return { center: n.position[0], half: n.width / 2 }
  }
  if (node.type === 'item') {
    const item = node as ItemNode
    const attachTo = item.asset.attachTo
    if (attachTo !== 'wall' && attachTo !== 'wall-side') return null
    const [w] = getScaledDimensions(item)
    return { center: item.position[0], half: w / 2 }
  }
  return null
}

/**
 * Figma-style alignment for a wall-hosted opening / item, along the wall
 * axis. Snaps the moving node's edges (or centre) to other attachments'
 * edges/centres on the same wall, plus the wall ends. Edge-to-edge first,
 * so two doors line up flush.
 *
 * Returns the adjusted `localX` when a neighbour stop is within threshold,
 * or `null` when nothing aligns — callers treat `null` as "no alignment,
 * fall back to the grid snap". This lets along-wall alignment COMPETE with
 * the 0.5m grid (openings have arbitrary widths rarely on the grid, so
 * layering on top of the grid snap would almost never trigger).
 *
 * Snap-only for v1 — no guide is published (the floor-plan guide layer
 * renders XZ guides; an along-wall guide on a diagonal wall needs extra
 * projection work, deferred).
 */
export function snapLocalXToNeighbors(args: {
  wall: WallNode
  localX: number
  width: number
  selfId: AnyNodeId
  nodes: Record<AnyNodeId, AnyNode>
  threshold?: number
}): number | null {
  const { wall, localX, width, selfId, nodes, threshold = ALONG_WALL_ALIGN_THRESHOLD_M } = args
  const half = width / 2
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])

  // Candidate stops along the wall: both ends + every other attachment's
  // edges and centre.
  const candidateStops: number[] = [0, wallLength]
  for (const node of Object.values(nodes)) {
    if (!node || node.id === selfId) continue
    if ((node as { parentId?: string }).parentId !== wall.id) continue
    const span = wallAttachmentSpan(node)
    if (!span) continue
    candidateStops.push(span.center - span.half, span.center, span.center + span.half)
  }

  // Moving stops: our two edges (edge-to-edge alignment) + centre.
  const movingStops = [localX - half, localX, localX + half]

  let bestDelta: number | null = null
  let bestAbs = threshold
  for (const ms of movingStops) {
    for (const cs of candidateStops) {
      const d = cs - ms
      const ad = Math.abs(d)
      if (ad <= bestAbs && (bestDelta === null || ad < bestAbs)) {
        bestAbs = ad
        bestDelta = d
      }
    }
  }

  return bestDelta === null ? null : localX + bestDelta
}
