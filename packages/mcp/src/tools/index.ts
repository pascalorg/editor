import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../operations'
import { registerAddColumn } from './add-column'
import { type GeometryScriptHost, registerAddObject, registerGetSource } from './add-object'
import { registerApplyPatch } from './apply-patch'
import type { AssetCatalog } from './asset-catalog'
import { registerCheckCollisions } from './check-collisions'
import { registerClearScene } from './clear-scene'
import { registerConstructionTools } from './construction-tools'
import { registerCreateUnit } from './create-unit'
import { registerDescribeNode } from './describe-node'
import { registerExportGlb } from './export-glb'
import { registerExportJson } from './export-json'
import { registerFacadeTools } from './facade'
import { registerFindNodes } from './find-nodes'
import { registerGetScene } from './get-scene'
import { registerListUnits } from './list-units'
import { registerMeasure } from './measure'
import { registerPhotoToSceneTool } from './photo-to-scene'
import { registerPlaceDesign } from './place-design'
import { registerRedo } from './redo'
import { type PlanRasterDecoder, registerReferenceConstruction } from './reference-construction'
import { registerRoomTools } from './room-tools'
import { registerSceneLifecycleTools } from './scene-lifecycle'
import { registerSetUnitMembers } from './set-unit-members'
import { registerSetZone } from './set-zone'
import { type PlanReadingHosts, registerSharedTools } from './shared-tools'
import type { SourceResolver } from './source-resolver'
import { registerTemplateTools } from './templates'
import { registerUndo } from './undo'
import { registerValidateDesign } from './validate-design'
import { registerValidateScene } from './validate-scene'
import { registerVariantTools } from './variants'
import { registerViewScene, type SceneViewHost } from './view-scene'

/**
 * Register every non-vision MCP tool against the given server.
 * Vision tools (analyze_floorplan_image, analyze_room_photo) are registered
 * separately via `registerVisionTools` (Agent E).
 *
 * Scene-lifecycle tools (save/load/list/delete/rename scene) are registered
 * when persistence operations are available.
 */
/**
 * What the host lends the tools: its item library, script compiles, image decoding, a view, a
 * judge and a rasteriser for the plans furnish_from_plan reads.
 */
export type ToolHosts = PlanReadingHosts & {
  catalog?: AssetCatalog
  geometryScripts?: GeometryScriptHost
  sceneViews?: SceneViewHost
  /** Decodes a raster plan's pixels so its walls are traced; without it a raster is for reading. */
  decodeRaster?: PlanRasterDecoder
  /** Resolves a file the host serves `request_upload` for; without it, images are inline only. */
  resolveSource?: SourceResolver
}

export function registerTools(
  server: McpServer,
  operations: SceneOperations,
  {
    catalog,
    geometryScripts,
    sceneViews,
    decodeRaster,
    planJudge,
    rasterizeSvg,
    vectorizePlan,
    vectorizePlanPricing,
    resolveSource,
  }: ToolHosts = {},
): void {
  registerGetScene(server, operations)
  registerDescribeNode(server, operations)
  registerFindNodes(server, operations)
  registerSharedTools(server, operations, catalog, {
    planJudge,
    rasterizeSvg,
    vectorizePlan,
    vectorizePlanPricing,
  })
  registerAddColumn(server, operations, geometryScripts)
  registerAddObject(server, operations, geometryScripts)
  registerGetSource(server, operations, geometryScripts)
  registerMeasure(server, operations)
  registerViewScene(server, operations, sceneViews)
  registerConstructionTools(server, operations)
  registerRoomTools(server, operations, geometryScripts)
  registerApplyPatch(server, operations)
  registerClearScene(server, operations)
  registerCreateUnit(server, operations)
  registerSetUnitMembers(server, operations)
  registerListUnits(server, operations)
  registerPlaceDesign(server, operations)
  registerFacadeTools(server, operations)
  registerSetZone(server, operations)
  registerUndo(server, operations)
  registerRedo(server, operations)
  registerExportJson(server, operations)
  registerExportGlb(server, operations)
  registerValidateScene(server, operations)
  registerValidateDesign(server, operations)
  registerCheckCollisions(server, operations)
  registerTemplateTools(server, operations)
  if (operations.hasStore) {
    registerSceneLifecycleTools(server, operations)
    registerVariantTools(server, operations)
    registerPhotoToSceneTool(server, operations)
    registerReferenceConstruction(
      server,
      operations,
      decodeRaster,
      !!vectorizePlan,
      resolveSource,
      rasterizeSvg,
    )
  }
}
