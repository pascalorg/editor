import type { AnyNode, AnyNodeId, DoorNode, WallNode, WindowNode } from '@pascal-app/core'
import { getLinkedWallUpdates } from '@pascal-app/core'

/**
 * Driving dimensions — WS3.
 *
 * A dimension label in the floor plan is editable. Committing a new value
 * does NOT re-letter the annotation: it MOVES the geometry so the dimension
 * becomes true, the way a CAD "driving dimension" works.
 *
 * Everything in this module is pure: it reads a snapshot of the scene node
 * map and returns node patches. The React layer
 * (`floorplan-dimension-renderer.tsx` + `floorplan-registry-layer.tsx`)
 * applies them through `sceneApi.update`.
 */

export type DimensionPlanPoint = [number, number]

// ── Value parsing ────────────────────────────────────────────────────

const INCHES_PER_METER = 1 / 0.0254

/**
 * Parse a typed dimension value into METRES.
 *
 * Accepted (case-insensitive, whitespace tolerant):
 *   - `12'-6"`, `12' 6"`, `12'6"`, `12'`, `6"`, `12'-6 1/2"`, `6 1/2"`
 *   - `3810mm`, `381cm`, `3.81m`, `3810 mm`
 *   - bare number — `12.5` — interpreted in the caller's unit system:
 *     imperial → feet, metric → metres.
 *
 * Returns null for anything unparseable or non-positive.
 */
