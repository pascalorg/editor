import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * The `bones:device` node — a draggable wall-mounted electrical device
 * (receptacle / GFCI receptacle / switch), the movable-outlets answer to Q7.
 * Mirrors `bones:service` (service/schema.ts) with one key difference: these
 * nodes are RECONCILED against the engine's derived layout (device/place.ts)
 * instead of being created by a panel action — every derived wall device gets
 * a node keyed by the engine's deterministic `deviceId`, so ANY outlet is
 * hoverable and draggable door-style along its wall.
 *
 * Moved-vs-derived: the node carries the SEED anchor it was created at
 * (`seedWallId`/`seedWallT`/`seedHeightAff`, the derived spot). While the
 * live anchor equals the seed the node simply TRACKS the derivation (the
 * reconciler re-seats it when walls change, and the engine ignores it — a
 * scene of unmoved nodes computes byte-equal to a node-less one). The moment
 * any write path (drag commit, inspector slider, MCP) makes the anchor
 * differ from the seed, the node is an OVERRIDE: the engine honors it with
 * code-aware snapping (never in an RO, box against a stud face or a booked
 * blocking member, height clamped to the legal band) and the wiring
 * re-routes to the moved box. Deleting the node returns the device to
 * auto-placement (the reconciler re-creates it at the derived spot).
 */

export const DEVICE_KINDS = ['receptacle', 'receptacle-gfci', 'receptacle-wr-gfci', 'switch'] as const

export const DeviceKind = z.enum(DEVICE_KINDS)
export type DeviceKind = z.infer<typeof DeviceKind>

export const DeviceNode = BaseNode.extend({
  id: objectId('bonesdevice'),
  type: nodeType('bones:device'),
  /** The engine's deterministic device id (`recep-<wall>-<n>-<face>`,
   * `switch-<wall>-<opening>-<face>`) — the reconciliation key. */
  deviceId: z.string(),
  deviceKind: DeviceKind,
  /** Wall the device mounts on (host wall node id). */
  wallId: z.string().optional(),
  /** Normalized coordinate along the wall from `start` (0..1). */
  wallT: z.number().min(0).max(1).optional(),
  /** Mount height above finished floor, meters (device center). */
  heightAff: z.number().optional(),
  /** Derived anchor at seed time — anchor ≠ seed ⇒ the user moved it. */
  seedWallId: z.string().optional(),
  seedWallT: z.number().optional(),
  seedHeightAff: z.number().optional(),
  /** Level-local escape hatch — written off [0,0,0] it outranks the wall
   * anchor (nearest-wall snap), exactly like `bones:service`. */
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
}).describe(
  `Bones electrical device point — a movable receptacle or switch.
  - deviceId: the engine's deterministic id; nodes reconcile against the derived layout by this key
  - wallId + wallT (0..1 along the wall) + heightAff: the mount anchor; drags slide along the wall and commit wallT (position resets to [0,0,0])
  - seed*: the derived anchor at creation — while anchor == seed the node tracks auto-placement; any difference makes it an override (engine snaps it code-legal and re-routes the wiring)
  Delete the node to return the device to auto-placement.`,
)

export type DeviceNode = z.infer<typeof DeviceNode>

/** Display label per device kind (inspector). */
export const DEVICE_LABEL: Record<DeviceKind, string> = {
  receptacle: 'Receptacle',
  'receptacle-gfci': 'GFCI receptacle',
  'receptacle-wr-gfci': 'WR GFCI receptacle (outdoor)',
  switch: 'Switch',
}
