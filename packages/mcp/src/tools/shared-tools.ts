import type { McpServer } from '@modelcontextprotocol/server'
import {
  type AddObjectInput,
  AGENT_OPERATIONS,
  type AgentContext,
  type AgentHostRuntime,
  type AgentOperation,
  type AssetViewLoader,
  achievedChanges,
  applyAgentOutcome,
  assetViewNeeds,
  assetViewsReadCatalog,
  briefReadsCatalog,
  buildBatchObjects,
  createAssetViewLoader,
  createFetchAssetViewIO,
  furnishingRefusal,
  type SceneChanges,
  startOfSession,
  writeCollections,
} from '@pascal-app/core/agent-operations'
import {
  type AgentToolAnnotations,
  type AgentToolContract,
  addCornerWindowTool,
  addFenceTool,
  addLevelTool,
  addObjectTool,
  addWallTool,
  createRoofTool,
  createRoomTool,
  createStairTool,
  type DesignBrief,
  deleteNodeTool,
  designBriefTool,
  duplicateLevelTool,
  findByTypeTool,
  fitStairTool,
  furnishRoomTool,
  getLevelSummaryTool,
  getNodeTool,
  getSiteTool,
  getWallsTool,
  getZonesTool,
  listLevelsTool,
  measureStairTool,
  mergeWindowsTool,
  moveRoofsToRoofLevelTool,
  paintTool,
  placeBuildingTool,
  placeDesignTool,
  placeInRoomTool,
  placeItemsTool,
  ROOM_TOOL_CONTRACTS,
  refuse,
  runBatchTool,
  searchAssetsTool,
  searchMaterialsTool,
  setCheckpointTool,
  setGroundLevelTool,
  validateDesignTool,
  verifySceneTool,
  viewAssetsTool,
} from '@pascal-app/core/agent-tools'
import { DesignValidationSchema } from '@pascal-app/core/procedural-items'
import { untracked } from '@pascal-app/core/runtime'
import {
  type AnyNode,
  type AnyNodeId,
  type CompiledGeometryScript,
  MaterialSchema,
  SceneMaterial,
} from '@pascal-app/core/schema'
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
import { inScene } from './scene-scope'
import { ROOM_TOOL_ANNOTATIONS, type RoomToolName, structureOutput } from './structure-tools'

// Tools the MCP and the hosted chat share whole: one contract, one core operation. The MCP only
// applies the operation's changes through its bridge and adds its own facts (scene, persistence).

/**
 * A tool the server runs as a core-style operation: parse with the contract, plan with the
 * operation, apply its changes through the bridge in one history step, answer with what the scene
 * then holds. `annotations` are the host's to choose from its own review of the operation; a
 * plugin contract's `annotations` are only its hints.
 */
export type OperationTool = {
  contract: AgentToolContract
  operation: AgentOperation
  annotations: AgentToolAnnotations
  outputSchema?: Record<string, z.ZodType>
  envelope?: (bridge: SceneOperations) => Record<string, unknown>
  /** Reads the host's item library: only these calls wait for it (the hosted one is a query). */
  catalog?: true
}

export type PlanReadingHosts = {
  /** Reads catalog pictures and surfaces before view_assets and paint. */
  assetViews?: AssetViewLoader
  /** Compiles one add_object module for a batch before the synchronous operations run. */
  buildObject?: (input: Omit<AddObjectInput, 'compiled'>) => Promise<CompiledGeometryScript>
}

const defaultAssetViews = createAssetViewLoader(createFetchAssetViewIO())

type SharedTool = OperationTool & {
  annotations:
    | typeof READ_ONLY_TOOL_ANNOTATIONS
    | typeof ADDITIVE_TOOL_ANNOTATIONS
    | typeof DESTRUCTIVE_TOOL_ANNOTATIONS
}

const jsonObject = z.record(z.string(), z.unknown())

