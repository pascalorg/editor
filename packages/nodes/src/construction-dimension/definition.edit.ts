import { measurementAnchorReferenceNodeIds } from '@pascal-app/core'

import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { resolveConstructionDimensionForDrawing } from './drawing-coordination'
import {
  moveConstructionDimensionBaselineAffordance,
  moveConstructionDimensionWitnessAffordance,
} from './floorplan-affordances'
import { constructionDimensionParametrics } from './parametrics'
import type { ConstructionDimensionNode } from './schema'

export const constructionDimensionEditContribution: NodeEditContribution<
  typeof ConstructionDimensionNode
> = {
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      availableModes: ['expert'],
      resolveForDrawing: resolveConstructionDimensionForDrawing,
    } satisfies FloorplanNodeExtension<ConstructionDimensionNode>,
  },
  snapProfile: 'item',
  parametrics: constructionDimensionParametrics,
  floorplanDependencies: (node) => [
    ...measurementAnchorReferenceNodeIds(node.anchors),
    ...(node.controllingDimensionId ? [node.controllingDimensionId] : []),
  ],
  floorplanAffordances: {
    'move-construction-dimension-baseline': moveConstructionDimensionBaselineAffordance,
    'move-construction-dimension-witness': moveConstructionDimensionWitnessAffordance,
  },
  toolHints: [
    { key: 'Left click', label: 'Pick witness point' },
    { key: 'Enter', label: 'Finish multi-point witnesses' },
    { key: 'Left click', label: 'Place dimension line when needed' },
    { key: 'Backspace', label: 'Remove last witness' },
    { key: 'Esc', label: 'Step back or cancel' },
  ],
}
