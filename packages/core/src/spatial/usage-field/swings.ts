import { isFloorUnderlay } from '../../agent-operations/furniture-kind'
import { resolveLevelId } from '../../lib/node-ancestry'
import type { DoorNode, ItemNode, WallNode, ZoneNode } from '../../schema'
import { getLevelElevations } from '../../services/storey'
import { getWallLocalFaceZ } from '../../systems/wall/wall-frame'
import { PASSAGE_M, type UsageIssue } from './findings'
import { m, nameOf, quote, unique } from './labels'
import { type Obstacle, obstacleDistance, obstacleOf } from './obstacles'
import { doorwayRing } from './openings'
import { isFoliage, isPiecePrism, roomAt } from './pieces'
import type { LevelShapes, Prism, UsageShapes } from './types'
import type { Nodes } from './walls'
import { wayIn } from './way-in'

/** The leaf is swept in steps of this many degrees. */
export const SWEEP_STEP_DEG = 3
/** A door that stops before this angle does not open fully: a leaf flat against a wall at 90 degrees reads a few degrees short, and one that opens to 80 leaves the way clear. */
export const OPENS_FULLY_DEG = 80
/** A leaf that stops short of this angle is no way through: the finding is ranked with the blockers. */
export const DOOR_STOPPED_BLOCKING_DEG = 30
/** A leaf is in something once it is this far inside it (m): a leaf resting against a surface is not. */
const PENETRATION_M = 0.015
const LEAF_STEP_M = 0.04
/** The leaf is a little narrower than its opening: the frame takes this much (m). */
export const FRAME_M = 0.04
const LEAF_THICKNESS_M = 0.04
/** Two openings this near are one pair of doors. */
const PAIR_GAP_M = 0.05
/** An open leaf rests on a wall when its middle and tip are this near it (m): a hand's breadth off is not flat. */
const REST_M = 0.1
const DEFAULT_DOOR_HEIGHT_M = 2.04

export const FIXTURE =
  /toilet|water ?closet|(?:^|[^a-z])wc(?![a-z])|basin|lavatory|vanity|sink|shower|bath|(?:^|[^a-z])tub(?![a-z])/i

export type Hung = { swing: 1 | -1; hs: 1 | -1 }
type Point = [number, number]

type Sweep = {
  free: number
  by: {
    prism: Prism
    name: string
    kind: 'wall' | 'cabinet' | 'fixture' | 'furniture' | 'door' | 'stair'
  } | null
}

/**
 * Which way each door's leaf can be swept: a door swinging to a side of its wall, hinged at one jamb.
 * The side and the hinge follow the floor plan's drawing (`hingesSide`, `swingDirection`, both flipped for a turned door).
 */
export function hungOf(door: DoorNode): Hung {
  const flipped = Math.cos(door.rotation?.[1] ?? 0) < 0
  const hingeLeft = flipped ? door.hingesSide !== 'left' : door.hingesSide === 'left'
  const inward = flipped ? door.swingDirection !== 'inward' : door.swingDirection === 'inward'
  return { swing: inward ? 1 : -1, hs: hingeLeft ? 1 : -1 }
}

/** The door fields that give `hung` on a door that is not turned: the inverse of `hungOf`. */
export function hangingOf(hung: Hung): Pick<DoorNode, 'hingesSide' | 'swingDirection'> {
  return {
    hingesSide: hung.hs > 0 ? 'left' : 'right',
    swingDirection: hung.swing > 0 ? 'inward' : 'outward',
  }
}

/** The doors on a level whose leaf swings: not sliding, garage, pocket or open doorways. */
export function swingDoors(nodes: Nodes, levelId: string): DoorNode[] {
  return Object.values(nodes).filter(
    (node): node is DoorNode =>
      node.type === 'door' &&
      node.visible !== false &&
      node.doorType !== 'sliding' &&
      !String(node.doorType).startsWith('garage') &&
      node.doorType !== 'pocket' &&
      node.openingKind !== 'opening' &&
      (nodes[node.parentId ?? ''] as WallNode | undefined)?.type === 'wall' &&
      resolveLevelId(nodes[node.parentId!] as WallNode, nodes as never) === levelId,
  )
}

