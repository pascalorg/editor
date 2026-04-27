import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../operations'
import { registerApplyPatch } from './apply-patch'
import { registerCheckCollisions } from './check-collisions'
import { registerConstructionTools } from './construction-tools'
import { registerCreateLevel } from './create-level'
import { registerCreateWall } from './create-wall'
import { registerCutOpening } from './cut-opening'
import { registerDeleteNode } from './delete-node'
import { registerDescribeNode } from './describe-node'
import { registerDuplicateLevel } from './duplicate-level'
import { registerExportGlb } from './export-glb'
import { registerExportJson } from './export-json'
import { registerFindNodes } from './find-nodes'
import { registerGetNode } from './get-node'
import { registerGetScene } from './get-scene'
import { registerMeasure } from './measure'
import { registerPhotoToSceneTool } from './photo-to-scene'
import { registerPlaceItem } from './place-item'
import { registerRedo } from './redo'
import { registerRoomTools } from './room-tools'
import { registerSceneLifecycleTools } from './scene-lifecycle'
import { registerSceneQueryTools } from './scene-query'
import { registerSetZone } from './set-zone'
import { registerTemplateTools } from './templates'
import { registerUndo } from './undo'
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
export function registerTools(server: McpServer, operations: SceneOperations): void {
  registerGetScene(server, operations)
  registerGetNode(server, operations)
  registerDescribeNode(server, operations)
  registerFindNodes(server, operations)
  registerSceneQueryTools(server, operations)
  registerMeasure(server, operations)
  registerConstructionTools(server, operations)
  registerRoomTools(server, operations)
  registerApplyPatch(server, operations)
  registerCreateLevel(server, operations)
  registerCreateWall(server, operations)
  registerPlaceItem(server, operations)
  registerCutOpening(server, operations)
  registerSetZone(server, operations)
  registerDuplicateLevel(server, operations)
  registerDeleteNode(server, operations)
  registerUndo(server, operations)
  registerRedo(server, operations)
  registerExportJson(server, operations)
  registerExportGlb(server, operations)
  registerValidateScene(server, operations)
  registerCheckCollisions(server, operations)
  registerTemplateTools(server, operations)
  if (operations.hasStore) {
    registerSceneLifecycleTools(server, operations)
    registerVariantTools(server, operations)
    registerPhotoToSceneTool(server, operations)
  }
}
