import { composeNodeDefinition } from '../definition-contributions'
import { cabinetEditContribution, cabinetModuleEditContribution } from './definition.edit'
import { cabinetModuleRenderDefinition, cabinetRenderDefinition } from './definition.render'

export const cabinetDefinition = composeNodeDefinition(
  cabinetRenderDefinition,
  cabinetEditContribution,
)
export const cabinetModuleDefinition = composeNodeDefinition(
  cabinetModuleRenderDefinition,
  cabinetModuleEditContribution,
)
export type { CabinetRunFootprint } from './definition.render'
export {
  bumpCabinetRunsNear,
  cabinetFloorPlacedFootprints,
  cabinetRunFootprint,
  cabinetRunNeighborSignature,
} from './definition.render'
