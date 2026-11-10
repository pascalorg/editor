import { SeparatorNode } from '@pascal-app/core'

import type { NodeRenderDefinition } from '../definition-contributions'

export const separatorRenderDefinition: NodeRenderDefinition<typeof SeparatorNode> & {
  kind: 'separator'
} = {
  kind: 'separator',
  bake: 'strip',
  schemaVersion: 1,
  schema: SeparatorNode,
  category: 'structure',
  defaults: () => {
    const { id: _id, type: _type, ...rest } = SeparatorNode.parse({ start: [0, 0], end: [1, 0] })
    return rest
  },
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: true,
    presettable: false,
  },
  dirtyTracking: false,
  rendersChildren: false,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: {
    icon: { kind: 'iconify', name: 'lucide:split' },
    label: 'Separator',
    hidden: true,
    actionMenu: false,
  },
}
