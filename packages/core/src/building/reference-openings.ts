import type { WallNode } from '../schema/nodes/wall'

export type OpeningKind = 'door' | 'window'

type Point = [number, number]

export type OpeningPlacement = {
  /** Existing wall hosting the opening, when one covers the symbol. */
  hostWall: WallNode | null
  /** Missing wall segment to create between two flanking wall ends. */
  bridge: { start: Point; end: Point; thickness: number } | null
  /** Opening centre offset in metres from the host/bridge wall start. */
  along: number
  width: number
}

const MAX_BRIDGE = 3
const MIN_BRIDGE = 0.2
const WIDTH_MIN = 0.4
const WIDTH_MAX = 3
// How far the symbol may sit off the wall faces: a door leaf swings out of the
// wall and only touches it at the jambs, a window frame sits inside it.
const REACH: Record<OpeningKind, number> = { door: 0.15, window: 0.1 }

const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
const norm = (a: Point) => Math.hypot(a[0], a[1])
const unit = (a: Point): Point => {
  const length = norm(a)
  return length > 0 ? [a[0] / length, a[1] / length] : [1, 0]
}
const same = (a: Point, b: Point) => norm(subtract(a, b)) < 1e-6

/** How selected symbol shapes become openings. */
export type SymbolGrouping = 'touching' | 'separate'

export type SymbolPart = { points: readonly Point[]; stroke?: boolean }

/** Parts of one symbol drawn at most this far apart (m) still count as one opening. */
export const SYMBOL_PART_GAP = 0.03

export function partBounds(points: readonly Point[]) {
  let minX = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY,
    minZ = Number.POSITIVE_INFINITY,
    maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ }
}

/**
 * Whether two selected parts belong to the same door/window symbol.
 *
 * `tolerance` is in the parts' own units (plan pixels here). Real plans draw
 * one window as a frame with glass panes inside it, and one door as a leaf
 * plus a swing arc meeting at the leaf tip — so parts overlap, nest or touch.
 * Two different windows in one wall are separated by a pier of wall.
 */
export function symbolPartsTouch(a: SymbolPart, b: SymbolPart, tolerance: number): boolean {
  const boxA = partBounds(a.points),
    boxB = partBounds(b.points)
  if (
    boxA.minX > boxB.maxX + tolerance ||
    boxB.minX > boxA.maxX + tolerance ||
    boxA.minZ > boxB.maxZ + tolerance ||
    boxB.minZ > boxA.maxZ + tolerance
  )
    return false
  // Nested parts (glass inside its frame) never meet an edge, yet belong together.
  if (!a.stroke && b.points.some((p) => insidePolygon(p, a.points))) return true
  if (!b.stroke && a.points.some((p) => insidePolygon(p, b.points))) return true
  // Otherwise only outlines that really meet: a door arc's square bounding box
  // must not swallow a window drawn beside the swing.
  const edgesA = partEdges(a),
    edgesB = partEdges(b)
  return edgesA.some(([p, q]) => edgesB.some(([r, s]) => segmentGap(p, q, r, s) <= tolerance))
}

function partEdges(part: SymbolPart): [Point, Point][] {
  const { points } = part
  const count = part.stroke ? points.length - 1 : points.length
  return Array.from({ length: Math.max(0, count) }, (_, i) => [
    points[i]!,
    points[(i + 1) % points.length]!,
  ])
}

function insidePolygon([x, z]: Point, polygon: readonly Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!,
      [xj, zj] = polygon[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function pointToSegment(p: Point, a: Point, b: Point) {
  const ab = subtract(b, a),
    length = dot(ab, ab)
  const t = length > 0 ? Math.max(0, Math.min(1, dot(subtract(p, a), ab) / length)) : 0
  return norm(subtract(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]))
}

/** Closest distance between two segments; 0 when they cross. */
function segmentGap(p: Point, q: Point, r: Point, s: Point) {
  const turn = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (turn(p, q, r) * turn(p, q, s) < 0 && turn(r, s, p) * turn(r, s, q) < 0) return 0
  return Math.min(
    pointToSegment(p, r, s),
    pointToSegment(q, r, s),
    pointToSegment(r, p, q),
    pointToSegment(s, p, q),
  )
}

/**
 * Clusters the selected shapes into openings: each shape alone, or every chain
 * of touching shapes as one (A–B–C merge even when A and C never touch).
 */
export function groupSymbolShapes<T extends SymbolPart>(
  shapes: readonly T[],
  grouping: SymbolGrouping,
  tolerance: number,
): T[][] {
  if (grouping === 'separate') return shapes.map((shape) => [shape])
  const parent = shapes.map((_, i) => i)
  const root = (i: number): number => {
    if (parent[i] === i) return i
    parent[i] = root(parent[i]!)
    return parent[i]!
  }
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++)
      if (root(i) !== root(j) && symbolPartsTouch(shapes[i]!, shapes[j]!, tolerance))
        parent[root(j)] = root(i)
  const groups = new Map<number, T[]>()
  shapes.forEach((shape, i) => {
    groups.set(root(i), [...(groups.get(root(i)) ?? []), shape])
  })
  return [...groups.values()]
}

/**
 * The symbol measured in a wall's own frame, so rotated plans and square door
 * symbols (leaf + quarter arc) resolve against the wall rather than the axes.
 */
