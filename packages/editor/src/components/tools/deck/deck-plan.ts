import { DEFAULT_WALL_THICKNESS, pointInPolygon2D } from '@pascal-app/core'
import {
  DEFAULT_STAIR_HEIGHT,
  DEFAULT_STAIR_LENGTH,
  DEFAULT_STAIR_STEP_COUNT,
  DEFAULT_STAIR_WIDTH,
} from '../stair/stair-defaults'

/**
 * Pure planning math for the mezzanine / balcony deck tools: open-edge
 * classification against level walls, straight-stair auto-placement, and
 * railing runs (with the stair-mouth gap). Everything here is plan-space
 * `[x, z]` in level meters — no store, no Three.js — so it unit-tests in
 * isolation and both the 2D and 3D commit paths share one behavior.
 */

export type PlanPoint = [number, number]

export type DeckEdge = { start: PlanPoint; end: PlanPoint }

export type DeckWallSegment = { start: PlanPoint; end: PlanPoint; thickness?: number }

/**
 * Extra reach past the wall face when deciding an edge is wall-backed —
 * with the default 0.1 m wall the total midpoint threshold is ~0.3 m.
 */
export const RAILING_EDGE_MARGIN = 0.25

/** Railing stubs shorter than this are dropped rather than drawn. */
export const MIN_RAILING_RUN = 0.3

/** Clearance added on each side of the stair width for the railing gap. */
export const STAIR_MOUTH_CLEARANCE = 0.1

/** Shortest usable stair run — keeps tiny rises from degenerating the mesh. */
export const MIN_STAIR_RUN = 0.6

export const DECK_ELEVATION_STEP = 0.05

export function quantizeDeckElevation(value: number): number {
  // Integer divisor (1 / 0.05 = 20) keeps the result free of float dust.
  return Math.round(value / DECK_ELEVATION_STEP) / 20
}

/**
 * Drop consecutive duplicate vertices and a trailing vertex that repeats the
 * first — double-click finishes re-emit the last click point, and a duplicate
 * vertex would produce a zero-length railing edge.
 */
export function sanitizeDeckPolygon(points: PlanPoint[], tolerance = 0.01): PlanPoint[] {
  const result: PlanPoint[] = []
  for (const point of points) {
    const previous = result[result.length - 1]
    if (previous && samePoint(previous, point, tolerance)) continue
    result.push(point)
  }
  const first = result[0]
  const last = result[result.length - 1]
  if (result.length > 1 && first && last && samePoint(first, last, tolerance)) {
    result.pop()
  }
  return result
}

export function polygonEdges(polygon: PlanPoint[]): DeckEdge[] {
  const edges: DeckEdge[] = []
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i]
    const end = polygon[(i + 1) % polygon.length]
    if (start && end) edges.push({ start, end })
  }
  return edges
}

function samePoint(a: PlanPoint, b: PlanPoint, tolerance = 1e-6): boolean {
  return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance
}

function sameEdge(a: DeckEdge, b: DeckEdge): boolean {
  return a === b || (samePoint(a.start, b.start) && samePoint(a.end, b.end))
}

function edgeLength(edge: DeckEdge): number {
  return Math.hypot(edge.end[0] - edge.start[0], edge.end[1] - edge.start[1])
}

function edgeMidpoint(edge: DeckEdge): PlanPoint {
  return [(edge.start[0] + edge.end[0]) / 2, (edge.start[1] + edge.end[1]) / 2]
}

export function distancePointToSegment(point: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const abX = b[0] - a[0]
  const abZ = b[1] - a[1]
  const lengthSq = abX * abX + abZ * abZ
  if (lengthSq < 1e-12) return Math.hypot(point[0] - a[0], point[1] - a[1])
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * abX + (point[1] - a[1]) * abZ) / lengthSq))
  return Math.hypot(point[0] - (a[0] + t * abX), point[1] - (a[1] + t * abZ))
}

/**
 * Split the deck outline into wall-backed ("closed") edges and free ("open")
 * edges. An edge is closed when its midpoint sits within the wall's half
 * thickness plus {@link RAILING_EDGE_MARGIN} of any wall centerline on the
 * level — those edges need no railing. Curved walls are tested against their
 * straight chord (v1 approximation).
 */
