import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  AGENT_OPERATIONS,
  type AgentOperation,
  achievedChanges,
  applyAgentOutcome,
  type SceneChanges,
} from '@pascal-app/core/agent-operations'
import {
  addLevelTool,
  addWallTool,
  createRoomTool,
  createStairTool,
  deleteNodeTool,
  duplicateLevelTool,
  findByTypeTool,
  fitStairTool,
  furnishRoomTool,
  getLevelSummaryTool,
  getNodeTool,
  getWallsTool,
  getZonesTool,
  listLevelsTool,
  measureStairTool,
  placeItemsTool,
  ROOM_TOOL_CONTRACTS,
  searchAssetsTool,
  verifySceneTool,
} from '@pascal-app/core/agent-tools'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { Patch } from '../bridge/scene-bridge'
import type { SceneOperations } from '../operations'
import {
  ADDITIVE_TOOL_ANNOTATIONS,
  DESTRUCTIVE_TOOL_ANNOTATIONS,
  READ_ONLY_TOOL_ANNOTATIONS,
} from './annotations'
import { type AssetCatalog, builtInCatalog } from './asset-catalog'
import { registerCollectionTools } from './collections'
import { refusalResult } from './errors'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { ROOM_TOOL_ANNOTATIONS, type RoomToolName, structureOutput } from './structure-tools'

// Tools the MCP and the hosted chat share whole: one contract, one core operation. The MCP only
// applies the operation's changes through its bridge and adds its own facts (scene, persistence).

type SharedTool = {
  contract: { name: string; title: string; description: string; input: Record<string, z.ZodType> }
  operation: AgentOperation
  annotations:
    | typeof READ_ONLY_TOOL_ANNOTATIONS
    | typeof ADDITIVE_TOOL_ANNOTATIONS
    | typeof DESTRUCTIVE_TOOL_ANNOTATIONS
  outputSchema?: Record<string, z.ZodType>
  envelope?: (bridge: SceneOperations) => Record<string, unknown>
  /** Reads the host's item library: only these calls wait for it (the hosted one is a query). */
  catalog?: true
}

const jsonObject = z.record(z.string(), z.unknown())

/** What the scene holds after a mutating call (core achievedChanges). */
const achievedOutput = {
  achieved: z
    .object({
      created: z.record(z.string(), z.number()),
      updated: z.number(),
      deleted: z.record(z.string(), z.number()),
      unchanged: z.literal(true).optional(),
    })
    .optional(),
}

const levelRoleOutput = {
  levelId: z.string(),
  levelName: z.string().optional(),
  floorIndex: z.number(),
  role: z.string(),
  metadataRole: z.string().nullable(),
  isOccupiedStory: z.boolean(),
  isSupportLevel: z.boolean(),
  referenceLevelId: z.string().nullable(),
}

