import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { AnyNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../../bridge/scene-bridge'
import { type SceneStore, SceneVersionConflictError } from '../../storage/types'
import { ErrorCode, throwMcpError } from '../errors'
import { appendLiveSceneEvent } from '../live-sync'

export const saveSceneInput = {
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  projectId: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
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
}

export function registerSaveScene(server: McpServer, bridge: SceneBridge, store: SceneStore): void {
  server.registerTool(
    'save_scene',
    {
      title: 'Save scene',
      description:
        'Persist the current scene (or a provided graph) to the SceneStore. Returns the SceneMeta along with a `url` pointing to `/scene/<id>`.',
      inputSchema: saveSceneInput,
      outputSchema: saveSceneOutput,
    },
    async ({ id, name, projectId, expectedVersion, thumbnail, includeCurrentScene, graph }) => {
      let sceneGraph: SceneGraph
      if (includeCurrentScene) {
        const validation = bridge.validateScene()
        if (!validation.valid) {
          throwMcpError(ErrorCode.InvalidRequest, 'scene_invalid', { errors: validation.errors })
        }
        const exported = bridge.exportJSON()
        sceneGraph = {
          nodes: exported.nodes,
          rootNodeIds: exported.rootNodeIds,
          collections: exported.collections as SceneGraph['collections'],
        }
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
        const meta = await store.save({
          ...(id !== undefined ? { id } : {}),
          name,
          ...(projectId !== undefined ? { projectId } : {}),
          graph: sceneGraph,
          ...(thumbnail !== undefined ? { thumbnailUrl: thumbnail } : {}),
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        })
        await appendLiveSceneEvent(store, meta.id, meta.version, 'save_scene', sceneGraph)
        if (includeCurrentScene) {
          bridge.setActiveScene(meta)
        }
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
          url: `/scene/${meta.id}`,
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
