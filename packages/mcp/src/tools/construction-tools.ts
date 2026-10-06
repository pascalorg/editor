import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  adjacentLevelId,
  createZone,
  cutFloorOpening,
  generateId,
  measureStair,
  planStairCreation,
  planStairPreset,
  planStairSizingEdit,
  proposeStairLayouts,
  StairDesignTargets,
} from '@pascal-app/core'
import { unknownMaterialPresetRefusal } from '@pascal-app/core/agent-operations'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import {
  getActiveRoofHeight,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core/schema'
import { z } from 'zod'
import type { Patch } from '../bridge/scene-bridge'
import type { SceneOperations } from '../operations'
import {
  ADDITIVE_TOOL_ANNOTATIONS,
  DESTRUCTIVE_TOOL_ANNOTATIONS,
  READ_ONLY_TOOL_ANNOTATIONS,
} from './annotations'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { measurement } from './measurement'
import { NodeIdSchema, Vec2Schema, Vec3Schema } from './schemas'

const ROOF_TYPES = [
  'hip',
  'gable',
  'shed',
  'gambrel',
  'dutch',
  'mansard',
  'flat',
  'conical',
] as const
const RAILING_MODES = ['none', 'left', 'right', 'both'] as const

export const createStoryShellInput = {
  levelId: NodeIdSchema,
  footprint: z.array(Vec2Schema).min(3),
  wallHeight: measurement('length', 'm', {
    positive: true,
    description: 'Explicit wall height override. Omit for level-plane-bound walls.',
  }).optional(),
  wallThickness: measurement('length', 'm', {
    positive: true,
    description: 'Wall thickness.',
  }).default(0.16),
  createSlab: z
    .boolean()
    .default(true)
    .describe('Floor intent for the rooms inside the shell. False records hasFloor: false.'),
  createCeiling: z
    .boolean()
    .default(true)
    .describe('Ceiling intent for the rooms inside the shell. False records hasCeiling: false.'),
  slabElevation: measurement('length', 'm', {
    description: "Walking surface of the derived plate, stored as the room's floor elevation.",
  }).default(0.1),
  ceilingHeight: measurement('length', 'm', {
    positive: true,
    description: 'Ceiling height.',
  }).optional(),
  namePrefix: z.string().optional(),
  wallMaterialPreset: z.string().optional(),
  slabMaterialPreset: z.string().optional(),
  ceilingMaterialPreset: z.string().optional(),
}

export const createStoryShellOutput = {
  levelId: z.string(),
  wallIds: z.array(z.string()),
  /** Zones the reconciler derived for the enclosed faces. */
  zoneIds: z.array(z.string()),
  /** Derived floor plate. `null` when floors were declined or nothing reconciled. */
  slabId: z.string().nullable(),
  /** Derived ceiling. `null` when ceilings were declined or nothing reconciled. */
  ceilingId: z.string().nullable(),
  createdIds: z.array(z.string()),
  ...liveSyncOutput,
}

export const createRoofInput = {
  levelId: NodeIdSchema,
  roofLevelId: NodeIdSchema.optional(),
  useDedicatedRoofLevel: z.boolean().default(true),
  roofLevelLabel: z.string().default('Roof'),
  // A level ordinal (story index), not a length — kept numeric.
  roofLevelElevation: z.number().optional(),
  roofLevelHeight: measurement('length', 'm', {
    positive: true,
    description: 'Roof level height.',
  }).optional(),
  center: Vec3Schema.optional(),
  width: measurement('length', 'm', { positive: true, description: 'Roof width.' }),
  depth: measurement('length', 'm', { positive: true, description: 'Roof depth.' }),
  roofType: z.enum(ROOF_TYPES).default('hip'),
  pitch: measurement('angle', 'deg', { min: 0, max: 85, description: 'Roof pitch.' }).default(35),
  wallHeight: measurement('length', 'm', { min: 0, description: 'Knee-wall height.' }).default(
    0.35,
  ),
  wallThickness: measurement('length', 'm', {
    positive: true,
    description: 'Wall thickness.',
  }).default(0.16),
  overhang: measurement('length', 'm', { min: 0, description: 'Eave overhang.' }).default(0.45),
  materialPreset: z.string().optional(),
  name: z.string().optional(),
}

export const createRoofOutput = {
  referenceLevelId: z.string(),
  roofLevelId: z.string(),
  createdRoofLevelId: z.string().nullable(),
  roofId: z.string(),
  roofSegmentId: z.string(),
  ...liveSyncOutput,
}

export const createStairBetweenLevelsInput = {
  fromLevelId: NodeIdSchema,
  toLevelId: NodeIdSchema,
  position: Vec3Schema,
  rotation: measurement('angle', 'rad', { description: 'Y-axis rotation.' }).default(0),
  width: measurement('length', 'm', { positive: true, description: 'Stair width.' }).default(1),
  runLength: measurement('length', 'm', {
    positive: true,
    description: 'Horizontal run length; omitted derives from shared stair design targets.',
  }).optional(),
  totalRise: measurement('length', 'm', {
    positive: true,
    description: 'Total vertical rise.',
  }).optional(),
  stepCount: z.number().int().min(2).optional(),
  railingMode: z.enum(RAILING_MODES).default('both'),
  destinationSlabId: NodeIdSchema.optional(),
  sourceCeilingId: NodeIdSchema.optional(),
  createDestinationSlabOpening: z.boolean().default(true),
  createSourceCeilingOpening: z.boolean().default(true),
  openingWidth: measurement('length', 'm', {
    positive: true,
    description: 'Floor opening width.',
  }).optional(),
  openingLength: measurement('length', 'm', {
    positive: true,
    description: 'Floor opening length.',
  }).optional(),
  openingOffset: measurement('length', 'm', { min: 0, description: 'Opening offset.' }).default(0),
  openingCenter: Vec2Schema.optional(),
  openingRotation: measurement('angle', 'rad', { description: 'Opening rotation.' }).optional(),
  materialPreset: z.string().optional(),
  name: z.string().optional(),
}

export const createStairBetweenLevelsOutput = {
  stairId: z.string(),
  stairSegmentId: z.string(),
  destinationSlabId: z.string().nullable(),
  sourceCeilingId: z.string().nullable(),
  openingPolygon: z.array(Vec2Schema),
  openingIds: z.array(z.string()),
  openingHints: z.array(
    z.object({
      code: z.literal('manual-ceiling'),
      openingId: z.string(),
      surfaceIds: z.array(z.string()),
      message: z.string(),
    }),
  ),
  ...liveSyncOutput,
}

function textResult<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

function assertNode(bridge: SceneOperations, id: string, type: AnyNode['type']): AnyNode {
  const node = bridge.getNode(id as AnyNodeId)
  if (!node) throw new Error(`${type} not found: ${id}`)
  if (node.type !== type) throw new Error(`Node ${id} is a ${node.type}, expected ${type}`)
  return node
}

function getBuildingIdForLevel(bridge: SceneOperations, levelId: string): AnyNodeId {
  const building = bridge.getAncestry(levelId as AnyNodeId).find((node) => node.type === 'building')
  if (!building) {
    throw new Error(`Building ancestor not found for level: ${levelId}`)
  }
  return building.id as AnyNodeId
}

function isRoofLevel(level: AnyNode): boolean {
  return (
    level.type === 'level' &&
    typeof level.metadata === 'object' &&
    level.metadata !== null &&
    'role' in level.metadata &&
    level.metadata.role === 'roof'
  )
}

function nextLevelIndex(
  bridge: SceneOperations,
  buildingId: AnyNodeId,
  referenceLevel: AnyNode,
): number {
  const existing = bridge
    .getChildren(buildingId)
    .filter((node): node is AnyNode & { type: 'level' } => node.type === 'level')
    .map((level) => level.level)
  const referenceIndex = referenceLevel.type === 'level' ? referenceLevel.level : 0
  const candidate = referenceIndex + 1
  return existing.includes(candidate) ? Math.max(candidate, ...existing) + 1 : candidate
}

function nodesOnLevel(bridge: SceneOperations, levelId: string): AnyNode[] {
  return Object.values(bridge.getNodes()).filter(
    (node) => node.id !== levelId && bridge.resolveLevelId(node.id as AnyNodeId) === levelId,
  )
}

function firstNodeOnLevel(
  bridge: SceneOperations,
  levelId: string,
  type: 'slab' | 'ceiling',
): AnyNode | null {
  return nodesOnLevel(bridge, levelId).find((node) => node.type === type) ?? null
}

function rotatePoint(x: number, z: number, rotation: number): [number, number] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [x * cos + z * sin, -x * sin + z * cos]
}

