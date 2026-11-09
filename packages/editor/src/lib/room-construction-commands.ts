import {
  type AnyNode,
  type AnyNodeId,
  area,
  type CeilingNode,
  checkRoomFloor,
  clampRoomFloorHandle,
  containsPoint,
  GROUND_SUPPORT_ID,
  generateId,
  getRoomBaseElevation,
  getRoomRelativeFloorElevation,
  intersection,
  isDerivedNode,
  justificationForFaceOnLine,
  lockOutsideFaces,
  type NodeChange,
  planWallJustification,
  resolveCeilingHeight,
  roomFloorElevationFromRelative,
  roomSideFaces,
  runAsSingleSceneHistoryStep,
  type StructureConflict,
  type StructureNodes,
  type StructurePlan,
  setZoneEdges,
  setZoneIntent,
  useScene,
} from '@pascal-app/core'
import useDeleteConfirmation, {
  type DeleteConfirmationRequest,
} from '../store/use-delete-confirmation'
import useEditor from '../store/use-editor'
import { footprintHeightValue } from './floor-footprints'
import { roomOwnPlate, roomSharedFootprint } from './room-built-on'
import { roomClearPolygon, roomConstructionState, roomFloorContents } from './room-construction'
import {
  mezzanineElevationBounds,
  ownFloorElevationBounds,
  planRoomElevation,
  roomFloorElevation,
} from './room-handle-drag'
import { applyRoomPlan } from './room-structure-commands'
import { showRoomNotice } from './room-transform-session'

export type RoomConstructionPart = 'floor' | 'walls' | 'ceiling'
export type RoomConstructionResult =
  | { status: 'applied' | 'unchanged' | 'confirming' }
  | { status: 'conflict'; message: string }

// Planner messages address callers ("Pass dropOpenings…"); the panel speaks to people.
const CONFLICT_MESSAGES: Record<string, string> = {
  'covered-existing-wall': 'A wall already runs along this edge.',
  'segment-too-short': 'An edge is too short for a wall.',
  'occupied-split': 'An opening sits where the wall would split.',
  'overlapping-spans': 'The room changed. Try again.',
  'invalid-span': 'The room changed. Try again.',
  'stale-span': 'The room changed. Try again.',
  'mixed-exterior-faces': 'A wall is outside on both faces. Divide it first.',
  'junction-conflict': 'Locking would break a room on this floor.',
}

/** Clear floor area new walls may take before Add walls asks first, m². */
export const TRIVIAL_AREA_LOSS = 0.01

export function roomConflictMessage(conflicts: readonly StructureConflict[] = []) {
  return [...new Set(conflicts.map((c) => CONFLICT_MESSAGES[c.code] ?? c.message))].join(' ')
}

function commit(plan: StructurePlan): RoomConstructionResult {
  if (plan.conflicts?.length)
    return { status: 'conflict', message: roomConflictMessage(plan.conflicts) }
  if (!plan.changes.length) return { status: 'unchanged' }
  applyRoomPlan(plan)
  return { status: 'applied' }
}

const nodes = (): StructureNodes => useScene.getState().nodes
const sorted = (ids: readonly string[]) => [...ids].sort()
const deletes = (ids: readonly string[]) =>
  ids.map((id): NodeChange => ({ op: 'delete', id: id as AnyNodeId }))

/**
 * Opens the house confirmation for one described change. At confirm time the
 * choice re-derives what the dialog showed; when the scene moved on (a door
 * added, an item placed) it re-asks with the new picture instead of applying.
 */
function ask(
  zoneId: string,
  request: Omit<DeleteConfirmationRequest, 'onConfirm' | 'onKeepContents'>,
  choices: {
    /** What the dialog shows, recomputed from the scene at the moment of choice. */
    shown: () => unknown
    reask: () => RoomConstructionResult
    confirm: () => void
    keep?: () => void
  },
): RoomConstructionResult {
  const shown = JSON.stringify(choices.shown())
  const guarded = (apply: () => void) => () => {
    if (!nodes()[zoneId as AnyNodeId]) return
    if (JSON.stringify(choices.shown()) !== shown) {
      choices.reask()
      return
    }
    apply()
  }
  useDeleteConfirmation.getState().requestConfirmation({
    ...request,
    onConfirm: guarded(choices.confirm),
    onKeepContents: choices.keep && guarded(choices.keep),
  })
  return { status: 'confirming' }
}

