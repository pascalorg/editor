import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const ElevatorDoorStyle = z.enum(['center-opening', 'single-left', 'single-right'])

export type ElevatorDoorStyle = z.infer<typeof ElevatorDoorStyle>

export const ElevatorNode = BaseNode.extend({
  id: objectId('elevator'),
  type: nodeType('elevator'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around the Y axis in radians.
  rotation: z.number().default(0),
  width: z.number().default(1.6),
  depth: z.number().default(1.6),
  cabHeight: z.number().default(2.35),
  doorWidth: z.number().default(0.95),
  doorHeight: z.number().default(2.1),
  doorStyle: ElevatorDoorStyle.default('center-opening'),
  fromLevelId: z.string().nullable().default(null),
  toLevelId: z.string().nullable().default(null),
  servedLevelIds: z.array(z.string()).optional(),
  defaultLevelId: z.string().nullable().default(null),
  speed: z.number().default(2.2),
  doorDurationMs: z.number().default(900),
  dwellMs: z.number().default(1400),
}).describe(
  dedent`
  Elevator node - a vertical transport core attached to a building.
  - parentId: building that owns this elevator
  - position: building-local shaft center on the X/Z plane
  - rotation: rotation around the Y axis
  - width/depth: shaft and cab footprint
  - cabHeight: visible elevator cab height
  - doorWidth/doorHeight/doorStyle: landing and cab door presentation
  - fromLevelId / toLevelId: source and destination levels used for service range and auto cutouts
  - servedLevelIds: legacy optional explicit level list; used only when from/to are missing
  - defaultLevelId: starting/resting level, falling back to the lowest served level
  - speed/doorDurationMs/dwellMs: runtime animation defaults
  `,
)

export type ElevatorNode = z.infer<typeof ElevatorNode>
