import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const SteelBeamProfile = z.enum(['i-beam', 'box', 'channel', 'concave'])

export const SteelBeamNode = BaseNode.extend({
  id: objectId('steel-beam'),
  type: nodeType('steel-beam'),
  start: z.tuple([z.number(), z.number()]).default([0, 0]),
  end: z.tuple([z.number(), z.number()]).default([3, 0]),
  curveOffset: z.number().optional(),
  elevation: z.number().default(0),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  profile: SteelBeamProfile.default('i-beam'),
  length: z.number().default(3),
  height: z.number().default(0.32),
  width: z.number().default(0.18),
  flangeThickness: z.number().default(0.045),
  webThickness: z.number().default(0.035),
  color: z.string().default('#7f8792'),
}).describe(
  dedent`
  Steel beam node - editable structural beam route.
  - start/end/curveOffset: plan centerline, matching pipe-like route editing.
  - elevation: bottom height above level origin.
  - position/rotation/length are retained for legacy scenes; new tools write start/end.
  - profile: i-beam, box (hollow rectangular tube), channel, or concave.
  - height/width/flangeThickness/webThickness: section dimensions.
  `,
)

export type SteelBeamNode = z.infer<typeof SteelBeamNode>
