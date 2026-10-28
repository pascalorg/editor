import type { NodeDefinition } from '@pascal-app/core'
import { FLOORPLAN_NODE_EXTENSION_KEY, type FloorplanNodeExtension } from '@pascal-app/editor'
import { foundationFamilyOption } from '../foundation/family'
import { buildFootingFloorplan } from './floorplan'
import {
  footingEndpointAffordance,
  footingRotateAffordance,
  footingSizeAffordance,
  footingWidthAffordance,
} from './floorplan-affordances'
import { footingFloorplanMoveTarget } from './floorplan-move'
import { footingParametrics } from './parametrics'
import { FootingNode } from './schema'

/**
 * Footing — a concrete footing drawn by hand under the building's lowest level: a strip between
 * two points or a pad at one. Its height is derived from the building's foundation record
 * (`footingDesign` in core), so the renderer, Bones and the structural sheets read one footing.
 *
 * No `movable`: a strip has no `position` to translate; the plan moves both shapes through
 * `floorplanMoveTarget`.
 */
export const footingDefinition: NodeDefinition<typeof FootingNode> = {
  kind: 'footing',
  snapProfile: 'structural',
  schemaVersion: 1,
  schema: FootingNode,
  category: 'structure',
  extensions: {
    [FLOORPLAN_NODE_EXTENSION_KEY]: {
      // In 2D-only view the 3D tool never mounts: the plan drafts footings itself.
      tool: () => import('./tool').then((module) => ({ default: module.FootingFloorplanTool })),
      // A footing lies inside a room: a plan click on it picks the footing, not the room.
      planHitSelectsNode: true,
    } satisfies FloorplanNodeExtension,
  },

  defaults: () => {
    const { id: _id, type: _type, ...rest } = FootingNode.parse({ start: [0, 0], end: [1, 0] })
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: { hosting: false },
    surfacePlacement: 'floor-only',
    duplicable: true,
    deletable: true,
    drawTool: true,
  },

  // The renderer reads the scene and live overrides itself; nothing consumes a dirty mark.
  dirtyTracking: false,
  rendersChildren: false,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  parametrics: footingParametrics,

  tool: () => import('./tool'),
  // One family with the Foundation tool: a footing, or an outline poured as a slab or a raised floor.
  toolOptions: [foundationFamilyOption],
  toolHints: [
    { key: 'Left click', label: 'Set footing start / end, or place a pad' },
    { key: 'Alt', label: 'Free place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  floorplan: buildFootingFloorplan,
  floorplanMoveTarget: footingFloorplanMoveTarget,
  floorplanAffordances: {
    'move-endpoint': footingEndpointAffordance,
    width: footingWidthAffordance,
    size: footingSizeAffordance,
    rotate: footingRotateAffordance,
  },

  presentation: {
    label: 'Footing',
    description: 'A concrete strip or pad footing poured under the lowest floor.',
    icon: { kind: 'url', src: '/icons/floor.webp' },
    paletteSection: 'structure',
    paletteOrder: 71,
  },

  mcp: {
    description:
      'A concrete footing on the lowest level: a strip (start, end, width) or a pad (center, width, length, rotation), with thickness and an optional depth under grade; its height follows the building foundation.',
  },
}
