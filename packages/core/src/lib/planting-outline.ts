import { PLANTING_LIMITS } from '../schema/nodes/planting-limits'
import { valueNoise3 } from './seeded-noise'

export type PlantingPoint = [number, number]

/** Signed XZ area, evaluated about one vertex to retain precision away from the origin. */
export function plantingArea(outline: readonly PlantingPoint[]): number {
  const origin = outline[0]
  if (!origin) return 0
  let twice = 0
  for (let i = 1; i + 1 < outline.length; i++) {
    const a = outline[i] as PlantingPoint
    const b = outline[i + 1] as PlantingPoint
    twice += (a[0] - origin[0]) * (b[1] - origin[1]) - (b[0] - origin[0]) * (a[1] - origin[1])
  }
  return twice / 2
}

export function plantingCentroid(outline: readonly PlantingPoint[]): PlantingPoint {
  const origin = outline[0]
  if (!origin) return [0, 0]
  let x = 0
  let z = 0
  let weight = 0
  for (let i = 1; i + 1 < outline.length; i++) {
    const a = outline[i] as PlantingPoint
    const b = outline[i + 1] as PlantingPoint
    const ax = a[0] - origin[0]
    const az = a[1] - origin[1]
    const bx = b[0] - origin[0]
    const bz = b[1] - origin[1]
    const cross = ax * bz - bx * az
    x += (ax + bx) * cross
    z += (az + bz) * cross
    weight += cross
  }
  return Math.abs(weight) > 1e-12
    ? [origin[0] + x / (3 * weight), origin[1] + z / (3 * weight)]
    : [...origin]
}

export function plantingBounds(outline: readonly PlantingPoint[]) {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const [x, z] of outline) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, minZ, maxX, maxZ }
}

export function plantingContains(outline: readonly PlantingPoint[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i] as PlantingPoint
    const b = outline[j] as PlantingPoint
    if (a[1] > z !== b[1] > z && x < a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]))
      inside = !inside
  }
  return inside
}

export function plantingEdgeDistance(
  outline: readonly PlantingPoint[],
  x: number,
  z: number,
): number {
  let nearest = Infinity
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as PlantingPoint
    const b = outline[(i + 1) % outline.length] as PlantingPoint
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const t = Math.max(
      0,
      Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)),
    )
    nearest = Math.min(nearest, (x - a[0] - dx * t) ** 2 + (z - a[1] - dz * t) ** 2)
  }
  return Math.sqrt(nearest)
}

const cross = (a: PlantingPoint, b: PlantingPoint, c: PlantingPoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

function intersects(a: PlantingPoint, b: PlantingPoint, c: PlantingPoint, d: PlantingPoint) {
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  )
    return false
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
}

/** No crossings, doubled-back edges or zero-length sides. Collinear forward vertices are fine. */
export function plantingSimple(outline: readonly PlantingPoint[]): boolean {
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as PlantingPoint
    const b = outline[(i + 1) % outline.length] as PlantingPoint
    if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 < 1e-12) return false
    const before = outline[(i + outline.length - 1) % outline.length] as PlantingPoint
    if (
      Math.abs(cross(before, a, b)) < 1e-12 &&
      (before[0] - a[0]) * (b[0] - a[0]) + (before[1] - a[1]) * (b[1] - a[1]) > 0
    )
      return false
    for (let j = i + 2; j < outline.length; j++) {
      if (i === 0 && j === outline.length - 1) continue
      if (
        intersects(
          a,
          b,
          outline[j] as PlantingPoint,
          outline[(j + 1) % outline.length] as PlantingPoint,
        )
      )
        return false
    }
  }
  return outline.length >= 3
}

/** A bounded, friendly refusal shared by the schema and headless callers. */
export function plantingOutlineProblem(outline: readonly PlantingPoint[]): string | null {
  if (outline.length < PLANTING_LIMITS.minPoints || outline.length > PLANTING_LIMITS.maxPoints)
    return 'Use 3 to 64 outline points, without repeating the first point.'
  if (
    outline.some(
      (p) =>
        p.length !== 2 ||
        p.some((v) => !Number.isFinite(v) || Math.abs(v) > PLANTING_LIMITS.maxCoordinate),
    )
  )
    return 'Outline coordinates must be finite Site metres within ±10,000.'
  if (!plantingSimple(outline))
    return 'The planting outline must be a simple polygon with no crossings or repeated points.'
  const area = Math.abs(plantingArea(outline))
  if (area < PLANTING_LIMITS.minArea - 1e-9 || area > PLANTING_LIMITS.maxArea + 1e-9)
    return 'A planting bed must cover between 0.25 and 2,500 square metres.'
  const bounds = plantingBounds(outline)
  if (Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) > PLANTING_LIMITS.maxExtent)
    return 'Keep each planting bed within a 200 metre span.'
  return null
}

