import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MeasurementAnchor } from './measurement'

const FiniteCoordinate = z.number().finite()

export const ConstructionDimensionBaseline = z
  .object({
    origin: z.tuple([FiniteCoordinate, FiniteCoordinate]).default([0, 0.6]),
    direction: z.tuple([FiniteCoordinate, FiniteCoordinate]).default([1, 0]),
  })
  .superRefine((baseline, ctx) => {
    if (Math.hypot(baseline.direction[0], baseline.direction[1]) <= 1e-9) {
      ctx.addIssue({
        code: 'custom',
        path: ['direction'],
        message: 'Construction dimension baseline direction must be non-zero',
      })
    }
  })

export const ConstructionDimensionChainMode = z.enum(['point-to-point', 'continuous'])
export const ConstructionDimensionMode = z.enum([
  'linear',
  'radius',
  'diameter',
  'center-mark',
  'chord',
  'arc-length',
  'angular',
  'coordinate',
])

export const ConstructionDimensionNode = BaseNode.extend({
  id: objectId('construction-dimension'),
  type: nodeType('construction-dimension'),
  anchors: z
    .array(MeasurementAnchor)
    .min(2)
    .default([
      [0, 0, 0],
      [1, 0, 0],
    ]),
  baseline: ConstructionDimensionBaseline.default({ origin: [0, 0.6], direction: [1, 0] }),
  chainMode: ConstructionDimensionChainMode.default('point-to-point'),
  mode: ConstructionDimensionMode.default('linear'),
  featureCount: z.number().int().min(1).max(999).default(1),
  showCenterMark: z.boolean().default(true),
  reference: z.boolean().default(false),
  prefix: z.string().max(40).default(''),
  suffix: z.string().max(40).default(''),
  textOverride: z.string().trim().min(1).max(120).nullable().default(null),
}).describe(
  dedent`
  Construction dimension node - an associative floor-plan construction dimension
  - anchors: two or more free or semantic feature anchors that supply the witness origins
  - baseline.origin: a point on the independently placed dimension line
  - baseline.direction: the fixed plan direction used to project the witness origins
  - chainMode: point-to-point for one segment or continuous for adjacent dimension strings
  - mode: linear, radius, diameter, center mark, chord, arc length, angular, or coordinate
  - featureCount: repeated-feature multiplier used by diameter/radius and other notation
  - showCenterMark: displays the resolved circle/angle center where applicable
  - reference/prefix/suffix/textOverride: document notation overrides without changing geometry
  `,
)

export type ConstructionDimensionBaseline = z.infer<typeof ConstructionDimensionBaseline>
export type ConstructionDimensionChainMode = z.infer<typeof ConstructionDimensionChainMode>
export type ConstructionDimensionMode = z.infer<typeof ConstructionDimensionMode>
export type ConstructionDimensionNode = z.infer<typeof ConstructionDimensionNode>

export function constructionDimensionRequiredAnchorCount(mode: ConstructionDimensionMode): number {
  return mode === 'arc-length' || mode === 'angular' ? 3 : 2
}
