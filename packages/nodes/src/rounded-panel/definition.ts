import { type NodeDefinition, RoundedPanelNode as RoundedPanelNodeSchema } from '@pascal-app/core'
import { roundedpanelParametrics } from './parametrics'
import { RoundedPanelNode } from './schema'

export const roundedPanelDefinition: NodeDefinition<typeof RoundedPanelNode> = {
  kind: 'rounded-panel',
  schemaVersion: 1,
  schema: RoundedPanelNode,
  category: 'structure',

  defaults: () => {
    const stub = RoundedPanelNodeSchema.parse({
      id: 'rounded-panel_default' as never,
      type: 'rounded-panel',
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

  parametrics: roundedpanelParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Rounded Panel',
    description:
      'A thin rounded-rectangle bevelled panel for screens, keycaps, cushions, device faces, and plates.',
    icon: { kind: 'iconify', name: 'mdi:rectangle-rounded-outline' },
    paletteSection: 'structure',
    paletteOrder: 121,
  },

  mcp: {
    description:
      'A thin rounded-rectangle bevelled panel for screens, keycaps, cushions, device faces, and plates.',
  },
}
