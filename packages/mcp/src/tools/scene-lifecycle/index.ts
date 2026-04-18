import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from '../../bridge/scene-bridge'
import type { SceneStore } from '../../storage/types'
import { registerDeleteScene } from './delete-scene'
import { registerListScenes } from './list-scenes'
import { registerLoadScene } from './load-scene'
import { registerRenameScene } from './rename-scene'
import { registerSaveScene } from './save-scene'

/**
 * Register the scene-lifecycle MCP tools (`save_scene`, `load_scene`,
 * `list_scenes`, `delete_scene`, `rename_scene`) against the given server.
 * All tools operate against the supplied `SceneStore` so tests can inject an
 * in-memory implementation.
 */
export function registerSceneLifecycleTools(
  server: McpServer,
  bridge: SceneBridge,
  store: SceneStore,
): void {
  registerSaveScene(server, bridge, store)
  registerLoadScene(server, bridge, store)
  registerListScenes(server, store)
  registerDeleteScene(server, store)
  registerRenameScene(server, store)
}

export { deleteSceneInput, deleteSceneOutput, registerDeleteScene } from './delete-scene'
export { listScenesInput, listScenesOutput, registerListScenes } from './list-scenes'
export { loadSceneInput, loadSceneOutput, registerLoadScene } from './load-scene'
export { registerRenameScene, renameSceneInput, renameSceneOutput } from './rename-scene'
export { registerSaveScene, saveSceneInput, saveSceneOutput } from './save-scene'
