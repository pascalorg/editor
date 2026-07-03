import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { pumpDefinition } from './pump/definition'

export const FACTORY_EQUIPMENT_PLUGIN_ID = 'pascal:factory-equipment'

export const factoryEquipmentPlugin: Plugin = {
  id: FACTORY_EQUIPMENT_PLUGIN_ID,
  apiVersion: 1,
  nodes: [pumpDefinition as unknown as AnyNodeDefinition],
}

export { pumpDefinition } from './pump/definition'
export { buildPumpFloorplan } from './pump/floorplan'
export { buildPumpGeometry } from './pump/geometry'
export { pumpParametrics } from './pump/parametrics'
export { factoryPumpPorts } from './pump/ports'
export { FactoryPumpNode, PumpType } from './pump/schema'
