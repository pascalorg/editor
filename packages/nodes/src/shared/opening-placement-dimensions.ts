import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  type FloorplanGeometry,
  type GeometryContext,
  isCurvedWall,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'

/**
 * Build placement-measurement dimension lines for a door / window
 * being moved on a wall. Mirrors the legacy
 * `movingOpeningPlacementMeasurements` in `floorplan-panel.tsx`:
 *
 *   - Find the previous opening on the same wall (or the wall start
 *     if none) → distance from its right face to this opening's
 *     left face.
 *   - Find the next opening (or wall end) → distance from this
 *     opening's right face to its left face.
 *   - Each renders as a `dimension` primitive offset to the wall's
 *     outer face so the labels don't overlap the wall body.
 *
 * Returns an empty array if the parent isn't a wall, the wall is
 * curved, or the opening is at wall length 0 (invalid).
 */
export function buildOpeningPlacementDimensions(
  opening: DoorNode | WindowNode,
  ctx: GeometryContext,
): FloorplanGeometry[] {
  const wall = ctx.parent as WallNode | null
  if (!wall || wall.type !== 'wall') return []
  if (isCurvedWall(wall)) return []

  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const wallLength = Math.hypot(dx, dz)
  if (wallLength < 1e-6) return []

  const dirX = dx / wallLength
  const dirZ = dz / wallLength

  // Outward normal — chosen by the wall builder via the level
  // centroid. We replicate that decision here so the dimension lines
  // land on the same face. Walk wall's siblings (the level's other
  // walls) via ctx.resolve to compute the centroid.
  const outwardNormal = computeOutwardNormal(wall, ctx, dirX, dirZ)

  const halfWidth = opening.width / 2
  const startDist = opening.position[0] - halfWidth
  const endDist = opening.position[0] + halfWidth

  // Walk wall.children to find adjacent openings (door OR window).
  // ctx.siblings only includes same-kind nodes; doors + windows need
  // each other so we go via the parent's children directly.
  const childIds = ((wall as unknown as { children?: AnyNodeId[] }).children ?? []) as AnyNodeId[]
  let leftBoundary: number | null = null
  let rightBoundary: number | null = null
  for (const childId of childIds) {
    if (childId === opening.id) continue
    const sibling = ctx.resolve(childId) as AnyNode | undefined
    if (!sibling || (sibling.type !== 'door' && sibling.type !== 'window')) continue
    const sib = sibling as DoorNode | WindowNode
    const sibStart = sib.position[0] - sib.width / 2
    const sibEnd = sib.position[0] + sib.width / 2
    if (sibEnd <= startDist && (leftBoundary === null || sibEnd > leftBoundary)) {
      leftBoundary = sibEnd
    }
    if (sibStart >= endDist && (rightBoundary === null || sibStart < rightBoundary)) {
      rightBoundary = sibStart
    }
  }

  const leftFromDist = leftBoundary ?? 0
  const rightToDist = rightBoundary ?? wallLength

  // Place the dimension line at a constant offset from the wall's
  // outer face — same value the legacy uses for its placement
  // measurements (`FLOORPLAN_WALL_OUTER_MEASUREMENT_OFFSET`). The
  // dimension's `start` / `end` are points on that outer face (not
  // the wall centerline), so the extension lines stay short and the
  // overall layout matches the legacy treatment 1:1.
  const wallThickness = wall.thickness ?? 0.1
  const halfThickness = wallThickness / 2
  const FLOORPLAN_WALL_OUTER_MEASUREMENT_OFFSET = 0.32

  // Project a point on the wall axis at distance `along` onto the
  // wall's outer face by adding `halfThickness * outwardNormal`.
  const facePoint = (along: number): readonly [number, number] => [
    x1 + dirX * along + outwardNormal[0] * halfThickness,
    z1 + dirZ * along + outwardNormal[1] * halfThickness,
  ]

  const out: FloorplanGeometry[] = []

  const leftDistance = startDist - leftFromDist
  if (leftDistance >= 0.01) {
    out.push({
      kind: 'dimension',
      start: facePoint(leftFromDist),
      end: facePoint(startDist),
      offsetNormal: outwardNormal,
      offsetDistance: FLOORPLAN_WALL_OUTER_MEASUREMENT_OFFSET,
      extensionOvershoot: 0.12,
      text: `${Number.parseFloat(leftDistance.toFixed(2))}m`,
      stroke: '#f97316',
    })
  }

  const rightDistance = rightToDist - endDist
  if (rightDistance >= 0.01) {
    out.push({
      kind: 'dimension',
      start: facePoint(endDist),
      end: facePoint(rightToDist),
      offsetNormal: outwardNormal,
      offsetDistance: FLOORPLAN_WALL_OUTER_MEASUREMENT_OFFSET,
      extensionOvershoot: 0.12,
      text: `${Number.parseFloat(rightDistance.toFixed(2))}m`,
      stroke: '#f97316',
    })
  }

  return out
}

/**
 * Choose the perpendicular wall normal that points away from the
 * other walls' centroid — same logic the wall builder uses to place
 * its own dimension overlay so left / right placement dimensions land
 * on the same face the wall label is on.
 */
function computeOutwardNormal(
  wall: WallNode,
  ctx: GeometryContext,
  dirX: number,
  dirZ: number,
): readonly [number, number] {
  const nx = -dirZ
  const nz = dirX

  // Find the level by walking up via wall.parentId.
  const level = wall.parentId
    ? (ctx.resolve(wall.parentId as AnyNodeId) as AnyNode | undefined)
    : null
  const levelChildren = ((level as unknown as { children?: AnyNodeId[] })?.children ??
    []) as AnyNodeId[]
  let sumX = 0
  let sumZ = 0
  let count = 0
  for (const childId of levelChildren) {
    const child = ctx.resolve(childId) as AnyNode | undefined
    if (!child || child.type !== 'wall') continue
    const w = child as WallNode
    sumX += w.start[0] + w.end[0]
    sumZ += w.start[1] + w.end[1]
    count += 2
  }
  if (count === 0) return [nx, nz]

  const centroidX = sumX / count
  const centroidZ = sumZ / count
  const wallMidX = (wall.start[0] + wall.end[0]) / 2
  const wallMidZ = (wall.start[1] + wall.end[1]) / 2
  const fromCentroidX = wallMidX - centroidX
  const fromCentroidZ = wallMidZ - centroidZ
  const facingAway = fromCentroidX * nx + fromCentroidZ * nz >= 0 ? 1 : -1
  return [nx * facingAway, nz * facingAway]
}
