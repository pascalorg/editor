import type { McpServer } from '@modelcontextprotocol/server'
import type { SceneOperations } from '../operations'
import { registerAddColumn } from './add-column'
import {
  compileObjectOnHost,
  type GeometryScriptHost,
  registerAddObject,
  registerGetSource,
} from './add-object'
import { registerApplyPatch } from './apply-patch'
import type { AssetCatalog } from './asset-catalog'
import { registerAuthorScene } from './author-scene'
import { registerCheckCollisions } from './check-collisions'
import { registerClearScene } from './clear-scene'
import { registerConstructionTools } from './construction-tools'
import { registerCreateUnit } from './create-unit'
import { registerExportGlb } from './export-glb'
import { registerExportJson } from './export-json'
import { registerGetScene } from './get-scene'
import { registerListUnits } from './list-units'
import { registerMeasure } from './measure'
import { registerPhotoToSceneTool } from './photo-to-scene'
import { registerRedo } from './redo'
import { registerRoomTools } from './room-tools'
import { registerSceneLifecycleTools } from './scene-lifecycle'
import { registerSetUnitMembers } from './set-unit-members'
import { registerSetZone } from './set-zone'
import { type PlanReadingHosts, registerSharedTools } from './shared-tools'
import { registerTemplateTools } from './templates'
import { registerUndo } from './undo'
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
/** What the host lends the tools: its item library, script compiles, a view. */
export type ToolHosts = PlanReadingHosts & {
  catalog?: AssetCatalog
  geometryScripts?: GeometryScriptHost
  sceneViews?: SceneViewHost
}

export function registerTools(
  server: McpServer,
  operations: SceneOperations,
  { catalog, geometryScripts, sceneViews, assetViews }: ToolHosts = {},
): void {
  registerGetScene(server, operations)
  registerSharedTools(server, operations, catalog, {
    assetViews,
    buildObject: (input) => compileObjectOnHost(geometryScripts, operations, input),
  })
  registerAddColumn(server, operations, geometryScripts)
  registerAddObject(server, operations, geometryScripts)
  registerAuthorScene(server, operations, geometryScripts)
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
  registerSetZone(server, operations)
  registerUndo(server, operations)
  registerRedo(server, operations)
  registerExportJson(server, operations)
  registerExportGlb(server, operations)
  registerCheckCollisions(server, operations)
  registerTemplateTools(server, operations)
  if (operations.hasStore) {
    registerSceneLifecycleTools(server, operations)
    registerVariantTools(server, operations)
    registerPhotoToSceneTool(server, operations)
  }
}
