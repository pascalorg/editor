import { refuse } from '../agent-tools/refusal'
import { type AnyNode, type AssetInput, ItemNode } from '../schema'
import {
  aabbsOverlap,
  collectDoorKeepouts,
  itemNodePlanCorners,
  itemPlanAabb,
  type PlanAabb,
} from './door-clearance'
import { edgeFrame, roomToFurnish, WALL_GAP } from './furnish-room'
import { anchorOf, furnitureKind } from './furniture-kind'
import { classifyPlacement, collectOccupiedFootprints } from './layout-clearance'
import type { LevelTargetInput } from './level-target'
import { pointInPolygon, polygonBounds, type Vec2 } from './plan-geometry'
import { levelRole } from './scene-queries'
import type { AgentOperation } from './types'

export type ClearanceArea = PlanAabb & { id: string }

export type PlaceInRoomInput = LevelTargetInput & {
  assetId: string
  zoneId?: string
  polygon?: number[][]
  edge?: number
  allowDuplicate?: boolean
  rotationDeg?: number
  facing?: 'in' | 'out'
  align?: 'center' | 'start' | 'end'
  offset?: number
  inset?: number
  clearanceAreas?: ClearanceArea[]
}

type Pose = { x: number; z: number; rotationDeg: number }
type Dims = [number, number, number]
type ItemOnLevel = Extract<AnyNode, { type: 'item' }>

/** How far along a wall the sweep moves between the positions it tries. */
const STEP = 0.05
/** A wall is sampled at no more than this many positions (30 m at STEP): a longer one gets a coarser step. */
const MAX_POSITIONS_PER_WALL = 600
/** No room has more corners than this; the outline comes from the caller, and the search is cubic in it. */
const MAX_CORNERS = 128
/** A chair sits this far off its table's edge: the clearance every item keeps (DEFAULT_ITEM_GAP) and a hair more. */
const CHAIR_GAP = 0.09

const rad = (deg: number) => (deg / 180) * Math.PI
const round = (value: number) => Math.round(value * 100) / 100
const facingOf = (dx: number, dz: number) => (Math.atan2(dx, dz) * 180) / Math.PI

/** Where a piece's front points: it is authored facing +Z, and turns counter-clockwise from above. */
const frontOf = (rotationDeg: number): Vec2 => [
  Math.sin(rad(rotationDeg)),
  Math.cos(rad(rotationDeg)),
]

/** The piece's four corners on the plan, for a room that is not a rectangle. */
function corners(pose: Pose, [width, , depth]: Dims): Vec2[] {
  const front = frontOf(pose.rotationDeg)
  const side: Vec2 = [front[1], -front[0]]
  return ([-1, 1] as const).flatMap((s) =>
    ([-1, 1] as const).map(
      (f): Vec2 => [
        pose.x + side[0] * s * (width / 2) + front[0] * f * (depth / 2),
        pose.z + side[1] * s * (width / 2) + front[1] * f * (depth / 2),
      ],
    ),
  )
}

type Room = {
  bounds: ReturnType<typeof polygonBounds>
  center: Vec2
  doorKeepouts: PlanAabb[]
  occupied: PlanAabb[]
  polygon: Vec2[]
  options: PlaceInRoomInput
  blockedClearanceIds: Set<string>
}

/** Whether the piece may stand there: inside the room, clear of every door and every other item. */
function fits(room: Room, pose: Pose, dims: Dims, itemGap?: number, occupied = room.occupied) {
  const aabb = itemPlanAabb([pose.x, 0, pose.z], dims, rad(pose.rotationDeg))
  const reason = classifyPlacement({
    aabb,
    doorKeepouts: room.doorKeepouts,
    occupied,
    roomBounds: {
      maxX: room.bounds.maxX,
      maxZ: room.bounds.maxZ,
      minX: room.bounds.minX,
      minZ: room.bounds.minZ,
    },
    ...(itemGap === undefined ? {} : { itemGap }),
    ...(room.options.inset === undefined ? {} : { padding: 0 }),
  })
  if (reason !== 'ok') return false
  if (!corners(pose, dims).every((corner) => pointInPolygon(corner, room.polygon, true)))
    return false
  const blocked = (room.options.clearanceAreas ?? []).filter((area) => aabbsOverlap(aabb, area, 0))
  for (const area of blocked) room.blockedClearanceIds.add(area.id)
  return blocked.length === 0
}

const chosenYaw = (input: PlaceInRoomInput, preferred: number) =>
  (input.rotationDeg ?? preferred) + (input.facing === 'out' ? 180 : 0)