/** A door in its wall's frame: the wall's origin, unit tangent and normal, half the opening and where it is along the wall. */
export function doorFrame(nodes: Nodes, door: DoorNode) {
  const wall = nodes[door.parentId!] as WallNode
  const [sx, sz] = wall.start
  const length = Math.hypot(wall.end[0] - sx, wall.end[1] - sz)
  const tx = (wall.end[0] - sx) / length
  const tz = (wall.end[1] - sz) / length
  return {
    wall,
    sx,
    sz,
    tx,
    tz,
    nx: -tz,
    nz: tx,
    half: (door.width ?? 0.9) / 2,
    along: door.position[0],
  }
}

/** Where a door's leaf is hinged: at the jamb, on the face of the wall it swings to. */
export function hingeOf(nodes: Nodes, door: DoorNode, hung: Hung): Point {
  const f = doorFrame(nodes, door)
  const faceZ = getWallLocalFaceZ(f.wall, hung.swing > 0 ? 'a' : 'b')
  return [
    f.sx + f.tx * (f.along - hung.hs * f.half) + f.nx * faceZ,
    f.sz + f.tz * (f.along - hung.hs * f.half) + f.nz * faceZ,
  ]
}

/** The direction the leaf points at `theta` radians from closed. */
export function leafDirection(f: ReturnType<typeof doorFrame>, hung: Hung, theta: number): Point {
  return [
    f.tx * hung.hs * Math.cos(theta) + f.nx * hung.swing * Math.sin(theta),
    f.tz * hung.hs * Math.cos(theta) + f.nz * hung.swing * Math.sin(theta),
  ]
}

/** Whether two walls lie on the same line (a wall split in two, the door near the join): neither is an obstacle to a leaf on the other. */
function continues(a: WallNode, b: WallNode): boolean {
  const ax = a.end[0] - a.start[0]
  const az = a.end[1] - a.start[1]
  const bx = b.end[0] - b.start[0]
  const bz = b.end[1] - b.start[1]
  const al = Math.hypot(ax, az)
  const bl = Math.hypot(bx, bz)
  if (al < 1e-6 || bl < 1e-6) return false
  if (Math.abs((ax * bz - az * bx) / (al * bl)) > Math.sin((8 * Math.PI) / 180)) return false
  return Math.abs(((b.start[0] - a.start[0]) * -az + (b.start[1] - a.start[1]) * ax) / al) < 0.3
}

/**
 * What reads how the doors of one level swing: a door's leaf swept against what stands round it (`sweepOf`), and the way
 * into the room it opens into past the leaf open at an angle (`wayOf`).
 */
