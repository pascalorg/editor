import type { PlantingNode } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { plantingFloorplanMoveTarget } from './floorplan-move'
import { plantingFloorplanDependencies } from './ground-invalidation'
import { plantingParametrics } from './parametrics'

export const plantingEditContribution: NodeEditContribution<typeof PlantingNode> = {
  snapProfile: 'structural',
  floorplanMoveTarget: plantingFloorplanMoveTarget,
  floorplanDependencies: plantingFloorplanDependencies,
  parametrics: plantingParametrics,
  tool: () => import('./tool'),
  // Polygon coordinates, not a stored pose: the generic position mover does not apply.
  affordanceTools: { move: () => import('./move-tool') },
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension<PlantingNode>,
  },
  toolHints: [
    { key: 'Left click', label: 'Add an outline point' },
    { key: 'Enter', label: 'Plant the bed' },
    { key: 'Backspace', label: 'Take the last point back' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