function refuseScripts(): never {
  refuse('scripts_unavailable', 'This Pascal server cannot run geometry scripts.')
}

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
    contract: validateDesignTool,
    operation: AGENT_OPERATIONS.validate_design,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    outputSchema: DesignValidationSchema.shape,
  },
  {
    contract: placeDesignTool,
    operation: AGENT_OPERATIONS.place_design,
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
    outputSchema: {
      designId: z.string(),
      parentId: z.string(),
      surfaceId: z.string().nullable(),
      ...liveSyncOutput,
    },
  },
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
    outputSchema: {
      node: jsonObject,
      ancestorIds: z.array(z.string()),
      missingChildIds: z.array(z.string()).optional(),
      materials: z.record(z.string(), SceneMaterial).optional(),
    },
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
    contract: setGroundLevelTool,
    operation: AGENT_OPERATIONS.set_ground_level,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    outputSchema: {
      ok: z.boolean(),
      levelId: z.string(),
      buildingId: z.string(),
      floorElevation: z.number(),
      gradeElevation: z.number().optional(),
      movedBuildingBy: z.number().optional(),
      renumbered: z.boolean().optional(),
      unchanged: z.boolean().optional(),
      message: z.string(),
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
      // Typed by `type`; a check registered with verify_scene may add fields of its own.
      issues: z.array(
        z.looseObject({
          type: z.string(),
          message: z.string(),
          severity: z.literal('info').optional(),
          nodeId: z.string().optional(),
          path: z.string().optional(),
          zoneId: z.string().optional(),
          wallIds: z.array(z.string()).optional(),
          area: z.number().optional(),
          at: z.tuple([z.number(), z.number()]).optional(),
          wallId: z.string().optional(),
          slabId: z.string().optional(),
          levelId: z.string().optional(),
          wallTop: z.number().optional(),
          slabUnderside: z.number().optional(),
          slabTop: z.number().optional(),
          penetration: z.number().optional(),
          coplanar: z.boolean().optional(),
          end: z.enum(['start', 'end']).optional(),
          reason: z.enum(['gap', 'crosses', 'parallel', 'rejected']).optional(),
          gap: z.number().optional(),
          nearestWallId: z.string().optional(),
        }),
      ),
      hasIssues: z.boolean(),
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
    contract: designBriefTool,
    operation: AGENT_OPERATIONS.design_brief,
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
    contract: moveRoofsToRoofLevelTool,
    operation: AGENT_OPERATIONS.move_roofs_to_roof_level,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
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
    contract: paintTool,
    operation: AGENT_OPERATIONS.paint,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
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
    contract: getSiteTool,
    operation: AGENT_OPERATIONS.get_site,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    contract: placeBuildingTool,
    operation: AGENT_OPERATIONS.place_building,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    outputSchema: {
      buildingId: z.string(),
      moved: z.boolean(),
      fit: z.enum(['buildable', 'lot', 'outside']),
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
    contract: viewAssetsTool,
    operation: AGENT_OPERATIONS.view_assets,
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
    contract: runBatchTool,
    operation: AGENT_OPERATIONS.run_batch,
    annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
  },
]

export function toPatches(changes: SceneChanges): Patch[] {
  return [
    ...(changes.materials ?? []).map((material) => ({ op: 'upsert_material' as const, material })),
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
      if (changes.collections && Object.keys(changes.collections).length)
        // Copying the others is not a read: the operation recorded what it read of them.
        bridge.setCollections(
          writeCollections(untracked(bridge.getCollections()), changes.collections),
        )
    },
    reconcile: () => {
      bridge.deriveStructure()
    },
    keep: (keep) => bridge.agentSession?.keep(keep),
  }
}

export function briefInForce(bridge: SceneOperations): DesignBrief | null | undefined {
  if (bridge.designBriefRequired === false) return undefined
  const session = bridge.agentSession
  return session ? (session.read().designBrief ?? null) : undefined
}

function writesScene(changes: SceneChanges | undefined): boolean {
  return Boolean(
    changes &&
      (toPatches(changes).length ||
        (changes.collections && Object.keys(changes.collections).length)),
  )
}

export function registerSharedTools(
  server: McpServer,
  bridge: SceneOperations,
  catalog: AssetCatalog = builtInCatalog,
  hosts: PlanReadingHosts = {},
): void {
  for (const tool of SHARED_TOOLS) registerOperationTool(server, bridge, tool, catalog, hosts)
  registerCollectionTools(server, bridge)
}

/**
 * Registers one operation tool, as the shared tools are: a host adds a plugin's `'operation'`
 * tools with it, from the plugin's `./agent-tools` contract and `./agent-operations` operation.
 */
