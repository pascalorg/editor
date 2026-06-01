import { type NodeDefinition, SphereNode as SphereNodeSchema } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { sphereParametrics } from './parametrics'
import { SphereNode } from './schema'

export const sphereDefinition: NodeDefinition<typeof SphereNode> = {
  kind: 'sphere',
  schemaVersion: 1,
  schema: SphereNode,
  category: 'structure',

  defaults: () => {
    const stub = SphereNodeSchema.parse({ id: 'sphere_default' as never, type: 'sphere' })
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

  parametrics: sphereParametrics,

  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Sphere',
    description: 'A configurable solid spherical primitive.',
    icon: { kind: 'iconify', name: 'mdi:sphere' },
    paletteSection: 'structure',
    paletteOrder: 117,
  },

  mcp: {
    description: 'A spherical primitive with configurable radius.',
  },
}
