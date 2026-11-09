import { isFloorUnderlay } from '../../agent-operations/furniture-kind'
import { area, intersection, type Ring } from '../../lib/polygon-boolean'
import type { ItemNode } from '../../schema'
import type { UsageIssue } from './findings'
import { cm, nameOf, quote, unique } from './labels'
import {
  boxesMeet,
  hosts,
  isBed,
  isBuildingElement,
  isFoliage,
  isPiecePrism,
  itemText,
  narrowestExtent,
  ringBox,
  roomAt,
} from './pieces'
import type { Prism, UsageShapes } from './types'
import type { Nodes } from './walls'

/** Two shapes that overlap by less than this are touching, not clashing (the outlines' own tolerance is 2 cm). */
export const CLASH_INFO_M = 0.02
/** From this depth a clash is a warning; between the two it is information. */
export const CLASH_WARNING_M = 0.08
/** An approximate shape needs a warning at a greater depth: its outline's own error is this order. */
export const CLASH_APPROX_WARNING_M = 0.12
/** A clash smaller than this in plan is a sliver (m²). */
export const CLASH_MIN_AREA_M2 = 0.002
/** A wall-fixed piece (a cabinet, a wall unit) may sink this far into a wall: it is scribed to it. */
export const SCRIBE_M = 0.05
const MIN_HEIGHT_OVERLAP_M = 0.02
/** A piece this thin (a rug, a mat) is a covering, not something a piece stands in. */
const FLAT_COVERING_M = 0.03
/** A chair tucked under its table overlaps it by up to this much (m). */
const TUCKED_M = 0.15
const BUILT_IN =
  /oven|hob\b|cook ?top|cooker|stove|range|washing|washer|dryer|dishwasher|sink|fridge|refrigerator/i
const SEAT = /(?:^|[^a-z])(?:chair|stool)(?![a-z])/i
const TABLE = /(?:^|[^a-z])(?:table|desk)(?![a-z])/i

export const OBSTACLE_KINDS = new Set([
  'wall',
  'jamb',
  'door-head',
  'threshold',
  'window-frame',
  'sill',
  'stair',
  'stair-rail',
  'guard',
])

type Pair = {
  a: Prism
  b: Prism
  depth: number
  area: number
  at: [number, number]
  zFrom: number
  zTo: number
}

const WHAT: Record<string, string> = {
  wall: 'the wall',
  jamb: 'the frame of',
  'door-head': 'the frame of',
  threshold: 'the threshold of',
  'window-frame': 'the frame of',
  sill: 'the sill of',
  stair: 'the stair',
  'stair-rail': 'the railing of',
  guard: 'the guard',
}

export function wallFixed(nodes: Nodes, prism: Prism): boolean {
  if (prism.kind === 'cabinet' || prism.host) return true
  const node = nodes[prism.nodeId]
  const attach = node?.type === 'item' ? (node as ItemNode).asset?.attachTo : undefined
  return attach === 'wall' || attach === 'wall-side'
}

/**
 * How deep two prisms stand in each other, or null: the same node, a host and what it carries, a wall
 * and what is fixed to it, a contact, a sliver, a column that runs up into the piece above it, and a
 * wall-fixed piece scribed to its wall are not clashes.
 */
export function pairClash(
  nodes: Nodes,
  a: Prism,
  b: Prism,
): Pick<Pair, 'depth' | 'area' | 'at' | 'zFrom' | 'zTo'> | null {
  if (a.nodeId === b.nodeId) return null
  if (hosts(nodes, a.nodeId, b.nodeId) || hosts(nodes, b.nodeId, a.nodeId)) return null
  if (a.host?.wallId === b.nodeId || b.host?.wallId === a.nodeId) return null
  const z0 = Math.max(a.z0, b.z0)
  const z1 = Math.min(a.z1, b.z1)
  if (z1 - z0 < MIN_HEIGHT_OVERLAP_M) return null
  const meet = intersection({ outer: a.outer, holes: a.holes }, { outer: b.outer, holes: b.holes })
  const size = area(meet)
  if (size < CLASH_MIN_AREA_M2) return null
  const depth = narrowestExtent(meet)
  if (depth < CLASH_INFO_M) return null
  // a column that runs up into the piece above it (a beam) is joined to it, not clashing
  const column = a.kind === 'column' ? a : b.kind === 'column' ? b : null
  if (column && z1 >= column.z1 - 0.05) return null
  if (b.kind === 'wall' && wallFixed(nodes, a) && depth <= SCRIBE_M) return null
  if (Math.min(a.z1 - a.z0, b.z1 - b.z0) <= FLAT_COVERING_M) return null
  // a cabinet run is drawn as its box; the oven, hob or machine built into it is inside it by design
  for (const [run, other] of [
    [a, b],
    [b, a],
  ] as const)
    if (
      run.kind === 'cabinet' &&
      run.shape === 'approx' &&
      BUILT_IN.test(itemText(nodes, other.nodeId))
    )
      return null
  if (depth <= TUCKED_M)
    for (const [seat, table] of [
      [a, b],
      [b, a],
    ] as const)
      if (SEAT.test(itemText(nodes, seat.nodeId)) && TABLE.test(itemText(nodes, table.nodeId)))
        return null
  const ring = meet[0]!.outer as Ring
  return {
    depth,
    area: size,
    at: [
      ring.reduce((sum, p) => sum + p[0], 0) / ring.length,
      ring.reduce((sum, p) => sum + p[1], 0) / ring.length,
    ],
    zFrom: z0,
    zTo: z1,
  }
}

