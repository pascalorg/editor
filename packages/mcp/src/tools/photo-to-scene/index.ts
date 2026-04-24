import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from '../../bridge/scene-bridge'
import type { SceneStore } from '../../storage/types'
import { registerPhotoToScene } from './photo-to-scene'

/**
 * Register the `photo_to_scene` orchestrator tool. Chains the vision
 * (`analyze_floorplan_image`-equivalent sampling call) → SceneGraph
 * synthesis → optional `SceneStore.save` → `bridge.setScene` so callers get a
 * navigable Pascal scene from a single photo upload.
 */
export function registerPhotoToSceneTool(
  server: McpServer,
  bridge: SceneBridge,
  store: SceneStore,
): void {
  registerPhotoToScene(server, bridge, store)
}

export {
  photoToSceneInput,
  photoToSceneOutput,
  registerPhotoToScene,
} from './photo-to-scene'
