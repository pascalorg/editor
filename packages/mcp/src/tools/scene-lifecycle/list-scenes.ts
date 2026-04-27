import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { ErrorCode, throwMcpError } from '../errors'

const DEFAULT_LIMIT = 100

export const listScenesInput = {
  projectId: z.string().optional(),
  limit: z.number().int().positive().max(1000).optional(),
}

export const listScenesOutput = {
  scenes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      projectId: z.string().nullable(),
      thumbnailUrl: z.string().nullable(),
      version: z.number(),
      createdAt: z.string(),
      updatedAt: z.string(),
      ownerId: z.string().nullable(),
      sizeBytes: z.number(),
      nodeCount: z.number(),
    }),
  ),
}

export function registerListScenes(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'list_scenes',
    {
      title: 'List scenes',
      description:
        'List scenes in the SceneStore. Optionally filter by `projectId` and cap results with `limit` (default 100).',
      inputSchema: listScenesInput,
      outputSchema: listScenesOutput,
    },
    async ({ projectId, limit }) => {
      try {
        const scenes = await operations.listScenes({
          ...(projectId !== undefined ? { projectId } : {}),
          limit: limit ?? DEFAULT_LIMIT,
        })
        const payload = { scenes }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InternalError, msg)
      }
    },
  )
}
