import { isFloorUnderlay } from '../../agent-operations/furniture-kind'
import { area, intersection, type Ring } from '../../lib/polygon-boolean'
import { type AnyNode, getScaledDimensions, type ItemNode, type ZoneNode } from '../../schema'
import type { UsageIssue } from './findings'
import { m, nameOf, quote, unique } from './labels'
import { type Obstacle, obstaclesInBand, rayHit } from './obstacles'
import { boxesMeet, isBed, ringBox, roomAt } from './pieces'
import type { Prism, UsageShapes } from './types'
import type { Nodes } from './walls'

export type BedClass = 'single' | 'double' | 'queen' | 'king'
/** The footprint's short side (frame included) that makes a class, m: a retailer's Australian mattress widths plus a frame of 10 to 20 cm. */
export const BED_CLASS_FROM_M: [BedClass, number][] = [
  ['king', 1.75],
  ['queen', 1.5],
  ['double', 1.2],
  ['single', 0],
]
/** A bed of each class as a footprint with its frame and headboard (width, length), m. */
const BED_FOOTPRINT_M: Record<BedClass, [number, number]> = {
  king: [1.95, 2.15],
  queen: [1.65, 2.15],
  double: [1.5, 2.1],
  single: [1.1, 2.05],
}
/** A person gets by with this much on a side or at the foot (one unit of passage); UK M4(2) asks 0.75 m, the Scottish draft 0.80 m beside the bed. */
export const BED_ACCESS_M = 0.6
/** The room's short side under which a bed is small for it, from a retailer's recommended minimum rooms (3.0 x 4.0 m queen, 3.2 x 4.2 m king), m. */
export const BED_ROOM_SHORT_M: Partial<Record<BedClass, number>> = { queen: 3.0, king: 3.2 }
const FEET_FROM_M = 0.03
const FEET_TO_M = 0.7
const RAY_MAX_M = 3

export type BedMeasure = {
  id: string
  name: string
  levelId: string
  room: { id: string; name: string } | null
  widthM: number
  lengthM: number
  sizeClass: BedClass
  /** Free space beside the bed (median over the foot-ward three quarters of its sides) and at its foot, m. */
  left: number
  right: number
  foot: number
  roomShortSideM: number | null
  at: [number, number]
}

export const bedClassOf = (width: number): BedClass =>
  BED_CLASS_FROM_M.find(([, from]) => width >= from)![0]

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? RAY_MAX_M

