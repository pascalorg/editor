import { z } from 'zod'
import { plantingAreaOutline, plantingOutlineProblem } from '../../lib/planting-outline'
import { BaseNode, nodeType, objectId } from '../base'
import { PLANTING_LIMITS } from './planting-limits'

export { PLANTING_LIMITS } from './planting-limits'

const coordinate = z
  .number()
  .finite()
  .min(-PLANTING_LIMITS.maxCoordinate)
  .max(PLANTING_LIMITS.maxCoordinate)
const Point = z.tuple([coordinate, coordinate])
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour, such as #7f957a.')

export const PlantingSpecies = z.object({
  habit: z.enum(['mound', 'ball', 'spike', 'tuft', 'carpet']).default('mound'),
  height: z
    .number()
    .finite()
    .min(PLANTING_LIMITS.minHeight)
    .max(PLANTING_LIMITS.maxHeight)
    .default(0.55),
  spread: z
    .number()
    .finite()
    .min(PLANTING_LIMITS.minSpread)
    .max(PLANTING_LIMITS.maxSpread)
    .default(0.55),
  spacing: z
    .number()
    .finite()
    .min(PLANTING_LIMITS.minSpacing)
    .max(PLANTING_LIMITS.maxSpacing)
    .default(0.45),
  share: z.number().finite().min(0.01).max(100).default(1),
  layer: z.enum(['back', 'mid', 'edge']).default('mid'),
  leafColor: Color.default('#7f957a'),
  flowerColor: Color.optional(),
})

export type PlantingSpecies = z.infer<typeof PlantingSpecies>

/** Touching mature crowns: evergreen structure, flowering drifts and a soft, low edge. */
export const PLANTING_DEFAULT_PLANTS: PlantingSpecies[] = [
  {
    habit: 'mound',
    height: 1.5,
    spread: 1.3,
    spacing: 1,
    share: 1,
    layer: 'back',
    leafColor: '#365b2c',
  },
  {
    habit: 'mound',
    height: 0.52,
    spread: 0.65,
    spacing: 0.48,
    share: 1,
    layer: 'mid',
    leafColor: '#609343',
    flowerColor: '#f2eedb',
  },
  {
    habit: 'spike',
    height: 0.88,
    spread: 0.55,
    spacing: 0.42,
    share: 1,
    layer: 'mid',
    leafColor: '#597653',
    flowerColor: '#8362cf',
  },
  {
    habit: 'spike',
    height: 1.05,
    spread: 0.55,
    spacing: 0.42,
    share: 1,
    layer: 'mid',
    leafColor: '#426a3c',
    flowerColor: '#d26a9a',
  },
  {
    habit: 'tuft',
    height: 1.6,
    spread: 0.75,
    spacing: 0.6,
    share: 0.2,
    layer: 'back',
    leafColor: '#819448',
  },
  {
    habit: 'carpet',
    height: 0.11,
    spread: 0.65,
    spacing: 0.35,
    share: 1,
    layer: 'edge',
    leafColor: '#627f4e',
  },
]

/** One Site child; individual plants and all geometry are derived, never scene nodes. */
export const PlantingNode = BaseNode.extend({
  id: objectId('planting'),
  type: nodeType('planting'),
  outline: z.array(Point).min(PLANTING_LIMITS.minPoints).max(PLANTING_LIMITS.maxPoints).optional(),
  area: z.number().finite().min(PLANTING_LIMITS.minArea).max(PLANTING_LIMITS.maxArea).optional(),
  center: Point.default([0, 0]),
  plants: z
    .array(PlantingSpecies)
    .min(1)
    .max(PLANTING_LIMITS.maxSpecies)
    .default(() => PLANTING_DEFAULT_PLANTS.map((plant) => ({ ...plant }))),
  pattern: z.enum(['drifts', 'mixed', 'rows']).default('drifts'),
  ground: z.enum(['soil', 'mulch', 'none']).default('mulch'),
  edging: z.enum(['none', 'steel', 'stone']).default('steel'),
  seed: z.number().int().min(-2147483648).max(2147483647).default(1),
  gen: z.literal(1).default(1),
})
  .superRefine((node, ctx) => {
    if ((node.outline !== undefined) === (node.area !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['outline'],
        message: 'Supply either an outline or an area around a center, not both.',
      })
      return
    }
    const outline = node.outline ?? plantingAreaOutline(node.area as number, node.center)
    const problem = plantingOutlineProblem(outline)
    if (problem)
      ctx.addIssue({ code: 'custom', path: [node.outline ? 'outline' : 'area'], message: problem })
  })
  .describe(
    'Planting bed on Site ground: a simple outline in Site XZ metres, or an area in square metres around center. 1 to 8 species describe habit, height, spread, spacing, share, back/mid/edge layer and leaf/optional flower colours. The seen side is +Z. Pattern drifts, mixed or rows; soil/mulch/none ground; none/steel/stone edging. Seed fixes the layout. No per-plant nodes.',
  )

export type PlantingNode = z.infer<typeof PlantingNode>
