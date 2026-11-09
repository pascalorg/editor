import { WALL_JUNCTION_TOLERANCE } from '../../lib/room-graph'
import { type AnyNode, SeparatorNode, type WallNode } from '../../schema'
import { isCurvedWall } from '../../systems/wall/wall-curve'
import {
  getPlannedLinkedWallUpdates,
  planAttachedWallUpdates,
  planWallMoveJunctions,
  type WallPlanPoint,
} from '../../systems/wall/wall-move'
import { WALL_MIN_LENGTH } from '../../systems/wall/wall-topology'
import {
  at,
  conflict,
  diffStructure,
  type Point,
  type StructureMintId,
  type StructureNodes,
  type StructurePlan,
} from './shared'

/**
 * Invisible walls (room separators) move the way walls do, so the rooms they close stay closed:
 * a separator joined end to end with a moving one stretches to its moved end (or takes a jog
 * where it runs on in line), one T'd into its body slides along its own line to stay on it, and
 * an end of the moving one sitting on a wall, a railing or another separator slides along that
 * line. Walls never move with them.
 */

/** A stretch of an invisible wall: `[0, 1]` is all of it. */
export type SeparatorSpan = { separatorId: string; t0: number; t1: number }

/**
 * How near invisible walls meet: ends this near are one corner and an end this near a line is on
 * it, as far as the room graph joins them (`WALL_JUNCTION_TOLERANCE`). A move puts such ends
 * exactly together, so a corner drawn a little open closes.
 */
export const SEPARATOR_JOIN_REACH = WALL_JUNCTION_TOLERANCE

type Line = { start: Point; end: Point }
type Boundary = WallNode | SeparatorNode

const JOIN = SEPARATOR_JOIN_REACH
const SAME_POINT = 1e-6
const WHOLE = 1e-4
// Lines within about 1° of each other run alongside: one end can't slide along the other.
const MIN_SINE = Math.sin(Math.PI / 180)
// The shortest invisible wall a move may leave, as a wall's (`setWallGeometry`).
const MIN_LENGTH = 0.05

const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1])
const near = (a: Point, b: Point) => distance(a, b) <= JOIN

/** Where `point` sits along `line` (metres from its start) and how far off its line. */
function station(point: Point, line: Line) {
  const dx = line.end[0] - line.start[0]
  const dz = line.end[1] - line.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return { along: 0, across: distance(point, line.start), length }
  return {
    along: ((point[0] - line.start[0]) * dx + (point[1] - line.start[1]) * dz) / length,
    across: Math.abs((point[1] - line.start[1]) * dx - (point[0] - line.start[0]) * dz) / length,
    length,
  }
}

/** Whether `point` is on the segment `line`, its ends included. */
function onLine(point: Point, line: Line) {
  const { along, across, length } = station(point, line)
  return length > 1e-9 && across <= JOIN && along >= -JOIN && along <= length + JOIN
}

/** Where the line through `moving` meets the segment `host`, if it does at a real angle. */
function meetingOn(moving: Line, host: Line): Point | null {
  const r = [moving.end[0] - moving.start[0], moving.end[1] - moving.start[1]] as const
  const u = [host.end[0] - host.start[0], host.end[1] - host.start[1]] as const
  const hostLength = Math.hypot(u[0], u[1])
  const denominator = r[0] * u[1] - r[1] * u[0]
  if (Math.abs(denominator) <= MIN_SINE * Math.hypot(r[0], r[1]) * hostLength) return null
  const qp = [host.start[0] - moving.start[0], host.start[1] - moving.start[1]] as const
  const t = (qp[0] * r[1] - qp[1] * r[0]) / denominator
  if (t * hostLength < -JOIN || t * hostLength > hostLength + JOIN) return null
  return [host.start[0] + u[0] * t, host.start[1] + u[1] * t]
}

/** `separator` with its ends at `point` (within the join reach) put exactly on it. */
function ontoCorner(separator: SeparatorNode, point: Point): SeparatorNode {
  const start = near(separator.start, point) ? point : separator.start
  const end = near(separator.end, point) ? point : separator.end
  return start === separator.start && end === separator.end
    ? separator
    : { ...separator, start, end }
}

/** `separator` with its ends on the body of `line` (clear of its ends) put exactly on it. */
function ontoBody(separator: SeparatorNode, line: Line): SeparatorNode {
  let next = separator
  for (const end of ['start', 'end'] as const) {
    const { along, across, length } = station(separator[end], line)
    if (across > JOIN || along <= JOIN || along >= length - JOIN) continue
    next = { ...next, [end]: at(line.start, line.end, along / length) }
  }
  return next
}

