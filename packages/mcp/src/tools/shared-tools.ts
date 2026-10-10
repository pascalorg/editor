import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  AGENT_OPERATIONS,
  type AgentContext,
  type AgentHostRuntime,
  type AgentOperation,
  achievedChanges,
  applyAgentOutcome,
  furnishFromPlanQuestions,
  type SceneChanges,
  startOfSession,
  vectorizePlanTarget,
} from '@pascal-app/core/agent-operations'
import {
  addCornerWindowTool,
  addEntryDoorsTool,
  addFenceTool,
  addLevelTool,
  addSiteSurfaceTool,
  addStepsTool,
  addWallTool,
  applyUnitLayoutTool,
  calibratePlanReferenceTool,
  correctPlanReadingTool,
  createReferenceElementsTool,
  createRoofTool,
  createRoomTool,
  createStairsAndLiftsTool,
  createStairTool,
  deleteNodeTool,
  describeFacadeTool,
  disputeCoherenceItemTool,
  duplicateLevelTool,
  findByTypeTool,
  fitStairTool,
  furnishFromPlanTool,
  furnishRoomTool,
  getLevelSummaryTool,
  getNodeTool,
  getPlanReferenceTool,
  getWallsTool,
  getZonesTool,
  isAgentRefusal,
  listLevelsTool,
  locatePhotoTool,
  matchPlanReferenceTool,
  measureStairTool,
  mergeWindowsTool,
  nameUnitsTool,
  paintTool,
  placeInRoomTool,
  placeItemsTool,
  proposeUnitLayoutsTool,
  ROOM_TOOL_CONTRACTS,
  recordReferenceTool,
  refuse,
  runBatchTool,
  searchAssetsTool,
  searchMaterialsTool,
  setCheckpointTool,
  surveyPlanReferencesTool,
  VECTORIZE_PRICING,
  vectorizePlanTool,
  verifySceneTool,
} from '@pascal-app/core/agent-tools'
import type { PlanJudge } from '@pascal-app/core/building'
import {
  type AnyNode,
  type AnyNodeId,
  MaterialSchema,
  SceneMaterial,
} from '@pascal-app/core/schema'
import { z } from 'zod'
import type { Patch } from '../bridge/scene-bridge'
import type { SceneOperations } from '../operations'
import {
  ADDITIVE_OPEN_WORLD_TOOL_ANNOTATIONS,
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
    | typeof ADDITIVE_OPEN_WORLD_TOOL_ANNOTATIONS
    | typeof DESTRUCTIVE_TOOL_ANNOTATIONS
  outputSchema?: Record<string, z.ZodType>
  envelope?: (bridge: SceneOperations) => Record<string, unknown>
  /** Reads the host's item library: only these calls wait for it (the hosted one is a query). */
  catalog?: true
  /** Reads a plan: the host's judge answers its label questions first, its marked plan is drawn. */
  readsPlan?: true
  /** Vectorises a raster plan: the host's paid vectoriser answers first, never for an SVG plan. */
  vectorizesPlan?: true
}

/**
 * What a host lends the tools that read a plan (furnish_from_plan): a judge for what its labels
 * name, and a rasteriser for the marked plan. Without a judge the candidates go by size; without a
 * rasteriser the marked plan stays an SVG, in the structured result only (it is too long to read).
 */
export type PlanReadingHosts = {
  planJudge?: PlanJudge
  rasterizeSvg?: (svg: string) => Promise<{ data: string; mimeType: string }>
  /** A raster plan as SVG (vectorize_plan), paid; without it the tool refuses, unpaid. */
  vectorizePlan?: PlanVectorizer
  /** What the tool says a plan costs, for a host that charges otherwise (default: core's wording). */
  vectorizePlanPricing?: string
}

