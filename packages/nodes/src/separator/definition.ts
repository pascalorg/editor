import { type NodeDefinition, SeparatorNode } from '@pascal-app/core'
import { buildSeparatorFloorplan } from './floorplan'
import { separatorMoveEndpointAffordance } from './floorplan-affordances'

export const separatorDefinition: NodeDefinition<typeof SeparatorNode> = {
  kind: 'separator',
  // Its pushes and end drags snap as a wall's do.
  snapProfile: 'structural',
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
  floorplan: buildSeparatorFloorplan,
  // An invisible wall moves as a wall does, taking the ones joined to it along:
  // its side arrows push it (the plan's `move-arrow`s, the 3D selection
  // handles) and its ends drag, on the plan and in 3D.
  floorplanAffordances: { 'move-endpoint': separatorMoveEndpointAffordance },
  affordanceTools: { selection: () => import('./selection') },
  presentation: {
    icon: { kind: 'iconify', name: 'lucide:split' },
    label: 'Separator',
    hidden: true,
    actionMenu: false,
  },
}
