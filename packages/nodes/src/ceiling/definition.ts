import type { NodeDefinition } from '@pascal-app/core'
import { buildCeilingFloorplan } from './floorplan'
import { ceilingParametrics } from './parametrics'
import { CeilingNode } from './schema'

/**
 * Ceiling — Phase 5 batch kind, polygon-based. Structurally similar to
 * slab but with React-rendered hosted children + TSL shader materials +
 * named meshes that other systems poke (`getObjectByName('ceiling-grid')`).
 *
 * **Stage B intentionally skipped**: pure `def.geometry` extraction
 * would lose the React children rendering (hosted items) and the
 * named-mesh structure. Ceiling keeps `def.renderer` as the custom
 * escape hatch (per plans/editor-node-registry.md "custom-behavior
 * escape hatch"). Renderer wraps the legacy CeilingRenderer; system
 * wraps the legacy CeilingSystem.
 *
 * **Stage C completed**: `def.floorplan` builder draws the ceiling
 * polygon as a dashed outline in floor plan; legacy `ceilingPolygons`
 * short-circuits to [] when ceiling is registered.
 */
export const ceilingDefinition: NodeDefinition<typeof CeilingNode> = {
  kind: 'ceiling',
  schemaVersion: 1,
  schema: CeilingNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    polygon: [],
    holes: [],
    holeMetadata: [],
    height: 2.5,
    autoFromWalls: false,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: {
      top: { height: (n) => (n as CeilingNode).height },
    },
    duplicable: true,
    deletable: true,
  },

  relations: {
    hosts: ['item'],
    cascadeDelete: 'descendants',
  },

  parametrics: ceilingParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 4,
  },
  floorplan: buildCeilingFloorplan,

  toolHints: [
    { key: 'Left click', label: 'Trace ceiling outline' },
    { key: 'Enter', label: 'Finish ceiling' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Ceiling',
    description: 'A polygon-bounded ceiling surface that hosts ceiling-mounted items.',
    icon: { kind: 'iconify', name: 'lucide:square-dashed' },
    paletteSection: 'structure',
    paletteOrder: 40,
  },

  mcp: {
    description: 'A polygon-bounded ceiling with optional cutout holes.',
  },
}