function rectangularOpening(args: {
  position: [number, number, number]
  rotation: number
  width: number
  length: number
  offset: number
  center?: [number, number] | undefined
  openingRotation?: number | undefined
}): [number, number][] {
  const width = args.width + args.offset * 2
  const length = args.length + args.offset * 2
  const center: [number, number] = args.center ?? [
    args.position[0],
    args.position[2] + args.length / 2,
  ]
  const rotation = args.openingRotation ?? args.rotation
  const halfW = width / 2
  const halfL = length / 2
  const local: [number, number][] = [
    [-halfW, -halfL],
    [halfW, -halfL],
    [halfW, halfL],
    [-halfW, halfL],
  ]
  return local.map(([x, z]) => {
    const [rx, rz] = rotatePoint(x, z, rotation)
    return [center[0] + rx, center[1] + rz]
  })
}

/** Room zones that appeared on the level while this tool call ran. */
function newRoomZoneIds(bridge: SceneOperations, levelId: string, before: ReadonlySet<string>) {
  return Object.values(bridge.getNodes())
    .filter(
      (node) =>
        node.type === 'zone' &&
        node.parentId === levelId &&
        node.spaceRole === 'room' &&
        !before.has(node.id),
    )
    .map((node) => node.id)
    .sort()
}

function derivedShellSurfaces(bridge: SceneOperations, levelId: string, zoneIds: string[]) {
  const children = Object.values(bridge.getNodes()).filter((node) => node.parentId === levelId)
  const plate = children
    .filter((node) => node.type === 'slab')
    .sort((a, b) => Number(a.plateRole === 'base') - Number(b.plateRole === 'base'))
    .find(
      (node) =>
        node.type === 'slab' &&
        node.boundary === 'auto' &&
        (node.zoneIds ?? []).some((id) => zoneIds.includes(id)),
    )
  const ceiling = children.find(
    (node) =>
      node.type === 'ceiling' && node.boundary === 'auto' && zoneIds.includes(node.zoneId ?? ''),
  )
  return { slabId: plate?.id ?? null, ceilingId: ceiling?.id ?? null }
}

