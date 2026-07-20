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
}).describe(
  dedent`
  Construction dimension node - an associative linear floor-plan dimension
  - anchors: two or more free or semantic feature anchors that supply the witness origins
  - baseline.origin: a point on the independently placed dimension line
  - baseline.direction: the fixed plan direction used to project the witness origins
  - chainMode: point-to-point for one segment or continuous for adjacent dimension strings
  `,
)

export type ConstructionDimensionBaseline = z.infer<typeof ConstructionDimensionBaseline>
export type ConstructionDimensionChainMode = z.infer<typeof ConstructionDimensionChainMode>
export type ConstructionDimensionNode = z.infer<typeof ConstructionDimensionNode>
