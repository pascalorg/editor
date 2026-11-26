import { SITE_GROUND_DEPENDENCY_TYPES, type TreeNode } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { siteFloorplanDependencies } from '../shared/site-ground-invalidation'
import { treeFloorplanMoveTarget } from './floorplan-move'
import { treeParametrics } from './parametrics'

export const treeEditContribution: NodeEditContribution<typeof TreeNode> = {
  snapProfile: 'item',
  floorplanMoveTarget: treeFloorplanMoveTarget,
  floorplanDependencies: (node, nodes) =>
    siteFloorplanDependencies(node, nodes, SITE_GROUND_DEPENDENCY_TYPES),
  parametrics: treeParametrics,
  tool: () => import('./tool'),
  affordanceTools: { move: () => import('./move-tool') },
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension<TreeNode>,
  },
  toolHints: [
    { key: 'Left click', label: 'Plant the tree' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
