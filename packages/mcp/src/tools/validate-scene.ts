import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { READ_ONLY_TOOL_ANNOTATIONS } from './annotations'

export const validateSceneInput = {}

const validationIssue = z.object({
  nodeId: z.string(),
  path: z.string(),
  message: z.string(),
})

export const validateSceneOutput = {
  valid: z.boolean(),
  errors: z.array(validationIssue),
  warnings: z.array(validationIssue),
}

export function registerValidateScene(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'validate_scene',
    {
      title: 'Validate scene',
      description:
        'Run Zod validation against every node in the scene. Returns `{ valid, errors, warnings }` where each entry has `{ nodeId, path, message }`. Warnings do not fail validation; for example a hidden Site, whose flag hides only its own ground and boundary while the buildings on it stay visible and exported.',
      inputSchema: validateSceneInput,
      outputSchema: validateSceneOutput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
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
