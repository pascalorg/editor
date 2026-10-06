import { refuse } from '../agent-tools/refusal'
import { levelBuildingId } from '../building/level-duplication'
import { cutFloorOpening } from '../commands/structure/floor-opening'
import { adjacentLevelId } from '../lib/floor-opening-intent'
import { type AnyNode, type AnyNodeId, generateId, LevelNode, StairNode } from '../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../services/level-height'
import { getLevelFloorToFloorHeight } from '../services/storey'
import { planOwnedFloorOpenings } from '../systems/owned-floor-openings'
import { createDefaultStairSegment } from '../systems/stair/stair-flight'
import { refuseRoofLevel } from './add-wall'
import { applySceneChanges } from './apply-changes'
import { type LevelTargetInput, requireLevel, targetLevel } from './level-target'
import { finishSurface, requireMaterialRef } from './material-refs'
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
  railingMode?: 'none' | 'left' | 'right' | 'both'
  materialPreset?: string
  name?: string
  createDestinationSlabOpening?: boolean
  createSourceCeilingOpening?: boolean
  destinationSlabId?: string
  sourceCeilingId?: string
  openingWidth?: number
  openingLength?: number
  openingOffset?: number
  openingCenter?: [number, number]
  openingRotation?: number
}

const RISER = 0.18
/** The margin round a stair's opening when none is given, as the editor's stair tool cuts it. */
const OPENING_MARGIN = 0.08

type Pt = [number, number]

/**
 * The opening as asked, in level metres: its size plus the margin on every side, round its centre
 * (by default the middle of the flight, along the climb), turned as asked (by default with the
 * flight). An item's turn: local (dx, dz) goes to (cx + dx·cos + dz·sin, cz − dx·sin + dz·cos).
 */
