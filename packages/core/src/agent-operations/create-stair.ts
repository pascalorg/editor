import { refuse } from '../agent-tools/refusal'
import { levelBuildingId } from '../building/level-duplication'
import { type AnyNode, type AnyNodeId, LevelNode, StairNode } from '../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../services/level-height'
import { getLevelFloorToFloorHeight } from '../services/storey'
import { planOwnedFloorOpenings } from '../systems/owned-floor-openings'
import { createDefaultStairSegment } from '../systems/stair/stair-flight'
import { refuseRoofLevel } from './add-wall'
import { applySceneChanges } from './apply-changes'
import { type LevelTargetInput, requireLevel, targetLevel } from './level-target'
import { levelsOf } from './scene-queries'
import type { AgentOperation, SceneChanges } from './types'

type CreateStairInput = LevelTargetInput & {
  x: number
  z: number
  rotation?: number
  width?: number
  length?: number
  height?: number
  steps?: number
  toLevelId?: string
}

const RISER = 0.18

/**
 * `create_stair`: a straight flight placed as the editor's stair tool places one — rising to the
 * next level (made when there is none), its floor openings owned and cut by the stair.
 */
export const createStair: AgentOperation<CreateStairInput> = (nodes, input, context) => {
  const from = targetLevel(nodes, input, context)
  refuseRoofLevel(nodes, from.id, 'a stair')
  const buildingId = levelBuildingId(nodes as Record<AnyNodeId, AnyNode>, from)
  const building = buildingId ? nodes[buildingId] : undefined
  if (building?.type !== 'building')
    refuse('no_building', `Level ${from.id} is not in a building, so it has no floor above.`, {
      levelId: from.id,
    })
  const floors = levelsOf(nodes).filter(
    (level) => level.parentId === building.id || building.children.includes(level.id),
  )

  const changes: Required<SceneChanges> = { create: [], update: [], delete: [], collections: {} }
  let upper = input.toLevelId
    ? requireLevel(nodes, input.toLevelId)
    : floors.find((level) => level.level > from.level)
  if (upper && (upper.level <= from.level || !floors.includes(upper)))
    refuse(
      'not_above',
      `${upper.id} is not above ${from.id} in its building: a flight rises to a higher floor.`,
      { levelId: from.id, toLevelId: upper.id },
    )
  if (upper) refuseRoofLevel(nodes, upper.id, 'a stair')
  if (!upper) {
    upper = LevelNode.parse({
      parentId: building.id,
      level: from.level + 1,
      height: DEFAULT_LEVEL_HEIGHT,
      children: [],
    })
    changes.create.push({ node: upper, parentId: building.id })
  }

  const withUpper = applySceneChanges(nodes, changes)
  const rotation = input.rotation ?? 0
  const width = input.width ?? 1
  const length = input.length ?? 3
  // No height: the flight follows its storey (no totalRise) and keeps tracking it.
  const rise = input.height ?? getLevelFloorToFloorHeight(from.id, withUpper)
  const stepCount = input.steps ?? Math.max(3, Math.round(rise / RISER))
  const segment = createDefaultStairSegment({
    width,
    length,
    height: rise,
    stepCount,
    attachmentSide: 'front',
    fillToFloor: true,
  })
  const stairs = Object.values(nodes).filter((node) => node.type === 'stair').length
  const stair = StairNode.parse({
    parentId: from.id,
    name: `Staircase ${stairs + 1}`,
    position: [input.x, 0, input.z],
    rotation: (rotation * Math.PI) / 180,
    stairType: 'straight',
    fromLevelId: from.id,
    toLevelId: upper.id,
    slabOpeningMode: 'destination',
    openingOffset: 0.08,
    width,
    stepCount,
    railingMode: 'both',
    ...(input.height === undefined ? {} : { totalRise: input.height }),
    children: [segment.id],
  })
  changes.create.push(
    { node: stair, parentId: from.id },
    { node: { ...segment, parentId: stair.id }, parentId: stair.id },
  )

  // The editor's opening pass: the stair owns a floor opening in each floor it passes; the live
  // opening systems then find it in place.
  const openingIds: string[] = []
  for (const patch of planOwnedFloorOpenings(applySceneChanges(nodes, changes), {
    ownerIds: new Set([stair.id]),
  })) {
    if (patch.op === 'create') {
      changes.create.push({ node: patch.node, parentId: patch.node.parentId ?? undefined })
      if (patch.node.type === 'floor-opening') openingIds.push(patch.node.id)
    } else if (patch.op === 'update') changes.update.push({ id: patch.id, data: patch.data })
    else changes.delete.push(patch.id)
  }

  const createdUpperLevel = !nodes[upper.id]
  const arrival = upper.name ?? `level ${upper.level}`
  return {
    result: {
      ok: true,
      stairId: stair.id,
      segmentId: segment.id,
      fromLevelId: from.id,
      upperLevelId: upper.id,
      createdUpperLevel,
      stepCount,
      rise: Math.round(rise * 1000) / 1000,
      rotation,
      width,
      length,
      slabHoleCut: openingIds.length > 0,
      ...(openingIds.length ? { openingIds } : {}),
      message: openingIds.length
        ? `Created a staircase at (${input.x}, ${input.z}) with ${stepCount} steps up to ${arrival}, its floor opening cut.`
        : `Created a staircase at (${input.x}, ${input.z}) with ${stepCount} steps up to ${arrival}${createdUpperLevel ? ' (created for it)' : ''}, but no floor there covers the flight, so no opening was cut. Add or align the upper floor over the stair's footprint.`,
    },
    changes,
  }
}
