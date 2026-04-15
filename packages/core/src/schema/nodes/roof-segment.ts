import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const RoofType = z.enum(['hip', 'gable', 'shed', 'gambrel', 'dutch', 'mansard', 'flat'])

export type RoofType = z.infer<typeof RoofType>

export const RoofSegmentNode = BaseNode.extend({
  id: objectId('rseg'),
  type: nodeType('roof-segment'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  // Roof shape type
  roofType: RoofType.default('gable'),
  // Footprint dimensions
  width: z.number().default(8),
  depth: z.number().default(6),
  // Vertical dimensions
  wallHeight: z.number().default(0.5),
  roofHeight: z.number().default(2.5),
  // Structure thicknesses
  wallThickness: z.number().default(0.1),
  deckThickness: z.number().default(0.1),
  overhang: z.number().default(0.3),
  shingleThickness: z.number().default(0.05),
}).describe(
  dedent`
  Roof segment node - an individual roof module within a roof group.
  Each segment generates a complete architectural volume (walls + roof).
  Multiple segments can be combined to form complex roof shapes.
  - roofType: hip, gable, shed, gambrel, dutch, mansard, flat
  - width/depth: footprint dimensions
  - wallHeight: height of walls below the roof
  - roofHeight: height of the roof peak above the walls
  - wallThickness/deckThickness: structural thicknesses
  - overhang: eave overhang distance
  - shingleThickness: outer shingle layer thickness
  `,
)

export type RoofSegmentNode = z.infer<typeof RoofSegmentNode>
