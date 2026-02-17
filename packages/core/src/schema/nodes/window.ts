import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const WindowNode = BaseNode.extend({
  id: objectId('window'),
  type: nodeType('window'),

  // Position in wall-local coordinate system (center of window)
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  side: z.enum(['front', 'back']).optional(),

  // Wall reference
  wallId: z.string().optional(),

  // Overall dimensions
  width: z.number().default(1.5),
  height: z.number().default(1.5),

  // Frame
  frameThickness: z.number().default(0.05),
  frameDepth: z.number().default(0.07),

  // Divisions — ratios allow non-uniform panes
  // [0.5, 0.5] = two equal panes
  // [0.6, 0.4] = one larger, one smaller
  // [1] = single pane (no division)
  columnRatios: z.array(z.number()).default([1]),
  rowRatios: z.array(z.number()).default([1]),
  dividerThickness: z.number().default(0.03),

  // Sill
  sill: z.boolean().default(true),
  sillDepth: z.number().default(0.08),
  sillThickness: z.number().default(0.03),
}).describe(dedent`Window node - a parametric window placed on a wall
  - position: center of the window in wall-local coordinate system
  - width/height: overall outer dimensions
  - frameThickness: width of the frame members
  - frameDepth: how deep the frame sits within the wall
  - columnRatios/rowRatios: pane division ratios
  - sill: whether to show a window sill
`)

export type WindowNode = z.infer<typeof WindowNode>