const touches = (separator: SeparatorNode, line: Line) =>
  [separator.start, separator.end].some((p) => near(p, line.start) || near(p, line.end))

/** How far `other` lies off the line through `from` along `move`: 0 when it runs with the move. */
function offMove(from: Point, move: Point, other: Point) {
  const length = Math.hypot(move[0], move[1])
  if (length < SAME_POINT) return Number.POSITIVE_INFINITY
  return Math.abs(move[0] * (other[1] - from[1]) - move[1] * (other[0] - from[0])) / length
}

/**
 * `separator` (joined at a corner of `line`) as the junction rules should read it: one running
 * with its corner's move to within the join reach (a side drawn a little out of square, or put
 * onto the corner by `ontoCorner`) reads as running exactly with it, so it stretches as a square
 * corner's wall does instead of taking a jog.
 */
function squaredForMove(separator: SeparatorNode, line: Line, next: Line) {
  let read = { id: separator.id, start: separator.start, end: separator.end }
  for (const corner of ['start', 'end'] as const) {
    const from = line[corner]
    const move: Point = [next[corner][0] - from[0], next[corner][1] - from[1]]
    for (const end of ['start', 'end'] as const) {
      if (distance(separator[end], from) > SAME_POINT) continue
      const far = end === 'start' ? 'end' : 'start'
      if (offMove(from, move, separator[far]) > JOIN) continue
      const length = Math.hypot(move[0], move[1])
      const along =
        ((separator[far][0] - from[0]) * move[0] + (separator[far][1] - from[1]) * move[1]) / length
      read = {
        ...read,
        [far]: [from[0] + (move[0] / length) * along, from[1] + (move[1] / length) * along],
      }
    }
  }
  return read
}

function levelSeparators(nodes: Record<string, AnyNode>, levelId: string | null) {
  return Object.values(nodes).filter(
    (node): node is SeparatorNode => node.type === 'separator' && node.parentId === levelId,
  )
}

/** The invisible walls joined at `endpoint` of `separator`: the ones a drag of that end takes. */
export function joinedSeparatorIds(
  nodes: StructureNodes,
  separator: SeparatorNode,
  endpoint: 'start' | 'end',
): string[] {
  const point = separator[endpoint]
  return levelSeparators(nodes, separator.parentId).flatMap((node) =>
    node.id !== separator.id && (near(node.start, point) || near(node.end, point)) ? [node.id] : [],
  )
}

/**
 * Pushes invisible-wall stretches `offset` as one line: a room's edge of separators, a selected
 * separator's side arrow. A stretch shorter than its separator is split off first and only it
 * moves, the rest staying joined to it by a jog. An end that sat on a wall, a railing or another
 * separator slides along it to where the moved line meets it; one the move carries off its end
 * leaves a short invisible wall back to where it was, so the room stays closed. Separators joined
 * to the moving ones end to end follow the junction rules of a wall move, and those T'd into
 * their bodies stretch along their own lines. One plan, one undo step.
 */
