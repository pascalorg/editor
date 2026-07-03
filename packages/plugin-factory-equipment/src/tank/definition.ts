import type { NodeDefinition } from '@pascal-app/core'
import { buildTankFloorplan } from './floorplan'
import { buildTankGeometry } from './geometry'
import { tankParametrics } from './parametrics'
import { factoryTankPorts } from './ports'
import { FactoryTankNode } from './schema'

export const tankDefinition: NodeDefinition<typeof FactoryTankNode> = {
  kind: 'factory:tank',
  schemaVersion: 1,
  schema: FactoryTankNode,
  category: 'structure',
  snapProfile: 'item',

  defaults: () => {
    const stub = FactoryTankNode.parse({
      id: 'factory-tank_default' as never,
      type: 'factory:tank',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4),
    },
    snappable: {},
    floorPlaced: {
      footprint: (node) => {
        const tank = node as unknown as FactoryTankNode
        return {
          dimensions: [tank.length, tank.height, tank.width] as [number, number, number],
          rotation: tank.rotation,
        }
      },
      collides: true,
    },
  },

  equipment: {
    family: 'tank',
    label: 'Tank',
    acceptsProfiles: ['tank', 'storage_tank', 'vertical_tank', 'horizontal_tank'],
  },
  ports: factoryTankPorts,
  parametrics: tankParametrics,
  geometry: buildTankGeometry,
  floorplan: buildTankFloorplan,

  presentation: {
    label: 'Factory tank',
    description: 'Parametric industrial storage tank with equipment-level ports.',
    icon: { kind: 'iconify', name: 'lucide:database' },
    paletteSection: 'structure',
    paletteOrder: 25,
    hidden: true,
  },

  mcp: {
    description:
      'Factory equipment tank node. Use for storage tanks and vessels with stable inlet/outlet ports and editable equipment parameters.',
  },
}
