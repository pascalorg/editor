import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const LadderNode = BaseNode.extend({
  id: objectId('ladder'),
  type: nodeType('ladder'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  height: z.number().default(3),
  width: z.number().default(0.55),
  railDiameter: z.number().default(0.04),
  rungDiameter: z.number().default(0.03),
  rungSpacing: z.number().default(0.3),
  standoffDepth: z.number().default(0.16),
  cageEnabled: z.boolean().default(false),
  cageRadius: z.number().default(0.42),
  cageStartHeight: z.number().default(1.8),
  color: z.string().default('#8a9098'),
}).describe(
  dedent`
  Ladder node - editable vertical industrial access ladder.
  - position/rotation: floor anchor and facing.
  - height/width: ladder envelope.
  - railDiameter/rungDiameter/rungSpacing: rail and rung sizing.
  - standoffDepth: wall or equipment offset brackets.
  - cageEnabled/cageRadius/cageStartHeight: optional safety cage.
  `,
)

export type LadderNode = z.infer<typeof LadderNode>

