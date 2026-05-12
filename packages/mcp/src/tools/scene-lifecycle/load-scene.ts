import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { ErrorCode, throwMcpError } from '../errors'
import { currentLevelContext, sceneMetaPayload } from './metadata'

export const loadSceneInput = {
  id: z.string().min(1).max(64),
}

export const loadSceneOutput = {
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
  url: z.string(),
  editorUrl: z.string(),
  published: z.boolean(),
  isDraft: z.boolean(),
  saveMode: z.enum(['draft', 'checkpoint']),
  graphHash: z.string().optional(),
  levelIds: z.array(z.string()),
  defaultLevelId: z.string().nullable(),
}

export function registerLoadScene(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'load_scene',
    {
      title: 'Load scene',
      description:
        'Load a scene from the SceneStore into the bridge. Returns the scene metadata. Throws `scene_not_found` if the id does not exist.',
      inputSchema: loadSceneInput,
      outputSchema: loadSceneOutput,
    },
    async ({ id }) => {
      const result = await bridge.loadStoredScene(id)
      if (!result) {
        throwMcpError(ErrorCode.InvalidParams, 'scene_not_found', { id })
      }
      try {
        bridge.loadJSON(result.graph)
        bridge.setActiveScene(result)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InvalidRequest, `load_failed: ${msg}`, { id })
      }
      const payload = {
        ...sceneMetaPayload(result, result.graph),
        ...currentLevelContext(bridge),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
