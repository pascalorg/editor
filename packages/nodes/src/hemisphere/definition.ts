import { HemisphereNode as HemisphereNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { hemisphereParametrics } from './parametrics'
import { HemisphereNode } from './schema'

export const hemisphereDefinition: NodeDefinition<typeof HemisphereNode> = {
  kind: 'hemisphere',
  schemaVersion: 1,
  schema: HemisphereNode,
  category: 'structure',

  defaults: () => {
    const stub = HemisphereNodeSchema.parse({
      id: 'hemisphere_default' as never,
      type: 'hemisphere',
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

  parametrics: hemisphereParametrics,

  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Hemisphere',
    description:
      'A closed half-sphere dome primitive for buttons, camera covers, lamps, domes, and rounded housings.',
    icon: { kind: 'iconify', name: 'mdi:circle-slice-4' },
    paletteSection: 'structure',
    paletteOrder: 125,
  },

  mcp: {
    description:
      'A closed half-sphere dome primitive for buttons, camera covers, lamps, domes, and rounded housings.',
  },
}
