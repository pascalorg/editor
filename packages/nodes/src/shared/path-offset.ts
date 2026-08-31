import { Vector3 } from 'three'

type Point = [number, number, number]

const UP = new Vector3(0, 1, 0)
const FALLBACK_PERP = new Vector3(1, 0, 0)

/** Cap on the miter-length multiplier so a sharp turn doesn't shoot the
 * corner off to infinity — past this we'd want a bevel, but MEP runs bend
 * gently enough that clamping is invisible. */
const MITER_LIMIT = 4

/**
 * Horizontal side vector for each path segment — the axis a parallel line is
 * pushed apart along, kept HORIZONTAL so the offset never tilts. A vertical
 * (riser) segment has no horizontal heading of its own, so it inherits the
 * side vector from the nearest segment that does; this keeps the offset line
 * beside the source as the run climbs instead of rotating about the bend.
 * Falls back to the X axis only if the whole path is vertical.
 */
function segmentSides(points: Vector3[]): Vector3[] {
  const sides: (Vector3 | null)[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const dir = new Vector3().subVectors(points[i + 1]!, points[i]!)
    const horizontal = new Vector3(dir.x, 0, dir.z)
    sides.push(horizontal.lengthSq() < 1e-9 ? null : horizontal.normalize().cross(UP).normalize())
  }
  // Forward then backward fill so vertical segments adopt a real heading.
  for (let i = 1; i < sides.length; i++) if (!sides[i]) sides[i] = sides[i - 1] ?? null
  for (let i = sides.length - 2; i >= 0; i--) if (!sides[i]) sides[i] = sides[i + 1] ?? null
  return sides.map((s) => s ?? FALLBACK_PERP.clone())
}

/**
 * Per-vertex offset vectors for shifting a path sideways into a parallel line.
 * At an interior vertex the offset follows the angle bisector of the two
 * adjacent segment side vectors, scaled by `1/cos(half-angle)` so the offset
 * segments on either side of the bend meet exactly at one miter point (a plain
 * per-segment side leaves them crossing/gapping). Endpoints use their single
 * segment's side. Side vectors are horizontal, so the offset is too — a
 * horizontal→vertical bend keeps the same side (cos 1, no expansion), leaving
 * the parallel line side by side up the riser.
 */
function miterOffsets(points: Vector3[], offset: number): Vector3[] {
  const sides = segmentSides(points)
  return points.map((_p, i) => {
    const sIn = i > 0 ? sides[i - 1]! : null
    const sOut = i < sides.length ? sides[i]! : null
    if (sIn && sOut) {
      const bisector = sIn.clone().add(sOut)
      // s_in == -s_out → a 180° switchback; the bisector vanishes, so just
      // run straight out on one side.
      if (bisector.lengthSq() < 1e-9) return sIn.clone().multiplyScalar(offset)
      bisector.normalize()
      const cos = bisector.dot(sIn)
      const scale = Math.min(MITER_LIMIT, 1 / Math.max(cos, 1 / MITER_LIMIT))
      return bisector.multiplyScalar(offset * scale)
    }
    return (sIn ?? sOut)!.clone().multiplyScalar(offset)
  })
}

/**
 * Offset a polyline horizontally by `offset` meters to one side, mitered at
 * bends so the parallel line meets cleanly. Positive `offset` shifts along the
 * `+UP × heading` side of each segment; negative flips to the other side. Used
 * to lay a thin line beside an existing run (the liquid-line follow-trace).
 */
export function offsetPathHorizontal(path: readonly Point[], offset: number): Point[] {
  const points = path.map(([x, y, z]) => new Vector3(x, y, z))
  const offsets = miterOffsets(points, offset)
  return points.map((p, i) => {
    const o = p.clone().add(offsets[i]!)
    return [o.x, o.y, o.z] as Point
  })
}