function openingRing(
  stair: { x: number; z: number; turn: number; width: number; length: number },
  input: CreateStairInput,
): Pt[] {
  const margin = input.openingOffset ?? OPENING_MARGIN
  const half = [
    (input.openingWidth ?? stair.width) / 2 + margin,
    (input.openingLength ?? stair.length) / 2 + margin,
  ] as const
  const [cx, cz] = input.openingCenter ?? [
    stair.x + (stair.length / 2) * Math.sin(stair.turn),
    stair.z + (stair.length / 2) * Math.cos(stair.turn),
  ]
  const turn =
    input.openingRotation === undefined ? stair.turn : (input.openingRotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
  return (
    [
      [-half[0], -half[1]],
      [half[0], -half[1]],
      [half[0], half[1]],
      [-half[0], half[1]],
    ] as const
  ).map(([dx, dz]): Pt => [cx + dx * cos + dz * sin, cz - dx * sin + dz * cos])
}

/**
 * `create_stair`: a straight flight placed as the editor's stair tool places one — rising to the
 * next level (made when there is none), its floor openings owned and cut by the stair. With
 * create_stair_between_levels' opening controls (S1 parity with main), the opening is cut as
 * given instead, owned by the stair as main's are, and the stair's own opening is off so nothing
 * is cut twice.
 */
export const createStair: AgentOperation<CreateStairInput> = (nodes, input, context) => {
  const from = targetLevel(nodes, input, context)
  refuseRoofLevel(nodes, from.id, 'a stair')
  const preset =
    input.materialPreset === undefined
      ? undefined
      : // paint takes no stair: a colour is a flat library one.
        requireMaterialRef(input.materialPreset, 'materialPreset', finishSurface('stair'), {
          paint: false,
        })
  if (input.destinationSlabId && nodes[input.destinationSlabId]?.type !== 'slab')
    refuse(
      'slab_not_found',
      `No slab ${input.destinationSlabId}: name the slab the flight arrives through, or leave it out.`,
      { slabId: input.destinationSlabId },
    )
  if (input.sourceCeilingId && nodes[input.sourceCeilingId]?.type !== 'ceiling')
    refuse(
      'ceiling_not_found',
      `No ceiling ${input.sourceCeilingId}: name the ceiling the flight rises through, or leave it out.`,
      { ceilingId: input.sourceCeilingId },
    )
  const cutFloor = input.createDestinationSlabOpening !== false
  const cutCeiling = input.createSourceCeilingOpening !== false
  const asGiven =
    cutFloor !== cutCeiling ||
    [
      input.destinationSlabId,
      input.sourceCeilingId,
      input.openingWidth,
      input.openingLength,
      input.openingCenter,
      input.openingRotation,
    ].some((value) => value !== undefined)
  const owned = cutFloor && cutCeiling && !asGiven
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
  const segment = {
    ...createDefaultStairSegment({
      width,
      length,
      height: rise,
      stepCount,
      attachmentSide: 'front',
      fillToFloor: true,
    }),
    ...(preset ? { materialPreset: preset } : {}),
  }
  const stairs = Object.values(nodes).filter((node) => node.type === 'stair').length
  const railingMode = input.railingMode ?? 'both'
  const stair = StairNode.parse({
    parentId: from.id,
    name: input.name ?? `Staircase ${stairs + 1}`,
    position: [input.x, 0, input.z],
    rotation: (rotation * Math.PI) / 180,
    stairType: 'straight',
    fromLevelId: from.id,
    toLevelId: upper.id,
    slabOpeningMode: owned ? 'destination' : 'none',
    openingOffset: input.openingOffset ?? OPENING_MARGIN,
    width,
    stepCount,
    railingMode,
    ...(preset ? { materialPreset: preset } : {}),
    ...(input.height === undefined ? {} : { totalRise: input.height }),
    ...(asGiven ? { metadata: { openingManaged: 'floor-opening' } } : {}),
    children: [segment.id],
  })
  changes.create.push(
    { node: stair, parentId: from.id },
    { node: { ...segment, parentId: stair.id }, parentId: stair.id },
  )

  // The editor's opening pass: the stair owns a floor opening in each floor it passes; the live
  // opening systems then find it in place. Openings as given are cut as main cuts them: owned by
  // the stair, with the pose the live systems move them by.
  const openingIds: string[] = []
  const built = applySceneChanges(nodes, changes)
  const onLevel = (type: 'slab' | 'ceiling', levelId: string) =>
    Object.values(built).find((node) => node.type === type && node.parentId === levelId)
  const destinationSlab = input.destinationSlabId
    ? built[input.destinationSlabId]
    : onLevel('slab', upper.id)
  const sourceCeiling = input.sourceCeilingId
    ? built[input.sourceCeilingId]
    : onLevel('ceiling', from.id)
  const floorCut = asGiven && cutFloor && !!destinationSlab
  const ceilingCut = asGiven && cutCeiling && !!sourceCeiling
  const adjacent = adjacentLevelId(built, upper.id, -1) === from.id
  const polygon = asGiven
    ? openingRing({ x: input.x, z: input.z, turn: stair.rotation, width, length }, input)
    : []
  const opened = (levelId: string, drawnOn: 'floor' | 'ceiling', cutsAdjacent: boolean) =>
    cutFloorOpening(built, {
      levelId,
      polygon,
      drawnOn,
      source: 'stair',
      ownerId: stair.id,
      cutsAdjacent,
      mintId: generateId,
    }).changes
  const patches = owned
    ? planOwnedFloorOpenings(built, { ownerIds: new Set([stair.id]) })
    : [
        ...(floorCut ? opened(upper.id, 'floor', ceilingCut && adjacent) : []),
        ...(ceilingCut && (!floorCut || !adjacent) ? opened(from.id, 'ceiling', false) : []),
      ]
  for (const patch of patches) {
    if (patch.op === 'create') {
      const node =
        !owned && patch.node.type === 'floor-opening'
          ? {
              ...patch.node,
              metadata: {
                ...patch.node.metadata,
                ownerPose: {
                  position: stair.position,
                  rotation: stair.rotation,
                  width,
                  runLength: length,
                },
                ownerOpeningTarget: patch.node.drawnOn === 'ceiling' ? 'source' : 'destination',
              },
            }
          : patch.node
      changes.create.push({ node, parentId: node.parentId ?? undefined })
      if (node.type === 'floor-opening') openingIds.push(node.id)
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
      railingMode,
      slabHoleCut: openingIds.length > 0,
      ...(openingIds.length ? { openingIds } : {}),
      ...(floorCut ? { destinationSlabId: destinationSlab!.id } : {}),
      ...(ceilingCut ? { sourceCeilingId: sourceCeiling!.id } : {}),
      message: openingIds.length
        ? `Created a staircase at (${input.x}, ${input.z}) with ${stepCount} steps up to ${arrival}, its ${asGiven ? 'opening cut as given' : 'floor opening cut'}.`
        : !cutFloor && !cutCeiling
          ? `Created a staircase at (${input.x}, ${input.z}) with ${stepCount} steps up to ${arrival}${createdUpperLevel ? ' (created for it)' : ''}, with no opening, as asked.`
          : `Created a staircase at (${input.x}, ${input.z}) with ${stepCount} steps up to ${arrival}${createdUpperLevel ? ' (created for it)' : ''}, but no floor there covers the flight, so no opening was cut. Add or align the upper floor over the stair's footprint.`,
    },
    changes,
  }
}