function symbolOnLine(points: readonly Point[], origin: Point, direction: Point) {
  const normal: Point = [-direction[1], direction[0]]
  let start = Number.POSITIVE_INFINITY,
    end = Number.NEGATIVE_INFINITY,
    near = Number.POSITIVE_INFINITY,
    far = Number.NEGATIVE_INFINITY
  for (const p of points) {
    const v = subtract(p, origin)
    start = Math.min(start, dot(v, direction))
    end = Math.max(end, dot(v, direction))
    near = Math.min(near, dot(v, normal))
    far = Math.max(far, dot(v, normal))
  }
  return { start, end, centre: (start + end) / 2, width: end - start, near, far }
}

/** Distance between the symbol and the wall band; 0 when they overlap. */
function bandGap(symbol: { near: number; far: number }, thickness: number) {
  return Math.max(0, symbol.near - thickness / 2, -thickness / 2 - symbol.far)
}

function coversSpan(
  symbol: { start: number; end: number; centre: number; width: number },
  length: number,
) {
  const overlap = Math.min(symbol.end, length) - Math.max(symbol.start, 0)
  return (
    symbol.centre >= 0 && symbol.centre <= length && overlap >= 0.5 * Math.min(symbol.width, length)
  )
}

export function planOpeningPlacement(args: {
  /** Every point of the selected symbol shapes, in level metres. */
  points: readonly Point[]
  kind: OpeningKind
  walls: readonly WallNode[]
}): OpeningPlacement {
  const { points, kind, walls } = args
  if (!points.length || points.some((p) => !p.every(Number.isFinite)))
    throw Error('Select the shapes of one door or window symbol.')
  if (!walls.length) throw Error('Create or import the walls first, then place doors and windows.')

  const straight = walls.filter((wall) => Math.abs(wall.curveOffset ?? 0) < 1e-6)
  let bestHost: {
    wall: WallNode
    score: number
    along: number
    length: number
    width: number
  } | null = null
  for (const wall of straight) {
    const ab = subtract(wall.end, wall.start),
      length = norm(ab)
    if (length < MIN_BRIDGE) continue
    const symbol = symbolOnLine(points, wall.start, unit(ab))
    const gap = bandGap(symbol, wall.thickness ?? 0.1)
    if (gap > REACH[kind] || symbol.width < WIDTH_MIN * 0.75 || !coversSpan(symbol, length))
      continue
    if (!bestHost || gap < bestHost.score)
      bestHost = { wall, score: gap, along: symbol.centre, length, width: symbol.width }
  }

  let bestBridge: {
    start: Point
    end: Point
    thickness: number
    score: number
    width: number
  } | null = null
  // `body` points from each end into its own wall.
  const ends = straight.flatMap((wall) => [
    { wall, point: wall.start, body: unit(subtract(wall.end, wall.start)) },
    { wall, point: wall.end, body: unit(subtract(wall.start, wall.end)) },
  ])
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]!,
        b = ends[j]!
      if (a.wall.id === b.wall.id) continue
      const span = subtract(b.point, a.point),
        length = norm(span)
      if (length < MIN_BRIDGE || length > MAX_BRIDGE) continue
      // A wall already filling this gap (e.g. bridged by an earlier opening of
      // the same batch) hosts the opening instead of a duplicate bridge.
      if (
        straight.some(
          (wall) =>
            (same(wall.start, a.point) && same(wall.end, b.point)) ||
            (same(wall.start, b.point) && same(wall.end, a.point)),
        )
      )
        continue
      const direction = unit(span)
      // A doorway gap continues a wall line between two ends that face each
      // other; a span running back along either wall is not a gap.
      const continues = [a, b].some((end) => Math.abs(dot(end.body, direction)) >= 0.9)
      if (!continues || dot(a.body, direction) > 0.1 || dot(b.body, direction) < -0.1) continue
      const thickness = a.wall.thickness ?? b.wall.thickness ?? 0.18
      const symbol = symbolOnLine(points, a.point, direction)
      const gap = bandGap(symbol, thickness)
      if (gap > REACH[kind] || !coversSpan(symbol, length)) continue
      const score = gap + Math.abs(symbol.centre - length / 2)
      if (!bestBridge || score < bestBridge.score)
        bestBridge = { start: a.point, end: b.point, thickness, score, width: symbol.width }
    }

  // Doors usually mark a gap between two wall ends — bridge it. Windows sit
  // inside existing walls — host them, bridging only when no wall covers them.
  const preferBridge = kind === 'door'
  const host = preferBridge && bestBridge ? null : bestHost
  const bridge = bestBridge && (preferBridge || !bestHost) ? bestBridge : null
  if (host) {
    const width = clampWidth(host.width)
    if (host.length < width + 0.1)
      throw Error('This wall is too short for the selected opening size.')
    const along = Math.max(width / 2 + 0.05, Math.min(host.length - width / 2 - 0.05, host.along))
    return { hostWall: host.wall, bridge: null, along, width }
  }
  if (bridge) {
    const length = norm(subtract(bridge.end, bridge.start))
    const width = Math.min(clampWidth(bridge.width), Math.max(WIDTH_MIN, length - 0.1))
    return {
      hostWall: null,
      bridge: { start: bridge.start, end: bridge.end, thickness: bridge.thickness },
      along: length / 2,
      width,
    }
  }
  throw Error('Place the symbol on a wall, or select it spanning a gap between two wall ends.')
}

function clampWidth(width: number) {
  return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, width))
}
