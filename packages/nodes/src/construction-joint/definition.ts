import type { NodeDefinition } from '@pascal-app/core/registry'
import { constructionJointParametrics } from './parametrics'
import { ConstructionJointNode } from './schema'

/**
 * A joint between two pours, or between two lifts of one element.
 *
 * Registered without geometry: the joint's visible work is the stop-end, and a
 * stop-end belongs to the shutter that closes the pour — it is built by the
 * formwork assembly on the element being cast, reading the joint's treatments.
 * Giving the joint its own mesh would draw the same plate twice.
 *
 * Never placed by hand (`presentation.hidden: true`) — joints come from the pour
 * solver or from the element's own panel.
 */
export const constructionJointDefinition: NodeDefinition<typeof ConstructionJointNode> = {
  kind: 'construction-joint',
  schemaVersion: 1,
  category: 'structure',
  schema: ConstructionJointNode,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    kind: 'construction',
    elementIds: [],
    treatments: [],
    solverPlaced: false,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: true,
  },

  parametrics: constructionJointParametrics,
  // No geometry and no system rebuilds this kind — see NodeDefinition.dirtyTracking.
  dirtyTracking: false,

  presentation: {
    label: 'Construction joint',
    icon: { kind: 'iconify', name: 'lucide:minus' },
    hidden: true,
  },

  mcp: {
    description:
      'A joint between two concrete pours, or between two lifts of one element. Carries the treatments (roughening, shear key, starter bars, waterstop) that the stop-end forming it must provide. Expansion joints are hard partitions no monolithic pour may cross.',
  },
}
