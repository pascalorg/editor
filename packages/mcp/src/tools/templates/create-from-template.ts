import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { cloneSceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import { rehydrateSiteChildren } from '../../lib/rehydrate-site-children'
import type { SceneOperations } from '../../operations'
import { isTemplateId, TEMPLATES, type TemplateId } from '../../templates'
import { ErrorCode, throwMcpError } from '../errors'
import { appendLiveSceneEvent } from '../live-sync'

export const createFromTemplateInput = {
  id: z
    .string()
    .describe(
      'Template id (see `list_templates`). Currently one of: "empty-studio", "two-bedroom", "garden-house".',
    ),
  name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Optional display name for the saved scene. Defaults to the template name.'),
  /**
   * When persistence operations are wired into the MCP server, set this flag to
   * `true` to immediately save the instantiated template and return its
   * `SceneMeta`. When `false` (default) the template is applied to the bridge
   * only.
   */
  save: z.boolean().default(false),
  projectId: z.string().optional(),
}

export const createFromTemplateOutput = {
  templateId: z.string(),
  rootNodeIds: z.array(z.string()),
  nodeCount: z.number(),
  /** Present when `save: true` (and a store was available). */
  scene: z
    .object({
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
    })
    .optional(),
}

/**
 * `create_from_template` — instantiate a seed template into the bridge, and
 * optionally persist it via the attached scene operations.
 *
 * The source template is cloned with fresh ids (`cloneSceneGraph`) so the
 * deterministic placeholders (`site_empty`, `wall_n`, …) don't collide
 * across repeated calls or with other scenes.
 */
export function registerCreateFromTemplate(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'create_from_template',
    {
      title: 'Create scene from template',
      description:
        'Instantiate a seed Pascal scene template into the bridge. Regenerates all ids before applying. When `save: true` and a SceneStore is wired, also persists the new scene and returns the SceneMeta.',
      inputSchema: createFromTemplateInput,
      outputSchema: createFromTemplateOutput,
    },
    async ({ id, name, save, projectId }) => {
      if (!isTemplateId(id)) {
        throwMcpError(
          ErrorCode.InvalidParams,
          `unknown_template: ${id}. Call list_templates for the set of valid ids.`,
        )
      }

      const entry = TEMPLATES[id as TemplateId]
      // Clone: regenerate ids so each instantiation is independent.
      // `cloneSceneGraph` flattens SiteNode.children to string ids; rehydrate
      // them back to embedded objects to satisfy the SiteNode schema (see
      // CROSS_CUTTING §2).
      const cloned = rehydrateSiteChildren(cloneSceneGraph(entry.template))
      const nodes = cloned.nodes as Record<AnyNodeId, AnyNode>
      const rootNodeIds = cloned.rootNodeIds as AnyNodeId[]

      try {
        bridge.setScene(nodes, rootNodeIds)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InternalError, `apply_failed: ${msg}`)
      }

      const basePayload = {
        templateId: entry.id,
        rootNodeIds: rootNodeIds as string[],
        nodeCount: Object.keys(nodes).length,
      }

      if (!save) {
        bridge.clearActiveScene()
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(basePayload) }],
          structuredContent: basePayload,
        }
      }

      if (!bridge.hasStore) {
        // Graceful no-store mode: report that save was skipped rather than
        // erroring — this makes the tool usable in headless bridge-only
        // deployments (tests, smoke scripts) without crashing.
        bridge.clearActiveScene()
        const payload = { ...basePayload, saveSkipped: true } as const
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      }

      try {
        const meta = await bridge.saveScene({
          name: name ?? entry.name,
          ...(projectId !== undefined ? { projectId } : {}),
          graph: { nodes, rootNodeIds },
        })
        bridge.setActiveScene(meta)
        await appendLiveSceneEvent(bridge, meta.id, meta.version, 'create_from_template', {
          nodes,
          rootNodeIds,
        })
        const scene = {
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
        const payload = { ...basePayload, scene }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InternalError, `save_failed: ${msg}`)
      }
    },
  )
}
