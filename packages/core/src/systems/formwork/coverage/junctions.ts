import type { AnyNodeId } from '../../../schema/types'
import { type CastableElement, distanceToCentreline, elementLength, type Vec2 } from './elements'
import type {
  CornerLeg,
  EndKey,
  FormworkJunction,
  JunctionCorner,
  JunctionKind,
  JunctionRay,
} from './types'

/**
 * Which elements meet at which ends, and how. This is what makes cast order
 * answerable: an end that meets nothing is a free end (needs a stop-end),
 * an end that meets an earlier pour butts hardened concrete (needs none).
 */

/** Endpoints within this distance are treated as meeting, in meters. */
export const JUNCTION_TOLERANCE = 0.005

export interface Abutment {
  neighbourId: AnyNodeId
  /** Neighbour's cast order, if sequenced. */
  neighbourCastOrder?: number
  neighbourPourId?: string
  /** True when the neighbour is a column or a wall crossing at an angle. */
  angleDeg: number
}

export type AbutmentMap = Map<AnyNodeId, { start: Abutment[]; end: Abutment[] }>

function endPoint(element: CastableElement, key: EndKey): Vec2 {
  return key === 'start' ? element.start : element.end
}

function headingDeg(element: CastableElement): number {
  return (Math.atan2(element.end.y - element.start.y, element.end.x - element.start.x) * 180) / Math.PI
}

function angleBetween(a: CastableElement, b: CastableElement): number {
  if (elementLength(a) < 1e-9 || elementLength(b) < 1e-9) return 90
  const raw = Math.abs(headingDeg(a) - headingDeg(b)) % 180
  return raw > 90 ? 180 - raw : raw
}

/**
 * True when `point` lies inside `other`'s plan footprint — the case that
 * matters most in practice: a wall ending *at* a column, or running into the
 * middle of another wall (a T). Uses the neighbour's half-width so a wall
 * stopping at a column's face still counts as abutting it.
 */
function pointMeetsElement(point: Vec2, other: CastableElement): boolean {
  if (other.kind === 'column') {
    return Math.hypot(point.x - other.start.x, point.y - other.start.y) <= other.halfWidth + JUNCTION_TOLERANCE
  }
  if (other.kind === 'slab') {
    // A slab has no ends to abut, and every wall on the level lands inside its
    // plan, so treating that as an abutment would suppress real stop-ends.
    return false
  }
  return distanceToCentreline(other, point) <= other.halfWidth + JUNCTION_TOLERANCE
}

export function findAbutments(elements: CastableElement[]): AbutmentMap {
  const map: AbutmentMap = new Map()
  for (const element of elements) map.set(element.id, { start: [], end: [] })

  for (const element of elements) {
    // Only elements with two ends have abutments to record. A column's and a
    // slab's interfaces are found from their footprints instead, since neither
    // has a centreline direction for "start" and "end" to mean anything.
    if (element.kind !== 'wall') continue
    const entry = map.get(element.id)
    if (!entry) continue

    for (const key of ['start', 'end'] as const) {
      const point = endPoint(element, key)
      for (const other of elements) {
        if (other.id === element.id) continue
        if (!pointMeetsElement(point, other)) continue
        entry[key].push({
          neighbourId: other.id,
          neighbourCastOrder: other.castOrder,
          neighbourPourId: other.pourId,
          angleDeg: angleBetween(element, other),
        })
      }
    }
  }

  return map
}

/**
 * A junction is one point on plan and a fan of rays leaving it — one per
 * direction a wall continues in. Every ray pair that is adjacent in bearing
 * bounds a sector, and every sector is exactly one corner unit: re-entrant
 * (under 180°) takes an inside corner, reflex takes an outside one.
 *
 * Counting sectors rather than walls is what gets a T right. Three walls meeting
 * at a point is an L plus a butt, not a T; a stem landing mid-run on another
 * wall's face is a T, and it radiates three rays because the spine continues
 * both ways — two 90° sectors and one 180° straight, giving two inside corners
 * and no outside one. That is the count the catalogues quote, and it falls out
 * of the geometry instead of being tabulated per kind.
 */

/** A sector this close to straight is not a corner — the run continues through it. */
const STRAIGHT_TOLERANCE_DEG = 1

function pointKey(point: Vec2): string {
  const q = (v: number) => Math.round(v / JUNCTION_TOLERANCE)
  return `${q(point.x)}:${q(point.y)}`
}

function bearingDeg(from: Vec2, to: Vec2): number {
  const raw = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
  return raw < 0 ? raw + 360 : raw
}