/** What a host's vectoriser reads (the plan's image and pixel size), and what it answers. */
export type PlanVectorizer = (
  plan: ReturnType<typeof vectorizePlanTarget>,
) => Promise<{ svg: string; model: string; cost?: string }>

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
    outputSchema: { node: jsonObject, materials: z.record(z.string(), SceneMaterial).optional() },
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
      coherence: z
        .object({ open: z.number(), disputed: z.number(), checklist: z.array(jsonObject) })
        .optional(),
      checkpoints: z.array(z.string()).optional(),
      since: jsonObject.optional(),
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
    contract: setCheckpointTool,
    operation: AGENT_OPERATIONS.set_checkpoint,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: disputeCoherenceItemTool,
    operation: AGENT_OPERATIONS.dispute_coherence_item,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: addWallTool,
    operation: AGENT_OPERATIONS.add_wall,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: addFenceTool,
    operation: AGENT_OPERATIONS.add_fence,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: addCornerWindowTool,
    operation: AGENT_OPERATIONS.add_corner_window,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: mergeWindowsTool,
    operation: AGENT_OPERATIONS.merge_windows,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: addSiteSurfaceTool,
    operation: AGENT_OPERATIONS.add_site_surface,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: addStepsTool,
    operation: AGENT_OPERATIONS.add_steps,
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
    contract: createRoofTool,
    operation: AGENT_OPERATIONS.create_roof,
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
    contract: furnishFromPlanTool,
    operation: AGENT_OPERATIONS.furnish_from_plan,
    annotations: ADDITIVE_OPEN_WORLD_TOOL_ANNOTATIONS,
    catalog: true,
    readsPlan: true,
  },
  {
    contract: vectorizePlanTool,
    operation: AGENT_OPERATIONS.vectorize_plan,
    annotations: ADDITIVE_OPEN_WORLD_TOOL_ANNOTATIONS,
    vectorizesPlan: true,
  },
  {
    contract: paintTool,
    operation: AGENT_OPERATIONS.paint,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
    outputSchema: {
      ok: z.literal(true),
      painted: z.array(z.object({ id: z.string(), roles: z.array(z.string()) })),
      finish: z.string(),
      materialId: z.string().optional(),
      material: MaterialSchema.optional(),
      createdMaterial: SceneMaterial.optional(),
      note: z.string().optional(),
      ...achievedOutput,
      ...liveSyncOutput,
    },
  },
  {
    contract: placeInRoomTool,
    operation: AGENT_OPERATIONS.place_in_room,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
    catalog: true,
    outputSchema: {
      ok: z.literal(true),
      itemId: z.string(),
      kind: z.string(),
      placed: z.object({ position: z.array(z.number()), rotationDeg: z.number() }),
      against: z.object({ edge: z.number(), wall: z.string() }).optional(),
      around: z.string().optional(),
      facing: z.string().optional(),
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
  {
    contract: searchMaterialsTool,
    operation: AGENT_OPERATIONS.search_materials,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
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
  {
    contract: getPlanReferenceTool,
    operation: AGENT_OPERATIONS.get_plan_reference,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    contract: calibratePlanReferenceTool,
    operation: AGENT_OPERATIONS.calibrate_plan_reference,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: matchPlanReferenceTool,
    operation: AGENT_OPERATIONS.match_plan_reference,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: surveyPlanReferencesTool,
    operation: AGENT_OPERATIONS.survey_plan_references,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    contract: createReferenceElementsTool,
    operation: AGENT_OPERATIONS.create_reference_elements,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: correctPlanReadingTool,
    operation: AGENT_OPERATIONS.correct_plan_reading,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: createStairsAndLiftsTool,
    operation: AGENT_OPERATIONS.create_stairs_and_lifts,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: addEntryDoorsTool,
    operation: AGENT_OPERATIONS.add_entry_doors,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: describeFacadeTool,
    operation: AGENT_OPERATIONS.describe_facade,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    contract: locatePhotoTool,
    operation: AGENT_OPERATIONS.locate_photo,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    contract: proposeUnitLayoutsTool,
    operation: AGENT_OPERATIONS.propose_unit_layouts,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    contract: applyUnitLayoutTool,
    operation: AGENT_OPERATIONS.apply_unit_layout,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: nameUnitsTool,
    operation: AGENT_OPERATIONS.name_units,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: recordReferenceTool,
    operation: AGENT_OPERATIONS.record_reference,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  },
  {
    contract: runBatchTool,
    operation: AGENT_OPERATIONS.run_batch,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
  },
]

export function toPatches(changes: SceneChanges): Patch[] {
  return [
    ...(changes.materials ?? []).map((material) => ({
      op: 'upsert_material' as const,
      material,
    })),
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

/** How an outcome reaches this bridge: its patches, its derived construction, its session record. */
export function agentRuntime(bridge: SceneOperations): AgentHostRuntime {
  return {
    getNodes: () => bridge.getNodes(),
    applyChanges: (changes) => {
      if (
        changes.materials?.length &&
        (bridge.supportsMaterialUpserts !== true || bridge.getMaterials?.() === undefined)
      )
        refuse(
          'materials_unavailable',
          'This host cannot atomically persist native materials; nothing was painted.',
        )
      const next = toPatches(changes)
      if (next.length) bridge.applyPatch(next)
    },
    reconcile: () => {
      bridge.deriveStructure()
    },
    keep: (keep) => bridge.agentSession?.keep(keep),
  }
}

export function registerSharedTools(
  server: McpServer,
  bridge: SceneOperations,
  catalog: AssetCatalog = builtInCatalog,
  // Read at each call, not at registration: a host may lend a tool's helper later (the tests do).
  hosts: PlanReadingHosts = {},
): void {
  for (const tool of SHARED_TOOLS) {
    server.registerTool(
      tool.contract.name,
      {
        title: tool.contract.title,
        description:
          tool.contract.name === vectorizePlanTool.name && hosts.vectorizePlanPricing
            ? tool.contract.description.replace(VECTORIZE_PRICING, hosts.vectorizePlanPricing)
            : tool.contract.description,
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
        // The agent's session begins with its first call, before anything is written.
        const first = bridge.agentSession && startOfSession(bridge.agentSession.read(), before)
        if (first) bridge.agentSession?.keep(first)
        const batchPlacesInRoom =
          tool.contract.name === runBatchTool.name &&
          Array.isArray(input.calls) &&
          input.calls.some(
            (call) =>
              typeof call === 'object' &&
              call !== null &&
              'tool' in call &&
              call.tool === placeInRoomTool.name,
          )
        const context: AgentContext = {
          activeLevelId: null,
          materials: bridge.supportsMaterialUpserts === true ? bridge.getMaterials?.() : undefined,
          session: bridge.agentSession?.read(),
          ...((tool.catalog || batchPlacesInRoom) && { catalog: await catalog() }),
        }
        if (tool.readsPlan && hosts.planJudge) {
          try {
            const questions = furnishFromPlanQuestions(before, input as never, context)
            const answers = questions.length ? await hosts.planJudge(questions) : []
            context.planAnswers = Object.fromEntries(
              questions.map((question, i) => [question.id, answers[i] ?? null]),
            )
          } catch {
            // No plan to ask about: the operation refuses with the reason.
          }
        }
        if (tool.vectorizesPlan && hosts.vectorizePlan) {
          let target: ReturnType<typeof vectorizePlanTarget> | null = null
          try {
            target = vectorizePlanTarget(before, input as never, context)
          } catch {
            // No raster plan to send: the operation refuses with the reason, and nothing is paid.
          }
          if (target)
            try {
              context.planVector = {
                guideId: target.guideId,
                ...(await hosts.vectorizePlan(target)),
              }
            } catch (error) {
              // A host that refuses (a plan it will not vectorise) gives its own code, unpaid.
              context.planVector = isAgentRefusal(error)
                ? { guideId: target.guideId, refusal: { code: error.code, message: error.message } }
                : {
                    guideId: target.guideId,
                    error: error instanceof Error ? error.message : String(error),
                  }
            }
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
            applyAgentOutcome(outcome, agentRuntime(bridge)),
          )
          persistence = persistencePayload(
            await publishLiveSceneSnapshot(bridge, tool.contract.name),
          )
        } else if (outcome.keep) {
          // A checkpoint: kept with the session, nothing in the scene to save.
          result = applyAgentOutcome(outcome, agentRuntime(bridge))
        }
        // What the scene holds after the call, not only what the call says it built.
        const achieved = outcome.changes ? achievedChanges(before, outcome.changes) : null
        const payload = {
          ...result,
          ...(achieved ? { achieved } : {}),
          ...(tool.envelope?.(bridge) ?? {}),
          ...persistence,
        }
        const { markedPlanSvg, ...shown } = payload as typeof payload & { markedPlanSvg?: string }
        if (typeof markedPlanSvg === 'string') {
          const image = hosts.rasterizeSvg
            ? await hosts.rasterizeSvg(markedPlanSvg).catch(() => null)
            : null
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify(shown) },
              ...(image
                ? [{ type: 'image' as const, data: image.data, mimeType: image.mimeType }]
                : []),
            ],
            structuredContent: image
              ? { ...shown, markedPlan: `data:${image.mimeType};base64,${image.data}` }
              : { ...shown, markedPlanSvg },
          }
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