/** Resample, low-pass, push normally by low-frequency noise, then restore area and centroid. */
export function plantingOrganicOutline(
  outline: readonly PlantingPoint[],
  seed = 1,
): PlantingPoint[] {
  const problem = plantingOutlineProblem(outline)
  if (problem) throw new Error(problem)
  const area = Math.abs(plantingArea(outline))
  const center = plantingCentroid(outline)
  const bounds = plantingBounds(outline)
  let perimeter = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as PlantingPoint
    const b = outline[(i + 1) % outline.length] as PlantingPoint
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  // Preserve every supplied corner, including a narrow concavity; spend only the remaining slots.
  const remaining = PLANTING_LIMITS.maxOutlinePoints - outline.length
  const original: PlantingPoint[] = []
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as PlantingPoint
    const b = outline[(i + 1) % outline.length] as PlantingPoint
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const count =
      1 + Math.min(Math.floor(length / 0.18), Math.floor((remaining * length) / perimeter))
    for (let j = 0; j < count; j++)
      original.push([a[0] + ((b[0] - a[0]) * j) / count, a[1] + ((b[1] - a[1]) * j) / count])
  }
  let points = original
  for (let pass = 0; pass < 20; pass++) {
    points = points.map((p, i): PlantingPoint => {
      const a = points[(i + points.length - 1) % points.length] as PlantingPoint
      const b = points[(i + 1) % points.length] as PlantingPoint
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]
    })
  }
  const sign = plantingArea(points) > 0 ? 1 : -1
  const amplitude = Math.min(0.45, (area / perimeter) * 0.65)
  const phase = Math.PI * valueNoise3(seed, 2.7, 0, 8.3)
  const pushed = points.map((p, i): PlantingPoint => {
    const a = points[(i + points.length - 1) % points.length] as PlantingPoint
    const b = points[(i + 1) % points.length] as PlantingPoint
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const d = Math.hypot(dx, dz) || 1
    const x = p[0] - center[0]
    const z = p[1] - center[1]
    // A broad wave supplies actual bays even when the noise happens to be almost flat.
    const noise =
      amplitude *
      (0.65 * Math.sin(x * 1.8 + z * 1.2 + phase) +
        0.35 * valueNoise3(seed, x * 0.65, 3.1, z * 0.65))
    return [p[0] + ((sign * dz) / d) * noise * 0.3, p[1] - ((sign * dx) / d) * noise]
  })
  // Narrow necks may not survive the full smoothing. Reduce only the deformation, never the area.
  for (let attempt = 0; attempt < 9; attempt++) {
    const blend = attempt === 8 ? 0 : 1 / 2 ** attempt
    const candidate = original.map((p, i): PlantingPoint => {
      const q = pushed[i] as PlantingPoint
      return [p[0] + (q[0] - p[0]) * blend, p[1] + (q[1] - p[1]) * blend]
    })
    const size = Math.abs(plantingArea(candidate))
    if (!(size > 1e-12) || !plantingSimple(candidate)) continue
    const c = plantingCentroid(candidate)
    const scale = Math.sqrt(area / size)
    const extent = plantingBounds(candidate)
    // Keep the supplied lateral span: recover rounded-corner area in depth rather than
    // widening the bed into its neighbours. Positive affine scaling preserves simplicity.
    const scaleX = Math.min(
      scale,
      (bounds.maxX - center[0]) / (extent.maxX - c[0]),
      (center[0] - bounds.minX) / (c[0] - extent.minX),
    )
    const scaleZ = area / (size * scaleX)
    return candidate.map(
      (p): PlantingPoint => [
        center[0] + (p[0] - c[0]) * scaleX,
        center[1] + (p[1] - c[1]) * scaleZ,
      ],
    )
  }
  return outline.map((p): PlantingPoint => [...p])
}

export function plantingAreaOutline(area: number, center: PlantingPoint): PlantingPoint[] {
  const count = 32
  const radius = Math.sqrt(area / ((count * Math.sin((2 * Math.PI) / count)) / 2))
  return Array.from(
    { length: count },
    (_, i): PlantingPoint => [
      center[0] + radius * Math.cos((i * 2 * Math.PI) / count),
      center[1] + radius * Math.sin((i * 2 * Math.PI) / count),
    ],
  )
}