export function swingReader(nodes: Nodes, shapes: UsageShapes, level: LevelShapes) {
  const baseY = getLevelElevations(nodes as never).get(level.levelId)?.baseY ?? 0
  const isUnderlay = (prism: Prism) =>
    nodes[prism.nodeId]?.type === 'item' && isFloorUnderlay(nodes[prism.nodeId] as ItemNode)
  const prisms = level.prisms.filter((prism) => !isUnderlay(prism))
  const pieces = prisms.filter((p) => isPiecePrism(p) && !isFoliage(nodes, p.nodeId))
  const walls = prisms.filter((p) => p.kind === 'wall')
  const stairs = prisms.filter((p) => p.kind === 'stair')
  const doors = swingDoors(nodes, level.levelId)
  const heightOf = (door: DoorNode) => baseY + (door.height ?? DEFAULT_DOOR_HEIGHT_M)

  const frameOf = (door: DoorNode) => doorFrame(nodes, door)
  const leafPrism = (door: DoorNode): Prism => {
    const f = frameOf(door)
    const across = (getWallLocalFaceZ(f.wall, 'a') + getWallLocalFaceZ(f.wall, 'b')) / 2
    const at = (u: number, v: number): Point => [
      f.sx + f.tx * u + f.nx * v,
      f.sz + f.tz * u + f.nz * v,
    ]
    return {
      id: `${door.id}#leaf`,
      nodeId: door.id,
      kind: 'other',
      z0: baseY,
      z1: heightOf(door),
      outer: [
        at(f.along - f.half, across - LEAF_THICKNESS_M / 2),
        at(f.along + f.half, across - LEAF_THICKNESS_M / 2),
        at(f.along + f.half, across + LEAF_THICKNESS_M / 2),
        at(f.along - f.half, across + LEAF_THICKNESS_M / 2),
      ],
      holes: [],
      shape: 'exact',
    }
  }
  const classOf = (prism: Prism): NonNullable<Sweep['by']>['kind'] =>
    prism.kind === 'wall'
      ? 'wall'
      : prism.kind === 'stair'
        ? 'stair'
        : prism.kind === 'other'
          ? 'door'
          : prism.kind === 'cabinet'
            ? 'cabinet'
            : FIXTURE.test(nameOf(nodes, prism.nodeId))
              ? 'fixture'
              : 'furniture'
  const leaves = new Map(doors.map((door) => [door.id, leafPrism(door)]))
  /** The walls a door's leaf can meet: all but its own and those that carry on in line with it. */
  const wallsAround = (door: DoorNode) => {
    const host = frameOf(door).wall
    return walls.filter((p) => {
      const other = nodes[p.nodeId] as WallNode | undefined
      return p.nodeId !== host.id && !(other?.type === 'wall' && continues(host, other))
    })
  }

  const sweepOf = (door: DoorNode, hung: Hung): Sweep & { pivot: Point } => {
    const f = frameOf(door)
    const [hx, hz] = hingeOf(nodes, door, hung)
    const top = heightOf(door)
    const around: Obstacle[] = []
    let index = 0
    const across = (getWallLocalFaceZ(f.wall, 'a') + getWallLocalFaceZ(f.wall, 'b')) / 2
    const closed: Point = [
      f.sx + f.tx * f.along + f.nx * across,
      f.sz + f.tz * f.along + f.nz * across,
    ]
    const take = (prism: Prism) => {
      if (prism.z1 <= baseY + 0.05 || prism.z0 >= top - 0.1) return
      const obstacle = obstacleOf(prism, index++)
      // An approximate outline that holds the closed leaf is a box round the door (a portal, a
      // frame, trim the door stands in), not something in its way: its true outline has the opening.
      if (prism.shape === 'approx' && obstacleDistance(obstacle, closed[0], closed[1]) < 0) return
      around.push(obstacle)
    }
    for (const p of pieces) if (p.nodeId !== door.id) take(p)
    for (const p of wallsAround(door)) take(p)
    for (const p of stairs) take(p)
    for (const [id, leaf] of leaves) if (id !== door.id) take(leaf)
    const length = 2 * f.half - FRAME_M
    for (let a = SWEEP_STEP_DEG; a <= 90; a += SWEEP_STEP_DEG) {
      const th = (a * Math.PI) / 180
      const [dx, dz] = leafDirection(f, hung, th)
      for (let s = LEAF_STEP_M; s <= length + 1e-9; s += LEAF_STEP_M) {
        const px = hx + dx * s
        const pz = hz + dz * s
        for (const ob of around) {
          if (
            px < ob.aabb[0] - 0.02 ||
            px > ob.aabb[2] + 0.02 ||
            pz < ob.aabb[1] - 0.02 ||
            pz > ob.aabb[3] + 0.02
          )
            continue
          if (obstacleDistance(ob, px, pz) >= -PENETRATION_M) continue
          return {
            free: a - SWEEP_STEP_DEG,
            by: {
              prism: ob.prism,
              name: nameOf(nodes, ob.prism.nodeId),
              kind: classOf(ob.prism),
            },
            pivot: [hx, hz],
          }
        }
      }
    }
    return { free: 90, by: null, pivot: [hx, hz] }
  }

  // only a door of one hinged leaf: a double, a french pair, a folding or a barn door is not one leaf of the whole width,
  // and neither is a door whose opening abuts another's, a pair meant to open together
  const notOneLeaf = (door: DoorNode) =>
    door.doorType !== 'hinged' ||
    (door.leafCount ?? 1) > 1 ||
    doors.some(
      (other) =>
        other.id !== door.id &&
        other.parentId === door.parentId &&
        hungOf(other).swing === hungOf(door).swing &&
        Math.abs(other.position[0] - door.position[0]) <=
          ((other.width ?? 0.9) + (door.width ?? 0.9)) / 2 + PAIR_GAP_M,
    )

  /** The room a leaf swinging to `swing` opens into: the zone 0.3 m off the wall's face on that side. */
  const roomBeyond = (door: DoorNode, swing: 1 | -1) => {
    const f = frameOf(door)
    const across = (getWallLocalFaceZ(f.wall, 'a') + getWallLocalFaceZ(f.wall, 'b')) / 2
    const front: Point = [
      f.sx + f.tx * f.along + f.nx * (across + swing * 0.3),
      f.sz + f.tz * f.along + f.nz * (across + swing * 0.3),
    ]
    return roomAt(nodes, level.levelId, front)
  }
  /** The way into the room the door opens into, with its leaf open at `angle`: narrow only when the leaf bounds it. */
  const wayOf = (door: DoorNode, hung: Hung, angle: number) => {
    const f = frameOf(door)
    const room = roomBeyond(door, hung.swing)
    const zone = room ? (nodes[room.id] as ZoneNode) : null
    if (!room || !zone) return null
    const ring = doorwayRing(f.wall, door)
    if (!ring) return null
    const [hx, hz] = hingeOf(nodes, door, hung)
    const [dx, dz] = leafDirection(f, hung, (angle * Math.PI) / 180)
    const length = 2 * f.half - FRAME_M
    const leaf: Prism = {
      id: `${door.id}#open-leaf`,
      nodeId: door.id,
      kind: 'other',
      z0: baseY,
      z1: baseY + (door.height ?? DEFAULT_DOOR_HEIGHT_M),
      outer: [
        [hx, hz],
        [hx + dx * length, hz + dz * length],
      ],
      holes: [],
      shape: 'exact',
    }
    const way = wayIn(
      shapes,
      level,
      zone,
      ring,
      [hx, hz],
      baseY,
      isUnderlay,
      (prism) => prism.id === leaf.id,
      leaf,
    )
    return { room, way, leaf }
  }
  const rests = (door: DoorNode, hung: Hung) => {
    const f = frameOf(door)
    const [hx, hz] = hingeOf(nodes, door, hung)
    const [dx, dz] = leafDirection(f, hung, Math.PI / 2)
    const length = 2 * f.half - FRAME_M
    const against = wallsAround(door)
      .filter((wall) => wall.z1 > baseY + 0.05 && wall.z0 < heightOf(door) - 0.1)
      .map(obstacleOf)
    return against.some((wall) =>
      [0.5, 1].every(
        (share) =>
          obstacleDistance(wall, hx + dx * length * share, hz + dz * length * share) <= REST_M,
      ),
    )
  }
  const wayInIssue = (door: DoorNode, hung: Hung, angle: number): UsageIssue | null => {
    if (notOneLeaf(door)) return null
    const here = wayOf(door, hung, angle)
    if (!here?.way) return null
    const { room, way, leaf } = here
    const other = way.by.find((o) => o.prism.id !== leaf.id)
    const bound = other
      ? `between the leaf's edge and ${quote(nameOf(nodes, other.prism.nodeId))}`
      : `against the leaf's edge`
    const flipped: Hung = { swing: hung.swing, hs: -hung.hs as 1 | -1 }
    const there = sweepOf(door, flipped)
    const instead =
      there.free < OPENS_FULLY_DEG
        ? `hung at the other jamb it opens to ${there.free}° and no further`
        : (() => {
            const again = wayOf(door, flipped, there.free)?.way
            return again
              ? `hung at the other jamb the way would be ${m(again.width)} m`
              : 'hung at the other jamb the leaf would leave the way clear'
          })()
    const approximate = way.by.some((o) => o.prism.shape === 'approx')
    return {
      type: 'usage_door_swing',
      message: `${quote(nameOf(nodes, door.id))} open${angle < 90 ? ` to ${angle}°` : ''}: ${m(way.width)} m to enter ${quote(room.name)}, ${bound} (below ${m(PASSAGE_M)} m); ${instead}.`,
      severity: 'warning',
      nodeIds: unique([room.id, door.id, ...way.by.map((o) => o.prism.nodeId)]),
      valueM: way.width,
      thresholdM: PASSAGE_M,
      place: { room: room.name, roomId: room.id, at: way.at },
      obstacles: way.by.map((o) => ({
        nodeId: o.prism.nodeId,
        name:
          o.prism.id === leaf.id
            ? `the leaf of ${quote(nameOf(nodes, door.id))}`
            : nameOf(nodes, o.prism.nodeId),
        kind: o.prism.kind,
        shape: o.prism.shape,
        movable: false,
      })),
      approximate,
    }
  }
  return { baseY, doors, roomBeyond, sweepOf, wayOf, rests, wayInIssue }
}

