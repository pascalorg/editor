import { ROCK_LIMITS } from '../schema/nodes/rock-limits'
import type { RockFormInput, RockPoint } from './rock-form'

export const OUTLINE_MIN_AREA = 0.25

function mean(points: readonly RockPoint[]): RockPoint {
  const sum = points.reduce<RockPoint>((total, [x, z]) => [total[0] + x, total[1] + z], [0, 0])
  return [sum[0] / points.length, sum[1] / points.length]
}

/** The area centroid, or the mean of the corners for an outline with no area. */
export function rockCentre(outline: readonly RockPoint[]): RockPoint {
  let area = 0
  let cx = 0
  let cz = 0
  outline.forEach(([x, z], i) => {
    const [nx, nz] = outline[(i + 1) % outline.length] ?? [x, z]
    const cross = x * nz - nx * z
    area += cross
    cx += (x + nx) * cross
    cz += (z + nz) * cross
  })
  if (Math.abs(area) < 1e-9) return mean(outline)
  return [cx / (3 * area), cz / (3 * area)]
}

function segmentsCross(a: RockPoint, b: RockPoint, c: RockPoint, d: RockPoint): boolean {
  const side = (p: RockPoint, q: RockPoint, r: RockPoint) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

/** Why an outline cannot stand for a rock: fewer than three corners, no area, or crossing itself. */
export function outlineProblem(outline: readonly RockPoint[]): string | null {
  if (outline.length < ROCK_LIMITS.minPoints) return 'has fewer than three corners'
  const doubled = outline.reduce((sum, [x, z], i) => {
    const [nx, nz] = outline[(i + 1) % outline.length] ?? [x, z]
    return sum + x * nz - nx * z
  }, 0)
  if (Math.abs(doubled) / 2 < OUTLINE_MIN_AREA) return 'has almost no area'
  for (let i = 0; i < outline.length; i++)
    for (let j = i + 2; j < outline.length; j++) {
      if (i === 0 && j === outline.length - 1) continue
      const [a, b] = [outline[i], outline[(i + 1) % outline.length]]
      const [c, d] = [outline[j], outline[(j + 1) % outline.length]]
      if (a && b && c && d && segmentsCross(a, b, c, d)) return 'crosses itself'
    }
  return null
}

/** Shared by the registry and geometry builders before allocating any buffers. */
export function rockInputProblem(input: RockFormInput): string | null {
  if (input.polygon.length > ROCK_LIMITS.maxPoints) return 'has more than 64 corners'
  if (input.polygon.some(([x, z]) => !Number.isFinite(x) || !Number.isFinite(z)))
    return 'has non-finite corners'
  return (
    outlineProblem(input.polygon) ??
    (!(Number.isFinite(input.footY) && Number.isFinite(input.topY) && input.topY > input.footY)
      ? 'has an invalid vertical span'
      : null)
  )
}
