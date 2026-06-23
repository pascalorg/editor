import { CylinderNode as CylinderNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { cylinderParametrics } from './parametrics'
import { CylinderNode } from './schema'

export const cylinderDefinition: NodeDefinition<typeof CylinderNode> = {
  kind: 'cylinder',
  schemaVersion: 1,
  schema: CylinderNode,
  category: 'structure',

  defaults: () => {
    const stub = CylinderNodeSchema.parse({ id: 'cylinder_default' as never, type: 'cylinder' })
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

  parametrics: cylinderParametrics,

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
    label: 'Cylinder',
    description: 'A configurable cylindrical primitive. Set wall thickness for a hollow tube.',
    icon: { kind: 'iconify', name: 'mdi:cylinder' },
    paletteSection: 'structure',
    paletteOrder: 116,
  },

  mcp: {
    description:
      'A cylindrical primitive with configurable radius, height, and optional wall thickness for hollow tubes.',
  },
}
