import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const PanelSide = z.enum(['front', 'back'])
export type PanelSide = z.infer<typeof PanelSide>

/**
 * A flat cladding element fixed to one face of its host wall — an infill
 * beside a window, a spandrel below it, a pier or base cladding. It is
 * surface, not structure: it never cuts the wall.
 *
 * `position` is the panel's centre in the wall's frame (x along the wall from
 * its start, y up from its base). Its depth is derived from the wall's
 * thickness when it is built, so a panel stays on the face when the wall is
 * thickened.
 */
export const PanelNode = BaseNode.extend({
  id: objectId('panel'),
  type: nodeType('panel'),
  /** Re-derived from the wall under the cursor when a panel is placed from a preset. */
  wallId: z.string().optional(),
  side: PanelSide.default('front'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  /** Kept at zero: a panel lies in its wall's plane. Present because positioned nodes carry one. */
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  width: z.number().positive().default(1),
  height: z.number().positive().default(1),
  thickness: z.number().positive().default(0.03),
  /** Gap between the wall face and the panel's back; positive stands it proud. */
  offset: z.number().default(0),
  /** Paintable parts: `surface` → material ref. */
  slots: z.record(z.string(), z.string()).optional(),
}).describe(
  'Panel — flat cladding fixed to one wall face: an infill, a spandrel, a pier or base cladding',
)

export type PanelNode = z.infer<typeof PanelNode>
export type PanelNodeId = PanelNode['id']
