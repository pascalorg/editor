import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * The `bones:service` node — a draggable building/utility interface point
 * (docs/plans/service-nodes.md). One kind, discriminated by `serviceType`:
 * electric panel, water heater, water entry (meter + main shut-off), sewer
 * exit and power entry. The node's position IS the truth: engines consume it
 * as an override and re-route wires/pipes to wherever it stands; when no node
 * exists they auto-place exactly as before.
 *
 * Wall-mounted types mirror the host item wall contract (`wallId` + `wallT`
 * 0..1 along the wall + `heightAff`); the host move tool slides them
 * door-style along the wall (movable.parentFrame in frame.ts) and every
 * drag commits `wallT` + resets `position` to the [0,0,0] default, so the
 * wall anchor stays authoritative. `position` is the level-local spot for
 * floor-placed types (sewer exit) and the manual escape hatch: written off
 * the default (inspector / MCP) it OUTRANKS the wall anchor (wall types
 * snap to the nearest wall).
 */

export const SERVICE_TYPES = [
  'panel',
  'water-heater',
  'water-entry',
  'sewer-exit',
  'power-entry',
  'thermostat',
  'heat-pump',
  'electric-meter',
] as const

export const ServiceType = z.enum(SERVICE_TYPES)
export type ServiceType = z.infer<typeof ServiceType>

export const ServiceNode = BaseNode.extend({
  id: objectId('bonesservice'),
  type: nodeType('bones:service'),
  serviceType: ServiceType,
  /** Wall the point mounts on (host wall node id) — wall-mounted types. */
  wallId: z.string().optional(),
  /** Normalized coordinate along the wall from `start` (0..1). */
  wallT: z.number().min(0).max(1).optional(),
  /** Mount height above finished floor, meters (device center). */
  heightAff: z.number().optional(),
  /** Level-local position — the fallback when not wall-anchored. */
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  /** ADDITIVE assembly-yaw override (radians, world +Y) — heat-pump only.
   * Written by the host's standard rotate gestures (R/T keys + the ⌘-drag
   * rotate arc) through the bones:service definition's `keyboardActions` /
   * rotate handle; the hvac engine turns unit #1's WHOLE assembly (cabinet
   * + pad + pick proxy) to it. `null`/absent = derive (wall-square auto) —
   * never a stored copy of the derivation, so deleting the rotation
   * restores the engine's own orientation. Nullable so a gesture can be
   * explicitly cleared without deleting the node. */
  yawOverride: z.number().nullable().optional(),
}).describe(
  `Bones service point — a building/utility interface the systems route to.
  - serviceType: panel (electric service panel) | water-heater | water-entry (meter + shut-off) | sewer-exit | power-entry | thermostat | heat-pump (outdoor unit pad) | electric-meter
  - wallId + wallT (0..1 along the wall) + heightAff: wall-mounted anchor; drags slide along the wall and commit wallT (position resets to [0,0,0]); wires/pipes/ducts re-route
  - position: level-local spot for floor-placed types (sewer exit, heat pump); manually written off [0,0,0] it outranks the wall anchor (nearest-wall snap)
  - yawOverride (heat-pump only): assembly yaw in radians (cabinet + pad turn together); null/absent = the engine's wall-square auto orientation
  Engines treat an existing node as authoritative; delete it to return to auto-placement.`,
)

export type ServiceNode = z.infer<typeof ServiceNode>

/** Display label for each service type (sign plates + inspector). */
export const SERVICE_LABEL: Record<ServiceType, string> = {
  panel: 'Electric panel',
  'water-heater': 'Water heater',
  'water-entry': 'Water entry',
  'sewer-exit': 'Sewer exit',
  'power-entry': 'Power entry',
  thermostat: 'Thermostat',
  'heat-pump': 'Heat pump',
  'electric-meter': 'Electric meter',
}
