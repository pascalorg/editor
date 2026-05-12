import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { ErrorCode, throwMcpError } from '../errors'
import { currentLevelContext, projectStatusPayload } from './metadata'

export const createProjectInput = {
  name: z.string().min(1).max(200),
  id: z.string().min(1).max(64).optional(),
  isPrivate: z.boolean().default(true),
}

export const createProjectOutput = {
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

export function registerCreateProject(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Create a browser-visible Pascal project for the authenticated user. Use this before save_scene when the user asks for a new project.',
      inputSchema: createProjectInput,
      outputSchema: createProjectOutput,
    },
    async ({ name, id, isPrivate }) => {
      if (!operations.canCreateProject) {
        throwMcpError(
          ErrorCode.InvalidRequest,
          'create_project_unavailable: this MCP store cannot create hosted projects',
        )
      }
      try {
        const status = await operations.createProject({
          name,
          ...(id !== undefined ? { id } : {}),
          isPrivate,
        })
        operations.setActiveScene({
          id: status.id,
          name: status.name,
          projectId: status.projectId,
          ownerId: status.ownerId,
          thumbnailUrl: status.thumbnailUrl,
          version: status.version,
        })
        const payload = {
          ...projectStatusPayload(
            status,
            'The project is now bound to this MCP session. Open editorUrl now; semantic tools will update the browser-visible draft. Call save_scene with saveMode: "checkpoint" only when you want a meaningful version.',
          ),
          ...currentLevelContext(operations),
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InvalidRequest, msg)
      }
    },
  )
}
