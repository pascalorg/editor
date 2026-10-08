import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createZone, generateId } from '@pascal-app/core'
import { unknownMaterialPresetRefusal } from '@pascal-app/core/agent-operations'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { getActiveRoofHeight, LevelNode, RoofNode, RoofSegmentNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
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
}
