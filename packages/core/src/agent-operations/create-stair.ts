import { refuse } from '../agent-tools/refusal'
import type { CreateStairInput } from '../agent-tools/stairs'
import { levelBuildingId } from '../building/level-duplication'
import { cutFloorOpening } from '../commands/structure/floor-opening'
import { adjacentLevelId } from '../lib/floor-opening-intent'
import { area, intersection } from '../lib/polygon-boolean'
import { type AnyNode, type AnyNodeId, generateId, LevelNode, StairNode } from '../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../services/level-height'
import { getLevelFloorToFloorHeight } from '../services/storey'
import { planOwnedFloorOpenings } from '../systems/owned-floor-openings'
import {
  rotateXZ,
  type StairFootprintAABB,
  stairArrivalOpening,
  stairFootprintAABB,
  stairSegmentFootprints,
} from '../systems/stair/stair-footprint'
import { planStairPreset, type StairPresetOptions } from '../systems/stair/stair-presets'
import { applySceneChanges } from './apply-changes'
import { requireLevel, targetLevel } from './level-target'
import { finishSurface, requireMaterialRef } from './material-refs'
import { refuseRoofLevel } from './roof-writes'
import { levelsOf, queryNodes } from './scene-queries'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

/** The margin round a stair's opening when none is given, as the editor's stair tool cuts it. */
const OPENING_MARGIN = 0.08

type Pt = [number, number]

const KIND = { straight: 'a staircase', l: 'an L staircase', u: 'a U staircase' } as const

const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * The opening as asked, in level metres: its size plus the margin on every side, round its centre,
 * turned as asked. By default it is the stair's footprint in the stair's own frame (`box`), turned
 * with the stair.
 */
