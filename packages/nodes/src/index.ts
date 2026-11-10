import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import type { BuiltinKind } from './builtin-definitions'
import { renderDefinitions } from './builtin-definitions'
import { builtinEditContributions } from './builtin-edit-contributions'
import { builtinPluginMetadata } from './builtin-plugin-metadata'
import { composeNodeDefinition, type NodeEditContribution } from './definition-contributions'

export const builtinPlugin: Plugin = {
  ...builtinPluginMetadata,
  nodes: renderDefinitions.map((render) =>
    composeNodeDefinition(
      render,
      builtinEditContributions[render.kind as BuiltinKind] as unknown as NodeEditContribution<
        AnyNodeDefinition['schema']
      >,
    ),
  ),
}

export { beamDefinition } from './beam'
export { useBeamDraft } from './beam/draft-settings'
export {
  applyBlockCommand,
  type BlockCommand,
  type BlockCommandResult,
  type BlockSelection,
  blockFaceCentroid,
  blockFaceNormal,
} from './block/commands'
export { blockDefinition } from './block/definition'
export { boxVentDefinition } from './box-vent'
export { buildingDefinition } from './building'
export {
  bakeCabinetAnimationClip,
  beginKitchenPlacement,
  CABINET_PLANNING_TOLERANCE,
  type CabinetPlacementType,
  type CabinetPlanningIssue,
  type CabinetPlanningIssueCode,
  type CabinetPlanningOptions,
  type CabinetPlanningReport,
  type CabinetPresetId,
  cabinetDefinition,
  cabinetModuleDefinition,
  cabinetPresetById,
  findKitchenItems,
  KITCHEN_ITEM_LABELS,
  KITCHEN_ITEMS,
  KitchenCollection,
  kitchenItemMatches,
  kitchenPresetForModule,
  kitchenPresetForPlacedModule,
  MIN_PRACTICAL_TOP_CABINET_HEIGHT,
  poseCabinetMovingParts,
  useCabinetPlacementStatus,
  useCabinetPlacementType,
  validateCabinetRun,
} from './cabinet'
export { ceilingDefinition } from './ceiling'
export { chimneyDefinition } from './chimney'
export { columnDefinition } from './column'
export {
  armFramingPostTool,
  type FramingPostToolChoices,
  framingPostsUnderBeam,
  framingPostToolChoices,
  framingPostToolDefaults,
} from './column/post-placement'
export { constructionDimensionDefinition } from './construction-dimension'
export { cupolaDefinition } from './cupola'
export { doorDefinition } from './door'
export { dormerDefinition } from './dormer'
export { downspoutDefinition } from './downspout'
export { ductFittingDefinition } from './duct-fitting'
export { ductSegmentDefinition } from './duct-segment'
export { ductTerminalDefinition } from './duct-terminal'
export { elevatorDefinition } from './elevator'
export { ELEVATOR_PRESETS, elevatorPresetPatch } from './elevator/presets'
export { eyebrowVentDefinition } from './eyebrow-vent'
export { beginFenceFeaturePlacement, fenceDefinition } from './fence'
export { fenceGateDefinition, fenceOpeningDefinition } from './fence-feature/definition'
export { floorOpeningDefinition } from './floor-opening/definition'
export { guideDefinition } from './guide'
export { gutterDefinition } from './gutter'
export { hvacEquipmentDefinition } from './hvac-equipment'
export { importedMeshDefinition } from './imported-mesh'
export { getPendingItemModelLoadCount, itemDefinition } from './item'
export {
  registerWallObjectSceneCheck,
  wallObjectRenderedObservations,
} from './item/wall-object-observations'
export { leanToExtensionDefinition } from './lean-to-extension'
export { levelDefinition } from './level'
export { linesetDefinition } from './lineset'
export { liquidLineDefinition, useLiquidLineToolOptions } from './liquid-line'
export { measurementDefinition } from './measurement'
export { pipeFittingDefinition } from './pipe-fitting'
export { pipeSegmentDefinition } from './pipe-segment'
export { pipeTrapDefinition } from './pipe-trap'
export { ridgeVentDefinition } from './ridge-vent'
export { type RoofFootprintSourceChoice, roofDefinition, useRoofFootprintSource } from './roof'
export { glazedRoofGeometryAdapter } from './roof/glazed-geometry'
export { createGlazedRoofMaterials } from './roof/glazed-materials'
export { createRoofGlazingPreview } from './roof/glazing-preview'
export { RoofTypeThumbnail } from './roof/type-thumbnail'
export { roofSegmentDefinition } from './roof-segment'
export { scanDefinition } from './scan'
export { separatorDefinition } from './separator/definition'
export { default as PipeCollarInspector } from './shared/pipe-collar-inspector'
export { shelfDefinition } from './shelf'
export { siteDefinition } from './site'
export { skylightDefinition } from './skylight'
export { slabDefinition } from './slab'
export { solarPanelDefinition } from './solar-panel'
export { spawnDefinition } from './spawn'
export { stairDefinition } from './stair'
export { guardBoxGeometry } from './stair/baluster-geometry'
export { buildBalusterGuard } from './stair/baluster-guard'
export { buildBoardsGuard } from './stair/boards-guard'
export { buildCableGuard } from './stair/cable-guard'
export { buildGlassGuard } from './stair/glass-guard'
export { buildMetalGuard } from './stair/metal-guard'
export { buildFloorplanStairEntry } from './stair/plan-entry'
export { buildPostAndRailGuard } from './stair/post-and-rail-guard'
export { stairSegmentDefinition } from './stair-segment'
export { structuralGridDefinition } from './structural-grid'
export { turbineVentDefinition } from './turbine-vent'
export { unitDefinition } from './unit'
export { wallDefinition } from './wall'
export { windowDefinition } from './window'
export { zoneDefinition } from './zone'
