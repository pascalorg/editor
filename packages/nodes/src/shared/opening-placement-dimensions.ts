import {
  type AnyNode,
  type AnyNodeId,
  computeOpeningGuides,
  type DoorNode,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  isCurvedWall,
  type OpeningSpan,
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
  if (wall?.type !== 'wall') return []
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

  const wallThickness = wall.thickness ?? 0.1
  const halfThickness = wallThickness / 2
  const FLOORPLAN_WALL_OUTER_MEASUREMENT_OFFSET = 0.32

  // Outer-face projection for the placement dimensions (so extension lines stay
  // short and the layout matches the legacy treatment); centreline projection
  // for the equal-spacing badges, which sit on the solid wall between openings.
  const facePoint = (along: number): readonly [number, number] => [
    x1 + dirX * along + outwardNormal[0] * halfThickness,
    z1 + dirZ * along + outwardNormal[1] * halfThickness,
  ]
  const centrePoint = (along: number): FloorplanPoint => [x1 + dirX * along, z1 + dirZ * along]
  const round = (value: number) => Number.parseFloat(value.toFixed(2))

  // This wall's OTHER openings as wall-local spans. `ctx.siblings` only includes
  // same-kind nodes; doors and windows need each other, so resolve the wall's
  // children directly.
  const childIds = ((wall as unknown as { children?: AnyNodeId[] }).children ?? []) as AnyNodeId[]
  const siblings: OpeningSpan[] = []
  for (const childId of childIds) {
    if (childId === opening.id) continue
    const sibling = ctx.resolve(childId) as AnyNode | undefined
    if (!sibling || (sibling.type !== 'door' && sibling.type !== 'window')) continue
    const sib = sibling as DoorNode | WindowNode
    siblings.push({
      id: sib.id,
      centerS: sib.position[0],
      width: sib.width,
      centerY: sib.position[1],
      height: sib.height,
    })
  }

  const guides = computeOpeningGuides({
    moving: {
      id: opening.id,
      centerS: opening.position[0],
      width: opening.width,
      centerY: opening.position[1],
      height: opening.height,
    },
    siblings,
    wall: { length: wallLength, height: wall.height ?? 2.5 },
    // The 2D plan is top-down: sill/head height and vertical alignment aren't
    // representable here — those belong to the 3D viewport.
    includeVertical: false,
  })

  const out: FloorplanGeometry[] = []

  // Edge-to-edge clearance to the nearest neighbour (or wall end) on each side.
  for (const gap of guides.gaps) {
    const lo = Math.min(gap.fromS, gap.toS)
    const hi = Math.max(gap.fromS, gap.toS)
    out.push({
      kind: 'dimension',
      start: facePoint(lo),
      end: facePoint(hi),
      offsetNormal: outwardNormal,
      offsetDistance: FLOORPLAN_WALL_OUTER_MEASUREMENT_OFFSET,
      extensionOvershoot: 0.12,
      text: `${round(gap.distance)}m`,
      stroke: '#f97316',
    })
  }

  // Equal-spacing rhythm — a "=" badge per equal gap, on the wall centreline.
  if (guides.equalSpacing) {
    const wallAngle = Math.atan2(dz, dx)
    const text = `${round(guides.equalSpacing.gap)}m`
    for (const seg of guides.equalSpacing.segments) {
      out.push({
        kind: 'equal-spacing-badge',
        point: centrePoint((seg.fromS + seg.toS) / 2),
        text,
        angle: wallAngle,
      })
    }
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
    if (child?.type !== 'wall') continue
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
