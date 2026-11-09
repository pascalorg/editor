import { FloorOpeningNode, type NodeDefinition } from '@pascal-app/core'
import {
  buildFloorOpeningFloorplan,
  floorOpeningAddVertexAffordance,
  floorOpeningDeleteVertexAffordance,
  floorOpeningMoveEdgeAffordance,
  floorOpeningMoveVertexAffordance,
} from './floorplan'

export const floorOpeningDefinition: NodeDefinition<typeof FloorOpeningNode> = {
  kind: 'floor-opening',
  bake: 'strip',
  schemaVersion: 1,
  schema: FloorOpeningNode,
  category: 'structure',
  defaults: () => {
    const {
      id: _id,
      type: _type,
      ...rest
    } = FloorOpeningNode.parse({
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    })
    return rest
  },
  capabilities: {
    duplicable: false,
    deletable: true,
    presettable: false,
  },
  dirtyTracking: false,
  // The void on the plan, and its corners while selected.
  floorplan: buildFloorOpeningFloorplan,
  floorplanAffordances: {
    'move-vertex': floorOpeningMoveVertexAffordance,
    'add-vertex': floorOpeningAddVertexAffordance,
    'move-edge': floorOpeningMoveEdgeAffordance,
    'delete-vertex': floorOpeningDeleteVertexAffordance,
  },
  rendersChildren: false,
  presentation: {
    icon: { kind: 'iconify', name: 'lucide:square-dashed' },
    label: 'Floor opening',
    hidden: true,
    actionMenu: false,
  },
}
