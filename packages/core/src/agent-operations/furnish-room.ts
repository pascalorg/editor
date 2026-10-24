import type { FURNISHED_ROOM_TYPES } from '../agent-tools/furnish-room'
import { refuse } from '../agent-tools/refusal'
import { OTHER_SOURCES } from '../agent-tools/sources'
import { type AssetInput, ItemNode, type WallNode } from '../schema'
import { edgeProjection } from './create-room'
import {
  collectDoorKeepouts,
  itemBlocksDoorKeepout,
  itemPlanAabb,
  keepoutCoversPlanned,
  keepoutForPolygonEdge,
  type PlanAabb,
} from './door-clearance'
import { furnitureKind } from './furniture-kind'
import {
  collectOccupiedFootprints,
  findValidPlacement,
  lateralSteps,
  MID_ROOM_DISTANCE_M,
  PLACEMENT_INSETS_M,
  wallFacesOn,
} from './layout-clearance'
import { type LevelTargetInput, targetLevel } from './level-target'
import { polygonArea, polygonBounds, type Vec2 } from './plan-geometry'
import { levelIdOf, levelRole, queryNodes } from './scene-queries'
import type { AgentContext, AgentOperation, SceneNodes } from './types'

type RoomType = (typeof FURNISHED_ROOM_TYPES)[number]

type FurnishRoomInput = LevelTargetInput & {
  zoneId?: string
  polygon?: number[][]
  roomType: RoomType
  doorWallIndex?: number
}

// A door belongs to a room edge when it stands this close to the edge's line, within its span.
const DOOR_EDGE_TOLERANCE = 0.25
// Clearance between a piece's back and the wall's centreline: half a wall and a hand's width.
export const WALL_GAP = 0.1
// A wall-bound piece (a sofa, a bed, a TV stand) slides along its wall, within the wall's ends, to
// clear a door or another piece, and steps off it only as far as verify_scene still reads it
// against the wall (item_mid_room); where no wall stands, it is skipped.
const AGAINST_WALL_INSETS_M = PLACEMENT_INSETS_M.filter(
  (inset) => WALL_GAP + inset <= MID_ROOM_DISTANCE_M,
)

/** The room asked for: a zone's level and outline, or a polygon on the level named. */
export function roomToFurnish(
  nodes: SceneNodes,
  input: LevelTargetInput & Pick<FurnishRoomInput, 'zoneId' | 'polygon'>,
  context: AgentContext,
) {
  if (input.zoneId) {
    const zone = nodes[input.zoneId]
    if (!zone)
      refuse(
        'zone_not_found',
        `Room not found: ${input.zoneId}. Use a zoneId create_room or get_zones returned.`,
        { zoneId: input.zoneId },
      )
    if (zone.type !== 'zone')
      refuse(
        'not_a_zone',
        `Node ${input.zoneId} is a ${zone.type}, not a room: pass the room's zoneId (create_room, get_zones).`,
        { zoneId: input.zoneId, type: zone.type },
      )
    const levelId = levelIdOf(nodes, zone.id)
    if (!levelId) refuse('level_not_found', `Room ${zone.id} is not on a level.`)
    return { levelId, polygon: zone.polygon as Vec2[] }
  }
  if (!input.polygon)
    refuse('room_required', 'Say which room: its zoneId, or its polygon (and its level).')
  return { levelId: targetLevel(nodes, input, context).id, polygon: input.polygon as Vec2[] }
}

/** The doors of the level that stand on an edge of the room, by where they stand. */
function doorsOfRoom(nodes: SceneNodes, levelId: string, polygon: Vec2[]) {
  const found: { doorId: string; edge: number }[] = []
  for (const wall of queryNodes<WallNode>(nodes, { type: 'wall', parentId: levelId })) {
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    if (length < 1e-9) continue
    for (const childId of wall.children) {
      const door = nodes[childId]
      if (door?.type !== 'door') continue
      const t = door.position[0] / length
      const point: Vec2 = [
        wall.start[0] + t * (wall.end[0] - wall.start[0]),
        wall.start[1] + t * (wall.end[1] - wall.start[1]),
      ]
      const edge = polygon.findIndex((a, i) => {
        const along = edgeProjection(a, polygon[(i + 1) % polygon.length]!, point)
        return along.distance < DOOR_EDGE_TOLERANCE && along.t >= 0 && along.t <= 1
      })
      if (edge >= 0) found.push({ doorId: door.id, edge })
    }
  }
  return found
}

