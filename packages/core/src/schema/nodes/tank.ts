import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const TankKind = z.enum(['vertical', 'horizontal', 'spherical'])

export const TankNode = BaseNode.extend({
  id: objectId('tank'),
  type: nodeType('tank'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  kind: TankKind.default('vertical'),
  diameter: z.number().min(0.1).max(20).default(1.6),
  height: z.number().min(0.1).max(40).default(3),
  length: z.number().min(0.1).max(40).default(3),
  liquidLevel: z.number().min(0).max(1).default(0.5),
  shellColor: z.string().default('#94a3b8'),
  liquidColor: z.string().default('#38bdf8'),
  shellOpacity: z.number().min(0.05).max(1).default(0.24),
}).describe(
  'Tank node - industrial vertical, horizontal, or spherical storage tank with editable liquid level.',
)

export type TankNode = z.infer<typeof TankNode>
export type TankKind = z.infer<typeof TankKind>