export function classifyDeckEdges(
  polygon: PlanPoint[],
  walls: DeckWallSegment[],
  margin = RAILING_EDGE_MARGIN,
): { open: DeckEdge[]; closed: DeckEdge[] } {
  const open: DeckEdge[] = []
  const closed: DeckEdge[] = []

  for (const edge of polygonEdges(polygon)) {
    if (edgeLength(edge) < 1e-6) continue
    const midpoint = edgeMidpoint(edge)
    const wallBacked = walls.some((wall) => {
      const threshold = (wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2 + margin
      return distancePointToSegment(midpoint, wall.start, wall.end) <= threshold
    })
    if (wallBacked) closed.push(edge)
    else open.push(edge)
  }

  return { open, closed }
}

export type DeckStairPlan = {
  /** The boarding edge — the longest open edge of the deck outline. */
  edge: DeckEdge
  /** Stair origin (the entry) on the storey floor; the run ascends toward the deck. */
  foot: PlanPoint
  /** Where the run meets the deck rim — the boarding edge's midpoint. */
  head: PlanPoint
  /** Y rotation orienting the stair's local +Z run from foot to head. */
  rotation: number
  runLength: number
  stepCount: number
  width: number
}

/**
 * Place a straight stair perpendicular to the longest open edge: foot on the
 * storey floor outside the deck outline, head meeting the boarding edge at
 * its midpoint. Run length keeps the default stair's slope; step count keeps
 * its default riser height. Returns null when the deck is fully wall-enclosed
 * (no open edge) — the caller then creates the bare deck (clamp, never ask).
 */
export function planDeckStair(
  polygon: PlanPoint[],
  openEdges: DeckEdge[],
  rise: number,
): DeckStairPlan | null {
  if (rise <= 0) return null
  let edge: DeckEdge | null = null
  for (const candidate of openEdges) {
    if (!edge || edgeLength(candidate) > edgeLength(edge)) edge = candidate
  }
  if (!edge) return null

  const length = edgeLength(edge)
  if (length < 1e-6) return null
  const direction: PlanPoint = [
    (edge.end[0] - edge.start[0]) / length,
    (edge.end[1] - edge.start[1]) / length,
  ]
  const head = edgeMidpoint(edge)

  // Perpendicular pointing away from the deck interior — probe a point just
  // off the midpoint; if it lands inside the outline, flip.
  let outward: PlanPoint = [direction[1], -direction[0]]
  const probe: PlanPoint = [head[0] + outward[0] * 0.05, head[1] + outward[1] * 0.05]
  if (pointInPolygon2D(probe, polygon)) {
    outward = [-outward[0], -outward[1]]
  }

  const runLength = Math.max(rise * (DEFAULT_STAIR_LENGTH / DEFAULT_STAIR_HEIGHT), MIN_STAIR_RUN)
  const foot: PlanPoint = [head[0] + outward[0] * runLength, head[1] + outward[1] * runLength]
  const defaultRiser = DEFAULT_STAIR_HEIGHT / DEFAULT_STAIR_STEP_COUNT
  const stepCount = Math.max(2, Math.round(rise / defaultRiser))

  return {
    edge,
    foot,
    head,
    // Stair local +Z is the ascent; aim it from the foot toward the deck.
    rotation: Math.atan2(-outward[0], -outward[1]),
    runLength,
    stepCount,
    width: DEFAULT_STAIR_WIDTH,
  }
}

export type RailingRun = { start: PlanPoint; end: PlanPoint }

/**
 * One railing run per open edge, except the stair's boarding edge, which is
 * split into two runs around the stair mouth (stair width + clearance,
 * centered on the boarding point). Runs shorter than `minRunLength` are
 * dropped — an edge barely wider than the stair gets a clean gap instead of
 * fence stubs.
 */
export function buildRailingRuns(
  openEdges: DeckEdge[],
  stair: Pick<DeckStairPlan, 'edge' | 'head' | 'width'> | null,
  minRunLength = MIN_RAILING_RUN,
): RailingRun[] {
  const runs: RailingRun[] = []

  for (const edge of openEdges) {
    const length = edgeLength(edge)
    if (length < 1e-6) continue
    const direction: PlanPoint = [
      (edge.end[0] - edge.start[0]) / length,
      (edge.end[1] - edge.start[1]) / length,
    ]

    const spans: Array<[number, number]> = []
    if (stair && sameEdge(edge, stair.edge)) {
      const boardingT =
        (stair.head[0] - edge.start[0]) * direction[0] +
        (stair.head[1] - edge.start[1]) * direction[1]
      const halfGap = stair.width / 2 + STAIR_MOUTH_CLEARANCE
      spans.push([0, Math.min(boardingT - halfGap, length)])
      spans.push([Math.max(boardingT + halfGap, 0), length])
    } else {
      spans.push([0, length])
    }

    for (const [from, to] of spans) {
      const clampedFrom = Math.max(0, from)
      const clampedTo = Math.min(length, to)
      if (clampedTo - clampedFrom < minRunLength) continue
      runs.push({
        start: [
          edge.start[0] + direction[0] * clampedFrom,
          edge.start[1] + direction[1] * clampedFrom,
        ],
        end: [edge.start[0] + direction[0] * clampedTo, edge.start[1] + direction[1] * clampedTo],
      })
    }
  }

  return runs
}
