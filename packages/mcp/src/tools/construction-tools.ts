import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import {
  CeilingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
} from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'
import type { SceneStore } from '../storage/types'
import { publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema, Vec2Schema, Vec3Schema } from './schemas'

const ROOF_TYPES = ['hip', 'gable', 'shed', 'gambrel', 'dutch', 'mansard', 'flat'] as const
const RAILING_MODES = ['none', 'left', 'right', 'both'] as const

export const createStoryShellInput = {
  levelId: NodeIdSchema,
  footprint: z.array(Vec2Schema).min(3),
  wallHeight: z.number().positive().default(2.8),
  wallThickness: z.number().positive().default(0.16),
  createSlab: z.boolean().default(true),
  createCeiling: z.boolean().default(true),
  slabElevation: z.number().default(0.1),
  ceilingHeight: z.number().positive().optional(),
  namePrefix: z.string().optional(),
  wallMaterialPreset: z.string().optional(),
  slabMaterialPreset: z.string().optional(),
  ceilingMaterialPreset: z.string().optional(),
}

export const createStoryShellOutput = {
  levelId: z.string(),
  wallIds: z.array(z.string()),
  slabId: z.string().nullable(),
  ceilingId: z.string().nullable(),
  createdIds: z.array(z.string()),
}

export const createRoofInput = {
  levelId: NodeIdSchema,
  roofLevelId: NodeIdSchema.optional(),
  useDedicatedRoofLevel: z.boolean().default(true),
  roofLevelLabel: z.string().default('Roof'),
  roofLevelElevation: z.number().optional(),
  roofLevelHeight: z.number().positive().optional(),
  center: Vec3Schema.optional(),
  width: z.number().positive(),
  depth: z.number().positive(),
  roofType: z.enum(ROOF_TYPES).default('hip'),
  roofHeight: z.number().positive().default(1.8),
  wallHeight: z.number().min(0).default(0.35),
  wallThickness: z.number().positive().default(0.16),
  overhang: z.number().min(0).default(0.45),
  materialPreset: z.string().optional(),
  name: z.string().optional(),
}

export const createRoofOutput = {
  referenceLevelId: z.string(),
  roofLevelId: z.string(),
  createdRoofLevelId: z.string().nullable(),
  roofId: z.string(),
  roofSegmentId: z.string(),
}

export const createStairBetweenLevelsInput = {
  fromLevelId: NodeIdSchema,
  toLevelId: NodeIdSchema,
  position: Vec3Schema,
  rotation: z.number().default(0),
  width: z.number().positive().default(1),
  runLength: z.number().positive().default(3),
  totalRise: z.number().positive().default(2.8),
  stepCount: z.number().int().positive().default(14),
  railingMode: z.enum(RAILING_MODES).default('both'),
  destinationSlabId: NodeIdSchema.optional(),
  sourceCeilingId: NodeIdSchema.optional(),
  createDestinationSlabOpening: z.boolean().default(true),
  createSourceCeilingOpening: z.boolean().default(true),
  openingWidth: z.number().positive().optional(),
  openingLength: z.number().positive().optional(),
  openingOffset: z.number().min(0).default(0.15),
  openingCenter: Vec2Schema.optional(),
  openingRotation: z.number().optional(),
  materialPreset: z.string().optional(),
  name: z.string().optional(),
}

export const createStairBetweenLevelsOutput = {
  stairId: z.string(),
  stairSegmentId: z.string(),
  destinationSlabId: z.string().nullable(),
  sourceCeilingId: z.string().nullable(),
  openingPolygon: z.array(Vec2Schema),
}

function textResult<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

function assertNode(bridge: SceneBridge, id: string, type: AnyNode['type']): AnyNode {
  const node = bridge.getNode(id as AnyNodeId)
  if (!node) throw new Error(`${type} not found: ${id}`)
  if (node.type !== type) throw new Error(`Node ${id} is a ${node.type}, expected ${type}`)
  return node
}