/** Turns the room's unshared wall spans into separators; shared walls stay. */
export function roomWallRemovalPlan(
  scene: StructureNodes,
  zoneId: string,
  dropOpenings: boolean,
  mintId = generateId,
): StructurePlan {
  const removable = roomConstructionState(scene, zoneId)?.walls.removable ?? []
  if (!removable.length) return { changes: [] }
  return setZoneEdges(scene, {
    zoneId,
    edges: removable.map((spanRef) => ({ spanRef, kind: 'separator' as const })),
    dropOpenings,
    mintId,
  })
}

/** Turns the room's separator spans into walls with the wall tool's thickness and height. */
export function roomWallAdditionPlan(
  scene: StructureNodes,
  zoneId: string,
  mintId = generateId,
): StructurePlan {
  const separators = roomConstructionState(scene, zoneId)?.walls.separators ?? []
  if (!separators.length) return { changes: [] }
  const defaults = useEditor.getState().toolDefaults.wall
  const wall = {
    ...(typeof defaults?.thickness === 'number' && { thickness: defaults.thickness }),
    ...(typeof defaults?.height === 'number' && { height: defaults.height }),
  }
  return setZoneEdges(scene, {
    zoneId,
    edges: separators.map((spanRef) => ({ spanRef, kind: 'wall' as const, wall })),
    mintId,
  })
}

function applyChanges(scene: StructureNodes, changes: readonly NodeChange[]): StructureNodes {
  const next: Record<string, AnyNode> = { ...scene }
  for (const change of changes) {
    if (change.op === 'delete') delete next[change.id]
    else if (change.op === 'create') next[change.node.id] = change.node
    else if (next[change.id]) next[change.id] = { ...next[change.id], ...change.data } as AnyNode
  }
  return next
}

const clearArea = (scene: StructureNodes, zoneId: string) => {
  const clear = roomClearPolygon(scene, zoneId)
  return clear ? area([clear]) : 0
}

/** Add walls, with how many walls it builds and the clear floor area the room gives up to them. */
export function roomWallAdditionPreview(
  scene: StructureNodes,
  zoneId: string,
  mintId = generateId,
) {
  const plan = roomWallAdditionPlan(scene, zoneId, mintId)
  if (plan.conflicts?.length || !plan.changes.length) return { plan, wallCount: 0, areaLoss: 0 }
  const after = applyChanges(scene, plan.changes)
  return {
    plan,
    // One per separator built on; splitting the walls it meets is not news.
    wallCount: roomConstructionState(scene, zoneId)?.walls.separators.length ?? 0,
    areaLoss: Math.max(0, clearArea(scene, zoneId) - clearArea(after, zoneId)),
  }
}

function requestWallAddition(zoneId: string): RoomConstructionResult {
  const preview = roomWallAdditionPreview(nodes(), zoneId)
  if (preview.areaLoss <= TRIVIAL_AREA_LOSS) return commit(preview.plan)
  const state = roomConstructionState(nodes(), zoneId)!
  return ask(
    zoneId,
    {
      count: preview.wallCount,
      construction: {
        part: 'walls',
        action: 'add',
        roomName: state.name,
        hostedIds: [],
        wallCount: preview.wallCount,
        areaLoss: preview.areaLoss,
      },
    },
    {
      shown: () => {
        const current = roomWallAdditionPreview(nodes(), zoneId)
        return {
          separators: roomConstructionState(nodes(), zoneId)?.walls.separators,
          walls: current.wallCount,
          loss: current.areaLoss.toFixed(2),
        }
      },
      reask: () => requestWallAddition(zoneId),
      confirm: () => commit(roomWallAdditionPlan(nodes(), zoneId)),
    },
  )
}