export function translateSeparators(
  nodes: StructureNodes,
  input: { spans: readonly SeparatorSpan[]; offset: Point; mintId: StructureMintId },
): StructurePlan {
  const spans = new Map<string, { t0: number; t1: number }>()
  for (const span of input.spans) {
    const t0 = Math.max(0, Math.min(span.t0, span.t1))
    const t1 = Math.min(1, Math.max(span.t0, span.t1))
    const held = spans.get(span.separatorId)
    spans.set(span.separatorId, {
      t0: Math.min(t0, held?.t0 ?? t0),
      t1: Math.max(t1, held?.t1 ?? t1),
    })
  }
  const first = nodes[input.spans[0]?.separatorId ?? '']
  if (
    first?.type !== 'separator' ||
    [...spans.keys()].some(
      (id) => nodes[id]?.type !== 'separator' || nodes[id]?.parentId !== first.parentId,
    )
  )
    throw Error('Select an invisible wall.')
  const [dx, dz] = input.offset
  if (!(Number.isFinite(dx) && Number.isFinite(dz))) throw Error('Invalid move.')
  if (Math.hypot(dx, dz) < 1e-9) return { changes: [] }
  const levelId = first.parentId
  const shift = ([x, z]: Point): Point => [x + dx, z + dz]
  const scratch: Record<string, AnyNode> = { ...nodes }

  // The stretches that move, cut out of their separators.
  const rest = new Map<string, Line>()
  for (const [id, { t0, t1 }] of spans) {
    if (t1 - t0 < WHOLE) continue
    const separator = scratch[id] as SeparatorNode
    const point = (t: number) => at(separator.start, separator.end, t)
    for (const [from, to] of [
      [0, t0],
      [t1, 1],
    ] as const)
      if (to - from > WHOLE) {
        const remainder = SeparatorNode.parse({
          ...separator,
          id: input.mintId('separator'),
          start: point(from),
          end: point(to),
        })
        scratch[remainder.id] = remainder
      }
    const piece = { start: point(t0), end: point(t1) }
    scratch[id] = { ...separator, ...piece }
    rest.set(id, piece)
  }
  if (!rest.size) return { changes: [] }

  const still = Object.values(scratch).filter(
    (node): node is Boundary =>
      node.parentId === levelId &&
      !rest.has(node.id) &&
      (node.type === 'separator' || (node.type === 'wall' && !isCurvedWall(node))),
  )
  const bridges: Line[] = []
  const moved = new Map<string, Line>()
  for (const [id, line] of rest) {
    const shifted = { start: shift(line.start), end: shift(line.end) }
    const next = { ...shifted }
    for (const end of ['start', 'end'] as const) {
      const point = line[end]
      // A joint inside the moving line moves with it.
      if (
        [...rest].some(
          ([other, piece]) => other !== id && (near(piece.start, point) || near(piece.end, point)),
        )
      )
        continue
      // Separators joined here end to end follow the move instead.
      const hosts = still.filter(
        (node) =>
          !(node.type === 'separator' && (near(node.start, point) || near(node.end, point))) &&
          onLine(point, node),
      )
      if (!hosts.length) continue
      let slid: Point | null = null
      for (const host of hosts) {
        const meeting = meetingOn(shifted, host)
        if (meeting && (!slid || distance(meeting, shifted[end]) < distance(slid, shifted[end])))
          slid = meeting
      }
      if (slid) next[end] = slid
      else if (!still.some((node) => onLine(shifted[end], node)))
        bridges.push({ start: point, end: shifted[end] })
    }
    if (distance(next.start, next.end) < MIN_LENGTH)
      return conflict('invalid-geometry', [id], 'The invisible wall would be too short there.')
    moved.set(id, next)
  }

  const deleted = new Set<string>()
  for (const [id, line] of rest) {
    const next = moved.get(id)!
    const others = levelSeparators(scratch, levelId).filter(
      (node) => !rest.has(node.id) && !deleted.has(node.id),
    )
    // Joined end to end: put on the corner exactly, so the junction rules move them.
    const joined = others
      .filter((node) => touches(node, line))
      .map((node) => ontoCorner(ontoCorner(node, line.start), line.end))
    // T'd into its body: read before the joined ones move, so a moved end never reads as one.
    const attached = planAttachedWallUpdates(
      others.filter((node) => !touches(node, line)).map((node) => ontoBody(node, line)),
      line.start,
      line.end,
      next.start,
      next.end,
    )
    const read = joined.map((node) => squaredForMove(node, line, next))
    const junctions = planWallMoveJunctions(read, line.start, line.end, next.start, next.end)
    // The rules move the joined ends; each separator keeps its own far end.
    const linked = getPlannedLinkedWallUpdates(
      junctions,
      line.start,
      line.end,
      next.start,
      next.end,
    ).map((update) => {
      const proxy = read.find((entry) => entry.id === update.id)!
      const own = joined.find((entry) => entry.id === update.id)!
      return {
        id: update.id,
        start: update.start === proxy.start ? own.start : update.start,
        end: update.end === proxy.end ? own.end : update.end,
      }
    })
    for (const update of [...linked, ...attached]) {
      if (distance(update.start, update.end) < WALL_MIN_LENGTH) {
        delete scratch[update.id]
        deleted.add(update.id)
      } else
        scratch[update.id] = {
          ...(scratch[update.id] as SeparatorNode),
          start: update.start,
          end: update.end,
        }
    }
    for (const separator of junctions.wallsToDelete) {
      delete scratch[separator.id]
      deleted.add(separator.id)
    }
    for (const bridge of junctions.bridgePlans)
      bridges.push({
        start: bridge.originalPoint,
        end: bridge.movedEndpoint === 'start' ? next.start : next.end,
      })
    scratch[id] = { ...(scratch[id] as SeparatorNode), start: next.start, end: next.end }
  }

  const made: Line[] = []
  for (const bridge of bridges) {
    if (distance(bridge.start, bridge.end) < WALL_MIN_LENGTH) continue
    const same = (a: Point, b: Point) => distance(a, b) <= SAME_POINT
    if (
      made.some(
        (line) =>
          (same(line.start, bridge.start) && same(line.end, bridge.end)) ||
          (same(line.start, bridge.end) && same(line.end, bridge.start)),
      )
    )
      continue
    made.push(bridge)
    const separator = SeparatorNode.parse({
      id: input.mintId('separator'),
      parentId: levelId,
      start: bridge.start,
      end: bridge.end,
    })
    scratch[separator.id] = separator
  }
  return { changes: diffStructure(nodes, scratch) }
}

