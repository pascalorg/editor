import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'

export const validateSceneInput = {}

export const validateSceneOutput = {
  valid: z.boolean(),
  errors: z.array(
    z.object({
      nodeId: z.string(),
      path: z.string(),
      message: z.string(),
    }),
  ),
}

export function registerValidateScene(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'validate_scene',
    {
      title: 'Validate scene',
      description:
        'Run Zod validation against every node in the scene. Returns `{ valid, errors }` where each error has `{ nodeId, path, message }`.',
      inputSchema: validateSceneInput,
      outputSchema: validateSceneOutput,
    },
    async () => {
      const result = bridge.validateScene()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
      }
    },
  )
}
