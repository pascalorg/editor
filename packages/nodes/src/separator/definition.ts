import { type NodeDefinition, SeparatorNode } from '@pascal-app/core'

export const separatorDefinition: NodeDefinition<typeof SeparatorNode> = {
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
  floorplan: (node) => ({
    kind: 'line',
    x1: node.start[0],
    y1: node.start[1],
    x2: node.end[0],
    y2: node.end[1],
    stroke: '#818cf8',
    strokeWidth: 2,
    strokeDasharray: '6 4',
    vectorEffect: 'non-scaling-stroke',
    pointerEvents: 'stroke',
  }),
  presentation: {
    icon: { kind: 'iconify', name: 'lucide:split' },
    label: 'Separator',
    hidden: true,
    actionMenu: false,
  },
}