/** A polygon edge seen from inside the room: its middle, its direction, and the way into the room. */
export function edgeFrame(polygon: Vec2[], index: number, center: Vec2) {
  const a = polygon[index % polygon.length]!
  const b = polygon[(index + 1) % polygon.length]!
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const along = { x: (b[0] - a[0]) / length, z: (b[1] - a[1]) / length }
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const towardCenter = (center[0] - mid[0]) * -along.z + (center[1] - mid[1]) * along.x
  const inward = towardCenter >= 0 ? { x: -along.z, z: along.x } : { x: along.z, z: -along.x }
  // An item's front is its +Z: turned to face into the room.
  const facing = (Math.atan2(inward.x, inward.z) * 180) / Math.PI
  return { mid, along, inward, length, facing }
}

type Edge = ReturnType<typeof edgeFrame>
type Pose = {
  assetId: string
  x: number
  z: number
  rotationDeg: number
  along?: { x: number; z: number }
  inward?: { x: number; z: number }
  /** The wall it stands against: its length, and the piece's offset along it from its middle. */
  wall?: { length: number; lateral: number }
  /** A piece placed before it that it keeps with (a bedside table its bed, the TV its sofa). */
  follows?: string
}

/** Where each piece of a room type goes, sized from the catalog's own dimensions. */
function layout(
  roomType: RoomType,
  polygon: Vec2[],
  doorWall: number,
  catalog: readonly AssetInput[],
): Pose[] {
  const bounds = polygonBounds(polygon)
  const center: Vec2 = [bounds.centerX, bounds.centerZ]
  const n = polygon.length
  const door = edgeFrame(polygon, doorWall, center)
  const back = edgeFrame(polygon, doorWall + Math.floor(n / 2), center)
  const side = edgeFrame(polygon, doorWall + 1, center)
  const area = polygonArea(polygon)
  const size = (assetId: string) => catalog.find((asset) => asset.id === assetId)?.dimensions
  const width = (assetId: string) => size(assetId)?.[0] ?? 1
  const depth = (assetId: string) => size(assetId)?.[2] ?? 1
  const poses: Pose[] = []
  /**
   * Back against `edge`, `lateral` along it from its middle, `out` further into the room; moved
   * along `edge` as far as the piece it `follows` was moved.
   */
  const against = (edge: Edge, assetId: string, lateral = 0, out = 0, follows?: string) => {
    const inset = depth(assetId) / 2 + WALL_GAP + out
    poses.push({
      follows,
      assetId,
      x: edge.mid[0] + edge.inward.x * inset + edge.along.x * lateral,
      z: edge.mid[1] + edge.inward.z * inset + edge.along.z * lateral,
      rotationDeg: edge.facing,
      along: edge.along,
      inward: edge.inward,
      wall: { length: edge.length, lateral },
    })
  }
  const free = (assetId: string, x: number, z: number, rotationDeg = 0) =>
    poses.push({ assetId, x, z, rotationDeg })

  switch (roomType) {
    case 'bedroom': {
      const bed = Math.max(bounds.width, bounds.depth) >= 3.2 ? 'double-bed' : 'single-bed'
      against(back, bed)
      const table = width('bedside-table')
      if (back.length >= width(bed) + 2 * table + 0.2) {
        const lateral = width(bed) / 2 + table / 2 + 0.05
        against(back, 'bedside-table', -lateral, 0, bed)
        against(back, 'bedside-table', lateral, 0, bed)
      }
      if (area >= 10) against(side, 'dresser', side.length * 0.22)
      if (area >= 13) against(side, 'closet', -side.length * 0.22)
      break
    }
    case 'kitchen':
      against(back, back.length >= 2.6 ? 'kitchen' : 'kitchen-counter')
      if (back.length >= 3.5) against(back, 'stove', back.length / 2 - width('stove') / 2 - 0.1)
      against(side, 'fridge', side.length * 0.25)
      break
    case 'bathroom':
      against(back, 'toilet', back.length * 0.25)
      against(back, 'bathroom-sink', -back.length * 0.2)
      against(side, area >= 6.5 ? 'bathtub' : 'shower-square')
      break
    case 'living':
      against(back, 'sofa')
      against(back, 'coffee-table', 0, depth('sofa') + 0.4, 'sofa')
      against(side, 'livingroom-chair', -side.length * 0.18)
      // The TV faces the sofa from the door wall; the placement slides it off the door's clear zone.
      against(door, 'tv-stand', 0, 0, 'sofa')
      break
    case 'dining': {
      free('dining-table', bounds.centerX, bounds.centerZ)
      const ahead = depth('dining-table') / 2 + depth('dining-chair') / 2
      const beside = width('dining-table') / 2 + depth('dining-chair') / 2
      free('dining-chair', bounds.centerX, bounds.centerZ - ahead)
      free('dining-chair', bounds.centerX, bounds.centerZ + ahead, 180)
      if (Math.min(bounds.width, bounds.depth) >= 3) {
        free('dining-chair', bounds.centerX - beside, bounds.centerZ, 90)
        free('dining-chair', bounds.centerX + beside, bounds.centerZ, 270)
      }
      break
    }
    case 'laundry':
      against(back, 'washing-machine', -0.55)
      against(back, 'drying-rack', 0.65)
      break
    case 'entry':
    case 'hallway':
      if (Math.min(bounds.width, bounds.depth) >= 1.4) against(side, 'coat-rack')
      break
    case 'storage':
      against(back, 'closet')
      break
  }
  return poses
}