const SHARED_TOOLS: SharedTool[] = [
  {
    contract: measureStairTool,
    operation: AGENT_OPERATIONS.measure_stair,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    outputSchema: { measurements: z.json(), layouts: z.json() },
  },
  {
    contract: fitStairTool,
    operation: AGENT_OPERATIONS.fit_stair,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    outputSchema: { stairId: z.string().min(1), measurements: z.json(), ...liveSyncOutput },
  },
  {
    contract: findByTypeTool,
    operation: AGENT_OPERATIONS.find_by_type,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    contract: listLevelsTool,
    operation: AGENT_OPERATIONS.list_levels,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    outputSchema: {
      activeSceneId: z.string().nullable(),
      activeLevelId: z.string().nullable(),
      levelCount: z.number(),
      occupiedStoryCount: z.number(),
      supportLevelCount: z.number(),
      roofLevelIds: z.array(z.string()),
      levels: z.array(jsonObject),
    },
    envelope: (bridge) => ({ activeSceneId: bridge.getActiveScene()?.id ?? null }),
  },
  {
    contract: getNodeTool,
    operation: AGENT_OPERATIONS.get_node,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    outputSchema: { node: jsonObject },
  },
  {
    contract: getLevelSummaryTool,
    operation: AGENT_OPERATIONS.get_level_summary,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    outputSchema: {
      ...levelRoleOutput,
      counts: jsonObject,
      walls: z.array(jsonObject),
      zones: z.array(jsonObject),
      slabs: z.array(jsonObject),
      ceilings: z.array(jsonObject),
      items: z.array(jsonObject),
      openings: z.array(jsonObject),
      stairs: z.array(jsonObject),
      roofs: z.array(jsonObject),
      other: z.array(jsonObject),
    },
  },
  {
    contract: getWallsTool,
    operation: AGENT_OPERATIONS.get_walls,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    outputSchema: { levelId: z.string(), walls: z.array(jsonObject) },
  },
  {
    contract: getZonesTool,
    operation: AGENT_OPERATIONS.get_zones,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    outputSchema: { levelId: z.string(), zones: z.array(jsonObject) },
  },
  {
    contract: duplicateLevelTool,
    operation: AGENT_OPERATIONS.duplicate_level,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
    outputSchema: {
      newLevelId: z.string(),
      name: z.string().optional(),
      floorIndex: z.number(),
      shiftedLevelIds: z.array(z.string()),
      copied: z.record(z.string(), z.number()),
      skipped: z.record(z.string(), z.number()),
      newNodeIds: z.array(z.string()),
      // A floor copy is hundreds of ids: the result lists 40 and counts the rest.
      newNodeIdsOmitted: z.number().optional(),
      ...achievedOutput,
      ...liveSyncOutput,
    },
  },
  {
    contract: verifySceneTool,
    operation: AGENT_OPERATIONS.verify_scene,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    outputSchema: {
      ok: z.boolean(),
      valid: z.boolean(),
      levelCount: z.number(),
      occupiedStoryCount: z.number(),
      supportLevelCount: z.number(),
      roofLevelIds: z.array(z.string()),
      activeSceneId: z.string().nullable(),
      activeLevelId: z.string().nullable(),
      levels: z.array(jsonObject),
      emptyLevelIds: z.array(z.string()),
      issues: z.array(
        z.object({
          type: z.string(),
          message: z.string(),
          severity: z.literal('info').optional(),
          wallId: z.string().optional(),
          end: z.enum(['start', 'end']).optional(),
          reason: z.enum(['gap', 'crosses', 'parallel', 'rejected']).optional(),
          gap: z.number().optional(),
          nearestWallId: z.string().optional(),
        }),
      ),
      hasIssues: z.boolean(),
      authoredObjects: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            category: z.string(),
            reason: z.string().nullable(),
          }),
        )
        .optional(),
    },
    envelope: (bridge) => ({ activeSceneId: bridge.getActiveScene()?.id ?? null }),
  },
  {
    contract: addWallTool,
    operation: AGENT_OPERATIONS.add_wall,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: addLevelTool,
    operation: AGENT_OPERATIONS.add_level,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: createStairTool,
    operation: AGENT_OPERATIONS.create_stair,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: placeItemsTool,
    operation: AGENT_OPERATIONS.place_items,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
    catalog: true,
  },
  {
    contract: deleteNodeTool,
    operation: AGENT_OPERATIONS.delete_node,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    outputSchema: { deletedIds: z.array(z.string()), ...achievedOutput, ...liveSyncOutput },
  },
  {
    contract: createRoomTool,
    operation: AGENT_OPERATIONS.create_room,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
    outputSchema: {
      ok: z.literal(true),
      zoneId: z.string(),
      // The floor plate and the ceiling the host derived; null where it derives none (a terrace).
      slabId: z.string().nullable(),
      ceilingId: z.string().nullable(),
      // One per polygon edge; null where no wall runs along it.
      wallIds: z.array(z.string().nullable()),
      reusedWalls: z.number(),
      areaSqMeters: z.number(),
      doorIds: z.array(z.string()),
      windowIds: z.array(z.string()),
      skippedOpenings: z
        .array(
          z.object({
            kind: z.enum(['door', 'window']),
            index: z.number(),
            code: z.string(),
            message: z.string(),
          }),
        )
        .optional(),
      message: z.string(),
      ...achievedOutput,
      ...liveSyncOutput,
    },
  },
  {
    contract: furnishRoomTool,
    operation: AGENT_OPERATIONS.furnish_room,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
    catalog: true,
    outputSchema: {
      ok: z.literal(true),
      placed: z.number(),
      itemIds: z.array(z.string()),
      skipped: z.array(z.string()),
      doorWallIndex: z.number(),
      doorsDetected: z.number(),
      message: z.string(),
      ...achievedOutput,
      ...liveSyncOutput,
    },
  },
  {
    contract: searchAssetsTool,
    operation: AGENT_OPERATIONS.search_assets,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    catalog: true,
  },
  ...ROOM_TOOL_CONTRACTS.map((contract) => {
    const name = contract.name as RoomToolName
    return {
      contract,
      operation: AGENT_OPERATIONS[name],
      annotations: ROOM_TOOL_ANNOTATIONS[name],
      outputSchema: { ...structureOutput, ...achievedOutput },
    }
  }),
]

