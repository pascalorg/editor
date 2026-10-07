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
import { registerFindNodes } from './find-nodes'
import { registerGetScene } from './get-scene'
import { registerListUnits } from './list-units'
import { registerMeasure } from './measure'
import { registerPhotoToSceneTool } from './photo-to-scene'
import { registerPlaceDesign } from './place-design'
import { registerRedo } from './redo'
import { registerRoomTools } from './room-tools'
import { registerSceneLifecycleTools } from './scene-lifecycle'
import { registerSetUnitMembers } from './set-unit-members'
import { registerSetZone } from './set-zone'
import { registerSharedTools } from './shared-tools'
import { registerTemplateTools } from './templates'
import { registerUndo } from './undo'
import { registerValidateDesign } from './validate-design'
import { registerValidateScene } from './validate-scene'
import { registerVariantTools } from './variants'

/**
 * Register every non-vision MCP tool against the given server.
 * Vision tools (analyze_floorplan_image, analyze_room_photo) are registered
 * separately via `registerVisionTools` (Agent E).
 *
 * Scene-lifecycle tools (save/load/list/delete/rename scene) are registered
 * when persistence operations are available.
 */
/** What the host lends the tools: its item library and script compiles. */
export type ToolHosts = {
  catalog?: AssetCatalog
  geometryScripts?: GeometryScriptHost
}

export function registerTools(
  server: McpServer,
  operations: SceneOperations,
  { catalog, geometryScripts }: ToolHosts = {},
): void {
  registerGetScene(server, operations)
  registerDescribeNode(server, operations)
  registerFindNodes(server, operations)
  registerSharedTools(server, operations, catalog)
  registerAddColumn(server, operations, geometryScripts)
  registerAddObject(server, operations, geometryScripts)
  registerGetSource(server, operations, geometryScripts)
  registerMeasure(server, operations)
  registerConstructionTools(server, operations)
  registerRoomTools(server, operations, geometryScripts)
  registerApplyPatch(server, operations)
  registerClearScene(server, operations)
  registerCreateUnit(server, operations)
  registerSetUnitMembers(server, operations)
  registerListUnits(server, operations)
  registerPlaceDesign(server, operations)
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
  }
}
