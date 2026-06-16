import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const CableTrayNode = BaseNode.extend({
  id: objectId('cable-tray'),
  type: nodeType('cable-tray'),
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  curveOffset: z.number().optional(),
  width: z.number().default(0.45),
  sideHeight: z.number().default(0.18),
  thickness: z.number().default(0.035),
  elevation: z.number().default(2.4),
  rungSpacing: z.number().default(0.35),
  showRungs: z.boolean().default(true),
  color: z.string().default('#9aa3ad'),
}).describe(
  dedent`
  Cable tray node - editable industrial cable tray route in level coordinates.
  - start/end: plan centerline endpoints.
  - curveOffset: optional sagitta offset used to bend the tray into an arc.
  - width/sideHeight/thickness: tray cross-section dimensions.
  - elevation: tray bottom height above level origin.
  - rungSpacing/showRungs: ladder tray crossbar controls.
  `,
)

export type CableTrayNode = z.infer<typeof CableTrayNode>

