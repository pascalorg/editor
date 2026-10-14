import type { z } from 'zod'
import { refuse } from '../agent-tools/refusal'
import type { createRoofInput } from '../agent-tools/roofs'
import { levelBuildingId } from '../building/level-duplication'
import {
  type AnyNode,
  type AnyNodeId,
  getActiveRoofHeight,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
} from '../schema'
import { requireLevel } from './level-target'
import { unknownMaterialPresetRefusal } from './material-preset'
import type { AgentOperation, SceneChanges } from './types'

type CreateRoofInput = z.infer<z.ZodObject<typeof createRoofInput>>

export const createRoof: AgentOperation<CreateRoofInput> = (nodes, input) => {
  const preset = unknownMaterialPresetRefusal({ materialPreset: input.materialPreset })
  if (preset) refuse('unknown_material', preset)
  const { levelId, roofType, roofSystem, barrelRise, depth, width, wallHeight } = input
  if (roofSystem === 'glazed' && !['gable', 'shed', 'barrel'].includes(roofType))
    refuse('unsupported_glazing', 'Glazed roofs support gable, straight shed, and barrel shapes.')
  if (roofType === 'barrel' && barrelRise !== undefined && barrelRise > depth / 2)
    refuse('invalid_barrel_rise', 'Barrel rise must not exceed half the span.')
  const reference = requireLevel(nodes, levelId)
  const effectiveWidth = roofType === 'conical' ? Math.max(width, depth) : width
  const effectiveDepth = roofType === 'conical' ? effectiveWidth : depth
  const peak = getActiveRoofHeight({
    roofType,
    barrelRise,
    pitch: input.pitch,
    width: effectiveWidth,
    depth: effectiveDepth,
  })
  const create: NonNullable<SceneChanges['create']> = []
  let target = reference
  let createdRoofLevelId: string | null = null
  if (input.roofLevelId) {
    target = requireLevel(nodes, input.roofLevelId)
    if (target.metadata?.role !== 'roof')
      refuse(
        'not_roof_level',
        `roofLevelId ${target.id} must reference a dedicated roof level with metadata.role = "roof"; omit roofLevelId to create one automatically`,
      )
  } else if (input.useDedicatedRoofLevel && reference.metadata?.role !== 'roof') {
    const buildingId = levelBuildingId(nodes as Record<AnyNodeId, AnyNode>, reference)
    if (!buildingId) refuse('no_building', `Building ancestor not found for level: ${levelId}`)
    const levels = Object.values(nodes)
      .filter((node) => node.type === 'level' && node.parentId === buildingId)
      .map((node) => (node as LevelNode).level)
    const candidate = reference.level + 1
    target = LevelNode.parse({
      parentId: buildingId,
      name: input.roofLevelLabel,
      level:
        input.roofLevelElevation ??
        (levels.includes(candidate) ? Math.max(candidate, ...levels) + 1 : candidate),
      height: input.roofLevelHeight ?? Math.max(wallHeight + peak, 0.2),
      children: [],
      metadata: { role: 'roof', label: input.roofLevelLabel, referenceLevelId: levelId },
    })
    createdRoofLevelId = target.id
    create.push({ node: target, parentId: buildingId })
  }
  const segment = RoofSegmentNode.parse({
    roofType,
    roofSystem,
    barrelRise,
    glazing: input.glazing,
    barrelSegments: input.barrelSegments,
    width: effectiveWidth,
    depth: effectiveDepth,
    wallHeight,
    pitch: input.pitch,
    wallThickness: input.wallThickness,
    overhang: input.overhang,
    ...(input.materialPreset ? { materialPreset: input.materialPreset } : {}),
  })
  const roof = RoofNode.parse({
    parentId: target.id,
    name: input.name ?? 'Roof',
    position: input.center ?? [0, 0, 0],
    children: [segment.id],
    ...(input.materialPreset ? { materialPreset: input.materialPreset } : {}),
    metadata: { referenceLevelId: levelId, roofLevelId: target.id },
  })
  create.push(
    { node: roof, parentId: target.id },
    { node: { ...segment, parentId: roof.id }, parentId: roof.id },
  )
  return {
    result: {
      referenceLevelId: levelId,
      roofLevelId: target.id,
      createdRoofLevelId,
      roofId: roof.id,
      roofSegmentId: segment.id,
    },
    changes: { create },
  }
}
