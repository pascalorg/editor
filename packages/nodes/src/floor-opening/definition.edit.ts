import type { FloorOpeningNode } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import {
  floorOpeningAddVertexAffordance,
  floorOpeningDeleteVertexAffordance,
  floorOpeningMoveEdgeAffordance,
  floorOpeningMoveVertexAffordance,
} from './floorplan-affordances'

export const floorOpeningEditContribution: NodeEditContribution<typeof FloorOpeningNode> = {
  floorplanAffordances: {
    'move-vertex': floorOpeningMoveVertexAffordance,
    'add-vertex': floorOpeningAddVertexAffordance,
    'move-edge': floorOpeningMoveEdgeAffordance,
    'delete-vertex': floorOpeningDeleteVertexAffordance,
  },
}
