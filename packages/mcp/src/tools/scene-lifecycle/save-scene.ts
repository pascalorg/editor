import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { AnyNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { SceneVersionConflictError } from '../../storage/types'
import { ErrorCode, throwMcpError } from '../errors'
import { appendLiveSceneEvent } from '../live-sync'
import { currentLevelContext, sceneMetaPayload } from './metadata'

export const saveSceneInput = {
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  projectId: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
  saveMode: z
    .enum(['draft', 'checkpoint'])
    .default('draft')
    .describe(
      '`draft` updates the browser-visible working model without polluting version history. `checkpoint` creates a meaningful saved version.',
    ),
  publish: z
    .boolean()
    .optional()
    .describe('For checkpoint saves, publish the checkpoint as the browser-visible version.'),
  thumbnail: z.string().url().optional(),
  includeCurrentScene: z
    .boolean()
    .default(true)
    .describe('If true, save the bridge current scene. If false, use the graph arg.'),
  graph: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Full SceneGraph { nodes, rootNodeIds, collections? } to save instead of the bridge state.',
    ),
}

export const saveSceneOutput = {
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

export function registerSaveScene(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'save_scene',
    {
      title: 'Save scene',
      description:
        'Save the current scene (or a provided graph) to the SceneStore. Defaults to a browser-visible draft save so agents can iterate without creating many project versions. Use saveMode: "checkpoint" for meaningful version history.',
      inputSchema: saveSceneInput,
      outputSchema: saveSceneOutput,
    },
    async ({
      id,
      name,
      projectId,
      expectedVersion,
      saveMode,
      publish,
      thumbnail,
      includeCurrentScene,
      graph,
    }) => {
      let sceneGraph: SceneGraph
      if (includeCurrentScene) {
        const validation = bridge.validateScene()
        if (!validation.valid) {
          throwMcpError(ErrorCode.InvalidRequest, 'scene_invalid', { errors: validation.errors })
        }
        sceneGraph = bridge.exportSceneGraph()
      } else {
        if (!graph) {
          throwMcpError(
            ErrorCode.InvalidParams,
            'graph_required: pass `graph` when includeCurrentScene is false',
          )
        }
        // Security: revalidate every node with AnyNode schema (including the
        // AssetUrl allowlist) BEFORE persisting. Without this, the save_scene
        // graph arg is a bypass for the URL hardening in A7. See P4 report.
        const rawNodes = (graph as { nodes?: unknown }).nodes
        if (!rawNodes || typeof rawNodes !== 'object') {
          throwMcpError(ErrorCode.InvalidParams, 'graph.nodes must be an object')
        }
        const errors: { nodeId: string; path: string; message: string }[] = []
        for (const [nodeId, node] of Object.entries(rawNodes as Record<string, unknown>)) {
          const res = AnyNode.safeParse(node)
          if (!res.success) {
            for (const issue of res.error.issues) {
              errors.push({
                nodeId,
                path: issue.path.map(String).join('.'),
                message: issue.message,
              })
            }
          }
        }
        if (errors.length > 0) {
          throwMcpError(ErrorCode.InvalidParams, 'graph_invalid', { errors })
        }
        sceneGraph = graph as unknown as SceneGraph
      }

      try {
        const meta = await bridge.saveScene({
          ...(id !== undefined ? { id } : {}),
          name,
          ...(projectId !== undefined ? { projectId } : {}),
          graph: sceneGraph,
          ...(thumbnail !== undefined ? { thumbnailUrl: thumbnail } : {}),
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
          saveMode,
          ...(publish !== undefined ? { publish } : {}),
          operation: 'save_scene',
        })
        await appendLiveSceneEvent(bridge, meta.id, meta.version, 'save_scene', sceneGraph)
        if (includeCurrentScene) {
          bridge.setActiveScene(meta)
        }
        const payload = {
          ...sceneMetaPayload(meta, sceneGraph),
          ...currentLevelContext(bridge),
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        if (err instanceof SceneVersionConflictError) {
          throwMcpError(ErrorCode.InvalidRequest, 'version_conflict', {
            expectedVersion,
            id,
          })
        }
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InvalidRequest, msg)
      }
    },
  )
}
