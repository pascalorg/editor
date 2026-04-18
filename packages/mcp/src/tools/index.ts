import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from '../bridge/scene-bridge'
import type { SceneStore } from '../storage/types'
import { registerApplyPatch } from './apply-patch'
import { registerCheckCollisions } from './check-collisions'
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
import { registerSceneLifecycleTools } from './scene-lifecycle'
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
 * when a `store` is provided; callers that pass `undefined` skip them.
 */
export function registerTools(server: McpServer, bridge: SceneBridge, store?: SceneStore): void {
  registerGetScene(server, bridge)
  registerGetNode(server, bridge)
  registerDescribeNode(server, bridge)
  registerFindNodes(server, bridge)
  registerMeasure(server, bridge)
  registerApplyPatch(server, bridge)
  registerCreateLevel(server, bridge)
  registerCreateWall(server, bridge)
  registerPlaceItem(server, bridge)
  registerCutOpening(server, bridge)
  registerSetZone(server, bridge)
  registerDuplicateLevel(server, bridge)
  registerDeleteNode(server, bridge)
  registerUndo(server, bridge)
  registerRedo(server, bridge)
  registerExportJson(server, bridge)
  registerExportGlb(server, bridge)
  registerValidateScene(server, bridge)
  registerCheckCollisions(server, bridge)
  registerTemplateTools(server, bridge, store)
  if (store) {
    registerSceneLifecycleTools(server, bridge, store)
    registerVariantTools(server, bridge, store)
    registerPhotoToSceneTool(server, bridge, store)
  }
}
