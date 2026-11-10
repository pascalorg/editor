import type { SeparatorNode } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import { buildSeparatorFloorplan } from './floorplan'
import { separatorMoveEndpointAffordance } from './floorplan-affordances'

export const separatorEditContribution: NodeEditContribution<typeof SeparatorNode> = {
  // Its pushes and end drags snap as a wall's do.
  snapProfile: 'structural',
  floorplan: buildSeparatorFloorplan,
  // An invisible wall moves as a wall does, taking the ones joined to it along:
  // its side arrows push it (the plan's `move-arrow`s, the 3D selection
  // handles) and its ends drag, on the plan and in 3D.
  floorplanAffordances: { 'move-endpoint': separatorMoveEndpointAffordance },
  affordanceTools: { selection: () => import('./selection') },
  renderer: { kind: 'parametric', module: () => import('./renderer.edit') },
}
