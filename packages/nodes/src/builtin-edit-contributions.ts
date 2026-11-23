import { beamEditContribution } from './beam/definition.edit'
import { blockEditContribution } from './block/definition.edit'
import { boxVentEditContribution } from './box-vent/definition.edit'
import { buildingEditContribution } from './building/definition.edit'
import type { BuiltinEditContributions } from './builtin-definitions'
import { cabinetEditContribution, cabinetModuleEditContribution } from './cabinet/definition.edit'
import { ceilingEditContribution } from './ceiling/definition.edit'
import { chimneyEditContribution } from './chimney/definition.edit'
import { columnEditContribution } from './column/definition.edit'
import { constructionDimensionEditContribution } from './construction-dimension/definition.edit'
import { cupolaEditContribution } from './cupola/definition.edit'
import { doorEditContribution } from './door/definition.edit'
import { dormerEditContribution } from './dormer/definition.edit'
import { downspoutEditContribution } from './downspout/definition.edit'
import { ductFittingEditContribution } from './duct-fitting/definition.edit'
import { ductSegmentEditContribution } from './duct-segment/definition.edit'
import { ductTerminalEditContribution } from './duct-terminal/definition.edit'
import { elevatorEditContribution } from './elevator/definition.edit'
import { eyebrowVentEditContribution } from './eyebrow-vent/definition.edit'
import { fenceEditContribution } from './fence/definition.edit'
import {
  fenceGateEditContribution,
  fenceOpeningEditContribution,
} from './fence-feature/definition.edit'
import { floorOpeningEditContribution } from './floor-opening/definition.edit'
import { guideEditContribution } from './guide/definition.edit'
import { gutterEditContribution } from './gutter/definition.edit'
import { hvacEquipmentEditContribution } from './hvac-equipment/definition.edit'
import { importedMeshEditContribution } from './imported-mesh/definition.edit'
import { itemEditContribution } from './item/definition.edit'
import { leanToExtensionEditContribution } from './lean-to-extension/definition.edit'
import { levelEditContribution } from './level/definition.edit'
import { linesetEditContribution } from './lineset/definition.edit'
import { liquidLineEditContribution } from './liquid-line/definition.edit'
import { measurementEditContribution } from './measurement/definition.edit'
import { pipeFittingEditContribution } from './pipe-fitting/definition.edit'
import { pipeSegmentEditContribution } from './pipe-segment/definition.edit'
import { pipeTrapEditContribution } from './pipe-trap/definition.edit'
import { proceduralItemEditContribution } from './procedural-item/definition.edit'
import { ridgeVentEditContribution } from './ridge-vent/definition.edit'
import { roofEditContribution } from './roof/definition.edit'
import { roofSegmentEditContribution } from './roof-segment/definition.edit'
import { scanEditContribution } from './scan/definition.edit'
import { separatorEditContribution } from './separator/definition.edit'
import { shelfEditContribution } from './shelf/definition.edit'
import { siteEditContribution } from './site/definition.edit'
import { skylightEditContribution } from './skylight/definition.edit'
import { slabEditContribution } from './slab/definition.edit'
import { solarPanelEditContribution } from './solar-panel/definition.edit'
import { spawnEditContribution } from './spawn/definition.edit'
import { stairEditContribution } from './stair/definition.edit'
import { stairSegmentEditContribution } from './stair-segment/definition.edit'
import { structuralGridEditContribution } from './structural-grid/definition.edit'
import { turbineVentEditContribution } from './turbine-vent/definition.edit'
import { unitEditContribution } from './unit/definition.edit'
import { wallEditContribution } from './wall/definition.edit'
import { windowEditContribution } from './window/definition.edit'
import { zoneEditContribution } from './zone/definition.edit'

export const builtinEditContributions = {
  shelf: shelfEditContribution,
  block: blockEditContribution,
  spawn: spawnEditContribution,
  wall: wallEditContribution,
  separator: separatorEditContribution,
  'floor-opening': floorOpeningEditContribution,
  'lean-to-extension': leanToExtensionEditContribution,
  fence: fenceEditContribution,
  'fence-gate': fenceGateEditContribution,
  'fence-opening': fenceOpeningEditContribution,
  slab: slabEditContribution,
  ceiling: ceilingEditContribution,
  door: doorEditContribution,
  window: windowEditContribution,
  cabinet: cabinetEditContribution,
  'cabinet-module': cabinetModuleEditContribution,
  item: itemEditContribution,
  'procedural-item': proceduralItemEditContribution,
  'imported-mesh': importedMeshEditContribution,
  column: columnEditContribution,
  beam: beamEditContribution,
  elevator: elevatorEditContribution,
  unit: unitEditContribution,
  roof: roofEditContribution,
  'roof-segment': roofSegmentEditContribution,
  stair: stairEditContribution,
  'stair-segment': stairSegmentEditContribution,
  zone: zoneEditContribution,
  site: siteEditContribution,
  building: buildingEditContribution,
  level: levelEditContribution,
  guide: guideEditContribution,
  scan: scanEditContribution,
  measurement: measurementEditContribution,
  'construction-dimension': constructionDimensionEditContribution,
  'structural-grid': structuralGridEditContribution,
  'box-vent': boxVentEditContribution,
  'ridge-vent': ridgeVentEditContribution,
  'turbine-vent': turbineVentEditContribution,
  cupola: cupolaEditContribution,
  'eyebrow-vent': eyebrowVentEditContribution,
  chimney: chimneyEditContribution,
  'solar-panel': solarPanelEditContribution,
  skylight: skylightEditContribution,
  dormer: dormerEditContribution,
  gutter: gutterEditContribution,
  downspout: downspoutEditContribution,
  'duct-segment': ductSegmentEditContribution,
  'duct-fitting': ductFittingEditContribution,
  'duct-terminal': ductTerminalEditContribution,
  'hvac-equipment': hvacEquipmentEditContribution,
  lineset: linesetEditContribution,
  'liquid-line': liquidLineEditContribution,
  'pipe-segment': pipeSegmentEditContribution,
  'pipe-fitting': pipeFittingEditContribution,
  'pipe-trap': pipeTrapEditContribution,
} satisfies BuiltinEditContributions
