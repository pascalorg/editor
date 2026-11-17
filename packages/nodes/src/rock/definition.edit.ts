import type { RockNode } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import {
  rockAddVertexAffordance,
  rockDeleteVertexAffordance,
  rockMoveEdgeAffordance,
  rockMoveVertexAffordance,
} from './floorplan-affordances'
import { rockFloorplanMoveTarget } from './floorplan-move'
import { rockParametrics } from './parametrics'

export const rockEditContribution: NodeEditContribution<typeof RockNode> = {
  snapProfile: 'structural',
  snapDraftDirectional: false,
  affordanceTools: {
    selection: () => import('./boundary-editor'),
    move: () => import('./move-tool'),
  },
  floorplanMoveTarget: rockFloorplanMoveTarget,
  floorplanAffordances: {
    'move-vertex': rockMoveVertexAffordance,
    'add-vertex': rockAddVertexAffordance,
    'move-edge': rockMoveEdgeAffordance,
    'delete-vertex': rockDeleteVertexAffordance,
  },
  parametrics: rockParametrics,
  tool: () => import('./tool'),
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension<RockNode>,
  },
  toolHints: [
    { key: 'Left click', label: 'Place a rock' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
