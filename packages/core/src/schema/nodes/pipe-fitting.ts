import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * DWV pipe fitting — the joints drain systems are actually built from:
 * elbows (bends), wyes (45° branch entries, the code-preferred way to
 * join horizontal drains), sanitary tees (square branch entries), and
 * crosses (two opposed branches where a run passes straight through).
 *
 * Local-frame conventions (before `rotation`):
 *   - elbow:        inlet faces -X, outlet turned `angle`° in XZ.
 *   - wye:          run along X (inlet -X, outlet +X), branch collar at
 *                   45° between +X and +Z.
 *   - sanitary-tee: run along X, branch collar faces +Z.
 *   - cross:        run along X, two opposed branch collars on ±Z.
 */
export const PipeFittingNode = BaseNode.extend({
  id: objectId('pipe-fitting'),
  type: nodeType('pipe-fitting'),
  // Level-local meters.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // XYZ euler radians.
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  fittingType: z.enum(['elbow', 'wye', 'sanitary-tee', 'cross']).default('elbow'),
  // Elbow turn in degrees — DWV bends ship as 22.5 / 45 / 90 ("long
  // sweep" for drains); adjustable range matches the duct elbow. 0° is a
  // straight coupling — what an elbow flattens to when its run is dragged
  // into line with the fixed collar.
  angle: z.number().min(0).max(90).default(90),
  // Run nominal size in inches.
  diameter: z.number().min(1.25).max(8).default(2),
  // Branch collar size (wye / sanitary-tee).
  diameter2: z.number().min(1.25).max(8).default(2),
  pipeMaterial: z.enum(['pvc', 'abs', 'cast-iron']).default('pvc'),
  system: z.enum(['waste', 'vent']).default('waste'),
}).describe(
  dedent`
  DWV pipe fitting - elbow (bend), wye (45° branch), sanitary tee (square branch), or cross (two opposed branches).
  - position: [x, y, z] level-local meters
  - rotation: [x, y, z] euler radians
  - fittingType: elbow | wye | sanitary-tee | cross
  - angle: elbow turn in degrees (22.5 / 45 / 90 typical)
  - diameter: run size in inches; diameter2: branch collar size (both branches for a cross)
  - pipeMaterial: pvc | abs | cast-iron
  - system: waste | vent
  `,
)
export type PipeFittingNode = z.infer<typeof PipeFittingNode>
export type PipeFittingNodeId = PipeFittingNode['id']
