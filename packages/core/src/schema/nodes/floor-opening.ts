import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const OpeningRing = z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3)

export const FloorOpeningNode = BaseNode.extend({
  id: objectId('floor-opening'),
  type: nodeType('floor-opening'),
  polygon: OpeningRing,
  hostZoneId: z.string().optional(),
  legacyPlateCuts: z.record(z.string(), z.array(OpeningRing)).optional(),
  legacyCeilingCuts: z.record(z.string(), z.array(OpeningRing)).optional(),
  source: z.string().default('manual'),
  ownerId: z.string().optional(),
  surfaceId: z.string().optional(),
  drawnOn: z.enum(['floor', 'ceiling']).default('floor'),
  cutsPrimary: z.boolean().default(true),
  cutsAdjacent: z.boolean().default(true),
}).describe(
  'Level-local opening intent. Floor openings cut the floor and ceiling below; ceiling openings cut the ceiling and floor above. A hosted mezzanine opening cuts only its plate.',
)

export type FloorOpeningNode = z.infer<typeof FloorOpeningNode>
