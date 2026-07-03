import type { EquipmentPort } from '@pascal-app/core'
import type { FactoryTankNode } from './schema'

export function factoryTankPorts(node: FactoryTankNode): EquipmentPort[] {
  if (node.orientation === 'horizontal') {
    const portHeight = Math.max(0.2, node.height * 0.55)
    return [
      {
        id: 'inlet',
        medium: 'water',
        side: 'left',
        height: portHeight,
        offset: 0,
        diameter: node.inletDiameter,
        direction: [-1, 0, 0],
      },
      {
        id: 'outlet',
        medium: 'water',
        side: 'right',
        height: Math.max(0.18, node.height * 0.32),
        offset: 0,
        diameter: node.outletDiameter,
        direction: [1, 0, 0],
      },
    ]
  }

  return [
    {
      id: 'inlet',
      medium: 'water',
      side: 'top',
      height: node.height,
      offset: 0,
      diameter: node.inletDiameter,
      direction: [0, 1, 0],
    },
    {
      id: 'outlet',
      medium: 'water',
      side: 'front',
      height: Math.max(0.18, node.height * 0.18),
      offset: 0,
      diameter: node.outletDiameter,
      direction: [0, 0, 1],
    },
  ]
}
