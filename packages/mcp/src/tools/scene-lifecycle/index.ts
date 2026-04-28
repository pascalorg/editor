import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../../operations'
import { registerDeleteScene } from './delete-scene'
import { registerListScenes } from './list-scenes'
import { registerLoadScene } from './load-scene'
import { registerRenameScene } from './rename-scene'
import { registerSaveScene } from './save-scene'

/**
 * Register the scene-lifecycle MCP tools (`save_scene`, `load_scene`,
 * `list_scenes`, `delete_scene`, `rename_scene`) against the given server.
 * All tools operate against shared scene operations so MCP, REST, and future CLI
 * entry points share the same storage boundary.
 */
export function registerSceneLifecycleTools(server: McpServer, operations: SceneOperations): void {
  registerSaveScene(server, operations)
  registerLoadScene(server, operations)
  registerListScenes(server, operations)
  registerDeleteScene(server, operations)
  registerRenameScene(server, operations)
}

export { deleteSceneInput, deleteSceneOutput, registerDeleteScene } from './delete-scene'
export { listScenesInput, listScenesOutput, registerListScenes } from './list-scenes'
export { loadSceneInput, loadSceneOutput, registerLoadScene } from './load-scene'
export { registerRenameScene, renameSceneInput, renameSceneOutput } from './rename-scene'
export { registerSaveScene, saveSceneInput, saveSceneOutput } from './save-scene'
