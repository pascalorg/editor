import { floorsOf } from '../../agent-operations/circulation-spaces'
import { isFloorUnderlay } from '../../agent-operations/furniture-kind'
import { area, containsPoint, intersection } from '../../lib/polygon-boolean'
import type { DoorNode, ItemNode, WallNode } from '../../schema'
import { getLevelElevations } from '../../services/storey'
import { getWallThickness } from '../../systems/wall/wall-footprint'
import { getWallLocalFaceZ } from '../../systems/wall/wall-frame'
import { CLASH_INFO_M, CLASH_MIN_AREA_M2, wallFixed } from './clash'
import { DOOR_M, PASSAGE_M, type UsageIssue } from './findings'
import { m, nameOf, quote, unique } from './labels'
import { doorwayRing } from './openings'
import {
  boxesMeet,
  isBuildingElement,
  isFoliage,
  isPiecePrism,
  narrowestExtent,
  ringBox,
} from './pieces'
import { doorFrame, FIXTURE } from './swings'
import type { Prism, Ring, UsageShapes } from './types'
import { levelWalls, type Nodes } from './walls'
import { wayIn } from './way-in'

type Point = [number, number]
type Entrance = { ring: Ring; at: Point; door?: DoorNode }

/** Where a doorway is looked at from: this far to either side of the wall's middle (m). */
const SIDE_M = 0.3
/** A zone edge is sampled this often (m) to find where no wall stands on it. */
const SAMPLE_M = 0.05
/** Joinery made for the room: a built-in robe or a fitted unit is where it was designed to be. */
const BUILT_IN = /built[- ]?in|fitted|joinery/i
/** A wall stands on a zone edge when its middle line is within half its thickness and this much (m). */
const SCRIBE_M = 0.02
/** An open edge is a passage of this half thickness across (m): a doorway's, a wall's half thickness and a centimetre. */
const OPEN_HALF_M = 0.065

/** The segment's distance from a point. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const length2 = dx * dx + dz * dz
  const t =
    length2 < 1e-12
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length2))
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t))
}

/**
 * The stretches of a zone's boundary with no wall on them, a doorway's width or more: where the room is
 * open to the one beside it. A ring across each, a wall's thickness deep, is the way in.
 */
function openEntrances(
  walls: WallNode[],
  zone: { polygon: Ring; holes: Ring[] },
  zones: { id: string; polygon: Ring; holes: Ring[] }[],
  self: string,
): Entrance[] {
  const out: Entrance[] = []
  const covered = (p: Point) =>
    walls.some(
      (wall) =>
        segmentDistance(p, wall.start as Point, wall.end as Point) <=
        getWallThickness(wall) / 2 + SCRIBE_M,
    )
  for (const [i, a] of zone.polygon.entries()) {
    const b = zone.polygon[(i + 1) % zone.polygon.length]!
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < DOOR_M) continue
    const tx = (b[0] - a[0]) / length
    const tz = (b[1] - a[1]) / length
    const steps = Math.ceil(length / SAMPLE_M)
    let from = -1
    const close = (last: number) => {
      const s0 = (from * length) / steps
      const s1 = (last * length) / steps
      if (from >= 0 && s1 - s0 >= DOOR_M) {
        const p0: Point = [a[0] + tx * s0, a[1] + tz * s0]
        const p1: Point = [a[0] + tx * s1, a[1] + tz * s1]
        const mid: Point = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]
        // a room beyond: the opening is a way between two rooms, not a gap in the outline
        const beyond = [1, -1].some((side) => {
          const q: Point = [mid[0] - tz * side * SIDE_M, mid[1] + tx * side * SIDE_M]
          return (
            !containsPoint([{ outer: zone.polygon, holes: zone.holes }], q) &&
            zones.some(
              (z) => z.id !== self && containsPoint([{ outer: z.polygon, holes: z.holes }], q),
            )
          )
        })
        if (beyond)
          out.push({
            ring: [
              [p0[0] - tz * OPEN_HALF_M, p0[1] + tx * OPEN_HALF_M],
              [p1[0] - tz * OPEN_HALF_M, p1[1] + tx * OPEN_HALF_M],
              [p1[0] + tz * OPEN_HALF_M, p1[1] - tx * OPEN_HALF_M],
              [p0[0] + tz * OPEN_HALF_M, p0[1] - tx * OPEN_HALF_M],
            ],
            at: mid,
          })
      }
      from = -1
    }
    for (let s = 0; s <= steps; s++) {
      const p: Point = [a[0] + (tx * s * length) / steps, a[1] + (tz * s * length) / steps]
      if (covered(p)) {
        if (from >= 0) close(s - 1)
      } else if (from < 0) from = s
    }
    if (from >= 0) close(steps)
  }
  return out
}

/** The doors of a level that lead into a zone: a doorway of any kind but a vehicle's whose one side, and only one, is in the zone. */
function doorEntrances(
  nodes: Nodes,
  doors: DoorNode[],
  zone: { polygon: Ring; holes: Ring[] },
): Entrance[] {
  const out: Entrance[] = []
  for (const door of doors) {
    const f = doorFrame(nodes, door)
    const across = (getWallLocalFaceZ(f.wall, 'a') + getWallLocalFaceZ(f.wall, 'b')) / 2
    const side = (sign: number): Point => [
      f.sx + f.tx * f.along + f.nx * (across + sign * SIDE_M),
      f.sz + f.tz * f.along + f.nz * (across + sign * SIDE_M),
    ]
    const inside = [1, -1].filter((sign) =>
      containsPoint([{ outer: zone.polygon, holes: zone.holes }], side(sign)),
    )
    if (inside.length !== 1) continue
    const ring = doorwayRing(f.wall, door)
    if (!ring) continue
    out.push({
      ring,
      at: [f.sx + f.tx * f.along + f.nx * across, f.sz + f.tz * f.along + f.nz * across],
      door,
    })
  }
  return out
}