/** The smallest rectangle round an outline (180 directions): its centre, its axes, its long and short side. */
function boundingRectangle(points: Ring) {
  let best: { u0: number; u1: number; v0: number; v1: number; c: number; s: number } | null = null
  let bestArea = Number.POSITIVE_INFINITY
  for (let k = 0; k < 180; k++) {
    const a = (k * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    let u0 = Number.POSITIVE_INFINITY
    let u1 = Number.NEGATIVE_INFINITY
    let v0 = Number.POSITIVE_INFINITY
    let v1 = Number.NEGATIVE_INFINITY
    for (const [x, z] of points) {
      const u = x * c + z * s
      const v = -x * s + z * c
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }
    const size = (u1 - u0) * (v1 - v0)
    if (size < bestArea) {
      bestArea = size
      best = { u0, u1, v0, v1, c, s }
    }
  }
  const r = best!
  const du = r.u1 - r.u0
  const dv = r.v1 - r.v0
  const at = (u: number, v: number): [number, number] => [u * r.c - v * r.s, u * r.s + v * r.c]
  const longIsU = du >= dv
  return {
    centre: at((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2),
    long: longIsU ? ([r.c, r.s] as [number, number]) : ([-r.s, r.c] as [number, number]),
    across: longIsU ? ([-r.s, r.c] as [number, number]) : ([r.c, r.s] as [number, number]),
    length: Math.max(du, dv),
    width: Math.min(du, dv),
  }
}

type Rect = ReturnType<typeof boundingRectangle>

const CLASS_WORDS: [BedClass, RegExp][] = [
  ['king', /king/i],
  ['queen', /queen/i],
  ['double', /double/i],
  ['single', /single|twin/i],
]

/**
 * A bed standing wider than long, bedside tables included, reads as lying across its room: its
 * head-to-foot axis is the item's own z (a bed's length is never less than its width), whatever the
 * box says. Null for any other piece, which keeps the smallest rectangle round its outline.
 */
function ownAxes(node: AnyNode | undefined, outline: Ring): Rect | null {
  if (node?.type !== 'item') return null
  const [width, , depth] = getScaledDimensions(node)
  if (!(width > depth + 0.05)) return null
  const angle = node.rotation[1]
  const along: [number, number] = [Math.sin(angle), Math.cos(angle)]
  const across: [number, number] = [Math.cos(angle), -Math.sin(angle)]
  const us = outline.map(([x, z]) => x * across[0] + z * across[1])
  const vs = outline.map(([x, z]) => x * along[0] + z * along[1])
  const [u0, u1] = [Math.min(...us), Math.max(...us)]
  const [v0, v1] = [Math.min(...vs), Math.max(...vs)]
  const [u, v] = [(u0 + u1) / 2, (v0 + v1) / 2]
  return {
    centre: [u * across[0] + v * along[0], u * across[1] + v * along[1]],
    long: along,
    across,
    length: v1 - v0,
    width: u1 - u0,
  }
}

/** The mattress's class: the width of the item's own bed part when its manifest has one, else a size its name states, else the footprint's width. */
function classOfBed(node: AnyNode | undefined, name: string, rect: Rect): BedClass {
  if (node?.type === 'item') {
    const part = node.source?.manifest?.parts?.find((candidate) => candidate.type === 'bed')
    if (part?.bounds) return bedClassOf((part.bounds.max[0] - part.bounds.min[0]) * node.scale[0])
    const named = CLASS_WORDS.find(([, words]) => words.test(name))
    if (named && rect.width > rect.length) return named[0]
  }
  return bedClassOf(rect.width)
}

/** One bed's size class and free space, from its own prisms and those of its level (the bed itself may be a candidate that is not in the scene). */
export function measureBedPrisms(
  nodes: Nodes,
  levelId: string,
  bed: { id: string; name: string },
  own: Prism[],
  prisms: Prism[],
): BedMeasure | null {
  if (!own.length) return null
  const floor = Math.min(...own.map((prism) => prism.z0))
  const outline = own
    .filter((prism) => prism.z0 < floor + 0.9)
    .flatMap((prism) => prism.outer as Ring)
  if (outline.length < 3) return null
  const rect = ownAxes(nodes[bed.id], outline) ?? boundingRectangle(outline)
  const band = { z0: floor + FEET_FROM_M, z1: floor + FEET_TO_M }
  // what lies on or under the bed (bedding, a throw) is not an obstacle beside it
  const overlapsBed = (prism: Prism) =>
    own.some(
      (piece) =>
        boxesMeet(ringBox(piece.outer), ringBox(prism.outer)) &&
        area(
          intersection(
            { outer: piece.outer, holes: piece.holes },
            { outer: prism.outer, holes: prism.holes },
          ),
        ) > 1e-4,
    )
  const others = obstaclesInBand(
    prisms,
    band,
    undefined,
    (prism) => prism.nodeId === bed.id || overlapsBed(prism),
  )
  const wallObstacles = obstaclesInBand(
    prisms.filter((prism) => prism.kind === 'wall'),
    band,
  )
  const ends: [number, number][] = [
    [
      rect.centre[0] + (rect.long[0] * rect.length) / 2,
      rect.centre[1] + (rect.long[1] * rect.length) / 2,
    ],
    [
      rect.centre[0] - (rect.long[0] * rect.length) / 2,
      rect.centre[1] - (rect.long[1] * rect.length) / 2,
    ],
  ]
  const wallGap = (p: [number, number]) =>
    Math.min(...wallObstacles.map((o) => rayDistance(o, p)), Number.POSITIVE_INFINITY)
  const headFirst = wallGap(ends[0]!) <= wallGap(ends[1]!)
  const head = headFirst ? ends[0]! : ends[1]!
  const foot = headFirst ? ends[1]! : ends[0]!
  const out2: [number, number] = [foot[0] - head[0], foot[1] - head[1]]
  const outLen = Math.hypot(out2[0], out2[1]) || 1
  const toFoot: [number, number] = [out2[0] / outLen, out2[1] / outLen]
  const steps = Math.max(4, Math.round(rect.length / 0.05))
  const along = (t: number): [number, number] => [
    foot[0] - toFoot[0] * rect.length * t,
    foot[1] - toFoot[1] * rect.length * t,
  ]
  const sideRays = (sign: 1 | -1) => {
    const dir: [number, number] = [rect.across[0] * sign, rect.across[1] * sign]
    const hits: number[] = []
    for (let i = 0; i <= Math.round(steps * 0.75); i++) {
      const p = along(i / steps)
      hits.push(
        rayHit(
          [p[0] + dir[0] * (rect.width / 2), p[1] + dir[1] * (rect.width / 2)],
          dir,
          others,
          RAY_MAX_M,
        ),
      )
    }
    return median(hits)
  }
  const footHits: number[] = []
  for (let i = 0; i <= 20; i++) {
    const across = (i / 20 - 0.5) * rect.width
    footHits.push(
      rayHit(
        [foot[0] + rect.across[0] * across, foot[1] + rect.across[1] * across],
        toFoot,
        others,
        RAY_MAX_M,
      ),
    )
  }
  const room = roomAt(nodes, levelId, rect.centre)
  const zone = room ? (nodes[room.id] as ZoneNode) : null
  const bounds = zone ? ringBox(zone.polygon as Ring) : null
  return {
    id: bed.id,
    name: bed.name,
    levelId,
    room,
    widthM: Math.round(rect.width * 100) / 100,
    lengthM: Math.round(rect.length * 100) / 100,
    sizeClass: classOfBed(nodes[bed.id], bed.name, rect),
    left: Math.round(sideRays(1) * 100) / 100,
    right: Math.round(sideRays(-1) * 100) / 100,
    foot: Math.round(median(footHits) * 100) / 100,
    roomShortSideM: bounds
      ? Math.round(Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 100) / 100
      : null,
    at: [Math.round(rect.centre[0] * 100) / 100, Math.round(rect.centre[1] * 100) / 100],
  }
}

/** What leaves a bed tight: the foot under 0.60 m, no side at 0.60 m, a king with one. */
export function bedTightness(bed: BedMeasure): string[] {
  const sides = [bed.left, bed.right].filter((side) => side >= BED_ACCESS_M).length
  const reasons: string[] = []
  if (bed.foot < BED_ACCESS_M) reasons.push(`${m(bed.foot)} m at its foot`)
  if (sides === 0)
    reasons.push(`no side with ${m(BED_ACCESS_M)} m (${m(bed.left)} and ${m(bed.right)} m)`)
  else if (bed.sizeClass === 'king' && sides < 2)
    reasons.push(`a king with ${m(Math.min(bed.left, bed.right))} m on one side`)
  return reasons
}

/** Every bed of the scene with its size class and the free space round it, measured on the real shapes of the feet band. */
export function measureBeds(nodes: Nodes, shapes: UsageShapes): BedMeasure[] {
  const out: BedMeasure[] = []
  for (const level of shapes.levels) {
    const prisms = level.prisms.filter(
      (prism) =>
        !(nodes[prism.nodeId]?.type === 'item' && isFloorUnderlay(nodes[prism.nodeId] as ItemNode)),
    )
    for (const node of Object.values(nodes)) {
      if (!isBed(node)) continue
      const own = prisms.filter((prism) => prism.nodeId === node.id)
      const bed = measureBedPrisms(
        nodes,
        level.levelId,
        { id: node.id, name: nameOf(nodes, node.id) },
        own,
        prisms,
      )
      if (bed) out.push(bed)
    }
  }
  return out
}

/** The distance from a point to an obstacle's outline. */
function rayDistance(o: Obstacle, p: [number, number]): number {
  let best = Number.POSITIVE_INFINITY
  for (let k = 0; k < o.edges.length; k += 4) {
    const ax = o.edges[k]!
    const az = o.edges[k + 1]!
    const ex = o.edges[k + 2]! - ax
    const ez = o.edges[k + 3]! - az
    const l2 = ex * ex + ez * ez
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - az) * ez) / l2)) : 0
    best = Math.min(best, Math.hypot(p[0] - ax - ex * t, p[1] - az - ez * t))
  }
  return best
}

