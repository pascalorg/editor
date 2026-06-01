import { type NodeDefinition, SweepNode as SweepNodeSchema } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { sweepParametrics } from './parametrics'
import { SweepNode } from './schema'

export const sweepDefinition: NodeDefinition<typeof SweepNode> = {
  kind: 'sweep',
  schemaVersion: 1,
  schema: SweepNode,
  category: 'structure',

  defaults: () => {
    const stub = SweepNodeSchema.parse({ id: 'sweep_default' as never, type: 'sweep' })
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

  parametrics: sweepParametrics,

  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Sweep',
    description:
      'A circular tube swept along a 3D path for cables, hoses, curved handles, rails, and piping.',
    icon: { kind: 'iconify', name: 'mdi:transit-connection-variant' },
    paletteSection: 'structure',
    paletteOrder: 123,
  },

  mcp: {
    description:
      'A circular tube swept along a 3D path for cables, hoses, curved handles, rails, and piping.',
  },
}