/** Project the rotated footprint onto the wall tangent and normal, not its authored axes. */
function wallGeometry(room: Room, edge: number, dims: Dims) {
  const frame = edgeFrame(room.polygon, edge, room.center)
  const rotationDeg = chosenYaw(room.options, frame.facing)
  const relative = rad(rotationDeg - frame.facing)
  const half = (Math.abs(Math.cos(relative)) * dims[0] + Math.abs(Math.sin(relative)) * dims[2]) / 2
  const reach =
    (Math.abs(Math.sin(relative)) * dims[0] + Math.abs(Math.cos(relative)) * dims[2]) / 2 +
    (room.options.inset ?? WALL_GAP)
  return { frame, rotationDeg, half, reach }
}

function wallPoseAt(room: Room, edge: number, dims: Dims, s: number): Pose {
  const { frame, rotationDeg, reach } = wallGeometry(room, edge, dims)
  const start = room.polygon[edge % room.polygon.length]!
  return {
    rotationDeg,
    x: start[0] + frame.along.x * s + frame.inward.x * reach,
    z: start[1] + frame.along.z * s + frame.inward.z * reach,
  }
}

function desiredAlong(room: Room, edge: number, dims: Dims) {
  if (room.options.align === undefined && room.options.offset === undefined) return undefined
  const { frame, half } = wallGeometry(room, edge, dims)
  const base =
    room.options.align === 'start'
      ? half
      : room.options.align === 'end'
        ? frame.length - half
        : frame.length / 2
  return Math.max(half, Math.min(frame.length - half, base + (room.options.offset ?? 0)))
}

type Run = {
  edge: number
  from: number
  to: number
  span: number
  frame: ReturnType<typeof edgeFrame>
}

/** The free stretches of one wall for a piece: where its centre may stand along the edge, in runs. */
function runsAlong(room: Room, edge: number, dims: Dims): Run[] {
  const { frame, half } = wallGeometry(room, edge, dims)
  const width = half * 2
  const runs: Run[] = []
  let from: number | null = null
  let to = 0
  // Reserve two samples for the end and the caller's desired alignment.
  const step = Math.max(STEP, (frame.length - width) / (MAX_POSITIONS_PER_WALL - 3))
  if (half > frame.length - half) return runs
  const positions: number[] = []
  for (
    let s = half;
    s <= frame.length - half + 1e-9 && positions.length < MAX_POSITIONS_PER_WALL - 2;
    s += step
  )
    positions.push(s)
  positions.push(frame.length - half)
  const desired = desiredAlong(room, edge, dims)
  if (desired !== undefined) positions.push(desired)
  for (const s of [...new Set(positions)].sort((a, b) => a - b)) {
    const pose = wallPoseAt(room, edge, dims, s)
    if (fits(room, pose, dims)) {
      from ??= s
      to = s
    } else if (from !== null) {
      runs.push({ edge, frame, from, span: to - from + width, to })
      from = null
    }
  }
  if (from !== null) runs.push({ edge, frame, from, span: to - from + width, to })
  return runs
}

/** The desired alignment, clamped to a free run, or its centre when no alignment was requested. */
function poseInRun(room: Room, run: Run, dims: Dims): Pose {
  const desired = desiredAlong(room, run.edge, dims) ?? (run.from + run.to) / 2
  return wallPoseAt(room, run.edge, dims, Math.max(run.from, Math.min(run.to, desired)))
}

/** The widest free stretch of wall that any piece of this depth could use, for the refusal. */
function widestFree(room: Room, dims: Dims, edges: number[]) {
  const probe: Dims = [0.1, dims[1], dims[2]]
  let widest: Run | null = null
  for (const edge of edges)
    for (const run of runsAlong(room, edge, probe))
      if (!widest || run.span > widest.span) widest = run
  return widest
}

const nameOf = (node: ItemOnLevel) =>
  `${node.asset.id} ${node.name ?? node.asset.name ?? ''}`.toLowerCase()

function itemDims(node: ItemOnLevel): Dims {
  const [w = 1, h = 1, d = 1] = node.asset.dimensions ?? [1, 1, 1]
  return [w, h, d]
}