export function registerOperationTool(
  server: McpServer,
  bridge: SceneOperations,
  tool: OperationTool,
  catalog: AssetCatalog = builtInCatalog,
  hosts: PlanReadingHosts = {},
): void {
  server.registerTool(
    tool.contract.name,
    {
      title: tool.contract.title,
      description: tool.contract.description,
      inputSchema: z.object(tool.contract.input),
      // Loose: a client that listed the tools rejects any field the schema leaves out, and the
      // operations in core grow fields (verify_scene's guesses) that this list would miss.
      ...(tool.outputSchema ? { outputSchema: z.looseObject(tool.outputSchema) } : {}),
      annotations: tool.annotations,
    },
    async (input: Record<string, unknown>) => {
      let outcome: ReturnType<AgentOperation>
      const nodes = bridge.getNodes() as Record<string, AnyNode>
      // A copy of the map: a host may write its own in place (the hosted bridge does), and a
      // "before" that grows with the call reads every creation as unchanged. Copying is not a
      // read: on a detached scene, the operation records what it selects.
      const before = { ...untracked(nodes) }
      // The agent's session begins with its first call, before anything is written.
      const first = bridge.agentSession && startOfSession(bridge.agentSession.read(), before)
      if (first) bridge.agentSession?.keep(first)
      // Gate before catalog I/O or module compilation.
      const designBrief = briefInForce(bridge)
      if (designBrief !== undefined) {
        const refusal = furnishingRefusal(tool.contract.name, input, designBrief)
        if (refusal) return refusalResult(refusal)
      }
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
      const batchesObjects =
        tool.contract.name === runBatchTool.name &&
        Array.isArray(input.calls) &&
        input.calls.some(
          (call) =>
            typeof call === 'object' &&
            call !== null &&
            'tool' in call &&
            call.tool === addObjectTool.name,
        )
      const context: AgentContext = {
        activeLevelId: bridge.activeLevelId?.() ?? null,
        ...(bridge.supportsMaterialUpserts && bridge.getMaterials
          ? { materials: bridge.getMaterials() }
          : {}),
        ...(bridge.nodeSchema && { nodeSchema: (kind: string) => bridge.nodeSchema!(kind) }),
        session: bridge.agentSession?.read(),
        ...(designBrief !== undefined && { designBrief }),
        ...((tool.catalog ||
          batchPlacesInRoom ||
          assetViewsReadCatalog(tool.contract.name, input) ||
          briefReadsCatalog(tool.contract.name, input)) && { catalog: await catalog() }),
        ...(batchesObjects && {
          batchObjects: await buildBatchObjects(
            input.calls as { tool?: unknown; input?: unknown }[],
            hosts.buildObject ?? refuseScripts,
          ),
        }),
      }
      const needs = assetViewNeeds(before, tool.contract.name, input, context)
      if (needs.subjects.length)
        context.assetViews = await (hosts.assetViews ?? defaultAssetViews)(needs.subjects, {
          pictures: needs.pictures,
        })
      try {
        outcome = inScene(bridge, () => tool.operation(nodes, input as never, context))
      } catch (error) {
        return refusalResult(error)
      }
      let result = outcome.result
      let persistence = {}
      // An outcome edits the scene through its node changes, its collection writes, or the
      // follow-up it plans once the host has reconciled; any of them is one history step.
      if (writesScene(outcome.changes) || outcome.afterReconcile) {
        result = bridge.runAsSingleHistoryStep(() =>
          applyAgentOutcome(outcome, agentRuntime(bridge)),
        )
        persistence = persistencePayload(await publishLiveSceneSnapshot(bridge, tool.contract.name))
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
      const { previews, ...shown } = payload as typeof payload & {
        previews?: { label: string; image: string }[]
      }
      const pictures = (Array.isArray(previews) ? previews : []).flatMap(({ label, image }) => {
        const [, mimeType, data] = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(image) ?? []
        return mimeType && data
          ? [
              { type: 'text' as const, text: label },
              { type: 'image' as const, data, mimeType },
            ]
          : []
      })
      if (pictures.length)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(shown) }, ...pictures],
          structuredContent: shown,
        }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