/**
 * A queen or a king bed's room, read the way a person would: free space at the foot, on each side,
 * and the room against the size. Guides; never refuses. Tight: the foot under 0.60 m; a king with
 * fewer than two sides at 0.60 m; a bed with no side at 0.60 m. Small for its size (information):
 * the room's short side under a retailer's recommended minimum.
 */
export function bedIssues(nodes: Nodes, shapes: UsageShapes): UsageIssue[] {
  const out: UsageIssue[] = []
  for (const bed of measureBeds(nodes, shapes)) {
    if (bed.sizeClass === 'single') continue
    const reasons = bedTightness(bed)
    const where = bed.room ? ` in ${quote(bed.room.name)}` : ''
    const base = {
      nodeIds: unique([bed.room?.id, bed.id]),
      place: { room: bed.room?.name ?? '', roomId: bed.room?.id ?? bed.levelId, at: bed.at },
      obstacles: [],
      approximate: false,
    }
    if (reasons.length)
      out.push({
        ...base,
        type: 'usage_bed_clearance',
        message: `${quote(bed.name)} (a ${bed.sizeClass}, ${m(bed.widthM)} x ${m(bed.lengthM)} m)${where} leaves ${reasons.join(' and ')}: tight.`,
        severity: 'warning',
        valueM: Math.min(bed.foot, Math.max(bed.left, bed.right)),
        thresholdM: BED_ACCESS_M,
      })
    const recommended = BED_ROOM_SHORT_M[bed.sizeClass]
    if (recommended && bed.roomShortSideM !== null && bed.roomShortSideM < recommended)
      out.push({
        ...base,
        type: 'usage_bed_clearance',
        message: `${quote(bed.name)} is a ${bed.sizeClass}${where}, a room ${m(bed.roomShortSideM)} m on its short side: retailers recommend ${m(recommended)} m or more for a ${bed.sizeClass}.`,
        severity: 'info',
        valueM: bed.roomShortSideM,
        thresholdM: recommended,
      })
  }
  return out
}

