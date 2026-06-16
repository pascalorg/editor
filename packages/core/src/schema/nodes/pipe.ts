import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const PipeMedium = z.enum(['steam', 'condensate', 'water'])

export const PipeNode = BaseNode.extend({
  id: objectId('pipe'),
  type: nodeType('pipe'),
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  curveOffset: z.number().optional(),
  diameter: z.number().default(0.15),
  /** Start height of the pipe centerline (meters above level origin). */
  elevation: z.number().default(1),
  /** Tilt from horizontal in degrees. 0 = horizontal run, 90 = vertical. */
  rotate: z.number().default(0),
  insulated: z.boolean().default(true),
  insulationThickness: z.number().default(0.05),
  pressureKpa: z.number().default(100),
  temperatureC: z.number().default(180),
  medium: PipeMedium.default('steam'),
  showHangers: z.boolean().default(true),
  hangerSpacing: z.number().default(2),
  color: z.string().default('#b0b8c0'),
}).describe(
  dedent`
  Pipe node — steam / utility routing segment in level coordinates.
  - Plan path start→end with optional curveOffset; 3D centerline tilts by \`rotate\` (0° horizontal, 90° vertical).
  - elevation: start height of the centerline.
  - diameter: outer pipe diameter in meters.
  - insulated / insulationThickness: visual insulation jacket.
  - pressureKpa / temperatureC / medium: process metadata (display + MCP).
  - showHangers / hangerSpacing: visual support rings along runs.
  `,
)

export type PipeNode = z.infer<typeof PipeNode>
