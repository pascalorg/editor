import {
  type NodeDefinition,
  TrapezoidPrismNode as TrapezoidPrismNodeSchema,
} from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { trapezoidPrismParametrics } from './parametrics'
import { TrapezoidPrismNode } from './schema'

export const trapezoidPrismDefinition: NodeDefinition<typeof TrapezoidPrismNode> = {
  kind: 'trapezoid-prism',
  schemaVersion: 1,
  schema: TrapezoidPrismNode,
  category: 'structure',

  defaults: () => {
    const stub = TrapezoidPrismNodeSchema.parse({
      id: 'trapezoid-prism_default' as never,
      type: 'trapezoid-prism',
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

  parametrics: trapezoidPrismParametrics,

  materialTargets: overallMaterialTarget,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Trapezoid Prism',
    description:
      'A tapered rectangular prism primitive for appliance shells, plinths, tapered cushions, and housings.',
    icon: { kind: 'iconify', name: 'mdi:shape-polygon-plus' },
    paletteSection: 'structure',
    paletteOrder: 128,
  },

  mcp: {
    description:
      'A tapered rectangular prism primitive for appliance shells, plinths, tapered cushions, and housings.',
  },
}
