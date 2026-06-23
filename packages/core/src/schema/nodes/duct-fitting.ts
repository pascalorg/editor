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
 *              collar at `branchAngle`° from the +X (outlet) axis in the
 *              XZ plane — 90° a square straight tee, <90° a lateral
 *              leaning downstream toward the outlet, >90° leaning upstream
 *              toward the inlet — sized at `diameter2`.
 *   - cross:   four-way junction — run along the X axis (ports face -X
 *              and +X) at the run profile, two opposed branches square to
 *              the run along ±Z (branch faces +Z, branch2 faces -Z) at the
 *              branch profile (`shape2` / `diameter2`).
 *   - reducer: inlet at `diameter` faces -X, outlet at `diameter2`
 *              faces +X.
 *   - transition: square-to-round — rect end at `width` × `height` faces
 *              -X, round end at `diameter2` faces +X. `diameter` carries
 *              the rect end's area-equivalent round size.
 */
export const DuctFittingNode = BaseNode.extend({
  id: objectId('duct-fitting'),
  type: nodeType('duct-fitting'),
  // Level-local meters.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // XYZ euler radians.
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  fittingType: z.enum(['elbow', 'tee', 'cross', 'reducer', 'transition']).default('elbow'),
  // Run-leg cross-section: round collars, or a rect / flat-oval profile
  // matching the trunk the fitting sits in. Reducers ignore the shape.
  // When non-round, `diameter` carries the area-equivalent round size
  // (drives leg lengths + advertised ports).
  shape: z.enum(['round', 'rect', 'oval']).default('rect'),
  // Rect / oval run-leg profile in inches (used when shape ≠ 'round').
  width: z.number().min(4).max(60).default(14),
  height: z.number().min(3).max(40).default(8),
  // Tee / cross BRANCH cross-section: a round collar at `diameter2` or a
  // rect / oval profile matching the duct drawn off the tap. When
  // non-round, `diameter2` carries the branch's area-equivalent round
  // size. A cross's two opposed branches share this one profile.
  shape2: z.enum(['round', 'rect', 'oval']).default('rect'),
  // Rect / oval branch profile in inches (used when shape2 ≠ 'round').
  width2: z.number().min(4).max(60).default(14),
  height2: z.number().min(3).max(40).default(8),
  // Elbow turn angle in degrees. Residential sheet-metal elbows come in
  // 90° and 45°; adjustable elbows cover the range between. 0° is a
  // straight coupling — what an elbow flattens to when its run is dragged
  // into line with the fixed collar.
  angle: z.number().min(0).max(90).default(90),
  // Tee branch angle in degrees, measured off the +X (outlet) axis: 90°
  // is a square straight tee, <90° a lateral whose branch sweeps
  // downstream toward the outlet (flow merges), >90° leans the branch
  // upstream toward the inlet. Ignored by every other fitting type.
  branchAngle: z.number().min(45).max(135).default(90),
  // Main (run/inlet) nominal diameter in inches.
  diameter: z.number().min(2).max(48).default(6),
  // Secondary diameter in inches — tee branch collar, reducer outlet.
  // Ignored by elbows.
  diameter2: z.number().min(2).max(48).default(6),
  ductMaterial: z.enum(['sheet-metal', 'flex', 'duct-board']).default('sheet-metal'),
  system: z.enum(['supply', 'return']).default('supply'),
  slots: z.record(z.string(), z.string()).optional(),
}).describe(
  dedent`
  Duct fitting - elbow, tee, cross, reducer, or square-to-round transition between duct runs.
  - position: [x, y, z] level-local meters
  - rotation: [x, y, z] euler radians
  - fittingType: elbow | tee | cross | reducer | transition (rect end -X, round end +X)
  - shape: round | rect | oval run legs (matches the trunk; ignored by reducer / transition)
  - width / height: rect / oval run-leg profile in inches (transition: the rect end)
  - shape2: round | rect | oval tee / cross branch (matches the duct drawn off the tap)
  - width2 / height2: rect / oval branch profile in inches
  - angle: elbow turn in degrees (45 or 90 typical)
  - branchAngle: tee branch angle off the outlet axis (90 straight tee, 45 downstream lateral, 135 upstream); cross branches are always square
  - diameter: main nominal diameter in inches
  - diameter2: tee / cross branch / reducer outlet / transition round-end diameter in inches
  - ductMaterial: sheet-metal | flex | duct-board
  - system: supply | return
  `,
)
export type DuctFittingNode = z.infer<typeof DuctFittingNode>
export type DuctFittingNodeId = DuctFittingNode['id']
