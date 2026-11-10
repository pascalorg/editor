import type { FloorOpeningNode } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import {
  buildFloorOpeningFloorplan,
  floorOpeningAddVertexAffordance,
  floorOpeningDeleteVertexAffordance,
  floorOpeningMoveEdgeAffordance,
  floorOpeningMoveVertexAffordance,
} from './floorplan'

export const floorOpeningEditContribution: NodeEditContribution<typeof FloorOpeningNode> = {
  // The void on the plan, and its corners while selected.
  floorplan: buildFloorOpeningFloorplan,
  floorplanAffordances: {
    'move-vertex': floorOpeningMoveVertexAffordance,
    'add-vertex': floorOpeningAddVertexAffordance,
    'move-edge': floorOpeningMoveEdgeAffordance,
    'delete-vertex': floorOpeningDeleteVertexAffordance,
  },
}
