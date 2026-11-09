import type { McpServer } from '@modelcontextprotocol/server'
import {
  applySceneWrites,
  type NodeWrite,
  seatWrittenRoofs,
} from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { migrateLegacyWallAssemblies } from '@pascal-app/core/scene-migrations'
import { AnyNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { SceneVersionConflictError } from '../../storage/types'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from '../annotations'
import { ProtocolErrorCode, throwMcpError, toolError } from '../errors'
import { appendLiveSceneEvent } from '../live-sync'
import { currentLevelContext, sceneMetaPayload } from './metadata'

export const saveSceneInput = {
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  projectId: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
  replace: z
    .boolean()
    .optional()
    .describe(
      "Write this session's scene over a project or scene it was not loaded from, replacing what that one holds.",
    ),
  saveMode: z
    .enum(['draft', 'checkpoint'])
    .default('draft')
    .describe(
      '`draft` updates the browser-visible working model without polluting version history. `checkpoint` creates a meaningful saved version; it does not publish.',
    ),
  publish: z
    .boolean()
    .optional()
    .describe(
      "Hosted Pascal: also publish this checkpoint, making it the version the project's viewers see. Only when the user asks to publish.",
    ),
  thumbnail: z.string().url().optional(),
  includeCurrentScene: z
    .boolean()
    .default(true)
    .describe('If true, save the bridge current scene. If false, use the graph arg.'),
  graph: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Full SceneGraph { nodes, rootNodeIds, collections? } to save instead of the bridge state. Judged against the scene it is saved over (the session's scene when the save goes to it, else the stored scene `id` names) as apply_patch is: a roof it puts on the walls of the storey holding it goes to the level above them, said in notes, and storey content on a roof level is refused. A graph with no scene under it is saved as it is.",
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
  /** What the server changed in a provided graph before saving it, one line each. */
  notes: z.array(z.string()).optional(),
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A graph as writes over the scene in hand, so a rule on writes judges only what it changes. */
function writesOver(
  scene: Readonly<Record<string, AnyNode>>,
  nodes: Readonly<Record<string, AnyNode>>,
): NodeWrite[] {
  const writes: NodeWrite[] = []
  for (const node of Object.values(nodes)) {
    const prior = scene[node.id] as Record<string, unknown> | undefined
    if (!prior) {
      writes.push({ op: 'create', node })
      continue
    }
    const next = node as Record<string, unknown>
    const data = Object.fromEntries(
      [...new Set([...Object.keys(prior), ...Object.keys(next)])]
        .filter((key) => !same(prior[key], next[key]))
        .map((key) => [key, next[key]]),
    )
    if (Object.keys(data).length) writes.push({ op: 'update', id: node.id, data })
  }
  for (const id of Object.keys(scene)) if (!nodes[id]) writes.push({ op: 'delete', id })
  return writes
}

/**
 * The scene a provided graph is saved over, as it stands: the session's when the save goes to the
 * scene in hand, else the stored one. Null for a new scene: a graph with nothing under it is saved
 * as it is, its roofs never judged against an unrelated scene (a legacy project saved from a fresh
 * session would otherwise read as all new writes, and be migrated or refused).
 */
async function savedOver(
  bridge: SceneOperations,
  target: { id?: string; projectId?: string },
): Promise<Readonly<Record<string, AnyNode>> | null> {
  const active = bridge.getActiveScene()
  const inHand =
    active &&
    (target.id !== undefined
      ? active.id === target.id
      : target.projectId !== undefined && active.projectId === target.projectId)
  if (inHand) return bridge.getNodes() as Record<string, AnyNode>
  if (target.id === undefined) return null
  const stored = await bridge.loadStoredScene(target.id).catch(() => null)
  return (stored?.graph.nodes as Record<string, AnyNode> | undefined) ?? null
}

/** A saved scene that is more than the default site, building and level. */
const HOLDS_CONTENT = 3

/**
 * The session's scene goes over a project or scene only when it was loaded from it (or created
 * for it). After a server reload a session starts over on a blank scene, and saving it by id wrote
 * it over the project's draft (2026-10-03: 8 levels and 10 imported plans lost).
 */
async function requireSceneLoadedFrom(
  bridge: SceneOperations,
  target: { id?: string; projectId?: string },
) {
  if (target.id === undefined && target.projectId === undefined) return
  const active = bridge.getActiveScene()
  if (target.id !== undefined ? active?.id === target.id : active?.projectId === target.projectId)
    return
  const nodeCount =
    target.projectId !== undefined && bridge.canGetProjectStatus
      ? ((await bridge.getProjectStatus(target.projectId))?.nodeCount ?? 0)
      : target.id !== undefined
        ? Object.keys((await bridge.loadStoredScene(target.id))?.graph.nodes ?? {}).length
        : 0
  if (nodeCount <= HOLDS_CONTENT) return
  throwMcpError(
    ProtocolErrorCode.InvalidRequest,
    `scene_not_loaded: this session's scene was not loaded from ${target.projectId ?? target.id}, which holds ${nodeCount} nodes — the server may have reloaded and this session started over. Call load_scene with it first, or pass replace: true to write this scene over it.`,
    { ...target, nodeCount },
  )
}

export function registerSaveScene(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'save_scene',
    {
      title: 'Save scene',
      description:
        'Save the current scene (or a provided graph) to the SceneStore. Without id or projectId it saves to the project this session is bound to (create_project or load_scene). Defaults to a browser-visible draft save so agents can iterate without creating many project versions. Use saveMode: "checkpoint" for meaningful version history.',
      inputSchema: z.object(saveSceneInput),
      outputSchema: z.object(saveSceneOutput),
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
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
      replace,
    }) => {
      // Without a target, the session's scene goes where it came from (create_project, load_scene,
      // an earlier save). An agent was refused "Call create_project first" on its first save, right
      // after create_project bound the session to its project.
      const bound =
        includeCurrentScene && id === undefined && projectId === undefined
          ? bridge.getActiveScene()
          : null
      if (bound) {
        id = bound.id
        projectId = bound.projectId ?? undefined
      }
      let sceneGraph: SceneGraph
      let notes: string[] = []
      if (includeCurrentScene && !replace) await requireSceneLoadedFrom(bridge, { id, projectId })
      if (includeCurrentScene) {
        const validation = bridge.validateScene()
        if (!validation.valid) {
          throwMcpError(ProtocolErrorCode.InvalidRequest, 'scene_invalid', {
            errors: validation.errors,
          })
        }
        sceneGraph = bridge.exportSceneGraph()
      } else {
        if (!graph) {
          throwMcpError(
            ProtocolErrorCode.InvalidParams,
            'graph_required: pass `graph` when includeCurrentScene is false',
          )
        }
        // Security: revalidate every node with AnyNode schema (including the
        // AssetUrl allowlist) BEFORE persisting. Without this, the save_scene
        // graph arg is a bypass for the URL hardening in A7. See P4 report.
        const rawNodes = (graph as { nodes?: unknown }).nodes
        if (!rawNodes || typeof rawNodes !== 'object') {
          throwMcpError(ProtocolErrorCode.InvalidParams, 'graph.nodes must be an object')
        }
        const migration = migrateLegacyWallAssemblies(rawNodes as Record<string, unknown>)
        const errors: { nodeId: string; path: string; message: string }[] = []
        for (const [nodeId, node] of Object.entries(migration.nodes)) {
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
          throwMcpError(ProtocolErrorCode.InvalidParams, 'graph_invalid', { errors })
        }
        // The roof-level rule, as apply_patch holds it: what the graph changes in the scene it
        // replaces.
        const scene = await savedOver(bridge, { id, projectId })
        let nodes = migration.nodes as Record<string, AnyNode>
        if (scene) {
          const writes = writesOver(scene, nodes)
          const written = writes.length
          try {
            notes = seatWrittenRoofs(writes, scene)
          } catch (error) {
            if (!isAgentRefusal(error)) throw error
            // An index into the graph's writes means nothing to the caller; the ids do.
            const { index: _index, ...details } = error.details
            return toolError(error.message, { code: error.code, ...details })
          }
          nodes = applySceneWrites(nodes, writes.slice(written))
        }
        sceneGraph = { ...graph, nodes } as unknown as SceneGraph
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
          ...(notes.length ? { notes } : {}),
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        if (err instanceof SceneVersionConflictError) {
          throwMcpError(ProtocolErrorCode.InvalidRequest, 'version_conflict', {
            expectedVersion,
            id,
          })
        }
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ProtocolErrorCode.InvalidRequest, msg)
      }
    },
  )
}
