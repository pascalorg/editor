import type { NodeDefinition } from '@pascal-app/core'
import { doorWidthAffordance } from './floorplan-affordances'
import { buildDoorFloorplan } from './floorplan'
import { doorFloorplanMoveTarget } from './floorplan-move'
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
  surfaceRole: 'joinery',

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
  // Stage D — placement (`def.tool`) + move-on-wall (`def.
  // affordanceTools.move`). Both ports of the legacy tools at
  // `editor/components/tools/door/`, relocated into the kind folder and
  // wired through ToolManager's registry-first dispatch (`def.tool` for
  // build-mode placement, `getRegistryAffordanceTool` for the move-on-
  // pick flow). Same legacy semantics: wall-event-driven snap, clamped
  // wall-local coords, hasWallChildOverlap guard, live mesh updates.
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  // 2D move-on-floorplan handler. When `useEditor.movingNode` is a
  // door and the floor plan is active, `FloorplanRegistryMoveOverlay`
  // dispatches to this instead of the generic translate path — pointer
  // snaps to the nearest wall, projects onto the wall axis, snaps
  // local-X to 0.5m, clamps inside wall bounds.
  floorplanMoveTarget: doorFloorplanMoveTarget,

  // 2D drag affordances. `resize-width` drives the door's two side
  // arrows — pointer-down on either arrow starts an anchored width drag
  // (opposite edge stays fixed, clamped to wall bounds).
  floorplanAffordances: {
    'resize-width': doorWidthAffordance,
  },

  toolHints: [
    { key: 'Left click', label: 'Place door on wall' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Door',
    description: 'A door cut into a wall. Animated open/close state.',
    icon: { kind: 'url', src: '/icons/door.png' },
    paletteSection: 'structure',
    paletteOrder: 50,
  },

  mcp: {
    description: 'A door mounted on a wall, with type / dimensions / hardware options.',
  },
}
