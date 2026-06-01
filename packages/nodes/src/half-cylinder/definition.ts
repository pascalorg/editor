import { HalfCylinderNode as HalfCylinderNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { halfcylinderParametrics } from './parametrics'
import { HalfCylinderNode } from './schema'

export const halfCylinderDefinition: NodeDefinition<typeof HalfCylinderNode> = {
  kind: 'half-cylinder',
  schemaVersion: 1,
  schema: HalfCylinderNode,
  category: 'structure',

  defaults: () => {
    const stub = HalfCylinderNodeSchema.parse({
      id: 'half-cylinder_default' as never,
      type: 'half-cylinder',
    })
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

  parametrics: halfcylinderParametrics,

  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Half Cylinder',
    description:
      'A semicircular extrusion with a flat cut face for fenders, arched covers, and half-pipe forms.',
    icon: { kind: 'iconify', name: 'mdi:arch' },
    paletteSection: 'structure',
    paletteOrder: 120,
  },

  mcp: {
    description:
      'A semicircular extrusion with a flat cut face for fenders, arched covers, and half-pipe forms.',
  },
}
