import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { forkSceneGraph, type SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { type AnyNode, AnyNode as AnyNodeSchema } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../../bridge/scene-bridge'
import type { SceneStore } from '../../storage/types'
import { ErrorCode, throwMcpError } from '../errors'
import { applyMutation, describeVariant, type MutationKind, mulberry32 } from './mutations'

const MUTATION_KINDS = [
  'wall-thickness',
  'wall-height',
  'zone-labels',
  'room-proportions',
  'open-plan',
  'door-positions',
  'fence-style',
] as const

export const generateVariantsInput = {
  baseSceneId: z
    .string()
    .optional()
    .describe('If set, fork from this saved scene; else fork from current bridge state.'),
  count: z.number().int().min(1).max(10).default(3),
  vary: z.array(z.enum(MUTATION_KINDS)).min(1).default(['wall-thickness', 'wall-height']),
  seed: z.number().int().optional().describe('Deterministic RNG seed.'),
  save: z
    .boolean()
    .default(false)
    .describe('If true, also save each variant via SceneStore and return ids.'),
}

export const generateVariantsOutput = {
  variants: z.array(
    z.object({
      index: z.number(),
      description: z.string(),
      nodeCount: z.number(),
      sceneId: z.string().optional(),
      url: z.string().optional(),
      graph: z.any().optional(),
    }),
  ),
}

/**
 * `forkSceneGraph` normalises `SiteNode.children` to string IDs, but the
 * `SiteNode` schema declares that field as an array of full `BuildingNode` /
 * `ItemNode` objects (see CROSS_CUTTING §2). To keep variants validating
 * against `AnyNode`, re-embed the site children from the flat dict.
 *
 * Pure: returns a new graph without mutating the input.
 */
function rehydrateSiteChildren(graph: SceneGraph): SceneGraph {
  const out: SceneGraph = {
    nodes: { ...graph.nodes },
    rootNodeIds: [...graph.rootNodeIds],
    ...(graph.collections ? { collections: graph.collections } : {}),
  }
  for (const [id, node] of Object.entries(out.nodes)) {
    if (node.type !== 'site') continue
    const childrenField = (node as { children?: unknown[] }).children
    if (!Array.isArray(childrenField)) continue
    const rehydrated: AnyNode[] = []
    for (const child of childrenField) {
      if (typeof child === 'string') {
        const target = out.nodes[child as keyof typeof out.nodes]
        if (target && (target.type === 'building' || target.type === 'item')) {
          rehydrated.push(target)
        }
      } else if (child && typeof child === 'object' && 'id' in (child as Record<string, unknown>)) {
        rehydrated.push(child as AnyNode)
      }
    }
    out.nodes[id as keyof typeof out.nodes] = {
      ...(node as AnyNode),
      children: rehydrated,
    } as AnyNode
  }
  return out
}

/**
 * Count how many nodes in a graph fail `AnyNode` validation. Used to keep the
 * tool from returning silently corrupt variants.
 */
function countInvalidNodes(graph: SceneGraph): number {
  let invalid = 0
  for (const node of Object.values(graph.nodes)) {
    if (!AnyNodeSchema.safeParse(node).success) invalid++
  }
  return invalid
}

export function registerGenerateVariants(
  server: McpServer,
  bridge: SceneBridge,
  store: SceneStore,
): void {
  server.registerTool(
    'generate_variants',
    {
      title: 'Generate variants',
      description:
        'Generate N variations of a base scene by forking and applying seeded mutations. Example: "give me 5 variations of this kitchen". If `save=true`, each variant is persisted via the SceneStore and returned with an id + URL; otherwise the graph is returned inline.',
      inputSchema: generateVariantsInput,
      outputSchema: generateVariantsOutput,
    },
    async ({ baseSceneId, count, vary, seed, save }) => {
      // 1. Obtain the base SceneGraph.
      let base: SceneGraph
      let baseName = 'scene'
      if (baseSceneId) {
        const loaded = await store.load(baseSceneId)
        if (!loaded) {
          throwMcpError(ErrorCode.InvalidParams, 'scene_not_found', { id: baseSceneId })
        }
        base = loaded.graph
        baseName = loaded.name
      } else {
        const exported = bridge.exportJSON()
        base = {
          nodes: exported.nodes,
          rootNodeIds: exported.rootNodeIds,
          collections: exported.collections as SceneGraph['collections'],
        }
      }

      // 2. Seed the RNG. Default seed is a time-ish number so runs vary, but
      //    tests always pass a fixed seed for determinism.
      const initialSeed = seed ?? Math.floor(Math.random() * 0xffffffff)

      const mutations = vary as MutationKind[]
      const variants: Array<{
        index: number
        description: string
        nodeCount: number
        sceneId?: string
        url?: string
        graph?: SceneGraph
      }> = []

      for (let i = 0; i < count; i++) {
        // Each variant gets its own RNG stream derived from (seed + i) so
        // results are deterministic per-index.
        const rng = mulberry32(initialSeed + i)

        let forked: SceneGraph = forkSceneGraph(base)
        for (const kind of mutations) {
          forked = applyMutation(forked, rng, kind)
        }
        // Re-embed site children so variants match the SiteNode schema.
        forked = rehydrateSiteChildren(forked)

        const invalidCount = countInvalidNodes(forked)
        if (invalidCount > 0) {
          throwMcpError(
            ErrorCode.InternalError,
            `variant_invalid: variant ${i} produced ${invalidCount} invalid node(s)`,
            { index: i },
          )
        }

        const nodeCount = Object.keys(forked.nodes).length
        const description = describeVariant(forked, mutations)

        if (save) {
          try {
            const meta = await store.save({
              name: `${baseName}-variant-${i + 1}`,
              graph: forked,
            })
            variants.push({
              index: i,
              description,
              nodeCount,
              sceneId: meta.id,
              url: `/scene/${meta.id}`,
            })
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            throwMcpError(ErrorCode.InternalError, `save_failed: ${msg}`, { index: i })
          }
        } else {
          variants.push({ index: i, description, nodeCount, graph: forked })
        }
      }

      const payload = { variants }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
