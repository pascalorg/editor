import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  AGENT_OPERATIONS,
  type AgentOperation,
  type SceneChanges,
} from '@pascal-app/core/agent-operations'
import {
  deleteNodeTool,
  duplicateLevelTool,
  findByTypeTool,
  fitStairTool,
  getLevelSummaryTool,
  getNodeTool,
  getWallsTool,
  getZonesTool,
  listLevelsTool,
  measureStairTool,
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
import { registerCollectionTools } from './collections'
import { refusalResult } from './errors'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'

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
}

const jsonObject = z.record(z.string(), z.unknown())

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
      issues: z.array(z.object({ type: z.string(), message: z.string() })),
      hasIssues: z.boolean(),
    },
    envelope: (bridge) => ({ activeSceneId: bridge.getActiveScene()?.id ?? null }),
  },
  {
    contract: deleteNodeTool,
    operation: AGENT_OPERATIONS.delete_node,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    outputSchema: { deletedIds: z.array(z.string()), ...liveSyncOutput },
  },
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

export function registerSharedTools(server: McpServer, bridge: SceneOperations): void {
  for (const tool of SHARED_TOOLS) {
    server.registerTool(
      tool.contract.name,
      {
        title: tool.contract.title,
        description: tool.contract.description,
        inputSchema: tool.contract.input,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: tool.annotations,
      },
      async (input: Record<string, unknown>) => {
        let outcome: ReturnType<AgentOperation>
        try {
          outcome = tool.operation(bridge.getNodes() as Record<string, AnyNode>, input as never, {
            activeLevelId: null,
          })
        } catch (error) {
          return refusalResult(error)
        }
        const patches = outcome.changes ? toPatches(outcome.changes) : []
        let persistence = {}
        if (patches.length) {
          bridge.applyPatch(patches)
          persistence = persistencePayload(
            await publishLiveSceneSnapshot(bridge, tool.contract.name),
          )
        }
        const payload = { ...outcome.result, ...(tool.envelope?.(bridge) ?? {}), ...persistence }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      },
    )
  }
  registerCollectionTools(server, bridge)
}