function openingRing(stair: StairNode, box: StairFootprintAABB, input: CreateStairInput): Pt[] {
  const margin = input.openingOffset ?? OPENING_MARGIN
  const half = [
    (input.openingWidth ?? box.maxX - box.minX) / 2 + margin,
    (input.openingLength ?? box.maxZ - box.minZ) / 2 + margin,
  ] as const
  const middle = rotateXZ((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2, stair.rotation)
  const [cx, cz] = (input.openingCenter as Pt | undefined) ?? [
    stair.position[0] + middle[0],
    stair.position[2] + middle[1],
  ]
  const turn =
    input.openingRotation === undefined ? stair.rotation : (input.openingRotation * Math.PI) / 180
  return (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([sx, sz]): Pt => {
    const [dx, dz] = rotateXZ(sx * half[0], sz * half[1], turn)
    return [cx + dx, cz + dz]
  })
}

/** The flights and landings, as fit_stair lays them out; a layout that cannot be built is refused. */
function planFlights(
  draft: StairNode,
  nodes: Record<string, AnyNode>,
  options: StairPresetOptions,
) {
  try {
    return planStairPreset(draft, nodes, options)
  } catch (error) {
    if (error instanceof RangeError)
      refuse('stair_layout', `${error.message}.`, {
        layout: options.layout,
        ...(options.stepCount === undefined ? {} : { steps: options.stepCount }),
        ...(options.lowerStepCount === undefined ? {} : { lowerSteps: options.lowerStepCount }),
      })
    throw error
  }
}

/**
 * `create_stair`: a straight, L or U stair placed as the editor's stair tool places one — rising to
 * the next level (made when there is none), its floor openings owned and cut by the stair — or a
 * flight to no level, which rises as asked and cuts nothing. With the opening controls
 * create_stair_between_levels had, the opening is cut as given instead, owned by the stair as main's
 * are, and the stair's own opening is off so nothing is cut twice.
 */
export const createStair: AgentOperation<CreateStairInput> = (nodes, input, context) => {
  const from = targetLevel(nodes, input, context)
  refuseRoofLevel(nodes, from.id, 'a stair')
  const layout = input.layout ?? 'straight'
  if (layout === 'straight' && (input.turn || input.lowerSteps !== undefined))
    refuse(
      'stair_layout_required',
      'turn and lowerSteps shape an L or U stair: give layout "l" or "u", or leave them out.',
      { levelId: from.id },
    )
  const preset =
    input.materialPreset === undefined
      ? undefined
      : requireMaterialRef(input.materialPreset, 'materialPreset', finishSurface('stair'))
  const railingPreset =
    input.railingMaterial === undefined
      ? undefined
      : requireMaterialRef(input.railingMaterial, 'railingMaterial')
  const toNoLevel = input.toLevelId === null
  // An opening of its own size, centre or turn, or through a surface named.
  const shaped = [
    input.destinationSlabId,
    input.sourceCeilingId,
    input.openingWidth,
    input.openingLength,
    input.openingCenter,
    input.openingRotation,
  ].some((value) => value !== undefined)
  if (
    toNoLevel &&
    (shaped ||
      input.openingOffset !== undefined ||
      input.createDestinationSlabOpening ||
      input.createSourceCeilingOpening)
  )
    refuse(
      'no_level_above',
      'A flight to no level cuts no opening: name the level it arrives on (toLevelId), or leave the opening out.',
      { levelId: from.id },
    )
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
  const cutFloor = !toNoLevel && input.createDestinationSlabOpening !== false
  const cutCeiling = !toNoLevel && input.createSourceCeilingOpening !== false
  const asGiven = cutFloor !== cutCeiling || shaped
  const owned = cutFloor && cutCeiling && !asGiven

  const changes: Required<Omit<SceneChanges, 'materials'>> = {
    create: [],
    update: [],
    delete: [],
    collections: {},
  }
  const upper = toNoLevel ? undefined : levelAbove(nodes, from, input, changes)

  const withUpper = applySceneChanges(nodes, changes)
  const rotation = input.rotation ?? 0
  const width = input.width ?? 1
  const stairs = queryNodes(nodes, { type: 'stair' }).length
  const railingMode = input.railingMode ?? 'both'
  // A flight to no level rises as asked, else its storey's height, and keeps that rise; one to a
  // level follows the storey (no totalRise) and keeps tracking it.
  const totalRise =
    input.height ?? (toNoLevel ? getLevelFloorToFloorHeight(from.id, nodes) : undefined)
  const draft = StairNode.parse({
    parentId: from.id,
    name: input.name ?? `Staircase ${stairs + 1}`,
    position: [input.x, 0, input.z],
    rotation: (rotation * Math.PI) / 180,
    stairType: 'straight',
    uniformRisers: true,
    fromLevelId: from.id,
    toLevelId: upper?.id ?? null,
    slabOpeningMode: owned ? 'destination' : 'none',
    openingOffset: input.openingOffset ?? OPENING_MARGIN,
    width,
    railingMode,
    ...(input.railingStyle ? { railingStyle: input.railingStyle } : {}),
    ...(railingPreset ? { railingMaterialPreset: railingPreset } : {}),
    ...(preset ? { materialPreset: preset } : {}),
    ...(totalRise === undefined ? {} : { totalRise }),
    ...(asGiven ? { metadata: { openingManaged: 'floor-opening' } } : {}),
    children: [],
  })
  // As main sizes a new stair: the risers and the run from the stair's design targets unless given,
  // the rise resolved against what the stair stands on and arrives at.
  const plan = planFlights(
    draft,
    {
      ...withUpper,
      [from.id]: {
        ...withUpper[from.id],
        children: [...(withUpper[from.id] as LevelNode).children, draft.id],
      } as AnyNode,
      [draft.id]: draft,
    },
    {
      layout,
      turn: input.turn,
      width,
      stepCount: input.steps,
      runLength: input.length,
      lowerStepCount: input.lowerSteps,
    },
  )
  const stair = plan.stair
  const segments = plan.segments.map((segment) =>
    preset ? { ...segment, materialPreset: preset } : segment,
  )
  changes.create.push(
    { node: stair, parentId: from.id },
    ...segments.map((segment) => ({ node: segment, parentId: stair.id })),
  )

  // The editor's opening pass: the stair owns a floor opening in each floor it passes; the live
  // opening systems then find it in place. Openings as given are cut as main cuts them: owned by
  // the stair, with the pose the live systems move them by.
  const openingIds: string[] = []
  // A hole in the slab above, not one in the ceiling below: the floor upstairs is open.
  let slabHoleCut = false
  const built = applySceneChanges(nodes, changes)
  const footprint = stairFootprintAABB(stair, built)!
  // The footprint in the stair's own frame: the opening as given by default, and the box its owner
  // pose keeps so the opening follows the stair's shape.
  const local = stairFootprintAABB({ ...stair, position: [0, 0, 0], rotation: 0 }, built)!
  const polygon = asGiven ? openingRing(stair, local, input) : []
  // The surface over the flights and landings, not the storey's first: a floor of several rooms
  // has a slab (and a ceiling below) per room, and an L's inside corner may lie in another.
  const outlines = stairSegmentFootprints(stair, built)
  const over = (type: 'slab' | 'ceiling', levelId: string) => {
    let most = 1e-6
    let surface: AnyNode | undefined
    for (const node of Object.values(built)) {
      if (node.type !== type || node.parentId !== levelId) continue
      const covered = outlines.reduce(
        (sum, outline) => sum + area(intersection(node.polygon, outline)),
        0,
      )
      if (covered > most) [most, surface] = [covered, node]
    }
    return surface
  }
  const destinationSlab = !upper
    ? undefined
    : input.destinationSlabId
      ? built[input.destinationSlabId]
      : over('slab', upper.id)
  const sourceCeiling = input.sourceCeilingId
    ? built[input.sourceCeilingId]
    : over('ceiling', from.id)
  const floorCut = asGiven && cutFloor && !!destinationSlab
  const ceilingCut = asGiven && cutCeiling && !!sourceCeiling
  const adjacent = !!upper && adjacentLevelId(built, upper.id, -1) === from.id
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
        ...(floorCut && upper ? opened(upper.id, 'floor', ceilingCut && adjacent) : []),
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
                  runLength: segments[0]!.length,
                  footprint: local,
                },
                ownerOpeningTarget: patch.node.drawnOn === 'ceiling' ? 'source' : 'destination',
              },
            }
          : patch.node
      changes.create.push({ node, parentId: node.parentId ?? undefined })
      if (node.type === 'floor-opening') {
        openingIds.push(node.id)
        if (node.drawnOn !== 'ceiling') slabHoleCut = true
      }
    } else if (patch.op === 'update') changes.update.push({ id: patch.id, data: patch.data })
    else changes.delete.push(patch.id)
  }

  const flights = segments.filter((segment) => segment.segmentType === 'stair')
  const rise = round(segments.reduce((sum, segment) => sum + segment.height, 0))
  const length = round(flights.reduce((sum, flight) => sum + flight.length, 0))
  const arrivalEdge = stairArrivalOpening(stair, built)
  const arrival = arrivalEdge.length
    ? ([
        round(arrivalEdge.reduce((sum, [x]) => sum + x, 0) / arrivalEdge.length),
        round(arrivalEdge.reduce((sum, [, z]) => sum + z, 0) / arrivalEdge.length),
      ] as Pt)
    : undefined
  const createdUpperLevel = !!upper && !nodes[upper.id]
  const arrivesOn = upper ? (upper.name ?? `level ${upper.level}`) : undefined
  const at = `${KIND[layout]} at (${input.x}, ${input.z}) with ${stair.stepCount} steps`
  return {
    result: {
      ok: true,
      stairId: stair.id,
      segmentIds: stair.children,
      fromLevelId: from.id,
      upperLevelId: upper?.id ?? null,
      createdUpperLevel,
      layout,
      ...(layout === 'straight' ? {} : { turn: input.turn ?? 'left' }),
      stepCount: stair.stepCount,
      rise,
      rotation,
      width,
      length,
      railingMode,
      footprint: {
        minX: round(footprint.minX),
        minZ: round(footprint.minZ),
        maxX: round(footprint.maxX),
        maxZ: round(footprint.maxZ),
      },
      ...(arrival ? { arrival } : {}),
      slabHoleCut,
      ...(openingIds.length ? { openingIds } : {}),
      ...(floorCut ? { destinationSlabId: destinationSlab!.id } : {}),
      ...(ceilingCut ? { sourceCeilingId: sourceCeiling!.id } : {}),
      message: !upper
        ? `Created ${at} rising ${rise} m to no level, so it cuts no opening.`
        : openingIds.length
          ? `Created ${at} up to ${arrivesOn}, its ${asGiven ? 'opening cut as given' : 'floor opening cut'}.`
          : !cutFloor && !cutCeiling
            ? `Created ${at} up to ${arrivesOn}${createdUpperLevel ? ' (created for it)' : ''}, with no opening, as asked.`
            : `Created ${at} up to ${arrivesOn}${createdUpperLevel ? ' (created for it)' : ''}, but no floor there covers the flight, so no opening was cut. Add or align the upper floor over the stair's footprint.`,
    },
    changes,
  }
}

