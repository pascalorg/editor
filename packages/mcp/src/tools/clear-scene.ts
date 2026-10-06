import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { clearSceneTool } from '@pascal-app/core/agent-tools'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult } from './errors'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'

/**
 * `clear_scene`: the scene goes back to the host's default scaffold (a site, a building, a level),
 * then is saved with `allowSceneWipe`, so a store that refuses an accidental wipe takes this one.
 * The project's installed plugins stay, as the editor's own clear keeps them.
 */
export function registerClearScene(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    clearSceneTool.name,
    {
      title: clearSceneTool.title,
      description: clearSceneTool.description,
      inputSchema: clearSceneTool.input,
      outputSchema: {
        cleared: z.object({ removed: z.number() }),
        version: z.number().nullable(),
        graphHash: z.string().nullable(),
        ...liveSyncOutput,
      },
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async () => {
      try {
        const before = Object.keys(operations.getNodes()).length
        const { installedPlugins } = operations.exportSceneGraph()
        operations.setScene({}, [])
        operations.loadDefault()
        // Resetting drops the plugin state on every host; the scaffold is applied again with it.
        if (installedPlugins)
          operations.loadJSON({
            ...operations.exportSceneGraph(),
            collections: {},
            materials: {},
            installedPlugins,
          })
        const removed = Math.max(0, before - Object.keys(operations.getNodes()).length)
        const persistence = await publishLiveSceneSnapshot(operations, clearSceneTool.name, {
          allowSceneWipe: true,
        })
        const active = operations.getActiveScene()
        const payload = {
          cleared: { removed },
          version: active?.version ?? null,
          graphHash: active?.graphHash ?? null,
          ...persistencePayload(persistence),
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (error) {
        return refusalResult(error)
      }
    },
  )
}