/** What a wall removal takes along: the openings/objects it hosts and every node it deletes. */
function wallRemovalOutcome(zoneId: string) {
  const scene = nodes()
  const preview = roomWallRemovalPlan(scene, zoneId, false)
  const final = roomWallRemovalPlan(scene, zoneId, true)
  const deleted = final.changes.flatMap((c) => (c.op === 'delete' ? [c.id as string] : []))
  // The planner stops at the first wall that hosts something, so its conflict
  // names only that wall's openings; the confirmed plan's deletions name them all.
  const asks = preview.conflicts?.some((c) => c.code === 'hosted-openings')
  return {
    preview,
    final,
    hostedIds: asks
      ? deleted.filter((id) => scene[id]?.type !== 'wall' && scene[id]?.type !== 'separator')
      : null,
    deleted: sorted(deleted),
  }
}

function requestWallRemoval(zoneId: string): RoomConstructionResult {
  const outcome = wallRemovalOutcome(zoneId)
  if (!outcome.hostedIds) return commit(outcome.preview)
  const state = roomConstructionState(nodes(), zoneId)!
  return ask(
    zoneId,
    {
      count: outcome.hostedIds.length,
      construction: {
        part: 'walls',
        roomName: state.name,
        hostedIds: outcome.hostedIds,
        wallCount: new Set(state.walls.removable.map((span) => span.boundaryId)).size,
        sharedWalls: state.walls.sharedWallIds.length > 0,
      },
      conflict: outcome.final.conflicts?.length
        ? roomConflictMessage(outcome.final.conflicts)
        : undefined,
    },
    {
      // A door placed while the dialog is open changes both; neither may slip through.
      shown: () => {
        const current = wallRemovalOutcome(zoneId)
        return { hosted: sorted(current.hostedIds ?? []), deleted: current.deleted }
      },
      reask: () => requestWallRemoval(zoneId),
      confirm: () => commit(roomWallRemovalPlan(nodes(), zoneId, true)),
    },
  )
}

/** Moves a ceiling-hung node onto the level at the height it hangs at now. */
function dropFromCeiling(scene: StructureNodes, id: string): NodeChange[] {
  const node = scene[id]
  const ceiling = node?.parentId ? scene[node.parentId] : undefined
  if (!(node && ceiling?.type === 'ceiling' && 'position' in node)) return []
  const [x, y, z] = node.position as [number, number, number]
  return [
    {
      op: 'update',
      id: node.id,
      data: {
        parentId: ceiling.parentId,
        position: [x, y + resolveCeilingHeight(ceiling, scene), z],
      } as Partial<AnyNode>,
    },
  ]
}

function ceilingRemovalOutcome(zoneId: string) {
  const ceiling = roomConstructionState(nodes(), zoneId)?.ceiling
  return {
    manualIds: ceiling?.manualIds ?? [],
    hostedIds: [...(ceiling?.hostedIds ?? []), ...(ceiling?.manualHostedIds ?? [])],
  }
}

/** Names of the other rooms a hand-drawn ceiling also covers. */
function alsoCovers(scene: StructureNodes, zoneId: string, ceilings: CeilingNode[]) {
  const outline = ceilings.map((c) => ({ outer: c.polygon, holes: c.holes }))
  return Object.values(scene).flatMap((node) =>
    node.type === 'zone' &&
    node.spaceRole === 'room' &&
    node.id !== zoneId &&
    node.parentId === scene[zoneId]?.parentId &&
    area(intersection({ outer: node.polygon, holes: node.holes ?? [] }, outline)) >
      TRIVIAL_AREA_LOSS
      ? [node.name.trim() || 'another room']
      : [],
  )
}

