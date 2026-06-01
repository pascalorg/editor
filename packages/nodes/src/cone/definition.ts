import { ConeNode as ConeNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { coneParametrics } from './parametrics'
import { ConeNode } from './schema'

export const coneDefinition: NodeDefinition<typeof ConeNode> = {
  kind: 'cone',
  schemaVersion: 1,
  schema: ConeNode,
  category: 'structure',

  defaults: () => {
    const stub = ConeNodeSchema.parse({ id: 'cone_default' as never, type: 'cone' })
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

  parametrics: coneParametrics,

  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Cone',
    description:
      'A circular cone primitive for tapered tips, traffic cones, lamp shades, roofs, and pointed mechanical parts.',
    icon: { kind: 'iconify', name: 'mdi:cone' },
    paletteSection: 'structure',
    paletteOrder: 123,
  },

  mcp: {
    description:
      'A circular cone primitive for tapered tips, traffic cones, lamp shades, roofs, and pointed mechanical parts.',
  },
}
