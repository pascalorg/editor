import type { NodeDefinition } from '@pascal-app/core'
import { buildFenceFloorplan } from './floorplan'
import { buildFenceGeometry } from './geometry'
import { fenceParametrics } from './parametrics'
import { FenceNode } from './schema'

/**
 * Fence — Phase 5 batch kind. Stage B complete: `def.geometry` drives
 * the rebuild via the generic `<GeometrySystem>`; `<ParametricNodeRenderer>`
 * mounts the empty group. No per-kind renderer or system file.
 *
 * Capabilities:
 *  - **No `movable`**: fence move is bespoke endpoint-drag. Capability-
 *    driven dispatch keeps the legacy MoveFenceTool until the
 *    affordance port (Stage D).
 *  - `surfaces.sides`, `selectable`, `duplicable`, `deletable` standard.
 *
 * Relations: `linkedBy: 'endpoint-match'` for corner cascade.
 */
export const fenceDefinition: NodeDefinition<typeof FenceNode> = {
  kind: 'fence',
  schemaVersion: 1,
  schema: FenceNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [3, 0],
    height: 1.8,
    thickness: 0.08,
    baseHeight: 0.22,
    postSpacing: 2,
    postSize: 0.1,
    topRailHeight: 0.04,
    groundClearance: 0,
    edgeInset: 0.015,
    baseStyle: 'grounded',
    showInfill: true,
    color: '#ffffff',
    style: 'slat',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: { sides: { faces: 'all' } },
    duplicable: true,
    deletable: true,
  },

  relations: {
    linkedBy: 'endpoint-match',
    cascadeDelete: 'none',
  },

  parametrics: fenceParametrics,

  // Stage B: pure geometry function. Generic <GeometrySystem> rebuilds
  // on dirtyNodes; <ParametricNodeRenderer> mounts the empty group.
  // `renderer` + `system` fields dropped along with their files.
  geometry: buildFenceGeometry,
  // Stage C: floor-plan rendering. FloorplanRegistryLayer iterates kinds
  // with `floorplan` set and renders via FloorplanGeometryRenderer.
  // Legacy `floorplanFenceEntries` short-circuits to [] when fence is
  // registered (see floorplan-panel.tsx).
  floorplan: buildFenceFloorplan,

  toolHints: [
    { key: 'Left click', label: 'Set fence start / end' },
    { key: 'Shift', label: 'Allow non-45° angles' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Fence',
    description: 'A straight or curved fence segment with configurable posts and infill.',
    icon: { kind: 'iconify', name: 'lucide:fence' },
    paletteSection: 'structure',
    paletteOrder: 20,
  },

  mcp: {
    description: 'A fence segment defined by start + end points, with optional curve sagitta.',
  },
}