function requestCeilingRemoval(zoneId: string): RoomConstructionResult {
  const state = roomConstructionState(nodes(), zoneId)
  if (!state) return { status: 'unchanged' }
  const { manualIds, hostedIds } = ceilingRemovalOutcome(zoneId)
  const plan = (keep: boolean): StructurePlan => {
    const scene = nodes()
    const intent = setZoneIntent(scene, { zoneId, patch: { hasCeiling: false } })
    return {
      ...intent,
      changes: [
        ...intent.changes,
        ...(keep ? hostedIds.flatMap((id) => dropFromCeiling(scene, id)) : deletes(hostedIds)),
        ...deletes(manualIds),
      ],
    }
  }
  if (!(hostedIds.length || manualIds.length)) return commit(plan(false))
  const manual = manualIds.map((id) => nodes()[id] as CeilingNode)
  return ask(
    zoneId,
    {
      count: hostedIds.length + manualIds.length,
      construction: {
        part: 'ceiling',
        roomName: state.name,
        hostedIds,
        manualCeilings: manual.map((c) => c.name?.trim() ?? ''),
        alsoCovers: alsoCovers(nodes(), zoneId, manual),
      },
    },
    {
      shown: () => {
        const current = ceilingRemovalOutcome(zoneId)
        return { manual: sorted(current.manualIds), hosted: sorted(current.hostedIds) }
      },
      reask: () => requestCeilingRemoval(zoneId),
      confirm: () => commit(plan(false)),
      keep: hostedIds.length ? () => commit(plan(true)) : undefined,
    },
  )
}

function requestFloorRemoval(zoneId: string): RoomConstructionResult {
  const state = roomConstructionState(nodes(), zoneId)
  if (!state) return { status: 'unchanged' }
  const contents = roomFloorContents(nodes(), zoneId)
  const plan = (keep: boolean): StructurePlan => {
    const scene = nodes()
    const intent = setZoneIntent(scene, { zoneId, patch: { hasFloor: false } })
    const levelId = scene[zoneId]?.parentId
    // Kept items rest on the level base instead, lifted by the plate they stood on.
    const kept = contents.flatMap(({ id, elevation }): NodeChange[] => {
      const node = scene[id]
      if (!(node && 'position' in node)) return []
      const [x, y, z] = node.position as [number, number, number]
      return [
        {
          op: 'update',
          id: node.id,
          data: {
            position: [x, y + elevation, z],
            supportSlabId: GROUND_SUPPORT_ID,
            ...(node.parentId !== levelId && { parentId: levelId }),
          } as Partial<AnyNode>,
        },
      ]
    })
    return {
      ...intent,
      changes: [
        ...intent.changes,
        ...(keep ? kept : deletes(contents.map((content) => content.id))),
      ],
    }
  }
  if (!contents.length) return commit(plan(false))
  const ids = contents.map((content) => content.id)
  return ask(
    zoneId,
    { count: ids.length, construction: { part: 'floor', roomName: state.name, hostedIds: ids } },
    {
      shown: () => roomFloorContents(nodes(), zoneId),
      reask: () => requestFloorRemoval(zoneId),
      confirm: () => commit(plan(false)),
      keep: () => commit(plan(true)),
    },
  )
}

/**
 * Adds a construction part in one undo step: clears the room's opt-out
 * (floor, ceiling) or builds walls on its separators. Walls that would eat
 * into the room's clear floor ask first (`status: 'confirming'`).
 */
export function addRoomConstruction(
  zoneId: string,
  part: RoomConstructionPart,
): RoomConstructionResult {
  if (part === 'walls') return requestWallAddition(zoneId)
  const patch = part === 'floor' ? { hasFloor: true } : { hasCeiling: true }
  return commit(setZoneIntent(nodes(), { zoneId, patch }))
}

/**
 * Removes a construction part in one undo step. Walls that would take doors,
 * windows or objects with them, ceilings holding items or drawn by hand, and
 * floors with furniture standing on them ask first through the house
 * confirmation (`status: 'confirming'`).
 */
export function removeRoomConstruction(
  zoneId: string,
  part: RoomConstructionPart,
): RoomConstructionResult {
  if (part === 'walls') return requestWallRemoval(zoneId)
  if (part === 'ceiling') return requestCeilingRemoval(zoneId)
  return requestFloorRemoval(zoneId)
}