/**
 * A piece of furniture or a fixture that stands inside something solid: another piece, a wall body, a
 * door or window frame or sill, a stair or a guard (a curtain or a blind is read with its opening). Read on the real outlines, so a
 * contact (under 2 cm), a piece resting on another, a rug, foliage, a building element (trim, soffit,
 * pier, beam) and a wall-fixed piece scribed to its wall (5 cm) stay quiet. From 2 cm it is information,
 * from 8 cm a warning, and from 12 cm for an approximate outline, still labeled as such.
 */
export function clashIssues(nodes: Nodes, shapes: UsageShapes): UsageIssue[] {
  const out: UsageIssue[] = []
  for (const level of shapes.levels) {
    const prisms = level.prisms.filter(
      (prism) =>
        !(nodes[prism.nodeId]?.type === 'item' && isFloorUnderlay(nodes[prism.nodeId] as ItemNode)),
    )
    const pieces = prisms.filter(
      (prism) =>
        isPiecePrism(prism) &&
        !isFoliage(nodes, prism.nodeId) &&
        !isBuildingElement(nodes, prism.nodeId),
    )
    const others = prisms.filter(
      (prism) =>
        (isPiecePrism(prism) || OBSTACLE_KINDS.has(prism.kind)) &&
        !isFoliage(nodes, prism.nodeId) &&
        !isBuildingElement(nodes, prism.nodeId),
    )
    const boxes = new Map<Prism, [number, number, number, number]>()
    const box = (prism: Prism) => {
      const known = boxes.get(prism)
      if (known) return known
      const fresh = ringBox(prism.outer)
      boxes.set(prism, fresh)
      return fresh
    }
    const found = new Map<string, Pair>()
    for (const a of pieces) {
      for (const b of others) {
        if (isPiecePrism(b) && b.nodeId < a.nodeId) continue
        if (!boxesMeet(box(a), box(b))) continue
        const clash = pairClash(nodes, a, b)
        if (!clash) continue
        const key = `${a.nodeId}|${b.nodeId}|${b.kind}`
        const prior = found.get(key)
        if (!prior || clash.depth > prior.depth) found.set(key, { a, b, ...clash })
        else prior.area += clash.area
      }
    }
    for (const { a, b, depth, area: size, at } of found.values()) {
      // a bed head against a window is a design choice, not a finding
      if (isBed(nodes[a.nodeId]) && (b.kind === 'sill' || b.kind === 'window-frame')) continue
      const approximate = a.shape === 'approx' || b.shape === 'approx'
      const room = roomAt(nodes, level.levelId, at)
      const who = quote(nameOf(nodes, a.nodeId))
      const target = isPiecePrism(b)
        ? `${quote(nameOf(nodes, b.nodeId))}`
        : `${WHAT[b.kind] ?? 'the'} ${quote(nameOf(nodes, b.nodeId))}`
      const warnAt = approximate ? CLASH_APPROX_WARNING_M : CLASH_WARNING_M
      const severity = depth >= warnAt ? 'warning' : 'info'
      out.push({
        type: 'usage_clash',
        message: `${who} ${isPiecePrism(b) ? 'overlaps' : 'stands'} ${cm(depth)} ${isPiecePrism(b) ? 'of' : 'into'} ${target}${room ? ` in ${quote(room.name)}` : ''}${size >= 0.1 || approximate ? ` (${[size >= 0.1 ? `${Math.round(size * 1e4)} cm² in plan` : '', approximate ? 'approximate shape' : ''].filter(Boolean).join(', ')})` : ''}.`,
        severity,
        nodeIds: unique([room?.id, a.nodeId, b.nodeId]),
        valueM: Math.round(depth * 1000) / 1000,
        thresholdM: warnAt,
        place: { room: room?.name ?? '', roomId: room?.id ?? level.levelId, at },
        obstacles: [a, b].map((prism) => ({
          nodeId: prism.nodeId,
          name: nameOf(nodes, prism.nodeId),
          kind: prism.kind,
          shape: prism.shape,
          movable: false,
        })),
        approximate,
      })
    }
  }
  return out
}