/**
 * The level a stair arrives on: the one named, else the next one up its building, else a blank
 * level made above for it (added to `changes`). Refused: no building, a level not above, a roof
 * level, a slab or ceiling named on another storey.
 */
function levelAbove(
  nodes: SceneNodes,
  from: LevelNode,
  input: CreateStairInput,
  changes: Required<Omit<SceneChanges, 'materials'>>,
): LevelNode {
  const buildingId = levelBuildingId(nodes as Record<AnyNodeId, AnyNode>, from)
  const building = buildingId ? nodes[buildingId] : undefined
  if (building?.type !== 'building')
    refuse('no_building', `Level ${from.id} is not in a building, so it has no floor above.`, {
      levelId: from.id,
    })
  const floors = levelsOf(nodes).filter(
    (level) => level.parentId === building.id || building.children.includes(level.id),
  )
  const upper = input.toLevelId
    ? requireLevel(nodes, input.toLevelId)
    : floors.find((level) => level.level > from.level)
  if (upper && (upper.level <= from.level || !floors.includes(upper)))
    refuse(
      'not_above',
      `${upper.id} is not above ${from.id} in its building: a flight rises to a higher floor.`,
      { levelId: from.id, toLevelId: upper.id },
    )
  if (upper) refuseRoofLevel(nodes, upper.id, 'a stair')
  // The flight cuts the slab of the floor it arrives at and the ceiling of the one it leaves.
  if (input.destinationSlabId && nodes[input.destinationSlabId]!.parentId !== upper?.id)
    refuse(
      'slab_not_on_level',
      `Slab ${input.destinationSlabId} is not on ${upper?.id ?? 'the floor above'}, the floor the flight arrives at: name a slab there, or leave it out.`,
      { slabId: input.destinationSlabId, levelId: upper?.id ?? null },
    )
  if (input.sourceCeilingId && nodes[input.sourceCeilingId]!.parentId !== from.id)
    refuse(
      'ceiling_not_on_level',
      `Ceiling ${input.sourceCeilingId} is not on ${from.id}, the floor the flight leaves: name a ceiling there, or leave it out.`,
      { ceilingId: input.sourceCeilingId, levelId: from.id },
    )
  if (upper) return upper
  const made = LevelNode.parse({
    parentId: building.id,
    level: from.level + 1,
    height: DEFAULT_LEVEL_HEIGHT,
    children: [],
  })
  changes.create.push({ node: made, parentId: building.id })
  return made
}
