import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { PipeMedium } from './pipe'

export const PipeFittingKind = z.enum(['elbow', 'tee', 'cross', 'flange', 'valve'])
export const PipeValveStyle = z.enum(['placeholder', 'gate', 'ball', 'butterfly'])

export const PipeFittingNode = BaseNode.extend({
  id: objectId('pipe-fitting'),
  type: nodeType('pipe-fitting'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 1, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  fittingKind: PipeFittingKind.default('elbow'),
  /** Elbow sweep angle in degrees. Common field values are 45, 60, and 90. */
  angleDegrees: z.number().min(15).max(180).default(90),
  diameter: z.number().min(0.02).max(2).default(0.15),
  bendRadiusMultiplier: z.number().min(1).max(8).default(3),
  branchLength: z.number().min(0.1).max(5).default(0.8),
  length: z.number().min(0.05).max(5).default(0.4),
  flangeOuterDiameter: z.number().min(0.03).max(4).optional(),
  flangeThickness: z.number().min(0.01).max(1).default(0.04),
  boltCount: z.number().int().min(0).max(32).default(8),
  boltDiameter: z.number().min(0.005).max(0.2).default(0.02),
  valveStyle: PipeValveStyle.default('placeholder'),
  connectedPipeId: z.string().optional(),
  connectionPoint: z.enum(['start', 'end', 'center']).default('center'),
  pipeStation: z.number().min(0).max(1).optional(),
  insulated: z.boolean().default(true),
  insulationThickness: z.number().min(0).max(1).default(0.05),
  pressureKpa: z.number().default(100),
  temperatureC: z.number().default(180),
  medium: PipeMedium.default('steam'),
  color: z.string().default('#b0b8c0'),
  opacity: z.number().min(0).max(1).default(1),
}).describe(
  dedent`
  Pipe fitting node - industrial pipe fittings such as elbows, tees, and crosses.
  - elbow: angled bend with editable sweep angle, e.g. 90° or 60°.
  - tee: one inlet with two outlets / one-to-two branch fitting.
  - cross: one-to-three branch fitting.
  `,
)

export type PipeFittingNode = z.infer<typeof PipeFittingNode>
export type PipeFittingKind = z.infer<typeof PipeFittingKind>
export type PipeValveStyle = z.infer<typeof PipeValveStyle>