/** The rays one wall contributes at `point`. */
function raysFor(element: CastableElement, point: Vec2): JunctionRay[] {
  const length = elementLength(element)
  if (length < 1e-9) return []
  const atStart = Math.hypot(point.x - element.start.x, point.y - element.start.y) <= JUNCTION_TOLERANCE
  const atEnd = Math.hypot(point.x - element.end.x, point.y - element.end.y) <= JUNCTION_TOLERANCE
  const forward = bearingDeg(element.start, element.end)
  const backward = (forward + 180) % 360
  const along = atStart ? 0 : atEnd ? length : distanceAlong(element, point)

  const ray = (end: EndKey | undefined, degrees: number, towardEnd: boolean): JunctionRay => ({
    elementId: element.id,
    end,
    alongM: along,
    bearingDeg: degrees,
    towardEnd,
    coreThickness: element.coreThickness,
  })

  // A wall ending here continues in one direction only; one the junction lands
  // mid-run on continues in both, which is what makes a T's third ray.
  if (atStart) return [ray('start', forward, true)]
  if (atEnd) return [ray('end', backward, false)]
  return [ray(undefined, forward, true), ray(undefined, backward, false)]
}

/** Distance from the wall's start to the foot of `point` on its centreline. */
function distanceAlong(element: CastableElement, point: Vec2): number {
  const length = elementLength(element)
  if (length < 1e-9) return 0
  const ux = (element.end.x - element.start.x) / length
  const uy = (element.end.y - element.start.y) / length
  const t = (point.x - element.start.x) * ux + (point.y - element.start.y) * uy
  return Math.max(0, Math.min(length, t))
}

/**
 * The face of `ray`'s wall that bounds the sector on the given side of it. Side
 * `a` is the wall's left-hand offset, so a forward ray has `a` to its
 * counter-clockwise side and `b` to its clockwise side, and a backward ray has
 * them the other way round.
 */
function boundingFace(ray: JunctionRay, sectorIsCcw: boolean): 'a' | 'b' {
  return sectorIsCcw === ray.towardEnd ? 'a' : 'b'
}

/**
 * The corner units filling the sectors between consecutive rays. `cw` bounds the
 * sector on its clockwise side, so the sector lies counter-clockwise *of* it, and
 * `ccw` the other way round.
 *
 * Each leg records the *other* wall's core, because that is what an outside leg
 * wraps — see `outsideCornerLeg`.
 */
function cornersBetween(rays: JunctionRay[]): JunctionCorner[] {
  if (rays.length < 2) return []
  const out: JunctionCorner[] = []
  for (let i = 0; i < rays.length; i++) {
    const cw = rays[i] as JunctionRay
    const ccw = rays[(i + 1) % rays.length] as JunctionRay
    // A single pair of rays bounds two sectors, so both are walked; three or
    // more bound one each, which the modulo wrap already gives.
    const sweep = (ccw.bearingDeg - cw.bearingDeg + 360) % 360
    if (sweep <= STRAIGHT_TOLERANCE_DEG || Math.abs(sweep - 180) <= STRAIGHT_TOLERANCE_DEG) continue
    const legs: [CornerLeg, CornerLeg] = [
      {
        elementId: cw.elementId,
        end: cw.end,
        alongM: cw.alongM,
        face: boundingFace(cw, true),
        towardEnd: cw.towardEnd,
        turnsOntoThicknessM: ccw.coreThickness,
      },
      {
        elementId: ccw.elementId,
        end: ccw.end,
        alongM: ccw.alongM,
        face: boundingFace(ccw, false),
        towardEnd: ccw.towardEnd,
        turnsOntoThicknessM: cw.coreThickness,
      },
    ]
    out.push({ side: sweep < 180 ? 'inside' : 'outside', angleDeg: sweep, legs })
  }
  return out
}

/**
 * Which kind of junction this is, from the sectors rather than the wall count.
 * The kinds are a label for the user and the AI; the corner hardware comes from
 * `corners`, so a shape none of them describes still bills correctly.
 */
function junctionKindFor(rays: JunctionRay[], corners: JunctionCorner[]): JunctionKind {
  if (corners.length === 0) return 'collinear-butt'
  if (rays.length >= 4) return 'cross'
  if (rays.length === 3) return 't-junction'
  return 'corner-l'
}

