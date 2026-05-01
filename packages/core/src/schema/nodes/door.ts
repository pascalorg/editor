import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const DoorSegment = z.object({
  type: z.enum(['panel', 'glass', 'empty']),
  heightRatio: z.number(),

  // Each segment controls its own column split
  columnRatios: z.array(z.number()).default([1]),
  dividerThickness: z.number().default(0.03),

  // panel-specific
  panelDepth: z.number().default(0.01), // + raised, - recessed
  panelInset: z.number().default(0.04),
})

export type DoorSegment = z.infer<typeof DoorSegment>

export const DoorNode = BaseNode.extend({
  id: objectId('door'),
  type: nodeType('door'),
  material: MaterialSchema.optional(),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  side: z.enum(['front', 'back']).optional(),
  wallId: z.string().optional(),

  // Overall dimensions
  width: z.number().default(0.9),
  height: z.number().default(2.1),

  // Opening mode
  openingKind: z.enum(['door', 'opening']).default('door'),
  openingShape: z.enum(['rectangle', 'rounded', 'arch']).default('rectangle'),
  cornerRadius: z.number().min(0).default(0.15),
  archHeight: z.number().min(0).default(0.45),
  openingRevealRadius: z.number().min(0).default(0.025),

  // Frame
  frameThickness: z.number().default(0.05),
  frameDepth: z.number().default(0.07),
  threshold: z.boolean().default(true),
  thresholdHeight: z.number().default(0.02),

  // Swing
  hingesSide: z.enum(['left', 'right']).default('left'),
  swingDirection: z.enum(['inward', 'outward']).default('inward'),
  swingAngle: z
    .number()
    .min(0)
    .max(Math.PI / 2)
    .default(0),

  // Leaf segments — stacked top to bottom, each with its own column split
  segments: z.array(DoorSegment).default([
    {
      type: 'panel',
      heightRatio: 0.4,
      columnRatios: [1],
      dividerThickness: 0.03,
      panelDepth: 0.01,
      panelInset: 0.04,
    },
    {
      type: 'panel',
      heightRatio: 0.6,
      columnRatios: [1],
      dividerThickness: 0.03,
      panelDepth: 0.01,
      panelInset: 0.04,
    },
  ]),

  // Handle
  handle: z.boolean().default(true),
  handleHeight: z.number().default(1.05),
  handleSide: z.enum(['left', 'right']).default('right'),

  // Leaf inner margin — space between leaf edge and segment content area [x, y]
  contentPadding: z.tuple([z.number(), z.number()]).default([0.04, 0.04]),

  // Emergency / commercial hardware
  doorCloser: z.boolean().default(false),
  panicBar: z.boolean().default(false),
  panicBarHeight: z.number().default(1.0),
}).describe(dedent`Door node - a parametric door placed on a wall
  - position: center of the door in wall-local coordinate system (Y = height/2, always at floor)
  - openingKind/openingShape: hinged door or frameless wall opening shape
  - segments: rows stacked top to bottom, each defining its own columnRatios
  - type 'empty' = no leaf fill for that segment, 'panel' = raised/recessed panel, 'glass' = glazed
  - hingesSide/swingDirection/swingAngle: which way the door opens and how far it is currently open
  - doorCloser/panicBar: commercial and emergency hardware options
`)

export type DoorNode = z.infer<typeof DoorNode>