function getBuildingIdForLevel(bridge: SceneBridge, levelId: string): AnyNodeId {
  const building = bridge
    .getAncestry(levelId as AnyNodeId)
    .find((node) => node.type === 'building')
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

function nextLevelIndex(bridge: SceneBridge, buildingId: AnyNodeId, referenceLevel: AnyNode): number {
  const existing = bridge
    .getChildren(buildingId)
    .filter((node): node is AnyNode & { type: 'level' } => node.type === 'level')
    .map((level) => level.level)
  const referenceIndex = referenceLevel.type === 'level' ? referenceLevel.level : 0
  const candidate = referenceIndex + 1
  return existing.includes(candidate) ? Math.max(candidate, ...existing) + 1 : candidate
}

function nodesOnLevel(bridge: SceneBridge, levelId: string): AnyNode[] {
  return Object.values(bridge.getNodes()).filter(
    (node) => node.id !== levelId && bridge.resolveLevelId(node.id as AnyNodeId) === levelId,
  )
}

function firstNodeOnLevel(
  bridge: SceneBridge,
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

function withHole(
  surface: AnyNode & { type: 'slab' | 'ceiling' },
  hole: [number, number][],
): Partial<AnyNode> {
  return {
    holes: [...(surface.holes ?? []), hole],
    holeMetadata: [...(surface.holeMetadata ?? []), { source: 'manual' }],
  } as Partial<AnyNode>
}

export function registerConstructionTools(
  server: McpServer,
  bridge: SceneBridge,
  store?: SceneStore,
): void {
  server.registerTool(
    'create_story_shell',
    {
      title: 'Create story shell',
      description:
        'Create one level-owned building shell from a footprint: perimeter walls plus optional slab and ceiling. Use once per story; do not make first-floor walls span multiple stories.',
      inputSchema: createStoryShellInput,
      outputSchema: createStoryShellOutput,
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
      assertNode(bridge, levelId, 'level')
      const points = footprint as [number, number][]
      const wallIds: string[] = []
      const patches: Array<{ op: 'create'; node: AnyNode; parentId: AnyNodeId }> = []

      for (let i = 0; i < points.length; i++) {
        const wall = WallNode.parse({
          name: namePrefix ? `${namePrefix} Wall ${i + 1}` : undefined,
          start: points[i],
          end: points[(i + 1) % points.length],
          thickness: wallThickness,
          height: wallHeight,
          frontSide: 'exterior',
          backSide: 'interior',
          ...(wallMaterialPreset ? { materialPreset: wallMaterialPreset } : {}),
          metadata: { role: 'exterior', storyShell: true },
        })
        wallIds.push(wall.id)
        patches.push({ op: 'create', node: wall, parentId: levelId as AnyNodeId })
      }

      let slabId: string | null = null
      if (createSlab) {
        const slab = SlabNode.parse({
          name: namePrefix ? `${namePrefix} Slab` : undefined,
          polygon: points,
          elevation: slabElevation,
          ...(slabMaterialPreset ? { materialPreset: slabMaterialPreset } : {}),
          metadata: { role: 'story-slab' },
        })
        slabId = slab.id
        patches.push({ op: 'create', node: slab, parentId: levelId as AnyNodeId })
      }

      let ceilingId: string | null = null
      if (createCeiling) {
        const ceiling = CeilingNode.parse({
          name: namePrefix ? `${namePrefix} Ceiling` : undefined,
          polygon: points,
          height: ceilingHeight ?? wallHeight,
          ...(ceilingMaterialPreset ? { materialPreset: ceilingMaterialPreset } : {}),
          metadata: { role: 'story-ceiling' },
        })
        ceilingId = ceiling.id
        patches.push({ op: 'create', node: ceiling, parentId: levelId as AnyNodeId })
      }

      const result = bridge.applyPatch(patches)
      await publishLiveSceneSnapshot(bridge, store, 'create_story_shell')
      return textResult({
        levelId,
        wallIds,
        slabId,
        ceilingId,
        createdIds: result.createdIds as string[],
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
      roofHeight,
      wallHeight,
      wallThickness,
      overhang,
      materialPreset,
      name,
    }) => {
      const referenceLevel = assertNode(bridge, levelId, 'level')
      const patches: Array<{ op: 'create'; node: AnyNode; parentId: AnyNodeId }> = []
      let targetRoofLevelId = levelId as AnyNodeId
      let createdRoofLevelId: string | null = null

      if (roofLevelId !== undefined) {
        assertNode(bridge, roofLevelId, 'level')
        targetRoofLevelId = roofLevelId as AnyNodeId
      } else if (useDedicatedRoofLevel && !isRoofLevel(referenceLevel)) {
        const buildingId = getBuildingIdForLevel(bridge, levelId)
        const roofLevel = LevelNode.parse({
          name: roofLevelLabel,
          level: roofLevelElevation ?? nextLevelIndex(bridge, buildingId, referenceLevel),
          children: [],
          metadata: {
            role: 'roof',
            label: roofLevelLabel,
            referenceLevelId: levelId,
            height: roofLevelHeight ?? Math.max(wallHeight + roofHeight, 0.2),
          },
        })
        targetRoofLevelId = roofLevel.id as AnyNodeId
        createdRoofLevelId = roofLevel.id
        patches.push({ op: 'create', node: roofLevel, parentId: buildingId })
      }

      const segment = RoofSegmentNode.parse({
        roofType,
        width,
        depth,
        wallHeight,
        roofHeight,
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
      await publishLiveSceneSnapshot(bridge, store, 'create_roof')
      return textResult({
        referenceLevelId: levelId,
        roofLevelId: targetRoofLevelId,
        createdRoofLevelId,
        roofId: roof.id,
        roofSegmentId: segment.id,
      })
    },
  )

  server.registerTool(
    'create_stair_between_levels',
    {
      title: 'Create stair between levels',
      description:
        'Create a straight stair and a single rectangular manual opening in the destination slab/source ceiling. This disables stair auto-opening mode to avoid duplicate or irregular holes.',
      inputSchema: createStairBetweenLevelsInput,
      outputSchema: createStairBetweenLevelsOutput,
    },
    async ({
      fromLevelId,
      toLevelId,
      position,
      rotation,
      width,
      runLength,
      totalRise,
      stepCount,
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
      assertNode(bridge, fromLevelId, 'level')
      assertNode(bridge, toLevelId, 'level')

      const segment = StairSegmentNode.parse({
        segmentType: 'stair',
        width,
        length: runLength,
        height: totalRise,
        stepCount,
        ...(materialPreset ? { materialPreset } : {}),
      })
      const stair = StairNode.parse({
        name: name ?? 'Stair',
        position: position as [number, number, number],
        rotation,
        stairType: 'straight',
        fromLevelId,
        toLevelId,
        slabOpeningMode: 'none',
        openingOffset,
        width,
        totalRise,
        stepCount,
        railingMode,
        children: [segment.id],
        ...(materialPreset ? { materialPreset } : {}),
        metadata: {
          openingManaged: 'manual-rectangular',
        },
      })

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
      if (createDestinationSlabOpening && destinationSlab?.type === 'slab') {
        patches.push({
          op: 'update',
          id: destinationSlab.id as AnyNodeId,
          data: withHole(destinationSlab, openingPolygon),
        })
      }

      const sourceCeiling =
        sourceCeilingId !== undefined
          ? assertNode(bridge, sourceCeilingId, 'ceiling')
          : firstNodeOnLevel(bridge, fromLevelId, 'ceiling')
      if (createSourceCeilingOpening && sourceCeiling?.type === 'ceiling') {
        patches.push({
          op: 'update',
          id: sourceCeiling.id as AnyNodeId,
          data: withHole(sourceCeiling, openingPolygon),
        })
      }

      bridge.applyPatch(patches)
      await publishLiveSceneSnapshot(bridge, store, 'create_stair_between_levels')
      return textResult({
        stairId: stair.id,
        stairSegmentId: segment.id,
        destinationSlabId: destinationSlab?.id ?? null,
        sourceCeilingId: sourceCeiling?.id ?? null,
        openingPolygon,
      })
    },
  )
}