/**
 * Keeps the hand-drawn ceiling over the room as its ceiling: clears the
 * opt-out, and the reconciler, seeing the room covered, generates none.
 */
export function adoptExistingCeiling(zoneId: string): RoomConstructionResult {
  return commit(setZoneIntent(nodes(), { zoneId, patch: { hasCeiling: true } }))
}

/**
 * Swaps the hand-drawn ceiling(s) over the room for generated room ceilings
 * in one undo step. What hung from them moves onto whichever new ceiling
 * covers it, at the same drop; anything left uncovered stays at its height.
 */
export function replaceRoomCeiling(zoneId: string): RoomConstructionResult {
  const state = roomConstructionState(nodes(), zoneId)
  if (!state?.ceiling.manualIds.length) return { status: 'unchanged' }
  const scene = nodes()
  const { manualIds, manualHostedIds } = state.ceiling
  const intent = setZoneIntent(scene, { zoneId, patch: { hasCeiling: true } })
  return runAsSingleSceneHistoryStep(useScene, () => {
    const result = commit({
      changes: [
        ...intent.changes,
        ...manualHostedIds.flatMap((id) => dropFromCeiling(scene, id)),
        ...deletes(manualIds),
      ],
    })
    if (result.status !== 'applied') return result
    const after = nodes()
    const generated = Object.values(after).filter(
      (node): node is CeilingNode =>
        node.type === 'ceiling' && node.parentId === scene[zoneId]?.parentId && isDerivedNode(node),
    )
    const rehung = manualHostedIds.flatMap((id): NodeChange[] => {
      const original = scene[id]
      if (!(original && after[id] && 'position' in original)) return []
      const [x, , z] = original.position as [number, number, number]
      const host = generated.find((ceiling) =>
        containsPoint([{ outer: ceiling.polygon, holes: ceiling.holes }], [x, z]),
      )
      return host
        ? [
            {
              op: 'update',
              id: original.id,
              data: { parentId: host.id, position: original.position } as Partial<AnyNode>,
            },
          ]
        : []
    })
    if (rehung.length) applyRoomPlan({ changes: rehung })
    return result
  })
}

/** Justifies the room's exterior walls so their outside faces stay put. One undo step. */
export function lockRoomOutsideFaces(zoneId: string): RoomConstructionResult {
  return commit(lockOutsideFaces(nodes(), { zoneIds: [zoneId] }))
}

/**
 * The room's walls with an outside (a face no room covers), and whether each
 * already keeps that face on its drawn line — what Keep outside dimensions sets.
 */
function outsideWalls(scene: StructureNodes, wallIds: readonly string[]) {
  return wallIds.flatMap((wallId) => {
    const wall = scene[wallId]
    const { outside } = wall?.type === 'wall' ? roomSideFaces(scene, wallId) : { outside: null }
    if (wall?.type !== 'wall' || !outside) return []
    return [{ wallId, locked: wall.justification === justificationForFaceOnLine(outside) }]
  })
}

/**
 * Keep outside dimensions as a switch: `null` when the room has no wall with an
 * outside (nothing to lock), else whether every such wall is locked.
 */
export function roomOutsideFacesLocked(
  scene: StructureNodes,
  wallIds: readonly string[],
): boolean | null {
  const walls = outsideWalls(scene, wallIds)
  return walls.length ? walls.every((wall) => wall.locked) : null
}

/** Switches Keep outside dimensions off: the locked walls go back to centred on their line. One undo step. */
export function unlockRoomOutsideFaces(wallIds: readonly string[]): RoomConstructionResult {
  const scene = nodes()
  return commit({
    changes: outsideWalls(scene, wallIds)
      .filter((wall) => wall.locked)
      .flatMap((wall) => planWallJustification(scene, wall.wallId, undefined))
      .map((patch): NodeChange => ({ op: 'update', ...patch })),
  })
}

/**
 * Moves the room onto another floor, in one undo step (core keeps every
 * surface where it is): a floor key joins that floor, null the shared floor,
 * 'new' a new floor of its own. A refusal says why.
 */
