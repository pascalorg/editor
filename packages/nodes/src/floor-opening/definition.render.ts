import { FloorOpeningNode } from '@pascal-app/core'

import type { NodeRenderDefinition } from '../definition-contributions'

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
  presentation: {
    icon: { kind: 'iconify', name: 'lucide:square-dashed' },
    label: 'Floor opening',
    hidden: true,
    actionMenu: false,
  },
}
