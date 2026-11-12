import { FloorOpeningNode } from '@pascal-app/core'

import type { NodeRenderDefinition } from '../definition-contributions'
import { buildFloorOpeningFloorplan } from './floorplan'

export const floorOpeningRenderDefinition: NodeRenderDefinition<typeof FloorOpeningNode> & {
  kind: 'floor-opening'
} = {
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
  rendersChildren: false,
  // The void on the plan, and its corners while selected.
  floorplan: buildFloorOpeningFloorplan,
  presentation: {
    icon: { kind: 'iconify', name: 'lucide:square-dashed' },
    label: 'Floor opening',
    hidden: true,
    actionMenu: false,
  },
}
