/**
 * Terrain contour lines for the site plan, from the site's heightfield.
 *
 * Marching squares over the field's samples at a chosen interval: every
 * cell whose four corner heights straddle a level gets one or two segments
 * (the saddle case split by the centre height), and the segments are
 * chained into polylines. Only segments whose midpoint lies inside the lot
 * are kept, so the lines stop at the property line the way a survey's do.
 * Elevations are the field's (relative to the site datum, metres); the
 * caller adds the datum for absolute feet when the terrain sample carries
 * one. Pure.
 *
 * Steve (2026-09-07): "i also need the terrain lines on the site plan,
 * include a terrain setting where they can select like 6" or 12" etc".
 */
import { heightAtSample, type TerrainField } from '@pascal-app/core'
import { pointInPolygon, type Pt } from './geometry'

export type Contour = {
  /** The level, site metres above the datum. */
  levelM: number
  points: Pt[]
  /** Every N-th line is an index contour (heavier, labelled). */
  index: boolean
}

type Seg = [Pt, Pt]

/** Interpolate the crossing of `level` between two corners. */
function cross(ax: number, az: number, ah: number, bx: number, bz: number, bh: number, level: number): Pt {
  const t = bh === ah ? 0.5 : (level - ah) / (bh - ah)
  return [ax + (bx - ax) * t, az + (bz - az) * t]
}

/** The segments of one level across the field (marching squares, 16 cases). */
function levelSegments(field: TerrainField, level: number, lot: readonly Pt[]): Seg[] {
  const out: Seg[] = []
  const { cols, rows, spacing } = field
  const [ox, oz] = field.origin
  for (let row = 0; row + 1 < rows; row++) {
    for (let col = 0; col + 1 < cols; col++) {
      // corners: a = (col,row) b = (col+1,row) c = (col+1,row+1) d = (col,row+1)
      const ha = heightAtSample(field, col, row)
      const hb = heightAtSample(field, col + 1, row)
      const hc = heightAtSample(field, col + 1, row + 1)
      const hd = heightAtSample(field, col, row + 1)
      const code = (ha >= level ? 8 : 0) | (hb >= level ? 4 : 0) | (hc >= level ? 2 : 0) | (hd >= level ? 1 : 0)
      if (code === 0 || code === 15) continue
      const x0 = ox + col * spacing
      const x1 = x0 + spacing
      const z0 = oz + row * spacing
      const z1 = z0 + spacing
      const top = () => cross(x0, z0, ha, x1, z0, hb, level)
      const right = () => cross(x1, z0, hb, x1, z1, hc, level)
      const bottom = () => cross(x0, z1, hd, x1, z1, hc, level)
      const left = () => cross(x0, z0, ha, x0, z1, hd, level)
      const push = (p: Pt, q: Pt) => {
        const mx = (p[0] + q[0]) / 2
        const mz = (p[1] + q[1]) / 2
        if (lot.length < 3 || pointInPolygon(lot, mx, mz)) out.push([p, q])
      }
      switch (code) {
        case 1:
        case 14:
          push(left(), bottom())
          break
        case 2:
        case 13:
          push(bottom(), right())
          break
        case 3:
        case 12:
          push(left(), right())
          break
        case 4:
        case 11:
          push(top(), right())
          break
        case 6:
        case 9:
          push(top(), bottom())
          break
        case 7:
        case 8:
          push(left(), top())
          break
        case 5:
        case 10: {
          // the saddle: split by the cell's centre height
          const centre = (ha + hb + hc + hd) / 4
          const high = centre >= level
          if ((code === 5) === high) {
            push(left(), top())
            push(bottom(), right())
          } else {
            push(left(), bottom())
            push(top(), right())
          }
          break
        }
        default:
          break
      }
    }
  }
  return out
}

/** Chain segments end to end into polylines (a tolerance of a centimetre). */
function chain(segments: Seg[]): Pt[][] {
  const key = (p: Pt) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`
  const unused = new Set<number>()
  const byEnd = new Map<string, number[]>()
  segments.forEach((s, i) => {
    unused.add(i)
    for (const p of s) {
      const k = key(p)
      const list = byEnd.get(k) ?? []
      list.push(i)
      byEnd.set(k, list)
    }
  })
  const takeFrom = (p: Pt): { seg: Seg; i: number } | null => {
    for (const i of byEnd.get(key(p)) ?? []) {
      if (unused.has(i)) {
        unused.delete(i)
        return { seg: segments[i] as Seg, i }
      }
    }
    return null
  }
  const lines: Pt[][] = []
  while (unused.size > 0) {
    const first = unused.values().next().value as number
    unused.delete(first)
    const seg = segments[first] as Seg
    const line: Pt[] = [seg[0], seg[1]]
    // grow forward
    for (;;) {
      const tail = line[line.length - 1] as Pt
      const next = takeFrom(tail)
      if (!next) break
      const other = key(next.seg[0]) === key(tail) ? next.seg[1] : next.seg[0]
      line.push(other)
    }
    // grow backward
    for (;;) {
      const head = line[0] as Pt
      const prev = takeFrom(head)
      if (!prev) break
      const other = key(prev.seg[0]) === key(head) ? prev.seg[1] : prev.seg[0]
      line.unshift(other)
    }
    lines.push(line)
  }
  return lines
}

/**
 * The contours of a field at `intervalM`, clipped to the lot. Every fifth
 * level (counted from zero) is an index contour.
 */
export function terrainContours(field: TerrainField, intervalM: number, lot: readonly Pt[]): Contour[] {
  if (!(intervalM > 0)) return []
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let row = 0; row < field.rows; row++) {
    for (let col = 0; col < field.cols; col++) {
      const h = heightAtSample(field, col, row)
      if (h < lo) lo = h
      if (h > hi) hi = h
    }
  }
  if (!Number.isFinite(lo) || hi - lo < 1e-6) return []
  const first = Math.ceil(lo / intervalM)
  const last = Math.floor(hi / intervalM)
  if (last - first > 400) return [] // an absurd interval for the relief — refuse rather than draw a blot
  const out: Contour[] = []
  for (let k = first; k <= last; k++) {
    const level = k * intervalM
    const segs = levelSegments(field, level, lot)
    if (segs.length === 0) continue
    for (const points of chain(segs)) {
      if (points.length < 2) continue
      out.push({ levelM: level, points, index: k % 5 === 0 })
    }
  }
  return out
}
