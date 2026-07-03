import type { EquipmentPort } from '@pascal-app/core'
import type { FactoryPumpNode } from './schema'

export function factoryPumpPorts(node: FactoryPumpNode): EquipmentPort[] {
  const portHeight = Math.max(0.2, node.height * 0.42)
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
      height: Math.max(portHeight, node.height * 0.56),
      offset: 0,
      diameter: node.outletDiameter,
      direction: [1, 0, 0],
    },
  ]
}
