import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { pumpDefinition } from './pump/definition'
import { tankDefinition } from './tank/definition'
import { centrifugalPumpRecipe } from './recipes/pump-recipe'
import { storageTankRecipe } from './recipes/tank-recipe'
import { distillationUnitRecipe } from './recipes/distillation-recipe'
import { refineryAuxiliaryUnitRecipe } from './recipes/refinery-auxiliary-recipe'
import { refineryReactorUnitRecipe } from './recipes/refinery-reactor-recipe'

export const FACTORY_EQUIPMENT_PLUGIN_ID = 'pascal:factory-equipment'

export const factoryEquipmentPlugin: Plugin = {
  id: FACTORY_EQUIPMENT_PLUGIN_ID,
  apiVersion: 1,
  nodes: [
    pumpDefinition as unknown as AnyNodeDefinition,
    tankDefinition as unknown as AnyNodeDefinition,
  ],
  semanticRecipes: [
    centrifugalPumpRecipe,
    storageTankRecipe,
    distillationUnitRecipe,
    refineryAuxiliaryUnitRecipe,
    refineryReactorUnitRecipe,
  ],
}

export { pumpDefinition } from './pump/definition'
export { buildPumpFloorplan } from './pump/floorplan'
export { buildPumpGeometry } from './pump/geometry'
export { pumpParametrics } from './pump/parametrics'
export { factoryPumpPorts } from './pump/ports'
export { FactoryPumpNode, PumpType } from './pump/schema'
export {
  buildCentrifugalPumpPorts,
  buildCentrifugalPumpProfileParts,
  CENTRIFUGAL_PUMP_CORE_PART_ROLES,
  CENTRIFUGAL_PUMP_EDITABLE_PARAMS,
  CENTRIFUGAL_PUMP_EDITABLE_PART_ROLES,
  CENTRIFUGAL_PUMP_PROFILE_ID,
  CENTRIFUGAL_PUMP_RECIPE_ID,
  centrifugalPumpRecipe,
} from './recipes/pump-recipe'
export {
  buildDistillationUnitPorts,
  buildDistillationUnitProfileParts,
  DISTILLATION_UNIT_CORE_PART_ROLES,
  DISTILLATION_UNIT_EDITABLE_PARAMS,
  DISTILLATION_UNIT_EDITABLE_PART_ROLES,
  DISTILLATION_UNIT_RECIPE_ID,
  distillationUnitRecipe,
} from './recipes/distillation-recipe'
export {
  buildRefineryAuxiliaryUnitPorts,
  buildRefineryAuxiliaryUnitProfileParts,
  REFINERY_AUXILIARY_UNIT_CORE_PART_ROLES,
  REFINERY_AUXILIARY_UNIT_EDITABLE_PARAMS,
  REFINERY_AUXILIARY_UNIT_EDITABLE_PART_ROLES,
  REFINERY_AUXILIARY_UNIT_RECIPE_ID,
  refineryAuxiliaryUnitRecipe,
} from './recipes/refinery-auxiliary-recipe'
export {
  buildRefineryReactorUnitPorts,
  buildRefineryReactorUnitProfileParts,
  REFINERY_REACTOR_UNIT_CORE_PART_ROLES,
  REFINERY_REACTOR_UNIT_EDITABLE_PARAMS,
  REFINERY_REACTOR_UNIT_EDITABLE_PART_ROLES,
  REFINERY_REACTOR_UNIT_RECIPE_ID,
  refineryReactorUnitRecipe,
} from './recipes/refinery-reactor-recipe'
export {
  buildStorageTankPorts,
  buildStorageTankProfileParts,
  STORAGE_TANK_CORE_PART_ROLES,
  STORAGE_TANK_EDITABLE_PARAMS,
  STORAGE_TANK_EDITABLE_PART_ROLES,
  STORAGE_TANK_RECIPE_ID,
  storageTankRecipe,
} from './recipes/tank-recipe'
export { tankDefinition } from './tank/definition'
export { buildTankFloorplan } from './tank/floorplan'
export { buildTankGeometry } from './tank/geometry'
export { tankParametrics } from './tank/parametrics'
export { factoryTankPorts } from './tank/ports'
export { FactoryTankNode, TankOrientation } from './tank/schema'
