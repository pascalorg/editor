import type { AnyNode, WallNode } from '@pascal-app/core'
import { isPascalAuthored } from './cleanup'
import { nextId } from './ids'

type SceneNodes = Record<string, AnyNode>
type Point = [number, number]

/**
 * Revit (and most IFC exporters) stop a wall axis at the neighbour's face, not
 * its centreline, so Pascal's wall graph sees open corners and rooms never
 * close. Each straight wall end moves along its own axis to the nearest
 * neighbour centreline it clearly meant to meet (L and T joins).
 */

/** Largest along-axis move for an end IfcRelConnectsPathElements joins. */
const MAX_CONNECTED_GAP = 0.6
/** Slack on top of the neighbour thickness for an unconnected end. */
const GAP_TOLERANCE = 0.05
/** Walls closer to parallel than this never join end-to-side. */
const MIN_JOIN_SINE = Math.sin((15 * Math.PI) / 180)
const MIN_JOINED_LENGTH = 0.1

type Segment = {
  wall: WallNode
  start: Point
  end: Point
  dir: Point
  length: number
  thickness: number
}

const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]

function toSegment(wall: WallNode): Segment | null {
  if (wall.curveOffset !== undefined && Math.abs(wall.curveOffset) > 1e-6) return null
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  if (length < MIN_JOINED_LENGTH) return null
  return {
    wall,
    start: wall.start,
    end: wall.end,
    dir: [dx / length, dy / length],
    length,
    thickness: wall.thickness ?? 0.1,
  }
}

function wallExpressIds(wall: WallNode): number[] {
  const metadata = (wall.metadata ?? {}) as {
    expressID?: unknown
    ifcSimplification?: { mergedExpressIDs?: unknown }
  }
  const merged = metadata.ifcSimplification?.mergedExpressIDs
  return [metadata.expressID, ...(Array.isArray(merged) ? merged : [])].filter(
    (id): id is number => typeof id === 'number',
  )
}

/** Slack around a wall body within which a touching end counts as inside it. */
const BODY_TOLERANCE = 0.03

function insideBody(point: Point, other: Segment, slack = 0) {
  const offset = [point[0] - other.start[0], point[1] - other.start[1]] as Point
  const along = offset[0] * other.dir[0] + offset[1] * other.dir[1]
  return (
    Math.abs(cross(offset, other.dir)) <= other.thickness / 2 + BODY_TOLERANCE + slack &&
    along >= -BODY_TOLERANCE &&
    along <= other.length + BODY_TOLERANCE
  )
}

/** Signed move of `segment`'s end along its outward axis onto `other`'s centreline. */
function joinMove(segment: Segment, atEnd: boolean, other: Segment, reach: number) {
  const point = atEnd ? segment.end : segment.start
  const out: Point = atEnd ? segment.dir : [-segment.dir[0], -segment.dir[1]]
  const denominator = cross(out, other.dir)
  if (Math.abs(denominator) < MIN_JOIN_SINE) return null
  const toOther: Point = [other.start[0] - point[0], other.start[1] - point[1]]
  const move = cross(toOther, other.dir) / denominator
  const along = cross(toOther, out) / denominator
  // The meeting point must lie on the neighbour, or just past an end of it
  // that is itself short of this wall's centreline.
  if (along < -reach || along > other.length + reach) return null
  if (segment.length + move < MIN_JOINED_LENGTH) return null
  return move
}

/** Thickest IFC wall still read as cladding (tiles, skirting) when it lines another wall. */
const MAX_CLADDING_THICKNESS = 0.035

/**
 * Walls that only line or hide inside another wall: tiles, skirtings and thin
 * facings exported as IfcWall along a real wall's face, shorter walls laid
 * face to face along or running through a longer one, and walls whose body
 * lies entirely inside a thicker parallel wall. As Pascal walls they carve
 * sliver rooms or keep corners from closing, so they stay exact meshes.
 */