/**
 * What closes off part of a room: from each entrance of a room (a doorway, or an open edge to the room
 * beside it) the widest way to the room's open floor, with the pieces of furniture standing where they
 * are. A way under a passage's width that a piece bounds is a finding that names the piece, the room and
 * what is on the other side of the pinch. A leaf swinging open is `doorSwingIssues`'s, a doorway's own
 * width and the walls' are the passage measure's: only a free-standing piece is named. What is built to
 * stand there stays quiet: a kitchen run or anything on a wall, a fixture, built-in joinery, foliage, a
 * building element, a rug, a piece on another piece. A room narrower than a passage is judged on its doorway only.
 */
export function entryIssues(nodes: Nodes, shapes: UsageShapes): UsageIssue[] {
  const out: UsageIssue[] = []
  const floors = floorsOf(nodes).floors
  const elevations = getLevelElevations(nodes as never)
  for (const level of shapes.levels) {
    const floor = floors.find((f) => f.id === level.levelId)
    if (!floor) continue
    const baseY = elevations.get(level.levelId)?.baseY ?? 0
    const isUnderlay = (prism: Prism) =>
      nodes[prism.nodeId]?.type === 'item' && isFloorUnderlay(nodes[prism.nodeId] as ItemNode)
    const standing = (prism: Prism) => {
      const node = nodes[prism.nodeId]
      return (
        (prism.kind === 'item' || prism.kind === 'shelf') &&
        isPiecePrism(prism) &&
        !wallFixed(nodes, prism) &&
        !isUnderlay(prism) &&
        !isFoliage(nodes, prism.nodeId) &&
        !isBuildingElement(nodes, prism.nodeId) &&
        !FIXTURE.test(nameOf(nodes, prism.nodeId)) &&
        !BUILT_IN.test(nameOf(nodes, prism.nodeId)) &&
        nodes[node?.parentId ?? '']?.type !== 'item'
      )
    }
    const named = new Set(level.prisms.filter(standing).map((prism) => prism.id))
    if (named.size === 0) continue
    const namedPrisms = level.prisms.filter((prism) => named.has(prism.id))
    const walls = levelWalls(nodes, level.levelId)
    const wallIds = new Set<string>(walls.map((wall) => wall.id))
    const doors = Object.values(nodes).filter(
      (node): node is DoorNode =>
        node.type === 'door' &&
        node.visible !== false &&
        !String(node.doorType).startsWith('garage') &&
        wallIds.has(node.parentId ?? ''),
    )
    const zones = floor.zones.filter((zone) => !zone.outdoor)
    const found = new Map<string, { issue: UsageIssue; width: number }>()
    for (const zone of zones) {
      if (narrowestExtent([{ outer: zone.polygon }]) < PASSAGE_M) continue
      const zoneBox = ringBox(zone.polygon)
      // a piece is in the room when it stands a contact's depth inside it: one against the wall on the other side is that room's
      const here = new Set(
        namedPrisms
          .filter((prism) => {
            if (!boxesMeet(ringBox(prism.outer), zoneBox)) return false
            const meet = intersection(
              { outer: prism.outer, holes: prism.holes },
              { outer: zone.polygon, holes: zone.holes },
            )
            return area(meet) >= CLASH_MIN_AREA_M2 && narrowestExtent(meet) >= CLASH_INFO_M
          })
          .map((prism) => prism.id),
      )
      if (here.size === 0) continue
      const room = { id: zone.id, name: nameOf(nodes, zone.id) }
      const entrances = [
        ...doorEntrances(nodes, doors, zone),
        ...openEntrances(walls, zone, zones, zone.id),
      ]
      for (const entrance of entrances) {
        const way = wayIn(
          shapes,
          level,
          zone,
          entrance.ring,
          entrance.at,
          baseY,
          isUnderlay,
          (prism) => here.has(prism.id),
        )
        if (!way) continue
        const subject = way.by.find((o) => here.has(o.prism.id))!
        const other = way.by.find((o) => o !== subject)
        const approximate = way.by.some((o) => o.prism.shape === 'approx')
        const key = `${zone.id}|${subject.prism.nodeId}`
        if ((found.get(key)?.width ?? Number.POSITIVE_INFINITY) <= way.width) continue
        found.set(key, {
          width: way.width,
          issue: {
            type: 'usage_entry_narrow',
            message: `${quote(nameOf(nodes, subject.prism.nodeId))} leaves ${m(way.width)} m to enter ${quote(room.name)}, ${other ? `between it and ${quote(nameOf(nodes, other.prism.nodeId))}` : 'against it'} (below ${m(PASSAGE_M)} m).`,
            severity: 'warning',
            nodeIds: unique([
              room.id,
              subject.prism.nodeId,
              other?.prism.nodeId,
              entrance.door?.id,
            ]),
            valueM: way.width,
            thresholdM: PASSAGE_M,
            place: { room: room.name, roomId: room.id, at: way.at },
            obstacles: way.by.map((o) => ({
              nodeId: o.prism.nodeId,
              name: nameOf(nodes, o.prism.nodeId),
              kind: o.prism.kind,
              shape: o.prism.shape,
              movable: false,
            })),
            approximate,
          },
        })
      }
    }
    out.push(...[...found.values()].map(({ issue }) => issue))
  }
  return out
}
