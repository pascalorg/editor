import { z } from 'zod'
import { plantingArea, plantingSimple } from '../../lib/planting-outline'
import { BaseNode, nodeType, objectId } from '../base'
import { LAWN_LIMITS } from './lawn-limits'

export { LAWN_LIMITS } from './lawn-limits'

const coordinate = z
  .number()
  .finite()
  .min(-LAWN_LIMITS.maxCoordinate)
  .max(LAWN_LIMITS.maxCoordinate)
const Point = z.tuple([coordinate, coordinate])
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour.')

export const LawnFlower = z.object({
  species: z.enum(['daisy', 'clover', 'yarrow']),
  share: z.number().finite().min(0.01).max(100),
  color: Color.optional(),
})
export type LawnFlower = z.infer<typeof LawnFlower>

export const LawnStroke = z.object({
  points: z.array(Point).min(1).max(LAWN_LIMITS.maxStrokePoints),
  radiusM: z.number().finite().min(LAWN_LIMITS.minStrokeRadius).max(LAWN_LIMITS.maxStrokeRadius),
  effect: z.enum(['bare', 'grass', 'taller', 'shorter', 'more-flowers', 'fewer-flowers']),
  strength: z.number().finite().min(0).max(1),
})
export type LawnStroke = z.infer<typeof LawnStroke>

export const LawnNode = BaseNode.extend({
  id: objectId('lawn'),
  type: nodeType('lawn'),
  outline: z.array(Point).min(LAWN_LIMITS.minPoints).max(LAWN_LIMITS.maxPoints),
  height: z.number().finite().min(LAWN_LIMITS.minHeight).max(LAWN_LIMITS.maxHeight).default(0.06),
  bladeWidth: z
    .number()
    .finite()
    .min(LAWN_LIMITS.minBladeWidth)
    .max(LAWN_LIMITS.maxBladeWidth)
    .default(0.008),
  density: z.number().finite().min(LAWN_LIMITS.minDensity).max(LAWN_LIMITS.maxDensity).default(100),
  roughness: z.number().finite().min(0).max(1).default(0.2),
  color: Color.default('#617c36'),
  edgeFade: z.number().finite().min(0).max(LAWN_LIMITS.maxEdgeFade).default(0.1),
  wind: z.number().finite().min(0).max(1).default(0.2),
  seed: z.number().int().min(-2147483648).max(2147483647).default(1),
  gen: z.literal(1).default(1),
  flowerDensity: z.number().finite().min(0).max(LAWN_LIMITS.maxFlowerDensity).default(0),
  flowers: z.array(LawnFlower).max(LAWN_LIMITS.maxSpecies).default([]),
  season: z.enum(['spring', 'summer', 'autumn', 'winter']).default('summer'),
  strokes: z.array(LawnStroke).max(LAWN_LIMITS.maxStrokes).default([]),
})
  .superRefine((node, ctx) => {
    if (!plantingSimple(node.outline)) {
      ctx.addIssue({
        code: 'custom',
        path: ['outline'],
        message: 'Use a simple lawn outline without crossings or repeated points.',
      })
      return
    }
    const area = Math.abs(plantingArea(node.outline))
    if (area < LAWN_LIMITS.minArea - 1e-9 || area > LAWN_LIMITS.maxArea + 1e-9)
      ctx.addIssue({
        code: 'custom',
        path: ['outline'],
        message: 'A lawn must cover 0.25 to 2,500 square metres.',
      })
  })
  .describe(
    'Lawn on Site ground. Outline and ordered brush strokes use Site XZ metres. Seed and generator version fix derived blades, real flowers and terrain-following ground; no geometry or images are stored.',
  )

export type LawnNode = z.infer<typeof LawnNode>
