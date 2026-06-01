import { FrustumNode as FrustumNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { frustumParametrics } from './parametrics'
import { FrustumNode } from './schema'

export const frustumDefinition: NodeDefinition<typeof FrustumNode> = {
  kind: 'frustum',
  schemaVersion: 1,
  schema: FrustumNode,
  category: 'structure',

  defaults: () => {
    const stub = FrustumNodeSchema.parse({ id: 'frustum_default' as never, type: 'frustum' })
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

  parametrics: frustumParametrics,

  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Frustum',
    description:
      'A truncated cone / circular taper primitive for cups, flower pots, lamp bases, table legs, and fittings.',
    icon: { kind: 'iconify', name: 'mdi:cone-off' },
    paletteSection: 'structure',
    paletteOrder: 124,
  },

  mcp: {
    description:
      'A truncated cone / circular taper primitive for cups, flower pots, lamp bases, table legs, and fittings.',
  },
}
