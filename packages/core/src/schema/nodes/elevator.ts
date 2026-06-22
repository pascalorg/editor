import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const ElevatorDoorStyle = z.enum(['center-opening', 'single-left', 'single-right'])
export const ElevatorDoorPanelStyle = z.enum(['glass-frame', 'solid-panel', 'segmented-panel'])
export const ElevatorShaftStyle = z.enum(['solid', 'glass'])

export type ElevatorDoorPanelStyle = z.infer<typeof ElevatorDoorPanelStyle>
export type ElevatorDoorStyle = z.infer<typeof ElevatorDoorStyle>
export type ElevatorShaftStyle = z.infer<typeof ElevatorShaftStyle>

export const ElevatorNode = BaseNode.extend({
  id: objectId('elevator'),
  type: nodeType('elevator'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  // Unified paint-slot refs (`scene:`/`library:` MaterialRef per slot id),
  // matching the slot model items/slab/shelf use. Absent = declared default.
  slots: z.record(z.string(), z.string()).optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around the Y axis in radians.
  rotation: z.number().default(0),
  width: z.number().default(1.84),
  depth: z.number().default(1.84),
  shaftWidth: z.number().optional(),
  shaftDepth: z.number().optional(),
  shaftWallThickness: z.number().default(0.09),
  shaftStyle: ElevatorShaftStyle.default('solid'),
  cabHeight: z.number().default(2.35),
  doorWidth: z.number().default(0.95),
  doorHeight: z.number().default(2.1),
  doorStyle: ElevatorDoorStyle.default('center-opening'),
  doorPanelStyle: ElevatorDoorPanelStyle.default('glass-frame'),
  fromLevelId: z.string().nullable().default(null),
  toLevelId: z.string().nullable().default(null),
  servedLevelIds: z.array(z.string()).optional(),
  disabledLevelIds: z.array(z.string()).default([]),
  serviceOnlyLevelIds: z.array(z.string()).default([]),
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
  - width/depth: cab footprint
  - shaftWidth/shaftDepth: optional clear shaft footprint; falls back to cab footprint
  - shaftWallThickness: visible shaft shell thickness
  - shaftStyle: solid or glass shaft shell presentation
  - cabHeight: visible elevator cab height
  - doorWidth/doorHeight/doorStyle: landing and cab door movement/opening presentation
  - doorPanelStyle: visual leaf style for glass-frame, solid-panel, or segmented-panel doors
  - fromLevelId / toLevelId: source and destination levels used for service range and auto cutouts
  - servedLevelIds: legacy optional explicit level list; used only when from/to are missing
  - disabledLevelIds: stops visible in the service range but unavailable for public/cab requests
  - serviceOnlyLevelIds: stops unavailable from landing calls but available from cab/admin controls
  - defaultLevelId: starting/resting level, falling back to the lowest served level
  - speed/doorDurationMs/dwellMs: runtime animation defaults
  `,
)

export type ElevatorNode = z.infer<typeof ElevatorNode>
