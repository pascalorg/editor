import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { ErrorCode, McpError, throwMcpError } from '../errors'
import { currentLevelContext, projectStatusPayload } from './metadata'

export const getProjectStatusInput = {
  id: z.string().min(1).max(64),
}

export const getProjectStatusOutput = {
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  editorUrl: z.string(),
  url: z.string(),
  ownerId: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  publishedVersion: z.number().nullable(),
  latestVersion: z.number().nullable(),
  draftVersion: z.number().nullable(),
  browserVisibleVersion: z.number().nullable(),
  version: z.number(),
  isEmpty: z.boolean(),
  sizeBytes: z.number(),
  nodeCount: z.number(),
  graphHash: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  levelIds: z.array(z.string()),
  defaultLevelId: z.string().nullable(),
  nextStep: z.string(),
}

export function registerGetProjectStatus(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'get_project_status',
    {
      title: 'Get project status',
      description:
        'Authoritative status/debug call for a Pascal project: editor URL, browser-visible version, latest saved version, published version, node count, and graph hash.',
      inputSchema: getProjectStatusInput,
      outputSchema: getProjectStatusOutput,
    },
    async ({ id }) => {
      try {
        const status = await operations.getProjectStatus(id)
        if (!status) {
          throwMcpError(ErrorCode.InvalidParams, 'project_not_found', { id })
        }
        const activeScene = operations.getActiveScene()
        if (activeScene?.id !== status.id) {
          const scene = await operations.loadStoredScene(status.id)
          if (scene) {
            operations.loadJSON(scene.graph)
            operations.setActiveScene(scene)
          }
        }
        const nextStep =
          status.nodeCount > 0
            ? 'Open editorUrl or continue editing, then save_scene again.'
            : 'Project is empty. Build a scene with semantic tools or create_from_template, then save_scene.'
        const payload = {
          ...projectStatusPayload(status, nextStep),
          ...currentLevelContext(operations),
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        if (err instanceof McpError) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InternalError, msg)
      }
    },
  )
}
