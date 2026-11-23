import type { AnyNodeDefinition } from '@pascal-app/core'
import { beamRenderDefinition } from './beam/definition.render'
import { blockRenderDefinition } from './block/definition.render'
import { boxVentRenderDefinition } from './box-vent/definition.render'
import { buildingRenderDefinition } from './building/definition.render'
import { cabinetModuleRenderDefinition, cabinetRenderDefinition } from './cabinet/definition.render'
import { ceilingRenderDefinition } from './ceiling/definition.render'
import { chimneyRenderDefinition } from './chimney/definition.render'
import { columnRenderDefinition } from './column/definition.render'
import { constructionDimensionRenderDefinition } from './construction-dimension/definition.render'
import { cupolaRenderDefinition } from './cupola/definition.render'
import type { NodeEditContribution } from './definition-contributions'
import { doorRenderDefinition } from './door/definition.render'
import { dormerRenderDefinition } from './dormer/definition.render'
import { downspoutRenderDefinition } from './downspout/definition.render'
import { ductFittingRenderDefinition } from './duct-fitting/definition.render'
import { ductSegmentRenderDefinition } from './duct-segment/definition.render'
import { ductTerminalRenderDefinition } from './duct-terminal/definition.render'
import { elevatorRenderDefinition } from './elevator/definition.render'
import { eyebrowVentRenderDefinition } from './eyebrow-vent/definition.render'
import { fenceRenderDefinition } from './fence/definition.render'
import {
  fenceGateRenderDefinition,
  fenceOpeningRenderDefinition,
} from './fence-feature/definition.render'
import { floorOpeningRenderDefinition } from './floor-opening/definition.render'
import { guideRenderDefinition } from './guide/definition.render'
import { gutterRenderDefinition } from './gutter/definition.render'
import { hvacEquipmentRenderDefinition } from './hvac-equipment/definition.render'
import { importedMeshRenderDefinition } from './imported-mesh/definition.render'
import { itemRenderDefinition } from './item/definition.render'
import { leanToExtensionRenderDefinition } from './lean-to-extension/definition.render'
import { levelRenderDefinition } from './level/definition.render'
import { linesetRenderDefinition } from './lineset/definition.render'
import { liquidLineRenderDefinition } from './liquid-line/definition.render'
import { measurementRenderDefinition } from './measurement/definition.render'
import { pipeFittingRenderDefinition } from './pipe-fitting/definition.render'
import { pipeSegmentRenderDefinition } from './pipe-segment/definition.render'
import { pipeTrapRenderDefinition } from './pipe-trap/definition.render'
import { proceduralItemRenderDefinition } from './procedural-item/definition.render'
import { ridgeVentRenderDefinition } from './ridge-vent/definition.render'
import { roofRenderDefinition } from './roof/definition.render'
import { roofSegmentRenderDefinition } from './roof-segment/definition.render'
import { scanRenderDefinition } from './scan/definition.render'
import { separatorRenderDefinition } from './separator/definition.render'
import { shelfRenderDefinition } from './shelf/definition.render'
import { siteRenderDefinition } from './site/definition.render'
import { skylightRenderDefinition } from './skylight/definition.render'
import { slabRenderDefinition } from './slab/definition.render'
import { solarPanelRenderDefinition } from './solar-panel/definition.render'
import { spawnRenderDefinition } from './spawn/definition.render'
import { stairRenderDefinition } from './stair/definition.render'
import { stairSegmentRenderDefinition } from './stair-segment/definition.render'
import { structuralGridRenderDefinition } from './structural-grid/definition.render'
import { turbineVentRenderDefinition } from './turbine-vent/definition.render'
import { unitRenderDefinition } from './unit/definition.render'
import { wallRenderDefinition } from './wall/definition.render'
import { windowRenderDefinition } from './window/definition.render'
import { zoneRenderDefinition } from './zone/definition.render'

export const builtinRenderDefinitions = [
  shelfRenderDefinition,
  blockRenderDefinition,
  spawnRenderDefinition,
  wallRenderDefinition,
  separatorRenderDefinition,
  floorOpeningRenderDefinition,
  leanToExtensionRenderDefinition,
  fenceRenderDefinition,
  fenceGateRenderDefinition,
  fenceOpeningRenderDefinition,
  slabRenderDefinition,
  ceilingRenderDefinition,
  doorRenderDefinition,
  windowRenderDefinition,
  cabinetRenderDefinition,
  cabinetModuleRenderDefinition,
  itemRenderDefinition,
  proceduralItemRenderDefinition,
  importedMeshRenderDefinition,
  columnRenderDefinition,
  beamRenderDefinition,
  elevatorRenderDefinition,
  unitRenderDefinition,
  roofRenderDefinition,
  roofSegmentRenderDefinition,
  stairRenderDefinition,
  stairSegmentRenderDefinition,
  zoneRenderDefinition,
  siteRenderDefinition,
  buildingRenderDefinition,
  levelRenderDefinition,
  guideRenderDefinition,
  scanRenderDefinition,
  measurementRenderDefinition,
  constructionDimensionRenderDefinition,
  structuralGridRenderDefinition,
  boxVentRenderDefinition,
  ridgeVentRenderDefinition,
  turbineVentRenderDefinition,
  cupolaRenderDefinition,
  eyebrowVentRenderDefinition,
  chimneyRenderDefinition,
  solarPanelRenderDefinition,
  skylightRenderDefinition,
  dormerRenderDefinition,
  gutterRenderDefinition,
  downspoutRenderDefinition,
  ductSegmentRenderDefinition,
  ductFittingRenderDefinition,
  ductTerminalRenderDefinition,
  hvacEquipmentRenderDefinition,
  linesetRenderDefinition,
  liquidLineRenderDefinition,
  pipeSegmentRenderDefinition,
  pipeFittingRenderDefinition,
  pipeTrapRenderDefinition,
] as const

export type BuiltinKind = (typeof builtinRenderDefinitions)[number]['kind']
export type BuiltinEditContributions = {
  [K in BuiltinKind]: NodeEditContribution<
    Extract<(typeof builtinRenderDefinitions)[number], { kind: K }>['schema']
  >
}
export const renderDefinitions: AnyNodeDefinition[] =
  builtinRenderDefinitions as unknown as AnyNodeDefinition[]
