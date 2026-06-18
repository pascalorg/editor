import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const RoadSurfaceKind = z.enum(['road', 'river', 'walkway', 'greenbelt'])
export type RoadSurfaceKind = z.infer<typeof RoadSurfaceKind>

export const RoadNode = BaseNode.extend({
  id: objectId('road'),
  type: nodeType('road'),
  surfaceKind: RoadSurfaceKind.default('road'),
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
  Ground strip node - a flat linear surface strip drawn on a level.
  - surfaceKind: road, river, walkway, or greenbelt presentation
  - start/end: centerline endpoints in level coordinate system
  - curveOffset: midpoint sagitta offset used to bend the road into an arc
  - width/thickness/elevation: strip dimensions and offset above or below the level plane
  - laneCount/showLaneMarkings: visual lane stripe controls for road-like strips
  - asphaltColor/markingColor: default surface and stripe colours
  `,
)

export type RoadNode = z.infer<typeof RoadNode>