/**
 * Moves one end of an invisible wall to `point`, as a wall's end drag does: the separators joined
 * at that end follow it, stretching and turning about their far ends, and those T'd into its
 * body slide along their own lines to stay on it. `detach` (Alt) leaves them where they are.
 */
export function setSeparatorEnd(
  nodes: StructureNodes,
  input: { separatorId: string; endpoint: 'start' | 'end'; point: Point; detach?: boolean },
): StructurePlan {
  const separator = nodes[input.separatorId]
  if (separator?.type !== 'separator') throw Error('Select an invisible wall.')
  if (!input.point.every(Number.isFinite)) throw Error('Invalid point.')
  const line: Line = { start: separator.start, end: separator.end }
  const next: Line = { ...line, [input.endpoint]: input.point }
  if (distance(next.start, next.end) < MIN_LENGTH)
    return conflict('invalid-geometry', [separator.id], 'The invisible wall would be too short.')
  const scratch: Record<string, AnyNode> = { ...nodes }
  scratch[separator.id] = { ...separator, start: next.start, end: next.end }
  if (!input.detach) {
    const from = line[input.endpoint]
    const others = levelSeparators(nodes, separator.parentId).filter(
      (node) => node.id !== separator.id,
    )
    const updates = [
      ...others.flatMap((other) => {
        const start = near(other.start, from) ? input.point : other.start
        const end = near(other.end, from) ? input.point : other.end
        return start === other.start && end === other.end ? [] : [{ id: other.id, start, end }]
      }),
      ...planAttachedWallUpdates(
        others.filter((other) => !touches(other, line)).map((other) => ontoBody(other, line)),
        line.start,
        line.end,
        next.start,
        next.end,
      ),
    ]
    for (const update of updates) {
      if (distance(update.start, update.end) < WALL_MIN_LENGTH) delete scratch[update.id]
      else
        scratch[update.id] = {
          ...(scratch[update.id] as SeparatorNode),
          start: update.start,
          end: update.end,
        }
    }
  }
  return { changes: diffStructure(nodes, scratch) }
}

/**
 * The invisible walls a moving wall carries along, so the rooms they close stay closed: one T'd
 * into its body slides along its own line onto the moved line, as a wall T'd into it does, and
 * one joined at a moving end follows that end while the end moves along the separator's own line
 * (a corner pushed square). A corner the move turns leaves its separators where they are, on the
 * wall it stretched; an end the move would carry off the wall lets go.
 */
export function planAttachedSeparatorUpdates(
  separators: readonly SeparatorNode[],
  originalStart: WallPlanPoint,
  originalEnd: WallPlanPoint,
  nextStart: WallPlanPoint,
  nextEnd: WallPlanPoint,
): Array<{ id: SeparatorNode['id']; start: WallPlanPoint; end: WallPlanPoint }> {
  const line = { start: originalStart, end: originalEnd }
  const updates = planAttachedWallUpdates(
    separators.filter((separator) => !touches(separator, line)).map((s) => ontoBody(s, line)),
    originalStart,
    originalEnd,
    nextStart,
    nextEnd,
  )
  const corners = [
    [originalStart, nextStart],
    [originalEnd, nextEnd],
  ] as const
  for (const separator of separators) {
    if (!touches(separator, line)) continue
    let next: Line | null = null
    for (const end of ['start', 'end'] as const) {
      const corner = corners.find(([from]) => near(separator[end], from))
      if (!corner) continue
      const [from, to] = corner
      const other = separator[end === 'start' ? 'end' : 'start']
      if (distance(other, from) < SAME_POINT) continue
      if (offMove(from, [to[0] - from[0], to[1] - from[1]], other) > JOIN) continue
      next = { ...(next ?? { start: separator.start, end: separator.end }), [end]: to }
    }
    if (next && distance(next.start, next.end) >= WALL_MIN_LENGTH)
      updates.push({ id: separator.id, start: next.start, end: next.end })
  }
  return updates
}