export function redundantWallIds(walls: readonly WallNode[]): Map<string, WallNode> {
  const hosts = new Map<string, WallNode>()
  const segments = walls.map(toSegment)
  for (const [index, segment] of segments.entries()) {
    if (!segment) continue
    const cladding = segment.thickness <= MAX_CLADDING_THICKNESS
    let lined = 0
    let host: Segment | undefined
    for (const [otherIndex, other] of segments.entries()) {
      if (!other || otherIndex === index || hosts.has(other.wall.id)) continue
      if (other.wall.parentId !== segment.wall.parentId) continue
      if (Math.abs(cross(segment.dir, other.dir)) > 0.05) continue
      const offset = Math.abs(
        cross([segment.start[0] - other.start[0], segment.start[1] - other.start[1]], other.dir),
      )
      const project = (point: Point) =>
        (point[0] - other.start[0]) * other.dir[0] + (point[1] - other.start[1]) * other.dir[1]
      const [a, b] = [project(segment.start), project(segment.end)].sort((x, y) => x - y)
      const overlap = Math.max(0, Math.min(b!, other.length) - Math.max(a!, 0))
      const embedded =
        other.thickness > segment.thickness &&
        offset + segment.thickness / 2 <= other.thickness / 2 + 0.01 &&
        overlap >= segment.length - 0.05
      // A shorter wall laid face to face along a longer one (a double
      // partition) would leave a zero-width room between the two bodies.
      // A shorter wall running through another's body (a thickened stretch
      // over a partition) makes two overlapping room boundaries.
      const lining =
        segment.length < other.length &&
        (Math.abs(offset - (other.thickness + segment.thickness) / 2) <= 0.01 ||
          offset < Math.max(other.thickness, segment.thickness) / 2) &&
        overlap >= segment.length * 0.9
      if (embedded || lining) {
        lined = segment.length
        host = other
        break
      }
      if (
        cladding &&
        other.thickness > 2 * segment.thickness &&
        offset <= (other.thickness + segment.thickness) / 2 + 0.02
      ) {
        lined += overlap
        host ??= other
      }
    }
    if (host && lined >= segment.length * 0.5) hosts.set(segment.wall.id, host.wall)
  }
  return hosts
}

export function joinWallEnds(
  nodes: SceneNodes,
  connections: readonly (readonly [number, number])[] = [],
  /** Host wall expressID → thickness of a lining removed from its face (see redundantWallIds). */
  linings: ReadonlyMap<number, number> = new Map(),
): number {
  const segments = Object.values(nodes)
    .filter((node): node is WallNode => node.type === 'wall')
    .map(toSegment)
    .filter((segment): segment is Segment => segment !== null)
  const wallByExpressId = new Map<number, string>()
  for (const segment of segments)
    for (const id of wallExpressIds(segment.wall)) wallByExpressId.set(id, segment.wall.id)
  const connected = new Set<string>()
  for (const [a, b] of connections) {
    const wallA = wallByExpressId.get(a)
    const wallB = wallByExpressId.get(b)
    if (!wallA || !wallB || wallA === wallB) continue
    connected.add(`${wallA}|${wallB}`)
    connected.add(`${wallB}|${wallA}`)
  }

  const byLevel = new Map<string | null, Segment[]>()
  for (const segment of segments) {
    const key = segment.wall.parentId ?? null
    byLevel.set(key, [...(byLevel.get(key) ?? []), segment])
  }

  // Moves are measured on the original geometry: a wall extending along its
  // own axis never changes the centreline its neighbours join onto.
  const moves: { segment: Segment; atEnd: boolean; move: number }[] = []
  for (const level of byLevel.values()) {
    for (const segment of level) {
      if (isPascalAuthored(segment.wall)) continue
      for (const atEnd of [false, true]) {
        const point = atEnd ? segment.end : segment.start
        let best: { move: number; score: number } | null = null
        // An end inside another wall's body belongs on that wall's centreline,
        // even past a corner it already makes (a furring lining a party wall).
        let embedded: { move: number } | null = null
        for (const other of level) {
          if (other === segment) continue
          const linked = connected.has(`${segment.wall.id}|${other.wall.id}`)
          const limit = linked
            ? MAX_CONNECTED_GAP
            : Math.min(MAX_CONNECTED_GAP, other.thickness + GAP_TOLERANCE)
          const reach = linked
            ? MAX_CONNECTED_GAP
            : Math.min(
                MAX_CONNECTED_GAP,
                Math.max(segment.thickness, other.thickness) + GAP_TOLERANCE,
              )
          const move = joinMove(segment, atEnd, other, reach)
          if (move === null || Math.abs(move) > limit) continue
          const slack = Math.max(0, ...wallExpressIds(other.wall).map((id) => linings.get(id) ?? 0))
          // Ends reach through to the farthest body they touch; an end
          // overshooting every body it touches trims back to the nearest.
          if (
            insideBody(point, other, slack) &&
            (!embedded ||
              (move > 0 ? move > embedded.move : embedded.move <= 0 && move > embedded.move))
          )
            embedded = { move }
          // An end already on a centreline stays there; IFC-connected
          // neighbours win ties.
          const score = Math.abs(move) - (linked ? 1e-3 : 0)
          if (!best || score < best.score) best = { move, score }
        }
        const chosen = embedded ?? best
        if (chosen && Math.abs(chosen.move) > 1e-4)
          moves.push({ segment, atEnd, move: chosen.move })
      }
    }
  }

  for (const { segment, atEnd, move } of moves) {
    const wall = nodes[segment.wall.id] as WallNode
    if (atEnd) {
      wall.end = [wall.end[0] + segment.dir[0] * move, wall.end[1] + segment.dir[1] * move]
      continue
    }
    wall.start = [wall.start[0] - segment.dir[0] * move, wall.start[1] - segment.dir[1] * move]
    // Openings are placed by their distance from the wall start.
    for (const childId of wall.children) {
      const child = nodes[childId]
      if (child?.type !== 'door' && child?.type !== 'window') continue
      child.position = [child.position[0] + move, child.position[1], child.position[2]]
    }
  }
  return moves.length + joinInLineEnds(nodes, segments)
}

