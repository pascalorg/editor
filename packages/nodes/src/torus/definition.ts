import { type NodeDefinition, TorusNode as TorusNodeSchema } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { torusParametrics } from './parametrics'
import { TorusNode } from './schema'

export const torusDefinition: NodeDefinition<typeof TorusNode> = {
  kind: 'torus',
  schemaVersion: 1,
  schema: TorusNode,
  category: 'structure',

  defaults: () => {
    const stub = TorusNodeSchema.parse({ id: 'torus_default' as never, type: 'torus' })
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

  parametrics: torusParametrics,

  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  system: {
    module: () => import('./batch-system'),
    priority: 7,
  },

  presentation: {
    label: 'Torus',
    description:
      'A ring / donut tube primitive for tires, steering wheels, seals, fan rims, and ring handles.',
    icon: { kind: 'iconify', name: 'mdi:circle-double' },
    paletteSection: 'structure',
    paletteOrder: 126,
  },

  mcp: {
    description:
      'A ring / donut tube primitive for tires, steering wheels, seals, fan rims, and ring handles.',
  },
}
