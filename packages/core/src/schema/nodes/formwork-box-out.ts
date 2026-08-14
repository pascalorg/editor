import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * An opening former — a void in a cast element that is neither a door nor a
 * window: a pipe sleeve, a cable penetration, a light shaft, a pocket left for
 * a service. The plan calls it an opening former for a reason: what it declares
 * is the void, and the box-out that forms it (the reveal faces inside the
 * opening, cut to the void and struck in pieces) belongs to the shutter of the
 * host element, exactly as it does for a door or a window.
 *
 * Hosted by the wall (or slab) it voids — `parentId` is the host, the same
 * convention as door/window, and `position` is the wall-child frame: `[along,
 * centreY, z]` with `position[0]` the distance along the host from its start
 * and `position[1]` the centre height above the host's base. A through-void:
 * the opening subtracts from both skins of a double-sided pour and the reveals
 * return inside it.
 *
 * `draftAngleDeg` and `chamferStrips` are how the void is released, and both
 * are physical: a drafted box-out is cut to a slight taper so it can be struck
 * rather than wedged, and chamfer strips are timber bevels nailed to the reveal
 * edges that leave a clean arris on the concrete. They are read into the
 * box-out parts' descriptions so the crew cutting the boards sees them.
 */
export const FormworkBoxOutNode = BaseNode.extend({
  id: objectId('formwork-box-out'),
  type: nodeType('formwork-box-out'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // The void the box-out forms. Positioned by centre, so these are the clear
  // opening size the concrete will show.
  width: z.number().positive().default(0.3),
  height: z.number().positive().default(0.3),
  // Release and finish details. Absent means plain boards, square-cut.
  draftAngleDeg: z.number().min(0).max(10).optional(),
  chamferStrips: z.boolean().optional(),
}).describe(dedent`Box-out node - a void former hosted by a wall or slab
  - position: centre of the void in the host's local frame ([along, centreY, z], the wall-child convention)
  - width/height: the clear opening the void shows in the finished concrete
  - draftAngleDeg: the taper the reveal boards are cut at so the box-out strikes without wedging
  - chamferStrips: timber bevels on the reveal edges that leave a clean arris
`)

export type FormworkBoxOutNode = z.infer<typeof FormworkBoxOutNode>