/** A wall's plan frame: x along start → end, z to its left (wall-local +z). */
function wallFrame(wall: WallNode) {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) || 1
  const dir: Point = [
    (wall.end[0] - wall.start[0]) / length,
    (wall.end[1] - wall.start[1]) / length,
  ]
  const left: Point = [-dir[1], dir[0]]
  const origin: Point = [wall.start[0], wall.start[1]]
  return {
    toWorld: (along: number, across: number): Point => [
      origin[0] + dir[0] * along + left[0] * across,
      origin[1] + dir[1] * along + left[1] * across,
    ],
    toLocal: (point: Point): [number, number] => {
      const offset: Point = [point[0] - origin[0], point[1] - origin[1]]
      return [offset[0] * dir[0] + offset[1] * dir[1], offset[0] * left[0] + offset[1] * left[1]]
    },
  }
}

/**
 * A thinner wall continuing a thicker one flush with one face leaves its end
 * beside the other's centreline, where no L or T can close. The end moves
 * sideways onto the other wall's end; the wall turns by a degree or two and
 * its doors and windows keep their plan position.
 */
function joinInLineEnds(nodes: SceneNodes, original: readonly Segment[]): number {
  const walls = original.map((segment) => nodes[segment.wall.id] as WallNode)
  const current = walls.map(toSegment)
  const onCentreline = (point: Point, self: Segment) =>
    current.some((other) => {
      if (!other || other === self || other.wall.parentId !== self.wall.parentId) return false
      const offset: Point = [point[0] - other.start[0], point[1] - other.start[1]]
      const along = offset[0] * other.dir[0] + offset[1] * other.dir[1]
      return (
        Math.abs(cross(offset, other.dir)) <= 1e-3 && along >= -1e-3 && along <= other.length + 1e-3
      )
    })
  let joined = 0
  for (const segment of current) {
    // Turning a wall would carry its doors and windows off their IFC place.
    if (!segment || isPascalAuthored(segment.wall)) continue
    for (const atEnd of [false, true]) {
      const point = atEnd ? segment.end : segment.start
      if (onCentreline(point, segment)) continue
      let best: { end: Point; distance: number } | undefined
      for (const other of current) {
        if (!other || other === segment || other.wall.parentId !== segment.wall.parentId) continue
        if (Math.abs(cross(segment.dir, other.dir)) > 0.03) continue
        const lateral = Math.abs(
          cross([point[0] - other.start[0], point[1] - other.start[1]], other.dir),
        )
        if (lateral > Math.max(segment.thickness, other.thickness) / 2 + 0.01) continue
        for (const end of [other.start, other.end]) {
          const distance = Math.hypot(end[0] - point[0], end[1] - point[1])
          const gap = Math.abs(
            (end[0] - point[0]) * other.dir[0] + (end[1] - point[1]) * other.dir[1],
          )
          if (gap > 0.1 || distance < 1e-4 || distance > segment.length * 0.1) continue
          if (!best || distance < best.distance) best = { end, distance }
        }
      }
      if (!best) continue
      const wall = nodes[segment.wall.id] as WallNode
      const before = wallFrame(wall)
      if (atEnd) wall.end = [...best.end]
      else wall.start = [...best.end]
      const after = wallFrame(wall)
      // Doors and windows keep their place: re-expressed in the turned wall.
      for (const id of wall.children) {
        const child = nodes[id]
        if (child?.type !== 'door' && child?.type !== 'window') continue
        const world = before.toWorld(child.position[0], child.position[2])
        const [along, across] = after.toLocal(world)
        child.position = [along, child.position[1], across]
      }
      segment.start = wall.start
      segment.end = wall.end
      joined++
    }
  }
  return joined
}

