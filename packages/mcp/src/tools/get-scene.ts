import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'

export const getSceneInput = {}

export const getSceneOutput = {
  nodes: z.record(z.string(), z.unknown()),
  rootNodeIds: z.array(z.string()),
  collections: z.record(z.string(), z.unknown()).optional(),
}

export function registerGetScene(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'get_scene',
    {
      title: 'Get scene',
      description:
        'Returns the full scene graph: flat node dictionary, root node IDs, and collections.',
      inputSchema: getSceneInput,
      outputSchema: getSceneOutput,
    },
    async () => {
      const scene = bridge.exportJSON()
      const payload = {
        nodes: scene.nodes as Record<string, unknown>,
        rootNodeIds: scene.rootNodeIds,
        collections: (scene.collections ?? {}) as Record<string, unknown>,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
