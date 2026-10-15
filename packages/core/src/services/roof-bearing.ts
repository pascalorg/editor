import { pointInPolygon, type Vec2 } from '../agent-operations/plan-geometry'
import { nodesOnLevel } from '../agent-operations/scene-queries'
import {
  type AnyNode,
  type AnyNodeId,
  getConicalRoofCoverage,
  getRoofSegmentDeckReach,
  getSegmentSlopeFrame,
  type LevelNode,
  type SlabNode,
  type WallNode,
  type ZoneNode,
} from '../schema'
import { resolveRoomRoofFootprintOnLevel } from '../systems/roof/roof-footprint'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { sampleWallCenterline } from '../systems/wall/wall-curve'
import { resolveWallTop } from '../systems/wall/wall-top'
import { getWallPlaneTop } from './storey'

/**
 * What a roof bears on: the walls along its edges with open air past them, their tops in their
 * level's metres. A wall with a room past it (the house a porch or a wing leans on) is one the roof
 * dies into, not one it sits on; a porch's or a portico's edges have posts, not walls.
 */

type Nodes = Readonly<Record<string, AnyNode>>

const r3 = (value: number) => Math.round(value * 1000) / 1000

/** Pascal's plan rotation: positive turns local +z toward +x (the roof, stair and item convention). */
function rot(x: number, z: number, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [x * c + z * s, -x * s + z * c]
}

export type WallSpan = { base: number; top: number }

/** Where each wall of a level stands, in that level's metres: on the slab it is elected to, up to its own height or the storey's plane. */
export function wallSpans(nodes: Nodes, levelId: string): Map<string, WallSpan> {
  const content = nodesOnLevel(nodes, levelId)
  const slabs = content.filter((node): node is SlabNode => node.type === 'slab')
  const walls = content.filter((node): node is WallNode => node.type === 'wall')
  return new Map(
    walls.map((wall) => {
      const support = computeWallSlabSupport(
        wall,
        slabs,
        walls,
        wall.supportSlabId,
        undefined,
        0,
        nodes,
      )
      const top = resolveWallTop(
        wall,
        getWallPlaneTop(wall, levelId, nodes as Record<AnyNodeId, AnyNode>),
        support.elevation,
      )
      return [wall.id, { base: support.elevation, top }]
    }),
  )
}

/** A roof mass in plan: its centre, turn and half sizes at the wall centre lines, how far its deck reaches past them along its ridge and across it, its form and how high it peaks over its eave. */
export type RoofShape = {
  cx: number
  cz: number
  yaw: number
  hw: number
  hd: number
  reach: { x: number; z: number }
  roofType: string
  peak: number
  /** A cone clipped to a sector, in its own frame (radians); none for a full cone. */
  sector?: { start: number; sweep: number }
}

/** A segment drawn over a rectangle of wall centre lines, [x0, z0, x1, z1], with its ridge along `ridgeAxis`. */
export function shapeOfRect(
  rect: [number, number, number, number],
  ridgeAxis: 'x' | 'z',
  roofType: string,
  pitchDeg: number,
): RoofShape {
  const [ax, az, bx, bz] = rect
  const w = Math.abs(bx - ax)
  const d = Math.abs(bz - az)
  const width = ridgeAxis === 'x' ? w : d
  const depth = ridgeAxis === 'x' ? d : w
  return {
    cx: (ax + bx) / 2,
    cz: (az + bz) / 2,
    yaw: ridgeAxis === 'x' ? 0 : -Math.PI / 2,
    hw: width / 2,
    hd: depth / 2,
    reach: { x: 0, z: 0 },
    roofType,
    peak: getSegmentSlopeFrame({ roofType, pitch: pitchDeg, width, depth } as never).activeRh,
  }
}

/** A segment where it stands, in its roof's level plan, through its roof container's placement. */
export function segmentShape(nodes: Nodes, segmentId: string): RoofShape | null {
  const segment = nodes[segmentId]
  const roof = segment?.type === 'roof-segment' ? nodes[segment.parentId ?? ''] : undefined
  if (segment?.type !== 'roof-segment' || roof?.type !== 'roof') return null
  const [ox, oz] = rot(segment.position[0], segment.position[2], roof.rotation)
  const frame = getSegmentSlopeFrame(segment)
  const coverage = segment.roofType === 'conical' ? getConicalRoofCoverage(segment) : null
  return {
    cx: roof.position[0] + ox,
    cz: roof.position[2] + oz,
    yaw: roof.rotation + segment.rotation,
    hw: segment.width / 2,
    hd: segment.depth / 2,
    reach: getRoofSegmentDeckReach(segment),
    roofType: segment.roofType,
    peak: frame.activeRh,
    ...(coverage && !coverage.fullCircle
      ? { sector: { start: coverage.startAngle, sweep: coverage.sweepAngle } }
      : {}),
  }
}

