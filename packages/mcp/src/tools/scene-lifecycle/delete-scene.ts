import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { SceneNotFoundError, SceneVersionConflictError } from '../../storage/types'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from '../annotations'
import { ProtocolErrorCode, throwMcpError } from '../errors'

export const deleteSceneInput = {
  id: z.string().min(1).max(64),
  expectedVersion: z.number().int().positive().optional(),
}

export const deleteSceneOutput = {
  deleted: z.boolean(),
  hidden: z.boolean(),
  message: z.string().optional(),
}

export function registerDeleteScene(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'delete_scene',
    {
      title: 'Delete scene',
      description:
        "Remove a stored scene by id. In Pascal this never deletes the project: it hides it from Pascal's public listings until it is next saved with content, and answers `deleted: false, hidden: true` with a message; its owner can delete it from the projects page. Only someone who can manage the project may hide it. A local scene store deletes the scene. Optionally pass `expectedVersion` for optimistic concurrency.",
      inputSchema: z.object(deleteSceneInput),
      outputSchema: z.object(deleteSceneOutput),
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async ({ id, expectedVersion }) => {
      try {
        const payload = await operations.deleteStoredScene(id, {
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        if (err instanceof SceneNotFoundError) {
          throwMcpError(ProtocolErrorCode.InvalidParams, 'scene_not_found', { id })
        }
        if (err instanceof SceneVersionConflictError) {
          throwMcpError(ProtocolErrorCode.InvalidRequest, 'version_conflict', {
            id,
            expectedVersion,
          })
        }
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ProtocolErrorCode.InternalError, msg)
      }
    },
  )
}
