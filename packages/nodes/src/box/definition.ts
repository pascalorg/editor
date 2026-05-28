import { type NodeDefinition, BoxNode as BoxNodeSchema } from '@pascal-app/core'
import { boxParametrics } from './parametrics'
import { BoxNode } from './schema'

export const boxDefinition: NodeDefinition<typeof BoxNode> = {
  kind: 'box',
  schemaVersion: 1,
  schema: BoxNode,
  category: 'structure',

  defaults: () => {
    const stub = BoxNodeSchema.parse({ id: 'box_default' as never, type: 'box' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    movable: { axes: ['x', 'z'] as const },
    rotatable: { axes: ['y'] as const },
  },

  parametrics: boxParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Box',
    description: 'A configurable solid or hollow cuboid primitive.',
    icon: { kind: 'url', src: '/icons/cube.png' },
    paletteSection: 'structure',
    paletteOrder: 115,
  },

  mcp: {
    description: 'A rectangular box primitive with configurable dimensions and optional hollow core.',
  },
}