const toLocal = (shape: RoofShape, point: Vec2): Vec2 =>
  rot(point[0] - shape.cx, point[1] - shape.cz, -shape.yaw)
const toPlan = (shape: RoofShape, local: Vec2): Vec2 => {
  const [x, z] = rot(local[0], local[1], shape.yaw)
  return [shape.cx + x, shape.cz + z]
}

/** How far the roof stands above its eave over a point of its own frame (0 outside its walls). */
export function riseAt(shape: RoofShape, lx: number, lz: number): number {
  const ex = shape.hw - Math.abs(lx)
  const ez = shape.hd - Math.abs(lz)
  if (ex < -1e-6 || ez < -1e-6 || shape.peak <= 0 || shape.hw <= 0 || shape.hd <= 0) return 0
  switch (shape.roofType) {
    case 'flat':
      return 0
    // a shed rises from its low eave at +z to its high one at -z
    case 'shed':
      return (shape.peak * (shape.hd - lz)) / (2 * shape.hd)
    case 'gable':
    case 'gambrel':
      return (shape.peak * Math.max(0, ez)) / shape.hd
    case 'conical':
      return shape.peak * Math.max(0, 1 - Math.hypot(lx, lz) / shape.hw)
    default:
      return (shape.peak * Math.max(0, Math.min(ex, ez))) / Math.min(shape.hw, shape.hd)
  }
}

/** A wall within this of a roof's edge line runs along that edge. */
const ON_EDGE = 0.2
/** Less of a wall than this along an edge only crosses its end. */
const MIN_OVERLAP = 0.3
/** How far past a wall's face the far side is read. */
const BEYOND = 0.3

export type Bearing = { id: string; name: string; top: number; rise: number }

type LevelPlan = { walls: WallNode[]; rooms: ZoneNode[]; spans: Map<string, WallSpan> }

// Identity-keyed, as `getLevelElevations` is: `nodes` is an immutable scene snapshot, so one seat
// or verify pass reads each level's walls, rooms and wall tops once, however many segments it tests
// against them (a 500-node paste of 450 segments read the whole scene per wall per segment: 13 s).
const planMemo = new WeakMap<object, Map<string, LevelPlan>>()

/** A level's visible walls, its rooms and where its walls stand. */
function planOf(nodes: Nodes, levelId: string): LevelPlan {
  let memo = planMemo.get(nodes)
  if (!memo) {
    memo = new Map()
    planMemo.set(nodes, memo)
  }
  const hit = memo.get(levelId)
  if (hit) return hit
  const walls: WallNode[] = []
  const rooms: ZoneNode[] = []
  for (const node of Object.values(nodes)) {
    if (node.parentId !== levelId) continue
    if (node.type === 'wall' && node.visible !== false) walls.push(node)
    else if (node.type === 'zone' && node.polygon.length >= 3) rooms.push(node)
  }
  const plan = { walls, rooms, spans: wallSpans(nodes, levelId) }
  memo.set(levelId, plan)
  return plan
}

/** Whether the far side of a wall, at `probe`, is indoors: in a room, or labelled interior on a level with no rooms. */
function indoors(rooms: readonly ZoneNode[], wall: WallNode, probe: Vec2): boolean {
  if (rooms.length) return rooms.some((room) => pointInPolygon(probe, room.polygon as Vec2[]))
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz) || 1
  // the door renderer's perpendicular: the direction turned 90° (x, z) → (-z, x)
  const front =
    (probe[0] - wall.start[0]) * (-dz / length) + (probe[1] - wall.start[1]) * (dx / length) > 0
  return (front ? wall.frontSide : wall.backSide) === 'interior'
}

const bearing = (wall: WallNode, top: number, rise: number): Bearing => ({
  id: wall.id,
  name: wall.name ?? wall.id,
  top: r3(top),
  rise,
})

/** Whether a local angle of a cone falls in its sector. */
function inSector(shape: RoofShape, angle: number): boolean {
  if (!shape.sector) return true
  const { start, sweep } = shape.sector
  const turn = Math.PI * 2
  const from = (((sweep >= 0 ? angle - start : start - angle) % turn) + turn) % turn
  return from <= Math.abs(sweep) + 1e-6
}