/** Slots around a table for chairs, best first: the middle of the long sides, then the ends, then beside. */
function chairSlots(table: ItemOnLevel, chair: Dims, input: PlaceInRoomInput): Pose[] {
  const tableDims = itemDims(table)
  const tw = tableDims[0] * Math.abs(table.scale[0])
  const td = tableDims[2] * Math.abs(table.scale[2])
  const turn = table.rotation[1] ?? 0
  const [chairWidth] = chair
  const tableCorners = itemNodePlanCorners(table)
  const center: Vec2 = [
    tableCorners.reduce((sum, [x]) => sum + x, 0) / tableCorners.length,
    tableCorners.reduce((sum, [, z]) => sum + z, 0) / tableCorners.length,
  ]
  /** A direction or a point in the table's own frame (x along its width, z along its front), on the plan. */
  const world = (x: number, z: number): Vec2 => [
    x * Math.cos(turn) + z * Math.sin(turn),
    -x * Math.sin(turn) + z * Math.cos(turn),
  ]
  const slots: Pose[] = []
  /** On the side whose outward normal is (nx, nz) in the table's frame, `lateral` along that side. */
  const slot = (nx: number, nz: number, lateral = 0) => {
    const [outX, outZ] = world(nx, nz)
    const rotationDeg = chosenYaw(input, facingOf(-outX, -outZ))
    // Separate the actual rectangles on this table-side normal, after the caller's yaw.
    const tableReach = Math.max(
      ...tableCorners.map(([x, z]) => (x - center[0]) * outX + (z - center[1]) * outZ),
    )
    const chairReach = -Math.min(
      ...corners({ x: 0, z: 0, rotationDeg }, chair).map(([x, z]) => x * outX + z * outZ),
    )
    const reach = tableReach + chairReach + CHAIR_GAP
    const [x, z] = world(
      nx * reach + (nz !== 0 ? lateral : 0),
      nz * reach + (nz === 0 ? lateral : 0),
    )
    slots.push({
      // Straight across its side, front to the table: facing the centre would turn a chair set beside the middle one.
      rotationDeg,
      x: center[0] + x,
      z: center[1] + z,
    })
  }
  const long: [number, number][] =
    tw >= td
      ? [
          [0, 1],
          [0, -1],
        ]
      : [
          [1, 0],
          [-1, 0],
        ]
  const ends: [number, number][] =
    tw >= td
      ? [
          [1, 0],
          [-1, 0],
        ]
      : [
          [0, 1],
          [0, -1],
        ]
  for (const [nx, nz] of long) slot(nx, nz)
  for (const [nx, nz] of ends) slot(nx, nz)
  const shift = chairWidth + 0.12
  for (const lateral of [shift, -shift, 2 * shift, -2 * shift])
    for (const [nx, nz] of long) slot(nx, nz, lateral)
  return slots
}

/**
 * `place_in_room`: one floor-standing catalog item where it fits. A wall-bound piece (fridge, counter, bed, sofa,
 * toilet) is set against a wall, centred in the widest free stretch of wall that clears every door
 * and every other item, facing into the room, and is never set in the middle: when no wall has room
 * the answer says how wide the widest stretch is. A free-standing piece (table, rug, plant) takes
 * the middle of the room, or goes with what it belongs with and faces it (a coffee table and an
 * armchair face the sofa). A chair is placed around its table facing it, and refused with no table.
 */
