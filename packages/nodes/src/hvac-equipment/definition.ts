import { composeNodeDefinition } from '../definition-contributions'
import { hvacEquipmentEditContribution } from './definition.edit'
import { hvacEquipmentRenderDefinition } from './definition.render'

export const hvacEquipmentDefinition = composeNodeDefinition(
  hvacEquipmentRenderDefinition,
  hvacEquipmentEditContribution,
)
