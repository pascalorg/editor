import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { cloneSceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import { rehydrateSiteChildren } from '../../lib/rehydrate-site-children'
import type { SceneOperations } from '../../operations'
import { isTemplateId, TEMPLATES, type TemplateId } from '../../templates'
import { ErrorCode, throwMcpError } from '../errors'
import { appendLiveSceneEvent } from '../live-sync'
import { currentLevelContext, sceneMetaPayload } from '../scene-lifecycle/metadata'

export const createHouseFromBriefInput = {
  brief: z.string().min(1),
  projectId: z.string().optional(),
  projectName: z.string().min(1).max(200).optional(),
  bedroomCount: z.number().int().min(0).max(12).optional(),
  rooms: z.array(z.string().min(1)).optional(),
  style: z.string().optional(),
  landscaping: z.boolean().optional(),
  constraints: z.string().optional(),
}

export const createHouseFromBriefOutput = {
  projectId: z.string().nullable(),
  editorUrl: z.string().nullable(),
  url: z.string().nullable(),
  version: z.number().nullable(),
  published: z.boolean(),
  isDraft: z.boolean(),
  templateId: z.string(),
  nodeCount: z.number(),
  roomCount: z.number(),
  levelIds: z.array(z.string()),
  defaultLevelId: z.string().nullable(),
  validation: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
  }),
  summary: z.string(),
  limitations: z.array(z.string()),
  nextStep: z.string(),
}

function chooseTemplate(args: {
  bedroomCount?: number
  rooms?: string[]
  landscaping?: boolean
}): TemplateId {
  const requested = new Set((args.rooms ?? []).map((room) => room.toLowerCase()))
  if (
    args.landscaping ||
    requested.has('garden') ||
    requested.has('patio') ||
    requested.has('yard')
  ) {
    return 'garden-house'
  }
  if ((args.bedroomCount ?? 0) <= 1) return 'empty-studio'
  if ((args.bedroomCount ?? 0) <= 2) return 'two-bedroom'
  return 'garden-house'
}

function countNodeTypes(nodes: Record<AnyNodeId, AnyNode>): {
  nodeCount: number
  roomCount: number
} {
  let roomCount = 0
  for (const node of Object.values(nodes)) {
    if (node.type === 'zone') roomCount++
  }
  return {
    nodeCount: Object.keys(nodes).length,
    roomCount,
  }
}

export function registerCreateHouseFromBrief(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'create_house_from_brief',
    {
      title: 'Create house from brief',
      description:
        'High-level hosted workflow for external agents: choose a starter house from a brief, create/save/publish it, and return the editor URL. Use semantic tools afterward for exact customization.',
      inputSchema: createHouseFromBriefInput,
      outputSchema: createHouseFromBriefOutput,
    },
    async ({
      brief,
      projectId,
      projectName,
      bedroomCount,
      rooms,
      style,
      landscaping,
      constraints,
    }) => {
      const templateId = chooseTemplate({
        ...(bedroomCount !== undefined ? { bedroomCount } : {}),
        ...(rooms !== undefined ? { rooms } : {}),
        ...(landscaping !== undefined ? { landscaping } : {}),
      })
      if (!isTemplateId(templateId)) {
        throwMcpError(ErrorCode.InternalError, `unknown_template: ${templateId}`)
      }

      const entry = TEMPLATES[templateId]
      const cloned = rehydrateSiteChildren(cloneSceneGraph(entry.template))
      const nodes = cloned.nodes as Record<AnyNodeId, AnyNode>
      const rootNodeIds = cloned.rootNodeIds as AnyNodeId[]
      const counts = countNodeTypes(nodes)

      try {
        bridge.setScene(nodes, rootNodeIds)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InternalError, `apply_failed: ${msg}`)
      }

      const rawValidation = bridge.validateScene()
      const validation = {
        valid: rawValidation.valid,
        errors: rawValidation.errors.map(
          (error) => `${error.nodeId}:${error.path}: ${error.message}`,
        ),
      }
      const limitations: string[] = []
      if ((bedroomCount ?? 0) > 2) {
        limitations.push(
          'MVP create_house_from_brief uses the closest built-in template for 3+ bedroom requests; refine with create_room/add_door/add_window for exact room count.',
        )
      }
      if (style || constraints) {
        limitations.push(
          'Style and constraints are recorded in the summary but not yet fully synthesized into custom geometry.',
        )
      }

      if (!bridge.hasStore) {
        const payload = {
          projectId: null,
          editorUrl: null,
          url: null,
          version: null,
          published: false,
          isDraft: false,
          templateId,
          nodeCount: counts.nodeCount,
          roomCount: counts.roomCount,
          ...currentLevelContext(bridge),
          validation,
          summary: `Applied ${entry.name} starter scene from brief: ${brief}`,
          limitations,
          nextStep:
            'No SceneStore is attached. Call save_scene later in a hosted MCP session to publish.',
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      }

      try {
        let saveProjectId = projectId
        if (!saveProjectId && bridge.canCreateProject) {
          const project = await bridge.createProject({ name: projectName ?? entry.name })
          saveProjectId = project.projectId
        }

        const meta = await bridge.saveScene({
          ...(saveProjectId !== undefined ? { id: saveProjectId, projectId: saveProjectId } : {}),
          name: projectName ?? entry.name,
          graph: { nodes, rootNodeIds },
          saveMode: 'draft',
          publish: false,
          operation: 'create_house_from_brief',
        })
        bridge.setActiveScene(meta)
        await appendLiveSceneEvent(bridge, meta.id, meta.version, 'create_house_from_brief', {
          nodes,
          rootNodeIds,
        })
        const scene = sceneMetaPayload(meta, { nodes, rootNodeIds })
        const payload = {
          projectId: scene.projectId ?? scene.id,
          editorUrl: scene.editorUrl,
          url: scene.url,
          version: scene.version,
          published: scene.published,
          isDraft: scene.isDraft,
          templateId,
          nodeCount: scene.nodeCount,
          roomCount: counts.roomCount,
          ...currentLevelContext(bridge),
          validation,
          summary: `Created ${scene.name} from ${entry.name}. Brief: ${brief}`,
          limitations,
          nextStep:
            'Call verify_scene and get_project_status. If the brief needs more specificity, refine with semantic tools and save_scene again.',
        }
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
