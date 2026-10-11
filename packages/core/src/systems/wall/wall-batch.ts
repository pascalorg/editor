import type { AnyNode, AnyNodeId } from '../../schema'
import { type WallNode, WallNode as WallSchema } from '../../schema'
import { splitWall, type WallTopologyChanges } from './wall-topology'

type Point = [number, number]

// Below this |sin| between two walls they run parallel: no corner or tee.
const PARALLEL_SIN = 0.1
// Snap reach beyond half the thicker wall: strokes stop at a wall face, or run a
// few centimetres into or past it.
const SNAP_SLACK = 0.03
const MIN_LENGTH = 0.01
const SAME_POINT = 1e-6
const GRID_CELL = 1

const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
const length = (a: Point) => Math.hypot(a[0], a[1])
const lerp = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
]
const straight = (wall: WallNode) => Math.abs(wall.curveOffset ?? 0) < SAME_POINT

/** Where the infinite lines through a→b and c→d meet, if they are not parallel. */
function lineIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = subtract(b, a),
    s = subtract(d, c)
  const denominator = cross(r, s)
  if (Math.abs(denominator) < 1e-12) return null
  return lerp(a, b, cross(subtract(c, a), s) / denominator)
}

type Draft = { wall: WallNode; ends: [Point, Point]; locked: [boolean, boolean] }
type Segment = { a: () => Point; b: () => Point; thickness: number; draft?: Draft; wall: WallNode }

export type WallBatchPlan = {
  /** The new walls, snapped and split into one network (still to be created). */
  walls: WallNode[]
  /** Existing walls split where new walls meet or cross them, openings re-hosted. */
  existingChanges: WallTopologyChanges
}

/**
 * Joins a batch of new straight walls — typically traced from a plan — into
 * one network with each other and with the level's existing walls, the way
 * hand-drawn walls join. Plans draw walls whose ends stop at another wall's
 * face, overshoot it, or leave corners a few centimetres apart; room detection
 * needs exactly shared junctions (0.1 mm) and mitering 1 mm, so without this
 * rooms never close and slabs never split along the walls.
 *
 * 1. Ends snap: corners to the meeting point of both centrelines, tee stems
 *    onto the other wall's centreline, straight continuations together.
 * 2. Every crossing and tee splits the walls it lands inside; existing walls
 *    go through `splitWall` so their doors and windows stay attached.
 */