export function findJunctions(elements: CastableElement[]): FormworkJunction[] {
  const groups = new Map<string, { point: Vec2; ids: Set<AnyNodeId> }>()

  for (const element of elements) {
    if (element.kind !== 'wall') continue
    for (const key of ['start', 'end'] as const) {
      const point = endPoint(element, key)
      const groupKey = pointKey(point)
      let group = groups.get(groupKey)
      if (!group) {
        group = { point, ids: new Set() }
        groups.set(groupKey, group)
      }
      group.ids.add(element.id)
      for (const other of elements) {
        if (other.id === element.id) continue
        if (!pointMeetsElement(point, other)) continue
        group.ids.add(other.id)
      }
    }
  }

  const byId = new Map(elements.map((element) => [element.id, element]))
  const junctions: FormworkJunction[] = []
  for (const group of groups.values()) {
    if (group.ids.size < 2) continue
    const ids = [...group.ids].sort()
    const rays: JunctionRay[] = []
    for (const id of ids) {
      const element = byId.get(id)
      // A column at the junction carries the corner in its own box form, and a
      // slab has no direction to radiate, so neither contributes a ray. The
      // walls' rays alone then read the sectors correctly: a wall stopping at a
      // column is one ray and no corner, which is right — the column was formed
      // as a closed box before the wall arrived.
      if (!element || element.kind !== 'wall') continue
      rays.push(...raysFor(element, group.point))
    }
    rays.sort((a, b) => a.bearingDeg - b.bearingDeg)
    const corners = cornersBetween(rays)
    junctions.push({
      kind: junctionKindFor(rays, corners),
      elementIds: ids,
      point: group.point,
      rays,
      corners,
      insideCornerCount: corners.filter((corner) => corner.side === 'inside').length,
      outsideCornerCount: corners.filter((corner) => corner.side === 'outside').length,
    })
  }

  return junctions.sort((a, b) => a.elementIds.join().localeCompare(b.elementIds.join()))
}

/**
 * Inside corner leg, m, when no system has been chosen. Both shipped systems turn
 * a 90° corner on a 300 mm leg — PERI's TE 270-2 is 180 × 300 and Framax's corners
 * are 300 — so this is the value they agree on rather than a guess, and a project
 * that names a system gets that system's geometry instead. See
 * `catalog/cornerLegsMm`.
 */
export const DEFAULT_INSIDE_CORNER_LEG_M = 0.3

/**
 * Outside corner legs wrap the core, so they are longer than inside legs by
 * the wall thickness. Getting this backwards is the classic corner-unit error.
 */
export function outsideCornerLeg(insideCornerLeg: number, coreThickness: number): number {
  return insideCornerLeg + coreThickness
}

/**
 * How much of a wall's face run one corner unit consumes, m. Panel layout on
 * each leg starts offset by this — the domain rule is to place the corners first
 * and let the make-up piece land mid-run, so a layout that starts a panel at the
 * corner point is wrong by exactly this much.
 */
export function cornerLegLength(
  corner: JunctionCorner,
  leg: CornerLeg,
  insideCornerLeg: number,
): number {
  return corner.side === 'inside'
    ? insideCornerLeg
    : outsideCornerLeg(insideCornerLeg, leg.turnsOntoThicknessM)
}

/**
 * Where one corner unit's leg lands on its face — m along the element, lo first.
 *
 * `legLengthM` is the fitted leg where the system sweeps a unit for the angle and
 * `cornerLegLength` where it does not, and the caller resolves that because only it
 * knows the system. What is shared is the *placement*, and it has two subtleties
 * that are wrong in opposite directions if either is dropped: the leg runs from the
 * junction toward the element's end or back toward its start (`towardEnd`), and it
 * starts at the corner of the *concrete* rather than the centreline point — half the
 * neighbour's core, added for an inside unit and subtracted for an outside one. That
 * offset is what makes an outside leg's first joint land at the same station as its
 * inside counterpart's, so a tie between the two skins passes through square.
 *
 * Shared rather than derived twice. The geometry builder places the unit and the
 * validator asks whether two of them collide; computed separately, the check and the
 * thing it checks drift, which is the failure the parts model exists to prevent one
 * layer down.
 */
export function cornerLegExtent(
  corner: JunctionCorner,
  leg: CornerLeg,
  legLengthM: number,
): { lo: number; hi: number } {
  const direction = leg.towardEnd ? 1 : -1
  const inset = (corner.side === 'inside' ? 1 : -1) * direction * leg.turnsOntoThicknessM
  const from = leg.alongM + inset / 2
  const to = from + direction * legLengthM
  return { lo: Math.min(from, to), hi: Math.max(from, to) }
}
