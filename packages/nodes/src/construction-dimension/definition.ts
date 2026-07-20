import { measurementReferenceNodeIds, type NodeDefinition } from '@pascal-app/core'
import { buildConstructionDimensionFloorplan } from './floorplan'
import { moveConstructionDimensionBaselineAffordance } from './floorplan-affordances'
import { ConstructionDimensionNode } from './schema'

export const constructionDimensionDefinition: NodeDefinition<typeof ConstructionDimensionNode> = {
  kind: 'construction-dimension',
  bake: 'strip',
  schemaVersion: 1,
  schema: ConstructionDimensionNode,
  category: 'analysis',
  snapProfile: 'structural',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    anchors: [
      [0, 0, 0],
      [1, 0, 0],
    ],
    baseline: { origin: [0, 0.6], direction: [1, 0] },
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: true,
    presettable: false,
  },

  dirtyTracking: false,
  floorplan: buildConstructionDimensionFloorplan,
  floorplanDependencies: (node) =>
    measurementReferenceNodeIds({ kind: 'distance', points: node.anchors }),
  floorplanAffordances: {
    'move-construction-dimension-baseline': moveConstructionDimensionBaselineAffordance,
  },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Pick first witness' },
    { key: 'Left click', label: 'Pick second witness' },
    { key: 'Left click', label: 'Place dimension line' },
    { key: 'Esc', label: 'Remove last point' },
  ],

  presentation: {
    label: 'Construction Dimension',
    description: 'Associative linear dimension for construction floor plans.',
    icon: { kind: 'iconify', name: 'lucide:ruler-dimension-line' },
    hidden: true,
    actionMenu: false,
  },

  mcp: {
    description:
      'An associative linear floor-plan dimension with semantic witness anchors and an editable baseline.',
  },
}