const SKIP_REASONS = {
  outside_bounds: 'outside the room',
  overlaps_item: 'overlaps another item',
  off_wall: 'no wall to stand against there',
} as const

const round = (value: number) => Math.round(value * 100) / 100

/**
 * Why a piece was skipped, with its size: told only "bathtub: blocks door clearance", an agent
 * set the same tub there with place_items. An item the room cannot hold in any turn says so and
 * what instead; one in a door's way names the door.
 */
function skipReason(
  asset: AssetInput,
  pose: { x: number; z: number; rotationDeg: number },
  reason: string,
  room: { minX: number; maxX: number; minZ: number; maxZ: number },
  doors: ReturnType<typeof collectDoorKeepouts>,
) {
  const [width = 1, , depth = 1] = asset.dimensions ?? [1, 1, 1]
  const named = `${asset.id} (${round(width)} × ${round(depth)} m)`
  const [roomWidth, roomDepth] = [room.maxX - room.minX, room.maxZ - room.minZ]
  const fits = (a: number, b: number) => a <= roomWidth && b <= roomDepth
  if (!fits(width, depth) && !fits(depth, width))
    return `${named}: too large for the room (${round(roomWidth)} × ${round(roomDepth)} m); a smaller one, or add_object at the room's size`
  if (reason === 'blocks_door_clearance') {
    const footprint = itemPlanAabb(
      [pose.x, 0, pose.z],
      asset.dimensions,
      (pose.rotationDeg * Math.PI) / 180,
    )
    const door = doors.find((keepout) => itemBlocksDoorKeepout(footprint, keepout))
    return `${named}: in the way of ${door ? `door ${door.doorId}` : 'the door wall kept clear for a door'}`
  }
  return `${named}: ${SKIP_REASONS[reason as keyof typeof SKIP_REASONS]}`
}

/**
 * How a wall-bound piece looks for a spot: along its wall, its whole width within the wall's ends
 * (`at` is where it starts, off the wall's middle), barely off it, against a wall that stands.
 */
function againstItsWall(
  wall: { length: number },
  at: number,
  width: number,
  walls: ReturnType<typeof wallFacesOn>,
) {
  // A piece wider than its wall stands at the wall's middle.
  const reach = (wall.length - width) / 2
  return {
    lateralsM: reach >= 0 ? lateralSteps(-reach - at, reach - at) : [-at],
    insetsM: AGAINST_WALL_INSETS_M,
    // A level with no walls yet is furnished by its outline alone; verify_scene judges no piece there.
    ...(walls.length > 0 ? { againstWalls: walls } : {}),
  }
}

/**
 * `furnish_room`: a room type's pieces from the host's catalog, against the walls the door decides,
 * each moved off door clear zones and other items or skipped with the reason. The door wall is the
 * edge a door of the room stands on (found by position), else doorWallIndex, else edge 0.
 */