export function setRoomFloor(zoneId: string, key: string | null): RoomConstructionResult {
  return commit(setZoneIntent(nodes(), { zoneId, patch: { floor: { footprint: key } } }))
}

/**
 * The floor a room's height is measured from: its footprint's floor (a room
 * on a raised house is 0 on the house floor), or for a mezzanine the floor of
 * the room it stands in. A room on its own floor measures from the shared
 * floor beside it, so its height reads the same before and after detaching
 * (from the ground when there is none).
 */
export function roomFloorBase(scene: StructureNodes, zoneId: string): number {
  const own = roomOwnPlate(scene, zoneId)
  if (own) {
    const shared = roomSharedFootprint(scene, zoneId)
    return shared ? shared.elevation : own.elevation - footprintHeightValue(scene, own)
  }
  const zone = scene[zoneId]
  if (zone?.type === 'zone' && zone.floor?.support === 'open' && zone.hostZoneId) {
    const host = scene[zone.hostZoneId]
    return host?.type === 'zone'
      ? (host.floor?.elevation ?? getRoomBaseElevation(scene, host.id))
      : 0
  }
  return getRoomBaseElevation(scene, zoneId)
}

/** How high the room's floor sits above the floor it is measured from (F − L). */
export function roomRelativeFloorHeight(scene: StructureNodes, zoneId: string): number {
  const zone = scene[zoneId]
  if (roomOwnPlate(scene, zoneId) || (zone?.type === 'zone' && zone.floor?.support === 'open'))
    return (
      Math.round((roomFloorElevation(scene, zoneId) - roomFloorBase(scene, zoneId)) * 1000) / 1000
    )
  return getRoomRelativeFloorElevation(scene, zoneId)
}

/**
 * Sets the room's floor to `height` above the floor it is measured from, in
 * one undo step. A refused height leaves the scene alone and says why.
 */
export function setRoomRelativeFloorHeight(
  zoneId: string,
  height: number,
): RoomConstructionResult | FloorHeightRefusal {
  const scene = nodes()
  const zone = scene[zoneId]
  const elevation =
    roomOwnPlate(scene, zoneId) || (zone?.type === 'zone' && zone.floor?.support === 'open')
      ? Math.round((roomFloorBase(scene, zoneId) + height) * 1000) / 1000
      : roomFloorElevationFromRelative(scene, zoneId, height)
  return setRoomFloorElevation(zoneId, elevation)
}

/**
 * Sets the room's floor to `elevation` (level-local), in one undo step. A
 * refused elevation leaves the scene alone and says why, a floor limit in
 * heights above the floor the room is measured from.
 */
export function setRoomFloorElevation(
  zoneId: string,
  elevation: number,
): RoomConstructionResult | FloorHeightRefusal {
  const scene = nodes()
  const zone = scene[zoneId]
  const base = roomFloorBase(scene, zoneId)
  const own = roomOwnPlate(scene, zoneId) !== null
  const plan = planRoomElevation(scene, zoneId, elevation)
  const result = commit(plan)
  if (result.status !== 'conflict') return result
  // Core states its limits as floor elevations; the panel speaks in heights
  // above the floor the room stands on, so it gets them in those terms.
  const code = plan.conflicts?.find((c) => FLOOR_LIMIT_CODES.has(c.code))?.code
  if (!code || own || zone?.type !== 'zone' || zone.floor?.support === 'open') return result
  const check = checkRoomFloor(scene, zoneId, elevation)
  return {
    ...result,
    code,
    min: Number.isFinite(check.minElevation) ? check.minElevation - base : null,
    max: Number.isFinite(check.maxElevation) ? check.maxElevation - base : null,
  }
}

/** Refusals whose message states a floor limit, rephrased from `min` / `max`. */
const FLOOR_LIMIT_CODES = new Set(['floor-headroom', 'floor-sunken-depth', 'floor-opening-fit'])

/** A refused room height, with the allowed range above the floor it stands on. */
export type FloorHeightRefusal = {
  status: 'conflict'
  message: string
  code: string
  min: number | null
  max: number | null
}