/** The walls of a level a cone sits on: along its eave circle, within its sector, open air past them. */
function coneWallsUnder({ walls, rooms, spans }: LevelPlan, shape: RoofShape): Bearing[] {
  const found: Bearing[] = []
  for (const wall of walls) {
    const top = spans.get(wall.id)?.top
    if (top === undefined) continue
    const points = sampleWallCenterline(wall, 24).map(({ x, y }) => toLocal(shape, [x, y]))
    const onEave = points.map(
      ([lx, lz]) =>
        Math.abs(Math.hypot(lx, lz) - shape.hw) <= ON_EDGE && inSector(shape, Math.atan2(lz, lx)),
    )
    let along = 0
    for (let i = 1; i < points.length; i++)
      if (onEave[i - 1] && onEave[i])
        along += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])
    if (along < MIN_OVERLAP) continue
    const stretch = points.filter((_, i) => onEave[i])
    const [lx, lz] = stretch[Math.floor(stretch.length / 2)]!
    const out = (shape.hw + (wall.thickness ?? 0.15) / 2 + BEYOND) / (Math.hypot(lx, lz) || 1)
    if (!indoors(rooms, wall, toPlan(shape, [lx * out, lz * out])))
      found.push(bearing(wall, top, 0))
  }
  return found
}

/** The walls of a level a roof sits on, each with its top and the least the roof rises over it. */
export function wallsUnder(nodes: Nodes, levelId: string, shape: RoofShape): Bearing[] {
  const plan = planOf(nodes, levelId)
  if (shape.roofType === 'conical') return coneWallsUnder(plan, shape)
  const found: Bearing[] = []
  for (const wall of plan.walls) {
    const a = toLocal(shape, wall.start)
    const b = toLocal(shape, wall.end)
    for (const [across, at] of [
      [1, -shape.hd],
      [1, shape.hd],
      [0, -shape.hw],
      [0, shape.hw],
    ] as const) {
      if (Math.abs(a[across] - at) > ON_EDGE || Math.abs(b[across] - at) > ON_EDGE) continue
      const [ua, ub] = across === 1 ? [a[0], b[0]] : [a[1], b[1]]
      const half = across === 1 ? shape.hw : shape.hd
      const u0 = Math.max(-half, Math.min(ua, ub))
      const u1 = Math.min(half, Math.max(ua, ub))
      if (u1 - u0 < MIN_OVERLAP) continue
      const point = (u: number, off = 0): Vec2 => (across === 1 ? [u, at + off] : [at + off, u])
      const out = Math.sign(at) * ((wall.thickness ?? 0.15) / 2 + BEYOND)
      const indoorsAt = (u: number, off: number) =>
        indoors(plan.rooms, wall, toPlan(shape, point(u, off)))
      // A wall running on past the roof's end with rooms on the roof's side there belongs to a
      // house the roof dies into (a porch box buried in it, a full-width porch flush with its
      // sides): the roof does not sit on it.
      const intoHouse =
        (Math.min(ua, ub) < -half - ON_EDGE && indoorsAt(-half - BEYOND, -out)) ||
        (Math.max(ua, ub) > half + ON_EDGE && indoorsAt(half + BEYOND, -out))
      const top = plan.spans.get(wall.id)?.top
      if (top !== undefined && !intoHouse && !indoorsAt((u0 + u1) / 2, out))
        found.push(
          bearing(wall, top, Math.min(riseAt(shape, ...point(u0)), riseAt(shape, ...point(u1)))),
        )
      break
    }
  }
  return found
}

/** The eave a roof needs to clear the walls it sits on, in their level's metres; null when it sits on none. */
export const seatOn = (walls: Bearing[]): number | null =>
  walls.length ? r3(Math.max(...walls.map((wall) => wall.top - wall.rise))) : null

/** The walls of `levelId` a segment bears on, and the eave they need (null: it bears on none). */
export function segmentBearing(
  nodes: Nodes,
  segmentId: string,
  levelId: string,
): { walls: Bearing[]; need: number | null } {
  const shape = segmentShape(nodes, segmentId)
  const walls = shape ? wallsUnder(nodes, levelId, shape) : []
  return { walls, need: seatOn(walls) }
}

/**
 * Whether a roof footprint with no segment of its own yet (a rectangle drawn by hand, an imported
 * roof plane) stands over a storey: an edge of it bears on the level's walls (`wallsUnder`), or it
 * covers a room those walls enclose (a rectangle drawn loosely over a house). A porch or portico
 * over posts beside the house does neither, and stays on the storey with its posts.
 */
export function standsOverStorey(nodes: Nodes, levelId: string, shape: RoofShape): boolean {
  return (
    wallsUnder(nodes, levelId, shape).length > 0 ||
    resolveRoomRoofFootprintOnLevel(levelId as LevelNode['id'], nodes, [shape.cx, shape.cz]) !==
      null
  )
}
