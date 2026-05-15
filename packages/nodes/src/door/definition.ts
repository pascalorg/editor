import type { NodeDefinition } from '@pascal-app/core'
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
 * Relations:
 *  - `parentId` references a wall — re-anchors on wall move (handled by
 *    `DoorSystem`'s cascade to parent wall).
 *  - `cascadeDelete: 'children'` — door has no children in v1.
 *
 * Renderer + system: wrap-export legacy `DoorRenderer` + bundle
 * `DoorSystem` + `DoorAnimationSystem`.
 *
 * Tool field absent: door placement / move tools wired through editor
 * state, not registry dispatch. Legacy DoorTool / MoveDoorTool continue.
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
