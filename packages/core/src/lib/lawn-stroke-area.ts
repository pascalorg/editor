import type { LawnNode, LawnStroke } from '../schema/nodes/lawn'
import type { LawnCoverage } from './lawn-coverage'
import { lawnStrokeWeight } from './lawn-strokes'
import { assertLawnStrokeWork, type LawnFacts } from './lawn-types'

type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number }

export function lawnStrokeAreas(
  node: LawnNode,
  coverage: LawnCoverage,
  bounds: Bounds,
  initialWork: number,
) {
  const byEffect: Record<LawnStroke['effect'], number> = {
    bare: 0,
    grass: 0,
    taller: 0,
    shorter: 0,
    'more-flowers': 0,
    'fewer-flowers': 0,
  }
  const resolution = 0.25
  let unionAreaM2 = 0,
    sampleCount = 0,
    minimumSamplingResolutionM = resolution,
    strokeWork = initialWork
  const points = node.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0)
  const fine = node.strokes
    .filter((stroke) => stroke.radiusM < resolution && stroke.strength > 0)
    .map((stroke) => ({
      stroke: { ...stroke, radiusM: stroke.radiusM + resolution / Math.SQRT2 },
      divisions: Math.ceil(resolution / (stroke.radiusM / 2)),
    }))
  if (points)
    for (let row = bounds.minZ / resolution; row < bounds.maxZ / resolution; row++)
      for (let col = bounds.minX / resolution; col < bounds.maxX / resolution; col++) {
        let divisions = 1
        for (const refinement of fine) {
          strokeWork += refinement.stroke.points.length
          assertLawnStrokeWork(strokeWork)
          if (
            lawnStrokeWeight(
              refinement.stroke,
              (col + 0.5) * resolution,
              (row + 0.5) * resolution,
            ) > 0
          )
            divisions = Math.max(divisions, refinement.divisions)
        }
        const step = resolution / divisions
        minimumSamplingResolutionM = Math.min(minimumSamplingResolutionM, step)
        for (let dz = 0; dz < divisions; dz++)
          for (let dx = 0; dx < divisions; dx++) {
            sampleCount++
            strokeWork += points
            assertLawnStrokeWork(strokeWork)
            const x = col * resolution + (dx + 0.5) * step,
              z = row * resolution + (dz + 0.5) * step
            if (!coverage.contains(x, z)) continue
            const effects = new Set<LawnStroke['effect']>()
            for (const stroke of node.strokes)
              if (lawnStrokeWeight(stroke, x, z) > 0) effects.add(stroke.effect)
            for (const effect of effects) byEffect[effect] += step * step
            if (effects.size) unionAreaM2 += step * step
          }
      }
  const areas: LawnFacts['strokeAreas'] = {
    estimated: true,
    samplingResolutionM: resolution,
    minimumSamplingResolutionM,
    sampleCount,
    byEffect,
    unionAreaM2,
  }
  return { areas, strokeWork }
}
