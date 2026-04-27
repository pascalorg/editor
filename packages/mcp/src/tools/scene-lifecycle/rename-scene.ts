import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { SceneNotFoundError, SceneVersionConflictError } from '../../storage/types'
import { ErrorCode, throwMcpError } from '../errors'

export const renameSceneInput = {
  id: z.string().min(1).max(64),
  newName: z.string().min(1).max(200),
  expectedVersion: z.number().int().positive().optional(),
}

export const renameSceneOutput = {
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
}

export function registerRenameScene(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'rename_scene',
    {
      title: 'Rename scene',
      description:
        'Rename a scene in the SceneStore. Returns the updated SceneMeta. Optionally pass `expectedVersion` for optimistic concurrency.',
      inputSchema: renameSceneInput,
      outputSchema: renameSceneOutput,
    },
    async ({ id, newName, expectedVersion }) => {
      try {
        const meta = await operations.renameStoredScene(id, newName, {
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        })
        const payload = {
          id: meta.id,
          name: meta.name,
          projectId: meta.projectId,
          thumbnailUrl: meta.thumbnailUrl,
          version: meta.version,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          ownerId: meta.ownerId,
          sizeBytes: meta.sizeBytes,
          nodeCount: meta.nodeCount,
        }
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
