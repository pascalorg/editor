import type { NodeDefinition } from '@pascal-app/core'
import { FLOORPLAN_NODE_EXTENSION_KEY, type FloorplanNodeExtension } from '@pascal-app/editor'
import { foundationFamilyOption } from './family'
import { buildFoundationFloorplan } from './floorplan'
import {
  foundationAddVertexAffordance,
  foundationDeleteVertexAffordance,
  foundationMoveEdgeAffordance,
  foundationMoveVertexAffordance,
} from './floorplan-affordances'
import { FoundationNode } from './schema'

/**
 * Foundation — the outline a building's foundation is poured to, in place of the one traced from
 * its exterior walls: traced from them and stretched (a porch slab, a bump-out), or drawn from
 * scratch, corner by corner. It stores the outline only; the concrete under it (slab and its
 * turned-down edge, stem wall and footing, grade beam on piles) is the building's designed
 * foundation (`genericFoundation` in core), sized by its record. Shown and edited in the foundation
 * view: corners and sides drag in the plan and in 3D.
 */
export const foundationDefinition: NodeDefinition<typeof FoundationNode> = {
  kind: 'foundation',
  snapProfile: 'structural',
  schemaVersion: 1,
  schema: FoundationNode,
  category: 'structure',
  extensions: {
    [FLOORPLAN_NODE_EXTENSION_KEY]: {
      // In 2D-only view the 3D tool never mounts: the plan drafts outlines itself.
      tool: () => import('./tool').then((module) => ({ default: module.FoundationFloorplanTool })),
    } satisfies FloorplanNodeExtension,
  },

  defaults: () => {
    const { id: _id, type: _type, ...rest } = FoundationNode.parse({})
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: { hosting: false },
    duplicable: false,
    deletable: true,
    drawTool: true,
  },

  // The site's foundation reads the scene itself; nothing consumes a dirty mark.
  dirtyTracking: false,
  rendersChildren: false,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  parametrics: {
    groups: [],
    customPanel: () => import('./panel'),
  },

  tool: () => import('./tool'),
  toolOptions: [foundationFamilyOption],
  toolHints: [
    { key: 'Left click', label: 'Place a corner of the foundation' },
    { key: 'Enter', label: 'Close the outline', minDraftVertices: 3 },
    { key: 'Alt', label: 'Free place' },
    { key: 'Esc', label: 'Cancel' },
  ],
  affordanceTools: {
    'boundary-edit': () => import('./boundary-editor'),
  },

  floorplan: buildFoundationFloorplan,
  floorplanAffordances: {
    'move-vertex': foundationMoveVertexAffordance,
    'add-vertex': foundationAddVertexAffordance,
    'move-edge': foundationMoveEdgeAffordance,
    'delete-vertex': foundationDeleteVertexAffordance,
  },

  presentation: {
    label: 'Foundation',
    description:
      'The outline the foundation is poured to: drawn, or traced from the walls and stretched.',
    icon: { kind: 'url', src: '/icons/floor.webp' },
    paletteSection: 'structure',
    paletteOrder: 70,
  },

  mcp: {
    description:
      "A building's foundation outline on its lowest level (polygon, level-local plan points at the foundation's outside face), in place of the outline traced from its exterior walls; the section and sizes come from the building foundation record.",
  },
}