export function registerConstructionTools(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'measure_stair',
    {
      title: 'Measure stair',
      description:
        'Inspect actual flight risers, walking-line going, slope, arrival, uniformity, headroom against floors, ceilings and stair bodies, and design-target diagnostics without changing measured geometry.',
      inputSchema: {
        stairId: NodeIdSchema,
        available: z
          .object({ width: z.number().positive(), length: z.number().positive() })
          .optional(),
      },
      outputSchema: { measurements: z.json(), layouts: z.json() },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ stairId, available }) => {
      const stair = assertNode(bridge, stairId, 'stair') as StairNode
      return textResult({
        measurements: measureStair(stair, bridge.getNodes()),
        layouts: proposeStairLayouts(stair, bridge.getNodes(), available),
      })
    },
  )
  server.registerTool(
    'fit_stair',
    {
      title: 'Fit stair',
      description:
        'Explicitly replace stair riser proportions with uniform risers from design targets. Optionally fit going by changing flight runs or arc sweep; preserves landing elevations. Optional straight, L or U layout replaces the flight chain with width-sized turning landings or quarter-turn winders. Winder going is measured along the selected walking line. One atomic edit.',
      inputSchema: {
        stairId: NodeIdSchema,
        fitRun: z.boolean().default(false),
        layout: z.enum(['straight', 'l', 'u']).optional(),
        turn: z.enum(['left', 'right']).optional(),
        width: z.number().positive().optional(),
        landingDepth: z.number().positive().optional(),
        turningStrategy: z.enum(['landing', 'winder']).optional(),
        innerGap: z.number().nonnegative().optional(),
        walkingLineOffset: z.number().positive().optional(),
        division: z.enum(['equal-going', 'equal-angle']).optional(),
        targets: StairDesignTargets.partial().optional(),
      },
      outputSchema: { stairId: NodeIdSchema, measurements: z.json(), ...liveSyncOutput },
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async ({
      stairId,
      fitRun,
      targets,
      layout,
      turn,
      width,
      landingDepth,
      turningStrategy,
      innerGap,
      walkingLineOffset,
      division,
    }) => {
      const original = assertNode(bridge, stairId, 'stair') as StairNode
      const stair = targets
        ? {
            ...original,
            designTargets: StairDesignTargets.parse({ ...original.designTargets, ...targets }),
          }
        : original
      const nodes: Record<string, AnyNode> = { ...bridge.getNodes(), [stair.id]: stair }
      let patches: Patch[]
      if (layout) {
        const plan = planStairPreset(stair, nodes, {
          layout,
          turn,
          width,
          landingDepth,
          turningStrategy,
          innerGap,
          walkingLineOffset,
          division,
        })
        patches = plan.removeIds.map((id) => ({ op: 'delete', id }))
        for (const segment of plan.segments) {
          patches.push(
            nodes[segment.id]
              ? { op: 'update', id: segment.id, data: segment }
              : { op: 'create', node: segment, parentId: stair.id },
          )
        }
        patches.push({ op: 'update', id: stair.id, data: plan.stair })
      } else {
        if (turn || width !== undefined || landingDepth !== undefined)
          throw new RangeError('Choose a layout when specifying turn, width or landing depth')
        const updates = planStairSizingEdit(stair, nodes, fitRun)
        if (targets)
          updates[0]!.data = {
            ...updates[0]!.data,
            designTargets: stair.designTargets,
          } as Partial<AnyNode>
        patches = updates.map(({ id, data }) => ({ op: 'update', id, data }))
      }
      bridge.applyPatch(patches)
      const persistence = await publishLiveSceneSnapshot(bridge, 'fit_stair')
      return textResult({
        stairId,
        measurements: measureStair(bridge.getNodes()[stair.id] as StairNode, bridge.getNodes()),
        ...persistencePayload(persistence),
      })
    },
  )
  server.registerTool(
    'create_story_shell',
    {
      title: 'Create story shell',
      description:
        'Create one level-owned building shell from a footprint: the perimeter walls. The floor plate and the ceiling are DERIVED from the rooms the walls enclose — never author a slab or a ceiling here, and never pass boundary/autoFromWalls; createSlab / createCeiling / slabElevation are recorded as room intent instead. Use once per story; do not make first-floor walls span multiple stories.',
      inputSchema: createStoryShellInput,
      outputSchema: createStoryShellOutput,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async ({
      levelId,
      footprint,
      wallHeight,
      wallThickness,
      createSlab,
      createCeiling,
      slabElevation,
      ceilingHeight,
      namePrefix,
      wallMaterialPreset,
      slabMaterialPreset,
      ceilingMaterialPreset,
    }) => {
      const preset = unknownMaterialPresetRefusal({
        wallMaterialPreset,
        slabMaterialPreset,
        ceilingMaterialPreset,
      })
      if (preset) throw new Error(preset)
      const level = assertNode(bridge, levelId, 'level')
      if (isRoofLevel(level)) {
        throw new Error(
          `Cannot create a story shell on roof support level ${levelId}; create or choose an occupied story level instead`,
        )
      }
      const points = footprint as [number, number][]
      const before = new Set(Object.keys(bridge.getNodes()))
      const plan = createZone(bridge.getNodes(), {
        levelId,
        polygon: points,
        name: namePrefix ?? 'Room',
        enclose: true,
        mintId: generateId,
        wall: {
          thickness: wallThickness,
          ...(wallHeight !== undefined ? { height: wallHeight } : {}),
        },
        intent: {
          floor: { elevation: slabElevation },
          hasFloor: createSlab,
          hasCeiling: createCeiling,
        },
      })
      const wallIds = plan.changes.flatMap((change) =>
        change.op === 'create' && change.node.type === 'wall' ? [change.node.id] : [],
      )
      bridge.runAsSingleHistoryStep(() => {
        bridge.applyPatch(
          plan.changes.map((change) =>
            change.op === 'create'
              ? {
                  ...change,
                  parentId: change.node.parentId as AnyNodeId,
                  node:
                    change.node.type === 'wall'
                      ? {
                          ...change.node,
                          ...(namePrefix
                            ? { name: `${namePrefix} Wall ${wallIds.indexOf(change.node.id) + 1}` }
                            : {}),
                          ...(wallMaterialPreset ? { materialPreset: wallMaterialPreset } : {}),
                          metadata: { role: 'exterior', storyShell: true },
                        }
                      : change.node,
                }
              : change,
          ),
        )
        bridge.deriveStructure([levelId as AnyNodeId])
      })
      const zoneIds = newRoomZoneIds(bridge, levelId, before)

      // Finishes and an explicit ceiling height stay editable on derived
      // construction, so they are applied to whatever the reconciler built.
      const derived = derivedShellSurfaces(bridge, levelId, zoneIds)
      const explicitCeilingHeight = ceilingHeight ?? wallHeight
      const finishes = [
        ...(derived.slabId && slabMaterialPreset
          ? [
              {
                op: 'update' as const,
                id: derived.slabId as AnyNodeId,
                data: {
                  ...(slabMaterialPreset ? { materialPreset: slabMaterialPreset } : {}),
                } as Partial<AnyNode>,
              },
            ]
          : []),
        ...(derived.ceilingId && (ceilingMaterialPreset || explicitCeilingHeight !== undefined)
          ? [
              {
                op: 'update' as const,
                id: derived.ceilingId as AnyNodeId,
                data: {
                  ...(ceilingMaterialPreset ? { materialPreset: ceilingMaterialPreset } : {}),
                  ...(explicitCeilingHeight !== undefined ? { height: explicitCeilingHeight } : {}),
                } as Partial<AnyNode>,
              },
            ]
          : []),
      ]
      if (finishes.length > 0) bridge.applyPatch(finishes)

      const persistence = await publishLiveSceneSnapshot(bridge, 'create_story_shell')
      return textResult({
        levelId,
        wallIds,
        zoneIds,
        slabId: derived.slabId,
        ceilingId: derived.ceilingId,
        createdIds: Object.keys(bridge.getNodes()).filter((id) => !before.has(id)),
        ...persistencePayload(persistence),
      })
    },
  )

  server.registerTool(
    'create_roof',
    {
      title: 'Create roof',
      description:
        'Create a roof container with one roof segment. By default creates a dedicated roof level above the reference level so exploded/solo level views can isolate the roof.',
      inputSchema: createRoofInput,
      outputSchema: createRoofOutput,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async ({
      levelId,
      roofLevelId,
      useDedicatedRoofLevel,
      roofLevelLabel,
      roofLevelElevation,
      roofLevelHeight,
      center,
      width,
      depth,
      roofType,
      pitch,
      wallHeight,
      wallThickness,
      overhang,
      materialPreset,
      name,
    }) => {
      const preset = unknownMaterialPresetRefusal({ materialPreset })
      if (preset) throw new Error(preset)
      const effectiveWidth = roofType === 'conical' ? Math.max(width, depth) : width
      const effectiveDepth = roofType === 'conical' ? effectiveWidth : depth
      // Peak height is derived from pitch + footprint + type; we still
      // need it to size the auto-generated roof level container below.
      const peakHeight = getActiveRoofHeight({
        roofType,
        pitch,
        width: effectiveWidth,
        depth: effectiveDepth,
      })
      const referenceLevel = assertNode(bridge, levelId, 'level')
      const patches: Array<{ op: 'create'; node: AnyNode; parentId: AnyNodeId }> = []
      let targetRoofLevelId = levelId as AnyNodeId
      let createdRoofLevelId: string | null = null

      if (roofLevelId !== undefined) {
        const roofLevel = assertNode(bridge, roofLevelId, 'level')
        if (!isRoofLevel(roofLevel)) {
          throw new Error(
            `roofLevelId ${roofLevelId} must reference a dedicated roof level with metadata.role = "roof"; omit roofLevelId to create one automatically`,
          )
        }
        targetRoofLevelId = roofLevelId as AnyNodeId
      } else if (useDedicatedRoofLevel && !isRoofLevel(referenceLevel)) {
        const buildingId = getBuildingIdForLevel(bridge, levelId)
        const roofLevel = LevelNode.parse({
          name: roofLevelLabel,
          level: roofLevelElevation ?? nextLevelIndex(bridge, buildingId, referenceLevel),
          height: roofLevelHeight ?? Math.max(wallHeight + peakHeight, 0.2),
          children: [],
          metadata: {
            role: 'roof',
            label: roofLevelLabel,
            referenceLevelId: levelId,
          },
        })
        targetRoofLevelId = roofLevel.id as AnyNodeId
        createdRoofLevelId = roofLevel.id
        patches.push({ op: 'create', node: roofLevel, parentId: buildingId })
      }

      const segment = RoofSegmentNode.parse({
        roofType,
        width: effectiveWidth,
        depth: effectiveDepth,
        wallHeight,
        pitch,
        wallThickness,
        overhang,
        ...(materialPreset ? { materialPreset } : {}),
      })
      const roof = RoofNode.parse({
        name: name ?? 'Roof',
        position: (center as [number, number, number] | undefined) ?? [0, 0, 0],
        children: [segment.id],
        ...(materialPreset ? { materialPreset } : {}),
        metadata: {
          referenceLevelId: levelId,
          roofLevelId: targetRoofLevelId,
        },
      })
      bridge.applyPatch([
        ...patches,
        { op: 'create', node: roof, parentId: targetRoofLevelId },
        { op: 'create', node: segment, parentId: roof.id as AnyNodeId },
      ])
      const persistence = await publishLiveSceneSnapshot(bridge, 'create_roof')
      return textResult({
        referenceLevelId: levelId,
        roofLevelId: targetRoofLevelId,
        createdRoofLevelId,
        roofId: roof.id,
        roofSegmentId: segment.id,
        ...persistencePayload(persistence),
      })
    },
  )

  server.registerTool(
    'create_stair_between_levels',
    {
      title: 'Create stair between levels',
      description:
        'Create a straight stair and a persistent floor-opening node for its destination floor and the ceiling directly below. This disables stair auto-opening mode to avoid duplicate cuts.',
      inputSchema: createStairBetweenLevelsInput,
      outputSchema: createStairBetweenLevelsOutput,
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async ({
      fromLevelId,
      toLevelId,
      position,
      rotation,
      width,
      runLength: requestedRunLength,
      totalRise,
      stepCount: requestedStepCount,
      railingMode,
      destinationSlabId,
      sourceCeilingId,
      createDestinationSlabOpening,
      createSourceCeilingOpening,
      openingWidth,
      openingLength,
      openingOffset,
      openingCenter,
      openingRotation,
      materialPreset,
      name,
    }) => {
      const preset = unknownMaterialPresetRefusal({ materialPreset })
      if (preset) throw new Error(preset)
      const fromLevel = assertNode(bridge, fromLevelId, 'level')
      const toLevel = assertNode(bridge, toLevelId, 'level')
      if (isRoofLevel(fromLevel) || isRoofLevel(toLevel)) {
        throw new Error(
          'Roof support levels are not occupied stories; create a separate occupied attic/story level if a stair-accessible attic is required',
        )
      }

      const stairDraft = StairNode.parse({
        name: name ?? 'Stair',
        position: position as [number, number, number],
        rotation,
        stairType: 'straight',
        parentId: fromLevelId,
        uniformRisers: true,
        fromLevelId,
        toLevelId,
        slabOpeningMode: 'none',
        openingOffset,
        width,
        ...(totalRise !== undefined ? { totalRise } : {}),
        stepCount: requestedStepCount,
        railingMode,
        children: [],
        ...(materialPreset ? { materialPreset } : {}),
        metadata: {
          openingManaged: 'floor-opening',
        },
      })
      const riseNodes = {
        ...bridge.getNodes(),
        [fromLevel.id]: {
          ...fromLevel,
          children: [...(fromLevel as Extract<AnyNode, { type: 'level' }>).children, stairDraft.id],
        },
        [stairDraft.id]: stairDraft,
      } as Record<string, AnyNode>
      const dimensions = {
        width,
        ...(requestedRunLength !== undefined ? { length: requestedRunLength } : {}),
        ...(requestedStepCount !== undefined ? { stepCount: requestedStepCount } : {}),
      }
      const { flight } = planStairCreation(stairDraft, riseNodes, dimensions)
      const segment = StairSegmentNode.parse({
        ...flight,
        ...(materialPreset ? { materialPreset } : {}),
      })
      const runLength = segment.length
      const stair = { ...stairDraft, stepCount: segment.stepCount, children: [segment.id] }

      const openingPolygon = rectangularOpening({
        position: position as [number, number, number],
        rotation,
        width: openingWidth ?? width,
        length: openingLength ?? runLength,
        offset: openingOffset,
        center: openingCenter as [number, number] | undefined,
        openingRotation,
      })

      const patches: Array<
        | { op: 'create'; node: AnyNode; parentId: AnyNodeId }
        | { op: 'update'; id: AnyNodeId; data: Partial<AnyNode> }
      > = [
        { op: 'create', node: stair, parentId: fromLevelId as AnyNodeId },
        { op: 'create', node: segment, parentId: stair.id as AnyNodeId },
      ]

      const destinationSlab =
        destinationSlabId !== undefined
          ? assertNode(bridge, destinationSlabId, 'slab')
          : firstNodeOnLevel(bridge, toLevelId, 'slab')
      const sourceCeiling =
        sourceCeilingId !== undefined
          ? assertNode(bridge, sourceCeilingId, 'ceiling')
          : firstNodeOnLevel(bridge, fromLevelId, 'ceiling')
      const floorCut = createDestinationSlabOpening && destinationSlab?.type === 'slab'
      const ceilingCut = createSourceCeilingOpening && sourceCeiling?.type === 'ceiling'
      const adjacentSource = adjacentLevelId(bridge.getNodes(), toLevelId, -1) === fromLevelId
      const openingPlans = [
        ...(floorCut
          ? [
              cutFloorOpening(bridge.getNodes(), {
                levelId: toLevelId,
                polygon: openingPolygon,
                source: 'stair',
                ownerId: stair.id,
                cutsAdjacent: ceilingCut && adjacentSource,
                mintId: generateId,
              }),
            ]
          : []),
        ...((!floorCut || !adjacentSource) && ceilingCut
          ? [
              cutFloorOpening(bridge.getNodes(), {
                levelId: fromLevelId,
                polygon: openingPolygon,
                drawnOn: 'ceiling',
                source: 'stair',
                ownerId: stair.id,
                cutsAdjacent: false,
                mintId: generateId,
              }),
            ]
          : []),
      ]
      for (const plan of openingPlans)
        for (const change of plan.changes)
          patches.push(
            change.op === 'create'
              ? {
                  ...change,
                  parentId: change.node.parentId as AnyNodeId,
                  node: {
                    ...change.node,
                    metadata: {
                      ...change.node.metadata,
                      ownerPose: {
                        position: stair.position,
                        rotation: stair.rotation,
                        width: stair.width,
                        runLength,
                      },
                      ownerOpeningTarget:
                        change.node.type === 'floor-opening' && change.node.drawnOn === 'ceiling'
                          ? 'source'
                          : 'destination',
                    },
                  },
                }
              : (change as Extract<(typeof patches)[number], { op: 'update' }>),
          )

      bridge.applyPatch(patches)
      const persistence = await publishLiveSceneSnapshot(bridge, 'create_stair_between_levels')
      return textResult({
        stairId: stair.id,
        stairSegmentId: segment.id,
        destinationSlabId: destinationSlab?.id ?? null,
        sourceCeilingId: sourceCeiling?.id ?? null,
        openingPolygon,
        openingIds: openingPlans.flatMap((plan) => plan.openingIds),
        openingHints: openingPlans.flatMap((plan) => plan.hints),
        ...persistencePayload(persistence),
      })
    },
  )
}
