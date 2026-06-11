import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * HVAC equipment — the boxes duct systems start and end at: furnace,
 * air handler, outdoor condenser.
 *
 * Phase 3 of the HVAC node system. Furnaces and air handlers expose
 * typed ports (supply plenum on top, return drop on the side) so duct
 * runs and fittings snap onto them; condensers are the outdoor half of
 * a split system and carry no duct ports.
 *
 * Floor-placed: `position` is level-local meters with y at the base,
 * `rotation` is yaw radians (the editor's default R-rotate applies).
 */
export const HvacEquipmentNode = BaseNode.extend({
  id: objectId('hvac-equipment'),
  type: nodeType('hvac-equipment'),
  // Level-local meters, y at the unit's base.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Yaw in radians.
  rotation: z.number().default(0),
  equipmentType: z.enum(['furnace', 'air-handler', 'condenser']).default('furnace'),
  // Cabinet dimensions in meters. Defaults match a typical upflow
  // furnace cabinet (~22" × 28" footprint, ~43" tall).
  width: z.number().min(0.3).max(2).default(0.56),
  depth: z.number().min(0.3).max(2).default(0.71),
  height: z.number().min(0.4).max(2.5).default(1.1),
  // Collar diameters in inches for the duct connections.
  supplyDiameter: z.number().min(6).max(30).default(12),
  returnDiameter: z.number().min(6).max(30).default(14),
}).describe(
  dedent`
  HVAC equipment cabinet - furnace, air handler, or outdoor condenser.
  - position: [x, y, z] level-local meters (y = base)
  - rotation: yaw radians
  - equipmentType: furnace | air-handler | condenser
  - width / depth / height: cabinet size in meters
  - supplyDiameter / returnDiameter: duct collar sizes in inches (ignored by condenser)
  `,
)
export type HvacEquipmentNode = z.infer<typeof HvacEquipmentNode>
export type HvacEquipmentNodeId = HvacEquipmentNode['id']
