import type { NodeDefinition } from '@pascal-app/core'
import { buildPumpFloorplan } from './floorplan'
import { buildPumpGeometry } from './geometry'
import { pumpParametrics } from './parametrics'
import { factoryPumpPorts } from './ports'
import { FactoryPumpNode } from './schema'

export const pumpDefinition: NodeDefinition<typeof FactoryPumpNode> = {
  kind: 'factory:pump',
  schemaVersion: 1,
  schema: FactoryPumpNode,
  category: 'structure',
  snapProfile: 'item',

  defaults: () => {
    const stub = FactoryPumpNode.parse({
      id: 'factory-pump_default' as never,
      type: 'factory:pump',
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
        const pump = node as unknown as FactoryPumpNode
        return {
          dimensions: [pump.length, pump.height, pump.width] as [number, number, number],
          rotation: pump.rotation,
        }
      },
      collides: true,
    },
  },

  equipment: {
    family: 'pump',
    label: 'Pump',
    acceptsProfiles: ['pump', 'centrifugal_pump', 'positive_displacement_pump', 'metering_pump'],
  },
  ports: factoryPumpPorts,
  parametrics: pumpParametrics,
  geometry: buildPumpGeometry,
  floorplan: buildPumpFloorplan,

  presentation: {
    label: 'Factory pump',
    description: 'Parametric industrial pump with equipment-level ports and editable parameters.',
    icon: { kind: 'iconify', name: 'lucide:fan' },
    paletteSection: 'structure',
    paletteOrder: 24,
    hidden: true,
  },

  mcp: {
    description:
      'Factory equipment pump node. Use for centrifugal, positive displacement, or metering pumps with stable inlet/outlet ports, skid, motor, casing, and editable equipment parameters.',
  },
}
