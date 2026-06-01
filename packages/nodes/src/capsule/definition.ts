import { CapsuleNode as CapsuleNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { capsuleParametrics } from './parametrics'
import { CapsuleNode } from './schema'

export const capsuleDefinition: NodeDefinition<typeof CapsuleNode> = {
  kind: 'capsule',
  schemaVersion: 1,
  schema: CapsuleNode,
  category: 'structure',

  defaults: () => {
    const stub = CapsuleNodeSchema.parse({ id: 'capsule_default' as never, type: 'capsule' })
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

  parametrics: capsuleParametrics,

  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Capsule',
    description:
      'A rounded-ended capsule primitive for pillows, bolsters, handles, and soft rounded bars.',
    icon: { kind: 'iconify', name: 'mdi:pill' },
    paletteSection: 'structure',
    paletteOrder: 119,
  },

  mcp: {
    description:
      'A rounded-ended capsule primitive for pillows, bolsters, handles, and soft rounded bars.',
  },
}
