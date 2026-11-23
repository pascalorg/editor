import { measurementReferenceNodeIds } from '@pascal-app/core'

import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { measurementMoveVertexAffordance } from './floorplan-affordance'
import type { MeasurementNode } from './schema'

export const measurementEditContribution: NodeEditContribution<typeof MeasurementNode> = {
  snapProfile: 'structural',
  floorplanDependencies: (node) => measurementReferenceNodeIds(node.measurement),
  extensions: {
    'pascal:editor/floorplan': {
      referencedSelectionAnnotationRole: 'measurement',
    } satisfies FloorplanNodeExtension,
  },
  floorplanAffordances: {
    'move-measurement-vertex': measurementMoveVertexAffordance,
  },
  affordanceTools: {
    selection: () => import('./selection'),
  },
  tool: () => import('./tool-router'),
  toolHints: [
    { key: 'Left click', label: 'Place measurement point' },
    { key: 'Enter', label: 'Finish measurement' },
    { key: 'Backspace', label: 'Remove last point' },
    { key: 'Esc', label: 'Finish and continue' },
  ],
}