export function planarizeWallBatch(
  created: readonly WallNode[],
  nodes: Record<string, AnyNode>,
  levelId: string,
): WallBatchPlan {
  const existing = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === levelId && straight(node),
  )
  const drafts: Draft[] = created
    .filter(straight)
    .map((wall) => ({ wall, ends: [[...wall.start], [...wall.end]], locked: [false, false] }))
  const segments: Segment[] = [
    ...drafts.map((draft) => ({
      a: () => draft.ends[0],
      b: () => draft.ends[1],
      thickness: draft.wall.thickness ?? 0.1,
      draft,
      wall: draft.wall,
    })),
    ...existing.map((wall) => ({
      a: () => wall.start as Point,
      b: () => wall.end as Point,
      thickness: wall.thickness ?? 0.1,
      wall,
    })),
  ]
  const reach = Math.max(0, ...segments.map((s) => s.thickness)) / 2 + SNAP_SLACK
  const grid = segmentGrid(segments, reach)

  // 1. Snap ends.
  for (const draft of drafts)
    for (const i of [0, 1] as const) {
      if (draft.locked[i]) continue
      const end = draft.ends[i],
        other = draft.ends[1 - i]!
      const span = subtract(end, other),
        spanLength = length(span)
      if (spanLength < MIN_LENGTH) continue
      const direction: Point = [span[0] / spanLength, span[1] / spanLength]
      let best: { target: Point; move: number; rank: number; apply?: () => void } | null = null
      const offer = (target: Point, rank: number, apply?: () => void) => {
        const move = length(subtract(target, end))
        // Never fold a wall back over itself.
        if (dot(subtract(target, other), direction) < MIN_LENGTH) return
        if (!best || rank < best.rank || (rank === best.rank && move < best.move))
          best = { target, move, rank, apply }
      }
      for (const segment of nearby(grid, end)) {
        if (segment.draft === draft) continue
        const a = segment.a(),
          b = segment.b(),
          along = subtract(b, a),
          alongLength = length(along)
        if (alongLength < MIN_LENGTH) continue
        const sin = cross(direction, [along[0] / alongLength, along[1] / alongLength])
        const radius = Math.max(draft.wall.thickness ?? 0.1, segment.thickness) / 2 + SNAP_SLACK
        const meet = Math.abs(sin) > PARALLEL_SIN ? lineIntersection(other, end, a, b) : null
        for (const j of [0, 1] as const) {
          const corner = j ? b : a
          const gap = length(subtract(corner, end))
          if (gap > radius) continue
          const partner = segment.draft
          if (!partner || partner.locked[j]) {
            // Existing walls and settled junctions don't move: share their point.
            offer([corner[0], corner[1]], 0)
          } else if (meet) {
            if (length(subtract(meet, end)) <= radius && length(subtract(meet, corner)) <= radius)
              offer(meet, 0, () => {
                partner.ends[j] = meet
                partner.locked[j] = true
              })
          } else if (gap <= SNAP_SLACK) {
            const middle = lerp(end, corner, 0.5)
            offer(middle, 0, () => {
              partner.ends[j] = middle
              partner.locked[j] = true
            })
          }
        }
        if (meet) {
          const t = dot(subtract(meet, a), along) / (alongLength * alongLength)
          if (t > 0 && t < 1 && length(subtract(meet, end)) <= radius) offer(meet, 1)
        }
      }
      const chosen = best as { target: Point; apply?: () => void } | null
      if (!chosen) continue
      draft.ends[i] = chosen.target
      draft.locked[i] = true
      chosen.apply?.()
    }

  // 2. Split at crossings and tees.
  const splits = new Map<Segment, number[]>()
  const addSplit = (segment: Segment, t: number, segmentLength: number) => {
    const margin = MIN_LENGTH / Math.max(segmentLength, MIN_LENGTH)
    if (t <= margin || t >= 1 - margin) return
    const list = splits.get(segment) ?? []
    if (!list.some((value) => Math.abs(value - t) * segmentLength < SAME_POINT * 10)) list.push(t)
    splits.set(segment, list)
  }
  const seen = new Set<string>()
  const order = new Map(segments.map((segment, index) => [segment, index]))
  segments.forEach((first, index) => {
    if (!first.draft) return
    for (const second of nearbySegment(grid, first)) {
      if (second === first) continue
      const otherIndex = order.get(second)!
      if (second.draft && otherIndex < index) continue
      const key = `${index}:${otherIndex}`
      if (seen.has(key)) continue
      seen.add(key)
      const p = first.a(),
        r = subtract(first.b(), p),
        q = second.a(),
        s = subtract(second.b(), q)
      const denominator = cross(r, s)
      if (Math.abs(denominator) < 1e-12) continue
      const lengthR = length(r),
        lengthS = length(s)
      const t = cross(subtract(q, p), s) / denominator,
        u = cross(subtract(q, p), r) / denominator
      const slackT = SAME_POINT / Math.max(lengthR, SAME_POINT),
        slackU = SAME_POINT / Math.max(lengthS, SAME_POINT)
      if (t < -slackT || t > 1 + slackT || u < -slackU || u > 1 + slackU) continue
      addSplit(first, t, lengthR)
      addSplit(second, u, lengthS)
    }
  })

  // Drafts lead `segments` in the same order.
  const walls = drafts.flatMap((draft, index) => {
    const segment = segments[index]!
    const parameters = [0, ...(splits.get(segment) ?? []).sort((x, y) => x - y), 1]
    const { id: _id, children: _children, ...properties } = draft.wall
    return parameters.slice(0, -1).flatMap((from, k) => {
      const start = lerp(draft.ends[0], draft.ends[1], from),
        end = lerp(draft.ends[0], draft.ends[1], parameters[k + 1]!)
      return length(subtract(end, start)) < MIN_LENGTH
        ? []
        : [WallSchema.parse({ ...properties, start, end, children: [] })]
    })
  })

  const existingChanges: WallTopologyChanges = { create: [], update: [], delete: [] }
  for (const [segment, parameters] of splits) {
    if (segment.draft) continue
    // An existing opening straddling the junction keeps its wall whole; rooms
    // still see the tee because detection splits walls at endpoints on them.
    const split = splitWall(segment.wall, parameters, nodes as Record<AnyNodeId, AnyNode>)
    if (!split) continue
    existingChanges.create.push(
      ...split.create.map((node) => ({ node, parentId: levelId as AnyNodeId })),
    )
    existingChanges.update.push(...split.update)
    existingChanges.delete.push(segment.wall.id as AnyNodeId)
  }
  return { walls, existingChanges }
}

type Grid = { cells: Map<string, Segment[]>; pad: number }

function cellsOf(min: Point, max: Point) {
  const keys: string[] = []
  for (let x = Math.floor(min[0] / GRID_CELL); x <= Math.floor(max[0] / GRID_CELL); x++)
    for (let z = Math.floor(min[1] / GRID_CELL); z <= Math.floor(max[1] / GRID_CELL); z++)
      keys.push(`${x},${z}`)
  return keys
}

// Drafts move by at most `pad` while snapping, so padding their boxes by it
// keeps the index valid through both passes.
function segmentGrid(segments: Segment[], pad: number): Grid {
  const cells = new Map<string, Segment[]>()
  for (const segment of segments) {
    const a = segment.a(),
      b = segment.b()
    for (const key of cellsOf(
      [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad],
      [Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad],
    ))
      cells.set(key, [...(cells.get(key) ?? []), segment])
  }
  return { cells, pad }
}

function nearby(grid: Grid, point: Point) {
  return grid.cells.get(cellsOf(point, point)[0]!) ?? []
}

function nearbySegment(grid: Grid, segment: Segment) {
  const a = segment.a(),
    b = segment.b()
  const found = new Set<Segment>()
  for (const key of cellsOf(
    [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  ))
    for (const candidate of grid.cells.get(key) ?? []) found.add(candidate)
  return found
}
