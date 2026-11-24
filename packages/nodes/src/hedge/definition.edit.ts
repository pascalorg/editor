import { type HedgeNode, SITE_GROUND_DEPENDENCY_TYPES } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { siteFloorplanDependencies } from '../shared/site-ground-invalidation'
import { hedgeFloorplanMoveTarget } from './floorplan-move'
import { hedgeParametrics } from './parametrics'

/**
 * Hedge: drawn point by point and moved whole in the 3D view or on the plan, and edited
 * by its numbers in the panel.
 */
export const hedgeEditContribution: NodeEditContribution<typeof HedgeNode> = {
  snapProfile: 'structural',
  floorplanMoveTarget: hedgeFloorplanMoveTarget,
  floorplanDependencies: (node, nodes) =>
    siteFloorplanDependencies(node, nodes, SITE_GROUND_DEPENDENCY_TYPES),
  parametrics: hedgeParametrics,
  tool: () => import('./tool'),
  affordanceTools: { move: () => import('./move-tool') },
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension<HedgeNode>,
  },
  toolHints: [
    { key: 'Left click', label: 'Add a point of the hedge' },
    { key: 'Enter', label: 'Plant it', minDraftVertices: 2 },
    { key: 'Backspace', label: 'Take the last point back' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
