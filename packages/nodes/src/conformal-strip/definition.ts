import {
  ConformalStripNode as ConformalStripNodeSchema,
  type NodeDefinition,
} from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { conformalStripParametrics } from './parametrics'
import { ConformalStripNode } from './schema'

export const conformalStripDefinition: NodeDefinition<typeof ConformalStripNode> = {
  kind: 'conformal-strip',
  schemaVersion: 1,
  schema: ConformalStripNode,
  category: 'structure',

  defaults: () => {
    const stub = ConformalStripNodeSchema.parse({
      id: 'conformal-strip_default' as never,
      type: 'conformal-strip',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    movable: { axes: ['x', 'y', 'z'] as const },
    rotatable: { axes: ['x', 'y', 'z'] as const },
  },

  parametrics: conformalStripParametrics,
  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Conformal Strip',
    description:
      'A thin curved rectangular stripe/decal that conforms to an ellipsoid-cylinder surface.',
    icon: { kind: 'iconify', name: 'mdi:vector-curve' },
    paletteSection: 'structure',
    paletteOrder: 122,
  },

  mcp: {
    description:
      'A thin curved rectangular stripe/decal that conforms to an ellipsoid-cylinder surface.',
  },
}