export function parseDimensionInput(
  raw: string,
  unit: 'metric' | 'imperial' = 'metric',
): number | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!text) return null

  // Explicit metric suffix.
  const metric = /^([+-]?\d+(?:\.\d+)?)\s*(mm|cm|m)$/.exec(text)
  if (metric) {
    const value = Number.parseFloat(metric[1]!)
    if (!Number.isFinite(value)) return null
    const scale = metric[2] === 'mm' ? 0.001 : metric[2] === 'cm' ? 0.01 : 1
    return positive(value * scale)
  }

  // Feet and/or inches. Either part may be absent; inches may carry a fraction.
  const feetInches =
    /^([+-]?)(?:(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*)?(?:-?\s*(?:(\d+(?:\.\d+)?)\s*)?(?:(\d+)\/(\d+)\s*)?(?:"|in|inch|inches))?$/.exec(
      text,
    )
  if (feetInches && (feetInches[2] || feetInches[3] || feetInches[4])) {
    const sign = feetInches[1] === '-' ? -1 : 1
    const feet = feetInches[2] ? Number.parseFloat(feetInches[2]) : 0
    const inches = feetInches[3] ? Number.parseFloat(feetInches[3]) : 0
    const numerator = feetInches[4] ? Number.parseFloat(feetInches[4]) : 0
    const denominator = feetInches[5] ? Number.parseFloat(feetInches[5]) : 1
    if (denominator === 0) return null
    const totalInches = feet * 12 + inches + numerator / denominator
    return positive((sign * totalInches) / INCHES_PER_METER)
  }

  // `12'-6` / `12-6` shorthand without the inch mark, feet-first.
  const shorthand = /^([+-]?\d+(?:\.\d+)?)\s*(?:'|ft)\s*-?\s*(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?$/.exec(
    text,
  )
  if (shorthand) {
    const feet = Number.parseFloat(shorthand[1]!)
    const inches = Number.parseFloat(shorthand[2]!)
    const numerator = shorthand[3] ? Number.parseFloat(shorthand[3]) : 0
    const denominator = shorthand[4] ? Number.parseFloat(shorthand[4]) : 1
    if (denominator === 0) return null
    const sign = feet < 0 ? -1 : 1
    return positive((Math.abs(feet) * 12 + inches + numerator / denominator) * sign / INCHES_PER_METER)
  }

  // Bare number — unit system decides.
  const bare = /^([+-]?\d+(?:\.\d+)?)$/.exec(text)
  if (bare) {
    const value = Number.parseFloat(bare[1]!)
    if (!Number.isFinite(value)) return null
    return positive(unit === 'imperial' ? (value * 12) / INCHES_PER_METER : value)
  }

  return null
}

function positive(value: number): number | null {
  return Number.isFinite(value) && value > 1e-6 ? value : null
}

// ── Drive resolution ─────────────────────────────────────────────────

export type DimensionDriveTarget =
  | {
      kind: 'wall-endpoint'
      wallId: AnyNodeId
      endpoint: 'start' | 'end'
      /** Unit vector along which the moving endpoint travels when the value grows. */
      direction: DimensionPlanPoint
    }
  | {
      kind: 'opening'
      openingId: AnyNodeId
      wallId: AnyNodeId
      /** +1 when growing the dimension increases `position[0]`, -1 otherwise. */
      sign: 1 | -1
    }
  | {
      /**
       * The dimension measures the opening itself (its own width tag), so
       * the value resizes the opening rather than sliding it.
       */
      kind: 'opening-width'
      openingId: AnyNodeId
      wallId: AnyNodeId
    }

export type DimensionDriveResolution =
  | { drivable: true; target: DimensionDriveTarget }
  | { drivable: false; reason: string }

/** How close a dimension witness point must sit to a feature to bind to it. */
const FEATURE_MATCH_TOLERANCE_M = 0.28
const PARALLEL_TOLERANCE = 0.02

export type DimensionDriveQuery = {
  nodes: Readonly<Record<string, AnyNode>>
  /** Node the dimension geometry was emitted by (the registry entry). */
  ownerNodeId: AnyNodeId
  /** Witness points of the dimension segment, in level-plan metres (x, z). */
  start: DimensionPlanPoint
  end: DimensionPlanPoint
}

/**
 * Work out what a dimension's value drives.
 *
 * Resolution is deliberately conservative: when nothing binds we say so and
 * the caller falls back to `textOverride` (with an "override" badge) rather
 * than moving something the author did not mean.
 */
export function resolveDimensionDrive(query: DimensionDriveQuery): DimensionDriveResolution {
  const { nodes, ownerNodeId } = query
  const owner = nodes[ownerNodeId]
  if (!owner) return { drivable: false, reason: 'unknown node' }
  if (isNodeLocked(owner)) return { drivable: false, reason: 'node is locked' }

  const dimDirection = unit(subtract(query.end, query.start))
  if (!dimDirection) return { drivable: false, reason: 'degenerate dimension' }

  if (owner.type === 'door' || owner.type === 'window') {
    return resolveOpeningDrive(query, owner as DoorNode | WindowNode, dimDirection)
  }
  if (owner.type === 'wall') {
    return resolveWallDrive(query, owner as WallNode, dimDirection)
  }
  if (owner.type === 'construction-dimension') {
    return resolveConstructionDimensionDrive(query, owner, dimDirection)
  }
  return { drivable: false, reason: `${owner.type} dimensions are not drivable` }
}

function resolveWallDrive(
  query: DimensionDriveQuery,
  wall: WallNode,
  dimDirection: DimensionPlanPoint,
): DimensionDriveResolution {
  const wallDirection = unit(subtract(wall.end, wall.start))
  if (!wallDirection) return { drivable: false, reason: 'degenerate wall' }
  if (Math.abs(cross(wallDirection, dimDirection)) > PARALLEL_TOLERANCE) {
    return { drivable: false, reason: 'dimension is not along the wall' }
  }
  if ((wall as { curvature?: number }).curvature) {
    return { drivable: false, reason: 'curved walls are not drivable yet' }
  }

  // Prefer moving an opening: it is the cheaper, more local edit and it is
  // what the "openings" dimension tier actually measures to.
  const openings = wallOpenings(query.nodes, wall)
  const endOpening = nearestOpening(openings, wall, wallDirection, query.end)
  if (endOpening) {
    return {
      drivable: true,
      target: {
        kind: 'opening',
        openingId: endOpening.id as AnyNodeId,
        wallId: wall.id as AnyNodeId,
        sign: dot(wallDirection, dimDirection) >= 0 ? 1 : -1,
      },
    }
  }

  // Otherwise the wall's own length: the endpoint the dimension runs TOWARD
  // moves, the one it starts from is the datum.
  const endpoint = nearestWallEndpoint(wall, query.end)
  if (!endpoint) return { drivable: false, reason: 'dimension does not end on this wall' }
  const fixed = endpoint === 'end' ? wall.start : wall.end
  const moving = endpoint === 'end' ? wall.end : wall.start
  const direction = unit(subtract(moving as DimensionPlanPoint, fixed as DimensionPlanPoint))
  if (!direction) return { drivable: false, reason: 'degenerate wall' }
  return { drivable: true, target: { kind: 'wall-endpoint', wallId: wall.id as AnyNodeId, endpoint, direction } }
}

function resolveOpeningDrive(
  query: DimensionDriveQuery,
  opening: DoorNode | WindowNode,
  dimDirection: DimensionPlanPoint,
): DimensionDriveResolution {
  const wall = opening.wallId ? query.nodes[opening.wallId] : undefined
  if (!wall || wall.type !== 'wall') return { drivable: false, reason: 'opening has no host wall' }
  if (isNodeLocked(wall)) return { drivable: false, reason: 'host wall is locked' }
  const wallDirection = unit(subtract((wall as WallNode).end, (wall as WallNode).start))
  if (!wallDirection) return { drivable: false, reason: 'degenerate wall' }
  if (Math.abs(cross(wallDirection, dimDirection)) > PARALLEL_TOLERANCE) {
    return { drivable: false, reason: 'dimension is not along the host wall' }
  }
  if (measuresOpeningWidth(query, opening, wall as WallNode, wallDirection)) {
    return {
      drivable: true,
      target: {
        kind: 'opening-width',
        openingId: opening.id as AnyNodeId,
        wallId: wall.id as AnyNodeId,
      },
    }
  }
  return {
    drivable: true,
    target: {
      kind: 'opening',
      openingId: opening.id as AnyNodeId,
      wallId: wall.id as AnyNodeId,
      sign: dot(wallDirection, dimDirection) >= 0 ? 1 : -1,
    },
  }
}

/**
 * True when the dimension spans the opening edge to edge — the opening's own
 * width tag. Typing into that resizes the opening; typing into a dimension
 * that merely ENDS at the opening slides it.
 */
function measuresOpeningWidth(
  query: DimensionDriveQuery,
  opening: DoorNode | WindowNode,
  wall: WallNode,
  wallDirection: DimensionPlanPoint,
): boolean {
  const origin = wall.start as DimensionPlanPoint
  const startAlong = dot(subtract(query.start, origin), wallDirection)
  const endAlong = dot(subtract(query.end, origin), wallDirection)
  const span = Math.abs(endAlong - startAlong)
  const centre = (startAlong + endAlong) / 2
  return (
    Math.abs(span - opening.width) <= 0.02 && Math.abs(centre - opening.position[0]) <= 0.02
  )
}

function resolveConstructionDimensionDrive(
  query: DimensionDriveQuery,
  node: AnyNode,
  dimDirection: DimensionPlanPoint,
): DimensionDriveResolution {
  const anchors = (node as { anchors?: unknown[] }).anchors ?? []
  // The LAST anchor is the one the dimension runs toward; it is the driven end.
  for (let index = anchors.length - 1; index >= 1; index--) {
    const anchor = anchors[index]
    if (!anchor || Array.isArray(anchor)) continue
    const reference = (anchor as { reference?: { nodeId?: string } }).reference
    const referenced = reference?.nodeId ? query.nodes[reference.nodeId] : undefined
    if (!referenced) continue
    if (isNodeLocked(referenced)) return { drivable: false, reason: 'anchored node is locked' }
    if (referenced.type === 'door' || referenced.type === 'window') {
      return resolveOpeningDrive(query, referenced as DoorNode | WindowNode, dimDirection)
    }
    if (referenced.type === 'wall') {
      return resolveWallDrive(query, referenced as WallNode, dimDirection)
    }
  }
  return { drivable: false, reason: 'dimension anchors are free points' }
}

function wallOpenings(
  nodes: Readonly<Record<string, AnyNode>>,
  wall: WallNode,
): Array<DoorNode | WindowNode> {
  const openings: Array<DoorNode | WindowNode> = []
  for (const id of wall.children ?? []) {
    const child = nodes[id]
    if (child && (child.type === 'door' || child.type === 'window')) {
      openings.push(child as DoorNode | WindowNode)
    }
  }
  return openings
}

function nearestOpening(
  openings: ReadonlyArray<DoorNode | WindowNode>,
  wall: WallNode,
  wallDirection: DimensionPlanPoint,
  point: DimensionPlanPoint,
): DoorNode | WindowNode | null {
  let best: DoorNode | WindowNode | null = null
  let bestDistance = FEATURE_MATCH_TOLERANCE_M
  const projected = dot(subtract(point, wall.start as DimensionPlanPoint), wallDirection)
  for (const opening of openings) {
    const center = opening.position[0]
    const half = opening.width / 2
    for (const candidate of [center, center - half, center + half]) {
      const distance = Math.abs(projected - candidate)
      if (distance < bestDistance) {
        bestDistance = distance
        best = opening
      }
    }
  }
  return best
}

function nearestWallEndpoint(wall: WallNode, point: DimensionPlanPoint): 'start' | 'end' | null {
  const toStart = length(subtract(point, wall.start as DimensionPlanPoint))
  const toEnd = length(subtract(point, wall.end as DimensionPlanPoint))
  const nearest = toEnd <= toStart ? 'end' : 'start'
  const distance = Math.min(toStart, toEnd)
  // Face-datum dimensions sit half a wall thickness in from the centreline
  // endpoint, so the tolerance has to clear the thickest plausible wall.
  return distance <= FEATURE_MATCH_TOLERANCE_M + (wall.thickness ?? 0.1) ? nearest : null
}

// ── Applying a drive ─────────────────────────────────────────────────

export type DimensionDriveUpdate = { id: AnyNodeId; data: Record<string, unknown> }

export type DimensionDrivePlan = {
  updates: DimensionDriveUpdate[]
  /** Signed change in metres that was applied. */
  delta: number
}

/**
 * Turn a resolved target plus a length delta into node patches.
 *
 * `currentLength` is the dimension's own measured length (whatever datum it
 * uses) and `nextLength` the typed value — the drive is applied as the
 * DELTA between them, so face / centreline datum offsets cancel out and the
 * dimension reads exactly the typed value afterwards.
 */
export function planDimensionDrive(args: {
  nodes: Readonly<Record<string, AnyNode>>
  target: DimensionDriveTarget
  currentLength: number
  nextLength: number
}): DimensionDrivePlan | null {
  const delta = args.nextLength - args.currentLength
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return { updates: [], delta: 0 }

  if (args.target.kind === 'opening-width') {
    const opening = args.nodes[args.target.openingId]
    if (!opening || (opening.type !== 'door' && opening.type !== 'window')) return null
    const wall = args.nodes[args.target.wallId] as WallNode | undefined
    const wallLength = wall
      ? length(subtract(wall.end as DimensionPlanPoint, wall.start as DimensionPlanPoint))
      : Number.POSITIVE_INFINITY
    if (args.nextLength < 0.05 || args.nextLength > wallLength) return null
    return {
      updates: [{ id: args.target.openingId, data: { width: args.nextLength } }],
      delta,
    }
  }

  if (args.target.kind === 'opening') {
    const opening = args.nodes[args.target.openingId]
    if (!opening || (opening.type !== 'door' && opening.type !== 'window')) return null
    const wall = args.nodes[args.target.wallId] as WallNode | undefined
    const node = opening as DoorNode | WindowNode
    const next = node.position[0] + delta * args.target.sign
    const limit = wall ? length(subtract(wall.end as DimensionPlanPoint, wall.start as DimensionPlanPoint)) : null
    const clamped = limit === null ? next : Math.min(Math.max(next, node.width / 2), limit - node.width / 2)
    return {
      updates: [
        {
          id: node.id as AnyNodeId,
          data: { position: [clamped, node.position[1], node.position[2]] },
        },
      ],
      delta,
    }
  }

  const wall = args.nodes[args.target.wallId] as WallNode | undefined
  if (!wall) return null
  const originalStart = [...wall.start] as DimensionPlanPoint
  const originalEnd = [...wall.end] as DimensionPlanPoint
  const moving = args.target.endpoint === 'end' ? originalEnd : originalStart
  const next: DimensionPlanPoint = [
    moving[0] + args.target.direction[0] * delta,
    moving[1] + args.target.direction[1] * delta,
  ]
  const nextStart = args.target.endpoint === 'start' ? next : originalStart
  const nextEnd = args.target.endpoint === 'end' ? next : originalEnd
  if (length(subtract(nextEnd, nextStart)) < 0.01) return null

  const updates: DimensionDriveUpdate[] = [
    { id: wall.id as AnyNodeId, data: { start: nextStart, end: nextEnd } },
  ]

  // Keep connected junctions consistent: any wall in the same level that
  // shares the moved corner follows it.
  const linked = Object.values(args.nodes).filter(
    (node): node is WallNode =>
      node?.type === 'wall' &&
      node.id !== wall.id &&
      (node.parentId ?? null) === (wall.parentId ?? null) &&
      !isNodeLocked(node) &&
      (samePlanPoint(node.start as DimensionPlanPoint, moving) ||
        samePlanPoint(node.end as DimensionPlanPoint, moving)),
  )
  for (const update of getLinkedWallUpdates(
    linked.map((node) => ({ wall: node })),
    originalStart,
    originalEnd,
    nextStart,
    nextEnd,
  )) {
    updates.push({ id: update.id as AnyNodeId, data: { start: update.start, end: update.end } })
  }

  return { updates, delta }
}

/**
 * Pascal has no first-class node lock — `guideUi.locked` is UI state for
 * reference guides only. `metadata.locked` is the convention used here, so a
 * future lock feature can set it and driving will refuse without a change.
 */
function isNodeLocked(node: AnyNode): boolean {
  const metadata = (node as { metadata?: Record<string, unknown> | null }).metadata
  return !!metadata && typeof metadata === 'object' && (metadata as { locked?: unknown }).locked === true
}

// ── Vector helpers ───────────────────────────────────────────────────

const SAME_POINT_EPSILON = 1e-6

function samePlanPoint(a: DimensionPlanPoint, b: DimensionPlanPoint): boolean {
  return Math.abs(a[0] - b[0]) <= SAME_POINT_EPSILON && Math.abs(a[1] - b[1]) <= SAME_POINT_EPSILON
}

function subtract(a: readonly number[], b: readonly number[]): DimensionPlanPoint {
  return [a[0]! - b[0]!, a[1]! - b[1]!]
}

function dot(a: DimensionPlanPoint, b: DimensionPlanPoint): number {
  return a[0] * b[0] + a[1] * b[1]
}

function cross(a: DimensionPlanPoint, b: DimensionPlanPoint): number {
  return a[0] * b[1] - a[1] * b[0]
}

function length(a: DimensionPlanPoint): number {
  return Math.hypot(a[0], a[1])
}

function unit(a: DimensionPlanPoint): DimensionPlanPoint | null {
  const magnitude = length(a)
  return magnitude <= 1e-9 ? null : [a[0] / magnitude, a[1] / magnitude]
}