export const furnishRoom: AgentOperation<FurnishRoomInput> = (nodes, input, context) => {
  const catalog = context.catalog
  if (!catalog) refuse('no_catalog', 'This host has no item catalog to furnish from.')
  const { levelId, polygon } = roomToFurnish(nodes, input, context)
  const level = nodes[levelId]
  if (level && levelRole(nodes, level).role === 'roof')
    refuse('roof_level', `${level.name || level.id} is a roof level, not a storey.`, { levelId })
  if (input.doorWallIndex !== undefined && input.doorWallIndex >= polygon.length)
    refuse(
      'edge_out_of_range',
      `The room has ${polygon.length} edges (0–${polygon.length - 1}); there is no edge ${input.doorWallIndex}.`,
    )

  const doors = doorsOfRoom(nodes, levelId, polygon)
  const doorWall = input.doorWallIndex ?? doors[0]?.edge ?? 0
  // biome-ignore lint/plugin: door keep-outs and occupied footprints resolve each item through its parents
  const all = Object.values(nodes)
  const doorKeepouts = collectDoorKeepouts(all, { levelId })
  const keepouts: PlanAabb[] = doorKeepouts.map((door) => door.aabb)
  // A door wall without a door yet keeps the middle of it clear for the one to come.
  if (!doors.some((door) => door.edge === doorWall)) {
    const planned = keepoutForPolygonEdge(polygon, doorWall, { t: 0.5, width: 0.9 })
    if (planned && !keepouts.some((keepout) => keepoutCoversPlanned(keepout, planned)))
      keepouts.push(planned)
  }
  const occupied = collectOccupiedFootprints(all, { levelId, floorOnly: true }).map(
    (footprint) => footprint.aabb,
  )
  const { minX, maxX, minZ, maxZ } = polygonBounds(polygon)
  const walls = wallFacesOn(all, levelId)

  const items: ItemNode[] = []
  const skipped: string[] = []
  // How far each piece was moved off the spot the layout gave it, for the pieces that follow it.
  const moved = new Map<string, Vec2>()
  for (const pose of layout(input.roomType, polygon, doorWall, catalog)) {
    const asset = catalog.find((entry) => entry.id === pose.assetId)
    if (!asset) {
      skipped.push(`${pose.assetId}: not in the catalog`)
      continue
    }
    // Along its own wall only: a TV across the room slides as its sofa did and stays on its wall.
    const lead = pose.follows ? moved.get(pose.follows) : undefined
    const slide = lead && pose.along ? lead[0] * pose.along.x + lead[1] * pose.along.z : 0
    const spot = {
      x: pose.x + (pose.along?.x ?? 0) * slide,
      z: pose.z + (pose.along?.z ?? 0) * slide,
      rotationDeg: pose.rotationDeg,
    }
    const found = findValidPlacement({
      primary: spot,
      dimensions: asset.dimensions,
      doorKeepouts: keepouts,
      occupied,
      roomBounds: { minX, maxX, minZ, maxZ },
      roomOutline: polygon,
      along: pose.along,
      inward: pose.inward,
      ...(pose.wall && furnitureKind(asset) === 'wall'
        ? againstItsWall(pose.wall, pose.wall.lateral + slide, asset.dimensions?.[0] ?? 1, walls)
        : {}),
    })
    if (!found.candidate) {
      const at = found.refused ?? spot
      skipped.push(skipReason(asset, at, found.reason, { minX, maxX, minZ, maxZ }, doorKeepouts))
      continue
    }
    const { candidate } = found
    moved.set(pose.assetId, [candidate.x - pose.x, candidate.z - pose.z])
    const rotation = (candidate.rotationDeg * Math.PI) / 180
    occupied.push(itemPlanAabb([candidate.x, 0, candidate.z], asset.dimensions, rotation))
    items.push(
      ItemNode.parse({
        name: asset.name,
        parentId: levelId,
        position: [candidate.x, 0, candidate.z],
        rotation: [0, rotation, 0],
        asset,
      }),
    )
  }

  const itemIds = items.map((item) => item.id)
  // Each piece with its size and id, as the skips are told: the set is not read back from the scene.
  const pieces = items.map((item) => {
    const [width = 1, , depth = 1] = item.asset.dimensions ?? [1, 1, 1]
    return `${item.name ?? item.asset.name} (${round(width)} × ${round(depth)} m): ${item.id}`
  })
  return {
    result: {
      ok: true,
      placed: items.length,
      itemIds,
      pieces,
      skipped,
      doorWallIndex: doorWall,
      doorsDetected: doors.length,
      message: `Furnished the ${input.roomType} with ${items.length} item${items.length === 1 ? '' : 's'}${skipped.length ? `, skipped ${skipped.length}` : ''}.${skipped.length ? ` For what was skipped: ${OTHER_SOURCES}` : ''}${input.zoneId && items.length ? ` view_scene with interior { zoneId: "${input.zoneId}" } shows the room from inside, at a person's height.` : ''}`,
    },
    ...(items.length
      ? { changes: { create: items.map((node) => ({ node, parentId: levelId })) } }
      : {}),
  }
}
