import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const RoadNode = BaseNode.extend({
  id: objectId('road'),
  type: nodeType('road'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  curveOffset: z.number().optional(),
  width: z.number().default(3.5),
  thickness: z.number().default(0.04),
  elevation: z.number().default(0.01),
  laneCount: z.number().int().min(1).max(8).default(2),
  showLaneMarkings: z.boolean().default(true),
  asphaltColor: z.string().default('#2f3338'),
  markingColor: z.string().default('#f8fafc'),
}).describe(
  dedent`
  Road node - a flat road segment drawn on a level.
  - start/end: road centerline endpoints in level coordinate system
  - curveOffset: midpoint sagitta offset used to bend the road into an arc
  - width/thickness/elevation: road deck dimensions and offset above the level plane
  - laneCount/showLaneMarkings: visual lane stripe controls
  - asphaltColor/markingColor: default road and stripe colours
  `,
)

export type RoadNode = z.infer<typeof RoadNode>
