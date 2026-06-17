import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * HVAC equipment — the boxes duct systems start and end at: furnace,
 * air handler, outdoor condenser.
 *
 * Phase 3 of the HVAC node system. Furnaces and air handlers expose
 * typed duct ports (supply plenum on top, return drop on the side) so
 * duct runs and fittings snap onto them. Every unit also exposes a
 * refrigerant service port on its valve face — a condenser, the outdoor
 * half of a split system, carries no duct ports but pipes to the indoor
 * coil through a `lineset` run mating onto that port.
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
  // Duct collar cross-section on the supply / return connections. Round is
  // the default; rect and oval (flat-oval) match the duct shapes a run
  // might mate with. Condensers carry no duct collars (ignored).
  supplyShape: z.enum(['round', 'rect', 'oval']).default('round'),
  returnShape: z.enum(['round', 'rect', 'oval']).default('round'),
  // Round collar diameters in inches.
  supplyDiameter: z.number().min(6).max(30).default(8),
  returnDiameter: z.number().min(6).max(30).default(8),
  // Rect / oval collar cross-section in inches: width is the horizontal
  // face, height the vertical. For oval, height is also the end-cap
  // semicircle diameter (width ≥ height).
  supplyWidth: z.number().min(6).max(30).default(12),
  supplyHeight: z.number().min(6).max(30).default(8),
  returnWidth: z.number().min(6).max(30).default(14),
  returnHeight: z.number().min(6).max(30).default(8),
}).describe(
  dedent`
  HVAC equipment cabinet - furnace, air handler, or outdoor condenser.
  - position: [x, y, z] level-local meters (y = base)
  - rotation: yaw radians
  - equipmentType: furnace | air-handler | condenser
  - width / depth / height: cabinet size in meters
  - supplyShape / returnShape: round | rect | oval duct collar cross-section (ignored by condenser)
  - supplyDiameter / returnDiameter: round collar sizes in inches
  - supplyWidth / supplyHeight / returnWidth / returnHeight: rect / oval collar cross-section in inches
  `,
)
export type HvacEquipmentNode = z.infer<typeof HvacEquipmentNode>
export type HvacEquipmentNodeId = HvacEquipmentNode['id']
