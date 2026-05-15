import type { NodeDefinition } from '@pascal-app/core'
import { buildDoorFloorplan } from './floorplan'
import { doorParametrics } from './parametrics'
import { DoorNode } from './schema'

/**
 * Door — Phase 5 batch kind. Hosted on walls, cuts holes in them,
 * animated open/close state.
 *
 * Capabilities:
 *  - **No `movable`**: door's move is bespoke wall-bound drag (slide
 *    along the wall, snap to wall start/end). Capability-driven dispatch
 *    keeps legacy `MoveDoorTool`.
 *  - `selectable`, `duplicable`, `deletable` standard.
 *
 * Stages:
 *  - A: registered.
 *  - B: deferred — door geometry (frame / leaf / glass / hardware /
 *    segments) is ~800 lines in DoorSystem; extraction is a focused
 *    session. `def.renderer` (wrap-export of legacy DoorRenderer) +
 *    `def.system` (DoorSystem + DoorAnimationSystem bundle) hold parity.
 *  - C: `def.floorplan` polygon sits in parent wall's cutout. Legacy
 *    `openingPolygons` short-circuits door entries when registered.
 */
export const doorDefinition: NodeDefinition<typeof DoorNode> = {
  kind: 'door',
  schemaVersion: 1,
  schema: DoorNode,
  category: 'structure',

  // Leverage the schema's zod `.default()` annotations to compute the
  // full default shape — door has 40+ fields, listing them inline would
  // duplicate the schema. Parse a minimal stub, drop id/type, return rest.
  defaults: () => {
    const stub = DoorNode.parse({ id: 'door_default' as never, type: 'door' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: doorParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    // Priority 3 mirrors the legacy DoorSystem (after animation at 2,
    // before wall mitering at 4).
    priority: 3,
  },
  // Stage C: floor-plan polygon. Needs ctx.parent (the wall) to compute
  // direction + perpendicular for the cutout footprint.
  floorplan: buildDoorFloorplan,

  toolHints: [
    { key: 'Left click', label: 'Place door on wall' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Door',
    description: 'A door cut into a wall. Animated open/close state.',
    icon: { kind: 'iconify', name: 'lucide:door-open' },
    paletteSection: 'structure',
    paletteOrder: 50,
  },

  mcp: {
    description: 'A door mounted on a wall, with type / dimensions / hardware options.',
  },
}
