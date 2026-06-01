import { type NodeDefinition, WedgeNode as WedgeNodeSchema } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { wedgeParametrics } from './parametrics'
import { WedgeNode } from './schema'

export const wedgeDefinition: NodeDefinition<typeof WedgeNode> = {
  kind: 'wedge',
  schemaVersion: 1,
  schema: WedgeNode,
  category: 'structure',

  defaults: () => {
    const stub = WedgeNodeSchema.parse({ id: 'wedge_default' as never, type: 'wedge' })
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

  parametrics: wedgeParametrics,

  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Wedge',
    description:
      'A sloped triangular prism primitive for ramps, car hoods, keyboard side blocks, and angled backs.',
    icon: { kind: 'iconify', name: 'mdi:slope-uphill' },
    paletteSection: 'structure',
    paletteOrder: 127,
  },

  mcp: {
    description:
      'A sloped triangular prism primitive for ramps, car hoods, keyboard side blocks, and angled backs.',
  },
}