type SwingReader = ReturnType<typeof swingReader>

/**
 * Prefer the served side, then a leaf resting against a wall, but only among clear, fully opening hangings.
 * Read the costly way-in measure down that ranking only until the first clear one.
 */
export function hangToClear(
  reader: SwingReader,
  door: DoorNode,
  order: readonly [Hung, ...Hung[]],
): { hung: Hung; why: string } {
  const failures = new Map<Hung, string>()
  const opening = order.flatMap((hung) => {
    const { free } = reader.sweepOf(door, hung)
    if (free >= OPENS_FULLY_DEG) return [{ hung, free, rests: reader.rests(door, hung) }]
    failures.set(hung, `opens to ${free}° and no further`)
    return []
  })
  const ranked = opening.sort(
    (left, right) =>
      Number(right.hung.swing === order[0].swing) - Number(left.hung.swing === order[0].swing) ||
      Number(right.rests) - Number(left.rests),
  )
  for (const { hung, free, rests } of ranked) {
    const entry = reader.wayOf(door, hung, free)
    const way = entry?.way
    if (!way) {
      const merit = entry
        ? `its open leaf ${rests ? 'rests against a wall and ' : ''}leaves the way clear`
        : `opens fully${rests ? ' with its leaf against a wall' : ''}; no closed room to measure the way in`
      const first = failures.get(order[0])
      return { hung, why: first ? `${merit}; the first choice ${first}` : merit }
    }
    failures.set(hung, `leaves ${m(way.width)} m to enter the room`)
  }
  return { hung: order[0], why: 'no hanging opens fully and leaves the way clear' }
}