export const placeInRoom: AgentOperation<PlaceInRoomInput> = (nodes, input, context) => {
  for (const key of ['rotationDeg', 'offset', 'inset'] as const)
    if (input[key] !== undefined && !Number.isFinite(input[key]))
      refuse('invalid_placement_options', `${key} must be a finite number.`)
  if (
    (input.facing !== undefined && !['in', 'out'].includes(input.facing)) ||
    (input.align !== undefined && !['center', 'start', 'end'].includes(input.align))
  )
    refuse('invalid_placement_options', 'Use facing in/out and align center/start/end.')
  if (
    input.clearanceAreas !== undefined &&
    (!Array.isArray(input.clearanceAreas) ||
      input.clearanceAreas.length > 128 ||
      !input.clearanceAreas.every(
        (area) =>
          area &&
          typeof area.id === 'string' &&
          area.id.length > 0 &&
          [area.minX, area.maxX, area.minZ, area.maxZ].every(Number.isFinite) &&
          area.minX <= area.maxX &&
          area.minZ <= area.maxZ,
      ))
  )
    refuse(
      'invalid_clearance_areas',
      'Supply at most 128 finite normalized clearance rectangles with ids.',
    )
  const catalog = context.catalog
  if (!catalog) refuse('no_catalog', 'This host has no item catalog to place from.')
  const asset: AssetInput | undefined = catalog.find((entry) => entry.id === input.assetId)
  if (!asset)
    refuse(
      'asset_not_found',
      `${input.assetId} is not in the item catalog: use an id search_assets returned.`,
      { assetId: input.assetId },
    )
  if (asset.attachTo !== undefined)
    refuse(
      'unsupported_attachment',
      `${asset.id} attaches to a ${asset.attachTo === 'ceiling' ? 'ceiling' : 'wall'}, not the room floor. Use place_items with targetNodeId naming its host${asset.attachTo === 'ceiling' ? '' : ' and y giving its bottom height above the floor'}.`,
      { assetId: asset.id, attachTo: asset.attachTo },
    )
  const { levelId, polygon } = roomToFurnish(nodes, input, context)
  if (polygon.length > MAX_CORNERS)
    refuse(
      'polygon_too_large',
      `A room outline has at most ${MAX_CORNERS} corners; this one has ${polygon.length}.`,
      { corners: polygon.length },
    )
  if (!polygon.every((corner) => corner.length === 2 && corner.every(Number.isFinite)))
    refuse('polygon_invalid', 'Every corner of the room outline must be a pair of finite numbers.')
  const level = nodes[levelId]
  if (level && levelRole(nodes, level).role === 'roof')
    refuse('roof_level', `${level.name || level.id} is a roof level, not a storey.`, { levelId })
  if (
    input.edge !== undefined &&
    (!Number.isInteger(input.edge) || input.edge < 0 || input.edge >= polygon.length)
  )
    refuse(
      'edge_out_of_range',
      `The room has ${polygon.length} edges (0–${polygon.length - 1}); there is no edge ${input.edge}.`,
    )

  const all = Object.values(nodes)
  const bounds = polygonBounds(polygon)
  const room: Room = {
    bounds,
    center: [bounds.centerX, bounds.centerZ],
    doorKeepouts: collectDoorKeepouts(all, { levelId }).map((door) => door.aabb),
    occupied: collectOccupiedFootprints(all, { floorOnly: true, levelId }).map(
      (footprint) => footprint.aabb,
    ),
    polygon,
    options: input,
    blockedClearanceIds: new Set(),
  }
  const inRoom = all.filter(
    (node): node is ItemOnLevel =>
      node.type === 'item' &&
      node.parentId === levelId &&
      pointInPolygon([node.position[0], node.position[2]], polygon, true),
  )
  const dims = itemDims({ asset } as ItemOnLevel)
  const kind = furnitureKind(asset)
  const wallTargeted =
    input.edge !== undefined ||
    input.align !== undefined ||
    input.offset !== undefined ||
    input.inset !== undefined

  if (
    kind !== 'chair' &&
    !input.allowDuplicate &&
    inRoom.some((node) => node.asset.id === asset.id)
  )
    refuse(
      'duplicate_item',
      `The room already has a ${asset.id}. Pass allowDuplicate to add another.`,
      { assetId: asset.id },
    )

  const named = (pattern: string) => new RegExp(pattern)
  const refuseClearance = () => {
    if (room.blockedClearanceIds.size)
      refuse(
        'stair_blocked',
        `No free spot for ${asset.id} clears the supplied clearance areas: ${[...room.blockedClearanceIds].join(', ')}.`,
        { assetId: asset.id, clearanceAreaIds: [...room.blockedClearanceIds] },
      )
  }
  const place = (pose: Pose, where: Record<string, unknown>) => {
    const node = ItemNode.parse({
      asset,
      name: asset.name,
      parentId: levelId,
      position: [pose.x, 0, pose.z],
      rotation: [0, rad(pose.rotationDeg), 0],
    })
    return {
      changes: { create: [{ node, parentId: levelId }] },
      result: {
        ok: true,
        itemId: node.id,
        kind,
        placed: { position: [round(pose.x), round(pose.z)], rotationDeg: round(pose.rotationDeg) },
        ...where,
        message: `Placed ${asset.id} ${Object.keys(where).includes('around') ? 'around its table' : 'in the room'}.`,
      },
    }
  }

  // Without an explicit wall target, a chair goes around its table, or nowhere.
  if (kind === 'chair' && !wallTargeted) {
    const table = inRoom
      .filter((node) => named('table|desk').test(nameOf(node)))
      .sort(
        (a, b) =>
          Math.hypot(a.position[0] - room.center[0], a.position[2] - room.center[1]) -
          Math.hypot(b.position[0] - room.center[0], b.position[2] - room.center[1]),
      )[0]
    if (!table)
      refuse(
        'no_table',
        `A ${asset.id} goes around a table, and this room has none: place the table first.`,
        { assetId: asset.id },
      )
    // The table is cleared by the oriented slot geometry; every other item still blocks.
    const others = collectOccupiedFootprints(all, {
      floorOnly: true,
      levelId,
      excludeIds: new Set([table.id]),
    }).map((footprint) => footprint.aabb)
    for (const slot of chairSlots(table, dims, input)) {
      if (fits(room, slot, dims, undefined, others)) return place(slot, { around: table.id })
    }
    refuseClearance()
    refuse(
      'no_free_spot',
      `No free place is left around the table for another ${asset.id}: every side of ${table.id} that is clear of doors and walls is taken.`,
      { assetId: asset.id },
    )
  }

  const edges = input.edge !== undefined ? [input.edge] : polygon.map((_, index) => index)
  const wallPose = () => {
    const runs = edges.flatMap((edge) => runsAlong(room, edge, dims))
    const distance = (run: Run) => {
      const desired = desiredAlong(room, run.edge, dims)
      return desired === undefined ? 0 : Math.max(run.from - desired, desired - run.to, 0)
    }
    runs.sort((a, b) => distance(a) - distance(b) || b.span - a.span)
    for (const run of runs) {
      const poses = [
        poseInRun(room, run, dims),
        wallPoseAt(room, run.edge, dims, run.from),
        wallPoseAt(room, run.edge, dims, run.to),
      ]
      for (const pose of poses) if (fits(room, pose, dims)) return { against: run.edge, pose }
    }
    return null
  }

  if (kind === 'free' && !wallTargeted) {
    const anchorPattern = anchorOf(asset)
    const anchor = anchorPattern
      ? inRoom
          .filter((node) => named(anchorPattern).test(nameOf(node)))
          .sort(
            (a, b) =>
              Math.hypot(a.position[0] - room.center[0], a.position[2] - room.center[1]) -
              Math.hypot(b.position[0] - room.center[0], b.position[2] - room.center[1]),
          )[0]
      : undefined
    const candidates: Pose[] = []
    const faceToward = (x: number, z: number, target: Vec2): Pose => ({
      rotationDeg: facingOf(target[0] - x, target[1] - z),
      x,
      z,
    })
    if (anchor) {
      const [aw, , ad] = itemDims(anchor)
      const front = frontOf(((anchor.rotation[1] ?? 0) * 180) / Math.PI)
      const target: Vec2 = [anchor.position[0], anchor.position[2]]
      const reach = ad / 2 + 0.4 + dims[2] / 2
      candidates.push(
        faceToward(target[0] + front[0] * reach, target[1] + front[1] * reach, target),
      )
      const side: Vec2 = [front[1], -front[0]]
      for (const sign of [1, -1])
        candidates.push(
          faceToward(
            target[0] +
              front[0] * (ad / 2 + 0.5 + dims[2] / 2) +
              side[0] * sign * (aw / 2 + dims[0] / 2 + 0.2),
            target[1] +
              front[1] * (ad / 2 + 0.5 + dims[2] / 2) +
              side[1] * sign * (aw / 2 + dims[0] / 2 + 0.2),
            target,
          ),
        )
    }
    // The middle of the room: facing what it belongs with, else its width along the room's long
    // axis; and when that does not fit (a door's clear zone, a counter), the other turns.
    const preferred = anchor
      ? facingOf(anchor.position[0] - room.center[0], anchor.position[2] - room.center[1])
      : room.bounds.width >= room.bounds.depth
        ? 0
        : 90
    for (const turn of anchor ? [0] : [0, 90, 180, 270])
      candidates.push({
        rotationDeg: anchor ? preferred : (preferred + turn) % 360,
        x: room.center[0],
        z: room.center[1],
      })
    for (const candidate of candidates) {
      const pose = { ...candidate, rotationDeg: chosenYaw(input, candidate.rotationDeg) }
      if (fits(room, pose, dims)) return place(pose, anchor ? { facing: anchor.id } : {})
    }
  }

  const found = wallPose()
  if (found)
    return place(found.pose, {
      against: {
        edge: found.against,
        wall: `edge ${found.against} of ${polygon.length}`,
      },
    })

  refuseClearance()
  const widest = widestFree(room, dims, edges)
  refuse(
    'no_free_spot',
    `No wall has room for ${asset.id} (${round(dims[0])} × ${round(dims[2])} m)${
      widest
        ? `: the widest free stretch of wall is ${round(widest.span)} m, on edge ${widest.edge}`
        : ': no wall of the room is free'
    }. A smaller one, another room, or remove something.`,
    {
      assetId: asset.id,
      widestFreeRunM: widest ? round(widest.span) : 0,
      ...(widest ? { edge: widest.edge } : {}),
    },
  )
}
