import { refuse } from '../agent-tools/refusal'
import {
  createMezzanine,
  cutFloorOpening,
  type DeleteZonePayload,
  deleteZone,
  divideZone,
  duplicateZone,
  type FloorFoundationPatch,
  type FloorOpeningHint,
  type HostedZoneTransformPlan,
  lockOutsideFaces,
  mergeZones,
  type NodeChange,
  type Point,
  rebaseFloorReference,
  removeFloorOpening,
  resolveZoneTransformHosts,
  rotateZone,
  setFloorFoundation,
  setRoomFloorConstruction,
  setZoneIntent,
  transformZone,
  type ZoneIntentPatch,
} from '../commands/structure'
import { containsPoint } from '../lib/polygon-boolean'
import { type AnyNode, generateId } from '../schema'
import { mergeSceneChanges } from './apply-changes'
import type { AgentOperation, AgentOperationOutcome, SceneChanges, SceneNodes } from './types'

type RoomPlan = HostedZoneTransformPlan & {
  zoneId?: string
  openingId?: string
  openingIds?: string[]
  hints?: FloorOpeningHint[]
  payload?: DeleteZonePayload
  separatorId?: string
  separatorIds?: string[]
}

/** A plan's ordered changes as one set, landing where applying them one by one does. */
function sceneChanges(changes: readonly NodeChange[]): SceneChanges {
  return mergeSceneChanges(
    changes.map((change) =>
      change.op === 'create'
        ? { create: [{ node: change.node, parentId: change.node.parentId ?? undefined }] }
        : change.op === 'update'
          ? { update: [{ id: change.id, data: change.data }] }
          : { delete: [change.id] },
    ),
  )
}

/** The commands throw a plain Error for an edit they cannot make ("Room not found: …"). */
function plan<T>(command: () => T): T {
  try {
    return command()
  } catch (error) {
    if (error instanceof Error && error.name === 'Error') refuse('structure_refused', error.message)
    throw error
  }
}

/**
 * A room or floor command's plan as a shared tool's outcome, as the editor applies it: conflicts
 * are answers and change nothing unless forced; otherwise the plan's changes, then — once the host
 * has re-derived rooms and ceilings — the copied fixtures onto their new ceilings, and the result's
 * rooms read from the derived scene (a room the reconciler re-minted is found by its seed).
 */
function roomOutcome(nodes: SceneNodes, plan: RoomPlan, force = false): AgentOperationOutcome {
  const result = (zoneId = plan.zoneId, zoneIds?: string[]) => ({
    changes: plan.changes.length,
    ...(zoneId ? { zoneId } : {}),
    ...(plan.openingId ? { openingId: plan.openingId } : {}),
    ...(plan.openingIds ? { openingIds: plan.openingIds } : {}),
    ...(plan.hints ? { hints: plan.hints } : {}),
    ...(plan.idMap
      ? {
          idMap: Object.fromEntries(
            Object.entries(plan.idMap).map(([id, targets]) => [
              id,
              targets.map((target) => (target === plan.zoneId ? zoneId! : target)),
            ]),
          ),
        }
      : {}),
    ...(zoneIds ? { zoneIds } : {}),
    ...(plan.payload ? { payload: plan.payload } : {}),
    ...(plan.separatorId ? { separatorId: plan.separatorId } : {}),
    ...(plan.separatorIds ? { separatorIds: plan.separatorIds } : {}),
    ...(plan.conflicts ? { conflicts: plan.conflicts } : {}),
  })
  if (!plan.changes.length || (plan.conflicts?.length && !force)) return { result: result() }

  let plannedZone: AnyNode | undefined = plan.zoneId ? nodes[plan.zoneId] : undefined
  for (const change of plan.changes) {
    if (change.op === 'create' && change.node.id === plan.zoneId) plannedZone = change.node
    else if (change.op === 'update' && change.id === plan.zoneId && plannedZone?.type === 'zone')
      plannedZone = { ...plannedZone, ...change.data } as AnyNode
  }
  return {
    result: result(),
    changes: sceneChanges(plan.changes),
    afterReconcile: (derived) => {
      let zoneId = plan.zoneId
      if (zoneId && !derived[zoneId] && plannedZone?.type === 'zone' && plannedZone.seed) {
        const { seed, parentId } = plannedZone
        zoneId =
          Object.values(derived).find(
            (node) =>
              node.type === 'zone' &&
              node.parentId === parentId &&
              containsPoint([{ outer: node.polygon, holes: node.holes }], seed),
          )?.id ?? zoneId
      }
      const zoneIds =
        plan.separatorIds?.length && !plan.conflicts?.length
          ? Object.values(derived)
              .filter(
                (node) =>
                  node.type === 'zone' &&
                  plan.separatorIds!.some((id) => node.boundarySeparatorIds.includes(id)),
              )
              .map((node) => node.id)
              .sort()
          : undefined
      const hosts = resolveZoneTransformHosts(derived, plan)
      return {
        result: result(zoneId, zoneIds),
        ...(hosts.length ? { changes: sceneChanges(hosts) } : {}),
      }
    },
  }
}

const points = (list: number[][]) => list as Point[]

type RoomTransformInput = {
  zoneId: string
  translate?: number[]
  rotate?: { angle: number; pivot?: number[] }
  force?: boolean
}
const transform = ({ translate, rotate, ...input }: RoomTransformInput) => ({
  ...input,
  ...(translate ? { translate: translate as Point } : {}),
  ...(rotate
    ? { rotate: { angle: rotate.angle, ...(rotate.pivot ? { pivot: rotate.pivot as Point } : {}) } }
    : {}),
  mintId: generateId,
})