/**
 * A refused room height in the panel's terms: the limit as a height above the
 * floor the room stands on (core states it as a floor elevation).
 */
export function floorHeightRefusalText(
  result: { message: string; code?: string; min?: number | null; max?: number | null },
  length: (meters: number) => string,
) {
  const { code, min, max } = result
  if (code === 'floor-sunken-depth' && typeof min === 'number')
    return min < 0
      ? `Too low: the floor can sink at most ${length(-min)} here.`
      : `Too low: the floor must stay at least ${length(min)} up.`
  if ((code === 'floor-headroom' || code === 'floor-opening-fit') && typeof max === 'number') {
    const limit = max < 0 ? `sink at least ${length(-max)}` : `rise at most ${length(max)}`
    return code === 'floor-headroom'
      ? `Too high: the floor can ${limit} and keep headroom.`
      : `Too high: the floor can ${limit} for the doors and windows to fit.`
  }
  return result.message
}

/**
 * The plan stepper's and the 3D elevation handle's commit: the room's floor to
 * `elevation`, a refusal said under the room's pill as the other room actions
 * say theirs.
 */
export function commitRoomFloorElevation(
  zoneId: string,
  elevation: number,
  length: (meters: number) => string,
) {
  const result = setRoomFloorElevation(zoneId, elevation)
  if (result.status === 'conflict')
    showRoomNotice({ zoneId, message: floorHeightRefusalText(result, length) })
  return result
}

/**
 * How far a room on a separate floor walks above (+) or below (−) the shared
 * floor beside it, m: its walking surface against that of the shared-floor
 * room it shares the most walls or open sides with (the shared plate's top
 * when none), not plate against plate. Null on the shared floor, or with no
 * shared floor beside it.
 */
export function separateFloorOffset(scene: StructureNodes, zoneId: string): number | null {
  const zone = scene[zoneId]
  if (zone?.type !== 'zone' || !zone.floor?.footprint) return null
  const shared = roomSharedFootprint(scene, zoneId)
  if (!shared) return null
  const sides = new Set([...zone.boundaryWallIds, ...zone.boundarySeparatorIds])
  let neighbour: { id: string; count: number } | null = null
  for (const id of shared.zoneIds ?? []) {
    const room = scene[id]
    if (room?.type !== 'zone' || room.spaceRole !== 'room' || room.floor?.support === 'open')
      continue
    const count = [...room.boundaryWallIds, ...room.boundarySeparatorIds].filter((side) =>
      sides.has(side),
    ).length
    if (count > (neighbour?.count ?? 0)) neighbour = { id, count }
  }
  const sharedTop = neighbour ? roomFloorElevation(scene, neighbour.id) : shared.elevation
  return roomFloorElevation(scene, zoneId) - sharedTop
}

/**
 * The floor elevation one plan stepper click lands on: the room's height above
 * the floor it is measured from moved to the next `step` multiple, held to what
 * the 3D handle accepts (a mezzanine's bounds, else the room floor clamp). Null
 * when the clamp leaves the floor where it is.
 */
export function stepRoomFloorElevation(
  nodes: StructureNodes,
  zoneId: string,
  step: number,
): number | null {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone') return null
  const current = roomFloorElevation(nodes, zoneId)
  const base = roomFloorBase(nodes, zoneId)
  const size = Math.abs(step)
  const relative = (current - base) / size
  const next =
    base + (step > 0 ? Math.floor(relative + 1e-6) + 1 : Math.ceil(relative - 1e-6) - 1) * size
  const bounds = mezzanineElevationBounds(nodes, zoneId) ?? ownFloorElevationBounds(nodes, zoneId)
  const clamped = bounds
    ? Math.min(bounds.max, Math.max(bounds.min, next))
    : clampRoomFloorHandle(nodes, zoneId, next)
  const rounded = Math.round(clamped * 1000) / 1000
  return Math.abs(rounded - current) < 1e-6 ? null : rounded
}