/**
 * The largest bed class a room can take: one with its head on a wall, 0.60 m at its foot and on at
 * least one side (two for a king), clear of every piece and wall. A pure read for placement.
 */
export function bedFit(nodes: Nodes, shapes: UsageShapes, zoneId: string): BedClass | null {
  const zone = nodes[zoneId] as ZoneNode | undefined
  if (zone?.type !== 'zone') return null
  const level = shapes.levels.find((l) => l.levelId === zone.parentId)
  if (!level) return null
  const polygon = zone.polygon as Ring
  const floorY = Math.min(...level.floors.map((f) => f.y), Number.POSITIVE_INFINITY)
  const band = {
    z0: (Number.isFinite(floorY) ? floorY : 0) + FEET_FROM_M,
    z1: (Number.isFinite(floorY) ? floorY : 0) + FEET_TO_M,
  }
  const blockers = obstaclesInBand(
    level.prisms.filter(
      (prism) =>
        !(nodes[prism.nodeId]?.type === 'item' && isFloorUnderlay(nodes[prism.nodeId] as ItemNode)),
    ),
    band,
  )
  const centre: [number, number] = [
    polygon.reduce((s, p) => s + p[0], 0) / polygon.length,
    polygon.reduce((s, p) => s + p[1], 0) / polygon.length,
  ]
  for (const [cls] of BED_CLASS_FROM_M) {
    const [width, length] = BED_FOOTPRINT_M[cls]
    for (let edge = 0; edge < polygon.length; edge++) {
      const a = polygon[edge]!
      const b = polygon[(edge + 1) % polygon.length]!
      const run = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (run < width) continue
      const along: [number, number] = [(b[0] - a[0]) / run, (b[1] - a[1]) / run]
      let inward: [number, number] = [-along[1], along[0]]
      if ((centre[0] - a[0]) * inward[0] + (centre[1] - a[1]) * inward[1] < 0)
        inward = [-inward[0], -inward[1]]
      const sidesNeeded = cls === 'king' ? 2 : 1
      for (let s = width / 2; s <= run - width / 2 + 1e-9; s += 0.1) {
        // the bed against the wall (its back at the wall face: 8 cm off the room's edge), then the strips round it
        const at = (u: number, v: number): [number, number] => [
          a[0] + along[0] * (s + u) + inward[0] * (0.08 + v),
          a[1] + along[1] * (s + u) + inward[1] * (0.08 + v),
        ]
        const rect = (u0: number, u1: number, v0: number, v1: number): Ring => [
          at(u0, v0),
          at(u1, v0),
          at(u1, v1),
          at(u0, v1),
        ]
        const free = (ring: Ring) => {
          const box = ringBox(ring)
          return !blockers.some(
            (o) =>
              boxesMeet(box, o.aabb) &&
              area(intersection(ring, { outer: o.prism.outer, holes: o.prism.holes })) > 0.005,
          )
        }
        const inside = (ring: Ring) => ring.every((p) => pointIn(p, polygon))
        const body = rect(-width / 2, width / 2, 0, length)
        const foot = rect(-width / 2, width / 2, length, length + BED_ACCESS_M)
        const left = rect(-width / 2 - BED_ACCESS_M, -width / 2, 0, length * 0.75)
        const right = rect(width / 2, width / 2 + BED_ACCESS_M, 0, length * 0.75)
        if (!(inside(body) && free(body) && inside(foot) && free(foot))) continue
        const openSides = [left, right].filter((r) => inside(r) && free(r)).length
        if (openSides >= sidesNeeded) return cls
      }
    }
  }
  return null
}

function pointIn(p: [number, number], ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!
    const [xj, zj] = ring[j]!
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi)
      inside = !inside
  }
  return inside
}
