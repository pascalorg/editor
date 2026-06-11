import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Duct fitting — the junction pieces that connect round duct segments:
 * elbows (direction change), tees (branch takeoff), reducers (diameter
 * transition).
 *
 * Phase 2 of the HVAC node system. Fittings are the first kind to expose
 * typed ports (`def.ports`) — placement tools snap duct endpoints onto a
 * fitting's collars, and the future system graph walks ports to decide
 * connectivity.
 *
 * `position` is level-local meters; `rotation` is an XYZ euler in radians
 * so a fitting can turn a horizontal run vertical (riser elbows).
 *
 * Local-frame conventions (before `rotation` is applied):
 *   - elbow:   inlet faces -X, outlet turned by `angle` degrees in the
 *              XZ plane (90° → +Z).
 *   - tee:     run along the X axis (ports face -X and +X), branch
 *              collar faces +Z at `diameter2`.
 *   - reducer: inlet at `diameter` faces -X, outlet at `diameter2`
 *              faces +X.
 */
export const DuctFittingNode = BaseNode.extend({
  id: objectId('duct-fitting'),
  type: nodeType('duct-fitting'),
  // Level-local meters.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // XYZ euler radians.
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  fittingType: z.enum(['elbow', 'tee', 'reducer']).default('elbow'),
  // Run-leg cross-section: round collars or a rect profile matching a
  // rect trunk. A tee's BRANCH collar is always round (diameter2);
  // reducers ignore the shape. When rect, `diameter` carries the
  // area-equivalent round size (drives leg lengths + advertised ports).
  shape: z.enum(['round', 'rect']).default('round'),
  // Rect run-leg profile in inches (used when shape = 'rect').
  width: z.number().min(4).max(60).default(14),
  height: z.number().min(3).max(40).default(8),
  // Elbow turn angle in degrees. Residential sheet-metal elbows come in
  // 90° and 45°; adjustable elbows cover the range between.
  angle: z.number().min(15).max(90).default(90),
  // Main (run/inlet) nominal diameter in inches.
  diameter: z.number().min(2).max(48).default(6),
  // Secondary diameter in inches — tee branch collar, reducer outlet.
  // Ignored by elbows.
  diameter2: z.number().min(2).max(48).default(6),
  ductMaterial: z.enum(['sheet-metal', 'flex', 'duct-board']).default('sheet-metal'),
  system: z.enum(['supply', 'return']).default('supply'),
}).describe(
  dedent`
  Duct fitting - elbow, tee, or reducer junction between round duct runs.
  - position: [x, y, z] level-local meters
  - rotation: [x, y, z] euler radians
  - fittingType: elbow | tee | reducer
  - shape: round | rect run legs (rect matches a rect trunk; branch stays round)
  - width / height: rect run-leg profile in inches
  - angle: elbow turn in degrees (45 or 90 typical)
  - diameter: main nominal diameter in inches
  - diameter2: tee branch / reducer outlet diameter in inches
  - ductMaterial: sheet-metal | flex | duct-board
  - system: supply | return
  `,
)
export type DuctFittingNode = z.infer<typeof DuctFittingNode>
export type DuctFittingNodeId = DuctFittingNode['id']
