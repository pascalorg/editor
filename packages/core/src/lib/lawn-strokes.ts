import type { LawnStroke } from '../schema/nodes/lawn'

export type LawnStrokeSample = { coverage: number; height: number; flowers: number }

const strokeBounds = new WeakMap<LawnStroke, [number, number, number, number]>()

export function lawnStrokeWeight(stroke: LawnStroke, x: number, z: number): number {
  let bounds = strokeBounds.get(stroke)
  if (!bounds) {
    bounds = [Infinity, Infinity, -Infinity, -Infinity]
    for (const [px, pz] of stroke.points) {
      bounds[0] = Math.min(bounds[0], px - stroke.radiusM)
      bounds[1] = Math.min(bounds[1], pz - stroke.radiusM)
      bounds[2] = Math.max(bounds[2], px + stroke.radiusM)
      bounds[3] = Math.max(bounds[3], pz + stroke.radiusM)
    }
    strokeBounds.set(stroke, bounds)
  }
  if (x < bounds[0] || z < bounds[1] || x > bounds[2] || z > bounds[3]) return 0
  let distanceSquared = Infinity
  for (let index = 0; index < stroke.points.length; index++) {
    const start = stroke.points[index]
    const end = stroke.points[index + 1] ?? start
    if (!start || !end) continue
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const lengthSquared = dx * dx + dz * dz
    const along = lengthSquared
      ? Math.max(0, Math.min(1, ((x - start[0]) * dx + (z - start[1]) * dz) / lengthSquared))
      : 0
    distanceSquared = Math.min(
      distanceSquared,
      (x - start[0] - along * dx) ** 2 + (z - start[1] - along * dz) ** 2,
    )
  }
  const t = Math.max(0, 1 - Math.sqrt(distanceSquared) / stroke.radiusM)
  return t * t * (3 - 2 * t) * stroke.strength
}

export function sampleLawnStrokes(
  strokes: readonly LawnStroke[],
  x: number,
  z: number,
): LawnStrokeSample {
  const sample = { coverage: 1, height: 1, flowers: 0.5 }
  for (const stroke of strokes) {
    const weight = lawnStrokeWeight(stroke, x, z)
    if (stroke.effect === 'bare') sample.coverage *= 1 - weight
    if (stroke.effect === 'grass') sample.coverage += (1 - sample.coverage) * weight
    if (stroke.effect === 'taller') sample.height += (2 - sample.height) * weight
    if (stroke.effect === 'shorter') sample.height += (0.25 - sample.height) * weight
    if (stroke.effect === 'more-flowers') sample.flowers += (1 - sample.flowers) * weight
    if (stroke.effect === 'fewer-flowers') sample.flowers *= 1 - weight
  }
  return sample
}