/**
 * Room faces only close at wall junctions: a wall crossing another mid-span
 * (an X, not a T) splits in two at the crossing so both halves meet the other
 * wall's centreline. The thinner wall of the pair is split.
 */
export function splitCrossingWalls(nodes: SceneNodes): number {
  let split = 0
  for (let changed = true; changed; ) {
    changed = false
    const segments = Object.values(nodes)
      .filter((node): node is WallNode => node.type === 'wall')
      .map(toSegment)
      .filter((segment): segment is Segment => segment !== null)
    outer: for (const a of segments)
      for (const b of segments) {
        if (a === b || a.wall.parentId !== b.wall.parentId || isPascalAuthored(a.wall)) continue
        if (a.thickness > b.thickness || (a.thickness === b.thickness && a.wall.id > b.wall.id))
          continue
        const denominator = cross(a.dir, b.dir)
        if (Math.abs(denominator) < MIN_JOIN_SINE) continue
        const toB: Point = [b.start[0] - a.start[0], b.start[1] - a.start[1]]
        const alongA = cross(toB, b.dir) / denominator
        const alongB = cross(toB, a.dir) / denominator
        const margin = Math.max(a.thickness, b.thickness) / 2 + 0.05
        if (alongA < margin || alongA > a.length - margin) continue
        if (alongB < margin || alongB > b.length - margin) continue
        splitWallAt(nodes, a, alongA)
        split++
        changed = true
        break outer
      }
  }
  return split
}

function splitWallAt(nodes: SceneNodes, segment: Segment, along: number) {
  const wall = nodes[segment.wall.id] as WallNode
  const point: Point = [
    segment.start[0] + segment.dir[0] * along,
    segment.start[1] + segment.dir[1] * along,
  ]
  const second: WallNode = {
    ...wall,
    id: nextId('wall') as WallNode['id'],
    start: point,
    end: [...wall.end],
    children: [],
    metadata: { ...(wall.metadata ?? {}) },
  }
  wall.end = point
  for (const childId of [...wall.children]) {
    const child = nodes[childId]
    if (child?.type !== 'door' && child?.type !== 'window') continue
    if (child.position[0] <= along) continue
    child.position = [child.position[0] - along, child.position[1], child.position[2]]
    child.parentId = second.id
    child.wallId = second.id
    wall.children = wall.children.filter((id) => id !== childId) as WallNode['children']
    second.children.push(childId as WallNode['children'][number])
  }
  nodes[second.id] = second
  const parent = wall.parentId ? nodes[wall.parentId] : undefined
  if (parent && 'children' in parent && Array.isArray(parent.children))
    (parent.children as string[]).push(second.id)
}