type SlabTarget = { slabId?: string; slabIds?: string[] }

const cutFloorOpeningOperation: AgentOperation<{
  levelId?: string
  zoneId?: string
  levelIds?: string[]
  polygon?: number[][]
  rect?: { x: number; z: number; width: number; depth: number }
  drawnOn?: 'floor' | 'ceiling'
  cutsPrimary?: boolean
  cutsAdjacent?: boolean
}> = (nodes, { polygon, ...input }) =>
  roomOutcome(
    nodes,
    plan(() =>
      cutFloorOpening(nodes, {
        ...input,
        ...(polygon ? { polygon: points(polygon) } : {}),
        mintId: generateId,
      }),
    ),
  )

const removeFloorOpeningOperation: AgentOperation<{ id: string }> = (nodes, { id }) =>
  roomOutcome(
    nodes,
    plan(() => removeFloorOpening(nodes, id)),
  )

const setFloorFoundationOperation: AgentOperation<SlabTarget & { patch: unknown }> = (
  nodes,
  input,
) =>
  roomOutcome(
    nodes,
    plan(() => setFloorFoundation(nodes, { ...input, patch: input.patch as FloorFoundationPatch })),
  )

const setRoomFloorConstructionOperation: AgentOperation<{
  zoneId: string
  slabId?: string
  patch: unknown
}> = (nodes, input) =>
  roomOutcome(
    nodes,
    plan(() =>
      setRoomFloorConstruction(nodes, { ...input, patch: input.patch as FloorFoundationPatch }),
    ),
  )

const rebaseFloorReferenceOperation: AgentOperation<
  SlabTarget & { referenceFloorElevation: number | null }
> = (nodes, input) =>
  roomOutcome(
    nodes,
    plan(() => rebaseFloorReference(nodes, input)),
  )

const createMezzanineOperation: AgentOperation<{
  hostZoneId: string
  polygon: number[][]
  elevation?: number
  thickness?: number
}> = (nodes, input) =>
  roomOutcome(
    nodes,
    plan(() =>
      createMezzanine(nodes, { ...input, polygon: points(input.polygon), mintId: generateId }),
    ),
  )

const moveZoneOperation: AgentOperation<RoomTransformInput> = (nodes, input) =>
  roomOutcome(
    nodes,
    plan(() => transformZone(nodes, transform(input))),
    input.force,
  )

const duplicateZoneOperation: AgentOperation<RoomTransformInput & { translate: number[] }> = (
  nodes,
  input,
) =>
  roomOutcome(
    nodes,
    plan(() => duplicateZone(nodes, { ...transform(input), translate: input.translate as Point })),
    input.force,
  )

const rotateZoneOperation: AgentOperation<{
  zoneId: string
  quarterTurns: number
  gridStep?: number
  force?: boolean
}> = (nodes, input) =>
  roomOutcome(
    nodes,
    plan(() =>
      rotateZone(nodes, {
        ...input,
        quarterTurns: input.quarterTurns as 1 | -1,
        mintId: generateId,
      }),
    ),
    input.force,
  )

const lockOutsideFacesOperation: AgentOperation<{ levelId?: string; zoneIds?: string[] }> = (
  nodes,
  { levelId, zoneIds },
) => {
  if (Boolean(levelId) === Boolean(zoneIds))
    refuse('target_required', 'Supply either levelId or zoneIds.')
  return roomOutcome(
    nodes,
    plan(() => lockOutsideFaces(nodes, levelId ? { levelId } : { zoneIds: zoneIds! })),
  )
}

const setZoneIntentOperation: AgentOperation<{ zoneId: string; patch: unknown }> = (nodes, input) =>
  roomOutcome(
    nodes,
    plan(() => setZoneIntent(nodes, { ...input, patch: input.patch as ZoneIntentPatch })),
  )

const divideZoneOperation: AgentOperation<{
  zoneId: string
  cut?: number[][]
  path?: number[][]
  closed?: boolean
  startBoundaryId?: string
  endBoundaryId?: string
}> = (nodes, { cut, path, ...input }) =>
  roomOutcome(
    nodes,
    plan(() =>
      divideZone(nodes, {
        ...input,
        ...(cut ? { cut: points(cut) as [Point, Point] } : {}),
        ...(path ? { path: points(path) } : {}),
        mintId: generateId,
      }),
    ),
  )

const mergeZonesOperation: AgentOperation<{ zoneIds: string[] }> = (nodes, { zoneIds }) =>
  roomOutcome(
    nodes,
    plan(() => mergeZones(nodes, { zoneIds: zoneIds as [string, string] })),
  )

const deleteZoneOperation: AgentOperation<{ zoneId: string; contents: 'delete' | 'keep' }> = (
  nodes,
  input,
) =>
  roomOutcome(
    nodes,
    plan(() => deleteZone(nodes, input)),
  )

/** The room and floor-construction tools' operations, by tool name. */
export const ROOM_OPERATIONS = {
  cut_floor_opening: cutFloorOpeningOperation,
  remove_floor_opening: removeFloorOpeningOperation,
  set_floor_foundation: setFloorFoundationOperation,
  set_room_floor_construction: setRoomFloorConstructionOperation,
  rebase_floor_reference: rebaseFloorReferenceOperation,
  create_mezzanine: createMezzanineOperation,
  move_zone: moveZoneOperation,
  duplicate_zone: duplicateZoneOperation,
  rotate_zone: rotateZoneOperation,
  lock_outside_faces: lockOutsideFacesOperation,
  set_zone_intent: setZoneIntentOperation,
  divide_zone: divideZoneOperation,
  merge_zones: mergeZonesOperation,
  delete_zone: deleteZoneOperation,
} as const
