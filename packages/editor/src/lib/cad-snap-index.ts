/**
 * Spatial index over a CAD underlay's line work, so drawing tools can snap to
 * the drawing they are tracing.
 *
 * Why a dedicated index rather than reusing the wall snap functions: those
 * walk every wall on the level, which is fine for the dozens a building has
 * and hopeless for the hundred-thousand-odd segments a real drawing carries
 * (146k in the first production file we tested). They also understand curved
 * walls and node identity, neither of which applies here — the parser
 * flattens every arc, so an underlay is only ever straight segments.
 *
 * Coordinates in and out are level-local metres. The drawing's own units and
 * the node's placement are baked in at build time, so queries never transform.
 */

export type CadSnapKind = 'endpoint' | 'midpoint' | 'intersection' | 'segment'

export type CadSnapResult = {
  point: [number, number]
  kind: CadSnapKind
}

export type CadSnapRadii = Partial<Record<CadSnapKind, number>>

/**
 * Cell size in metres. Sized a little above the largest snap radius so a query
 * touches a 2×2 block of cells at most.
 */
const CELL_SIZE = 1

/**
 * A segment whose bounding box covers more cells than this is held in a
 * separate list checked on every query instead of being written into each
 * cell. CAD files are full of construction lines running the length of the
 * sheet; without this, one of them would be inserted into thousands of cells.
 */
const MAX_CELLS_PER_SEGMENT = 64

/** Keeps cell keys collision-free for coordinates within ±1000 km. */
const KEY_OFFSET = 1 << 20
const KEY_STRIDE = 1 << 21

function cellKey(cx: number, cy: number): number {
  return (cx + KEY_OFFSET) * KEY_STRIDE + (cy + KEY_OFFSET)
}

export type CadUnderlayPlacement = {
  /** Metres per drawing unit. */
  scale: number
  /** Rotation about the vertical axis, radians. */
  rotation: number
  /** Level-local plan position of the drawing origin. */
  position: [number, number]
}

export class CadSnapIndex {
  /** Flat `[x1, y1, x2, y2, ...]` in level-local metres. */
  private readonly xy: Float64Array
  private readonly count: number
  private readonly cells = new Map<number, number[]>()
  private readonly oversized: number[] = []

  constructor(xy: Float64Array) {
    this.xy = xy
    this.count = xy.length / 4

    for (let i = 0; i < this.count; i++) {
      const x1 = xy[i * 4]!
      const y1 = xy[i * 4 + 1]!
      const x2 = xy[i * 4 + 2]!
      const y2 = xy[i * 4 + 3]!

      const minCx = Math.floor(Math.min(x1, x2) / CELL_SIZE)
      const maxCx = Math.floor(Math.max(x1, x2) / CELL_SIZE)
      const minCy = Math.floor(Math.min(y1, y2) / CELL_SIZE)
      const maxCy = Math.floor(Math.max(y1, y2) / CELL_SIZE)

      const spanned = (maxCx - minCx + 1) * (maxCy - minCy + 1)
      if (spanned > MAX_CELLS_PER_SEGMENT) {
        this.oversized.push(i)
        continue
      }

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const key = cellKey(cx, cy)
          const bucket = this.cells.get(key)
          if (bucket) bucket.push(i)
          else this.cells.set(key, [i])
        }
      }
    }
  }

  get segmentCount(): number {
    return this.count
  }

  /** Segment indices whose cells overlap the query disc, plus the oversized ones. */
  private candidates(x: number, y: number, radius: number): number[] {
    const minCx = Math.floor((x - radius) / CELL_SIZE)
    const maxCx = Math.floor((x + radius) / CELL_SIZE)
    const minCy = Math.floor((y - radius) / CELL_SIZE)
    const maxCy = Math.floor((y + radius) / CELL_SIZE)

    const seen = new Set<number>()
    const out: number[] = []
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(cellKey(cx, cy))
        if (!bucket) continue
        for (const index of bucket) {
          if (seen.has(index)) continue
          seen.add(index)
          out.push(index)
        }
      }
    }
    for (const index of this.oversized) {
      if (!seen.has(index)) {
        seen.add(index)
        out.push(index)
      }
    }
    return out
  }

  segmentAt(index: number): [number, number, number, number] {
    return [
      this.xy[index * 4]!,
      this.xy[index * 4 + 1]!,
      this.xy[index * 4 + 2]!,
      this.xy[index * 4 + 3]!,
    ]
  }

  nearestEndpoint(x: number, y: number, radius: number): [number, number] | null {
    let best: [number, number] | null = null
    let bestDist = radius * radius

    for (const index of this.candidates(x, y, radius)) {
      const [x1, y1, x2, y2] = this.segmentAt(index)
      for (const [px, py] of [
        [x1, y1],
        [x2, y2],
      ] as const) {
        const d = (px - x) ** 2 + (py - y) ** 2
        if (d < bestDist) {
          bestDist = d
          best = [px, py]
        }
      }
    }
    return best
  }

  nearestMidpoint(x: number, y: number, radius: number): [number, number] | null {
    let best: [number, number] | null = null
    let bestDist = radius * radius

    for (const index of this.candidates(x, y, radius)) {
      const [x1, y1, x2, y2] = this.segmentAt(index)
      const mx = (x1 + x2) / 2
      const my = (y1 + y2) / 2
      const d = (mx - x) ** 2 + (my - y) ** 2
      if (d < bestDist) {
        bestDist = d
        best = [mx, my]
      }
    }
    return best
  }

  /**
   * Nearest crossing of two underlay segments. Quadratic in the candidates a
   * single query returns, which the index keeps to the handful sharing a cell
   * — the same pass over the whole drawing would be 10^10 pairs.
   */
  nearestIntersection(x: number, y: number, radius: number): [number, number] | null {
    const candidates = this.candidates(x, y, radius)
    let best: [number, number] | null = null
    let bestDist = radius * radius

    for (let i = 0; i < candidates.length; i++) {
      const a = this.segmentAt(candidates[i]!)
      for (let j = i + 1; j < candidates.length; j++) {
        const b = this.segmentAt(candidates[j]!)
        const crossing = segmentIntersection(a, b)
        if (!crossing) continue
        const d = (crossing[0] - x) ** 2 + (crossing[1] - y) ** 2
        if (d < bestDist) {
          bestDist = d
          best = crossing
        }
      }
    }
    return best
  }

  /** Nearest point lying on a segment's body (its interior or its ends). */
  nearestOnSegment(x: number, y: number, radius: number): [number, number] | null {
    let best: [number, number] | null = null
    let bestDist = radius * radius

    for (const index of this.candidates(x, y, radius)) {
      const [x1, y1, x2, y2] = this.segmentAt(index)
      const dx = x2 - x1
      const dy = y2 - y1
      const lengthSquared = dx * dx + dy * dy
      if (lengthSquared < 1e-12) continue

      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared))
      const px = x1 + dx * t
      const py = y1 + dy * t
      const d = (px - x) ** 2 + (py - y) ** 2
      if (d < bestDist) {
        bestDist = d
        best = [px, py]
      }
    }
    return best
  }
}

