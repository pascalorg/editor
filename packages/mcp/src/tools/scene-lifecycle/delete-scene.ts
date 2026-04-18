import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SceneNotFoundError, type SceneStore, SceneVersionConflictError } from '../../storage/types'
import { ErrorCode, throwMcpError } from '../errors'

export const deleteSceneInput = {
  id: z.string().min(1).max(64),
  expectedVersion: z.number().int().positive().optional(),
}

export const deleteSceneOutput = {
  deleted: z.boolean(),
}

export function registerDeleteScene(server: McpServer, store: SceneStore): void {
  server.registerTool(
    'delete_scene',
    {
      title: 'Delete scene',
      description:
        'Delete a scene from the SceneStore by id. Optionally pass `expectedVersion` for optimistic concurrency.',
      inputSchema: deleteSceneInput,
      outputSchema: deleteSceneOutput,
    },
    async ({ id, expectedVersion }) => {
      try {
        const deleted = await store.delete(id, {
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        })
        const payload = { deleted }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        if (err instanceof SceneNotFoundError) {
          throwMcpError(ErrorCode.InvalidParams, 'scene_not_found', { id })
        }
        if (err instanceof SceneVersionConflictError) {
          throwMcpError(ErrorCode.InvalidRequest, 'version_conflict', {
            id,
            expectedVersion,
          })
        }
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InternalError, msg)
      }
    },
  )
}