/**
 * A door's leaf swept from its closed position to 90 degrees about its hinge at the jamb, on the face of the wall
 * it swings to, against the pieces, cabinets, fixtures, walls, the treads and landings of a stair that rise above the
 * door's floor and the closed leaves of other doors: the first
 * angle at which it is in something. Read on the real outlines; the leaf is a line, so it is as long as the opening
 * is wide less the frame. A leaf that cannot open to 90 degrees is a finding; so is one that would open fully hung
 * the other way, which the message says. A door that cannot open at all (its hinge in a corner wall's body) reads 0.
 * A leaf stopped below `OPENS_FULLY_DEG` warns whatever outline its blocker has; an approximate
 * outline keeps its uncertainty and the message says "about" for the angle.
 *
 * A door that does open fully has its open leaf, at the angle it stops at, as an obstacle on the way from
 * the doorway into the room: a way under a passage's width that the leaf bounds is the second case of the
 * finding (`wayIn`), with what hanging the leaf at the other jamb would leave.
 */
export function doorSwingIssues(nodes: Nodes, shapes: UsageShapes): UsageIssue[] {
  const out: UsageIssue[] = []
  for (const level of shapes.levels) {
    const { baseY, doors, sweepOf, wayInIssue } = swingReader(nodes, shapes, level)

    const found = new Map<string, UsageIssue>()
    for (const door of doors) {
      const hung = hungOf(door)
      const here = sweepOf(door, hung)
      if (here.free >= OPENS_FULLY_DEG) {
        const way = wayInIssue(door, hung, here.free)
        if (way) found.set(`${door.id}|way`, way)
      }
      if (here.by === null || here.free >= OPENS_FULLY_DEG) continue
      const swung = sweepOf(door, { swing: -hung.swing as 1 | -1, hs: hung.hs })
      const hinged = sweepOf(door, { swing: hung.swing, hs: -hung.hs as 1 | -1 })
      const fixes = [
        swung.free >= OPENS_FULLY_DEG ? 'swings the other way' : null,
        hinged.free >= OPENS_FULLY_DEG ? 'is hinged on the other side' : null,
      ].filter((fix): fix is string => fix !== null)
      const room = roomAt(nodes, level.levelId, here.pivot)
      const approximate = here.by.prism.shape === 'approx'
      const roughly = approximate && here.free > 0
      // a stair's lower face above the middle of the leaf is its underside (a soffit over the door), not a tread the leaf meets low down
      const leafHeight = door.height ?? DEFAULT_DOOR_HEIGHT_M
      const clearance = here.by.prism.z0 - baseY
      const underside = here.by.kind === 'stair' && clearance >= leafHeight / 2
      const what =
        here.by.kind === 'door'
          ? `the leaf of ${quote(here.by.name)}`
          : underside
            ? `the underside of ${quote(here.by.name)} at ${m(clearance)} m, below the leaf's ${m(leafHeight)} m top`
            : quote(here.by.name)
      const key = `${door.id}|${here.by.prism.nodeId}`
      if (found.has(key)) continue
      found.set(key, {
        type: 'usage_door_swing',
        message: `${quote(nameOf(nodes, door.id))}${room ? ` in ${quote(room.name)}` : ''} ${here.free <= 0 ? 'cannot open: its leaf is against' : `opens to ${roughly ? 'about ' : ''}${here.free}° and no further: its leaf meets`} ${what}${here.by.kind === 'wall' ? (here.free <= SWEEP_STEP_DEG ? ' (a wall: the door stands too close to its corner)' : ' (a wall)') : here.by.kind === 'cabinet' ? ' (a cabinet)' : here.by.kind === 'fixture' ? ' (a fixture)' : here.by.kind === 'stair' && !underside ? ' (a stair)' : ''}${fixes.length ? `; it opens fully if it ${fixes.join(' or ')}` : '; it does not open fully hung either way'}.`,
        severity: 'warning',
        nodeIds: unique([room?.id, door.id, here.by.prism.nodeId]),
        valueDeg: here.free,
        thresholdDeg: 90,
        place: { room: room?.name ?? '', roomId: room?.id ?? level.levelId, at: here.pivot },
        obstacles: [
          {
            nodeId: here.by.prism.nodeId,
            name: here.by.name,
            kind: here.by.prism.kind,
            shape: here.by.prism.shape,
            movable: false,
          },
        ],
        approximate,
      })
    }
    out.push(...found.values())
  }
  return out
}