function segmentIntersection(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number] | null {
  const rx = a[2] - a[0]
  const ry = a[3] - a[1]
  const sx = b[2] - b[0]
  const sy = b[3] - b[1]
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-9) return null

  const qpx = b[0] - a[0]
  const qpy = b[1] - a[1]
  const t = (qpx * sy - qpy * sx) / denom
  const u = (qpx * ry - qpy * rx) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null

  return [a[0] + t * rx, a[1] + t * ry]
}

/**
 * Bake an underlay's visible layers into level-local metres.
 *
 * `segments` and `segmentLayers` come straight from the underlay asset;
 * `visibleLayers` is the resolved per-layer decision, indexed the same way.
 */
export function buildCadSnapIndex({
  segments,
  segmentLayers,
  visibleLayers,
  placement,
}: {
  segments: Float32Array
  segmentLayers: Uint16Array
  visibleLayers: boolean[]
  placement: CadUnderlayPlacement
}): CadSnapIndex {
  const { scale, rotation, position } = placement
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  let kept = 0
  for (let i = 0; i < segmentLayers.length; i++) {
    if (visibleLayers[segmentLayers[i]!]) kept++
  }

  const xy = new Float64Array(kept * 4)
  let cursor = 0
  for (let i = 0; i < segmentLayers.length; i++) {
    if (!visibleLayers[segmentLayers[i]!]) continue
    for (const offset of [0, 2] as const) {
      const dx = segments[i * 4 + offset]! * scale
      const dy = segments[i * 4 + offset + 1]! * scale
      xy[cursor] = dx * cos - dy * sin + position[0]
      xy[cursor + 1] = dx * sin + dy * cos + position[1]
      cursor += 2
    }
  }

  return new CadSnapIndex(xy)
}

/**
 * Radii mirroring the wall tool's tiers, so snapping to a drawn line and
 * snapping to an underlay line feel the same. Slightly tighter across the
 * board: an underlay is dense, and a generous radius over dense line work
 * grabs the wrong thing.
 */
export const CAD_SNAP_RADII: Required<CadSnapRadii> = {
  endpoint: 0.5,
  midpoint: 0.35,
  intersection: 0.35,
  segment: 0.25,
}

/**
 * Nearest underlay feature to the cursor, in the same priority order the wall
 * tool uses: a corner is the strongest intent, then the nearer of a midpoint
 * or a crossing, then the line body.
 */
export function findCadSnap(
  index: CadSnapIndex,
  point: readonly [number, number],
  radii: CadSnapRadii = CAD_SNAP_RADII,
): CadSnapResult | null {
  const [x, y] = point
  const resolved = { ...CAD_SNAP_RADII, ...radii }

  const endpoint = index.nearestEndpoint(x, y, resolved.endpoint)
  if (endpoint) return { point: endpoint, kind: 'endpoint' }

  const midpoint = index.nearestMidpoint(x, y, resolved.midpoint)
  const intersection = index.nearestIntersection(x, y, resolved.intersection)
  const nearer = pickNearer(point, midpoint, 'midpoint', intersection, 'intersection')
  if (nearer) return nearer

  const onSegment = index.nearestOnSegment(x, y, resolved.segment)
  return onSegment ? { point: onSegment, kind: 'segment' } : null
}

function pickNearer(
  from: readonly [number, number],
  a: [number, number] | null,
  aKind: CadSnapKind,
  b: [number, number] | null,
  bKind: CadSnapKind,
): CadSnapResult | null {
  if (!a) return b ? { point: b, kind: bKind } : null
  if (!b) return { point: a, kind: aKind }
  const da = (a[0] - from[0]) ** 2 + (a[1] - from[1]) ** 2
  const db = (b[0] - from[0]) ** 2 + (b[1] - from[1]) ** 2
  return da <= db ? { point: a, kind: aKind } : { point: b, kind: bKind }
}