export function toPatches(changes: SceneChanges): Patch[] {
  return [
    ...(changes.create ?? []).map(({ node, parentId }) => ({
      op: 'create' as const,
      node,
      parentId: parentId as AnyNodeId | undefined,
    })),
    ...(changes.update ?? []).map(({ id, data }) => ({
      op: 'update' as const,
      id: id as AnyNodeId,
      data,
    })),
    ...(changes.delete ?? []).map((id) => ({
      op: 'delete' as const,
      id: id as AnyNodeId,
      cascade: true,
    })),
  ]
}

export function registerSharedTools(
  server: McpServer,
  bridge: SceneOperations,
  catalog: AssetCatalog = builtInCatalog,
): void {
  for (const tool of SHARED_TOOLS) {
    server.registerTool(
      tool.contract.name,
      {
        title: tool.contract.title,
        description: tool.contract.description,
        inputSchema: tool.contract.input,
        // Loose: a client that listed the tools rejects any field the schema leaves out, and the
        // operations in core grow fields (verify_scene's guesses) that this list would miss.
        ...(tool.outputSchema ? { outputSchema: z.looseObject(tool.outputSchema) } : {}),
        annotations: tool.annotations,
      },
      async (input: Record<string, unknown>) => {
        let outcome: ReturnType<AgentOperation>
        // A copy of the map: a host may write its own in place (the hosted bridge does), and a
        // "before" that grows with the call reads every creation as unchanged.
        const before = { ...(bridge.getNodes() as Record<string, AnyNode>) }
        const context = {
          activeLevelId: null,
          ...(tool.catalog && { catalog: await catalog() }),
        }
        try {
          outcome = tool.operation(before, input as never, context)
        } catch (error) {
          return refusalResult(error)
        }
        const patches = outcome.changes ? toPatches(outcome.changes) : []
        let result = outcome.result
        let persistence = {}
        if (patches.length) {
          result = bridge.runAsSingleHistoryStep(() =>
            applyAgentOutcome(outcome, {
              getNodes: () => bridge.getNodes(),
              applyChanges: (changes) => {
                const next = toPatches(changes)
                if (next.length) bridge.applyPatch(next)
              },
              reconcile: () => {
                bridge.deriveStructure()
              },
            }),
          )
          persistence = persistencePayload(
            await publishLiveSceneSnapshot(bridge, tool.contract.name),
          )
        }
        // What the scene holds after the call, not only what the call says it built.
        const achieved = outcome.changes ? achievedChanges(before, outcome.changes) : null
        const payload = {
          ...result,
          ...(achieved ? { achieved } : {}),
          ...(tool.envelope?.(bridge) ?? {}),
          ...persistence,
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      },
    )
  }
  registerCollectionTools(server, bridge)
}
