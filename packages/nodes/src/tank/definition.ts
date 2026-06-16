import { type NodeDefinition, TankNode as TankNodeSchema } from '@pascal-app/core'
import { buildTankFloorplan } from './floorplan'
import { tankParametrics } from './parametrics'
import { TankNode } from './schema'

export const tankDefinition: NodeDefinition<typeof TankNode> = {
  kind: 'tank',
  schemaVersion: 1,
  schema: TankNode,
  category: 'structure',

  defaults: () => {
    const stub = TankNodeSchema.parse({ id: 'tank_default' as never, type: 'tank' })
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

  parametrics: tankParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  floorplan: buildTankFloorplan,
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: '放置罐体' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Tank',
    description: 'Industrial vertical, horizontal, or spherical storage tank.',
    icon: { kind: 'url', src: '/icons/tank.svg' },
    paletteSection: 'structure',
    paletteOrder: 19,
  },

  mcp: {
    description:
      'Vertical, horizontal, or spherical industrial storage tank with a 0-100% liquid level.',
  },
}
