import type { AnyNodeId } from '../../../schema/types'
import type { CastableElement, Vec2 } from './elements'
import { elementLength } from './elements'
import { clipSegmentToElement, type Interval, unionLength } from './footprint'
import type { Abutment } from './junctions'
import type { Deduction } from './types'

/**
 * Corner overlap ownership. Where two elements meet, the prism they share is
 * one region of concrete but falls inside both elements' face rectangles. Left
 * alone both claim it and the take-off double-counts every junction in the
 * building.
 *
 * The earlier-cast element owns the overlap: it is the one that formed that
 * face before the other existed. A shared cast order ties on the lower id —
 * arbitrary but stable, so two runs never disagree about who paid for a corner.
 *
 * Only `physicalArea` is trimmed. The standards are explicit that intersections
 * are *not* deducted from measured work (HKSMM4: no formwork surface exists at
 * a wall/column/beam/slab intersection, yet the measured item stands), so the
 * contract number keeps the full rectangle.
 */

/** True when `element` formed this face before the neighbour existed. */
export function ownsOverlap(element: CastableElement, neighbour: Abutment): boolean {
  const ours = element.castOrder
  const theirs = neighbour.neighbourCastOrder
  if (ours === undefined || theirs === undefined || ours === theirs) {
    return element.id < neighbour.neighbourId
  }
  return ours < theirs
}

/**
 * One neighbour's share of a face's trim, in metres of run along that face.
 *
 * `lengthM` is *incremental*: where two neighbours bury the same stretch the
 * second reports only what it adds, so the contributions sum to the trim exactly
 * and no region is deducted twice. `overlapM` is the whole stretch that
 * neighbour covers, which is what the audit line should say was considered.
 */
export interface TrimContribution {
  neighbourId: AnyNodeId
  /** The neighbour's cast order, kept so merged lists still sort by ownership. */
  neighbourCastOrder?: number
  lengthM: number
  overlapM: number
  /**
   * Cast in the same pour as us. The distinction is not bookkeeping: a
   * monolithic overlap has no formwork surface at all, while a sequenced one has
   * a surface that the element cast first formed and billed.
   */
  monolithic: boolean
}

/**
 * Ownership order — earliest cast first, id as the tie-break. The same order
 * `ownsOverlap` uses, so where several neighbours bury one stretch the one
 * credited with it is the one that formed it.
 */
function byOwnership(
  a: { id: AnyNodeId; order: number | undefined },
  b: { id: AnyNodeId; order: number | undefined },
): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY
  const bo = b.order ?? Number.POSITIVE_INFINITY
  if (ao !== bo) return ao - bo
  return a.id < b.id ? -1 : 1
}

/** Metres of run lost, summed — the incremental lengths never overlap. */
export function trimLengthM(contributions: readonly TrimContribution[]): number {
  return contributions.reduce((sum, contribution) => sum + contribution.lengthM, 0)
}

/** The neighbour credited with the overlap: the earliest-cast one that buries it. */
export function governingNeighbour(
  contributions: readonly TrimContribution[],
): AnyNodeId | undefined {
  return contributions[0]?.neighbourId
}

interface TrimCandidate {
  id: AnyNodeId
  order: number | undefined
  monolithic: boolean
  intervals: Interval[]
}

/**
 * Candidates as incremental contributions. Walking them in ownership order and
 * charging each only what it adds to the union is what keeps the deductions
 * summing to the trim: three walls burying one stretch of a face take it off
 * once, credited to the one that formed it.
 */
function contributionsFrom(
  candidates: readonly TrimCandidate[],
  spanM: number,
): TrimContribution[] {
  const covered: Interval[] = []
  let coveredM = 0
  const out: TrimContribution[] = []
  for (const candidate of [...candidates].sort(byOwnership)) {
    const overlapM = unionLength(candidate.intervals) * spanM
    if (overlapM <= 0) continue
    covered.push(...candidate.intervals)
    const totalM = unionLength(covered) * spanM
    out.push({
      neighbourId: candidate.id,
      neighbourCastOrder: candidate.order,
      lengthM: totalM - coveredM,
      overlapM,
      monolithic: candidate.monolithic,
    })
    coveredM = totalM
  }
  return out
}

function sharesPour(element: CastableElement, other: CastableElement): boolean {
  return element.pourId !== undefined && element.pourId === other.pourId
}

/**
 * Merges per-edge contribution lists into one entry per neighbour, in ownership
 * order. Lengths add rather than union because the lists come from *different*
 * edges of the same footprint, which share no run.
 */
export function mergeTrimContributions(
  lists: ReadonlyArray<readonly TrimContribution[]>,
): TrimContribution[] {
  const byNeighbour = new Map<AnyNodeId, TrimContribution>()
  for (const list of lists) {
    for (const contribution of list) {
      const existing = byNeighbour.get(contribution.neighbourId)
      if (!existing) {
        byNeighbour.set(contribution.neighbourId, { ...contribution })
        continue
      }
      existing.lengthM += contribution.lengthM
      existing.overlapM += contribution.overlapM
    }
  }
  return [...byNeighbour.values()].sort((a, b) =>
    byOwnership(
      { id: a.neighbourId, order: a.neighbourCastOrder },
      { id: b.neighbourId, order: b.neighbourCastOrder },
    ),
  )
}

/**
 * Contributions restated against a different run. A round column is clipped
 * against its faceted outline but billed at π·D, so its buried runs have to be
 * carried across to the true circumference or the deduction and the gross area
 * are measuring different columns.
 */
export function scaleTrimContributions(
  contributions: readonly TrimContribution[],
  factor: number,
): TrimContribution[] {
  return contributions.map((contribution) => ({
    ...contribution,
    lengthM: contribution.lengthM * factor,
    overlapM: contribution.overlapM * factor,
  }))
}

/**
 * Contributions as face deductions. `heightM` is whatever turns a run into an
 * area for this face — a wall's height, a slab rim's thickness — so the caller
 * that knows the face shape supplies it.
 *
 * `measuredSqM` is always 0. No standard deducts at an intersection, and the
 * reason is recorded rather than the deduction skipped so the audit trail shows
 * the rule was applied instead of forgotten.
 */
export function trimDeductions(
  contributions: readonly TrimContribution[],
  heightM: number,
): Deduction[] {
  const out: Deduction[] = []
  for (const contribution of contributions) {
    if (contribution.lengthM <= 0) continue
    out.push({
      reason: contribution.monolithic ? 'INTERSECTION' : 'CORNER_OVERLAP_REASSIGNED',
      sourceId: contribution.neighbourId,
      areaSqM: contribution.overlapM * heightM,
      physicalSqM: contribution.lengthM * heightM,
      measuredSqM: 0,
    })
  }
  return out
}

/**
 * The centreline of one side face, offset from the element's centreline by half
 * the core. Side `a` is the left-hand offset, matching `classifySide`.
 */
function sideEdge(element: CastableElement, side: 'a' | 'b'): { from: Vec2; to: Vec2 } | null {
  const length = elementLength(element)
  if (length < 1e-9) return null
  const ux = (element.end.x - element.start.x) / length
  const uy = (element.end.y - element.start.y) / length
  const sign = side === 'a' ? 1 : -1
  const offX = -uy * element.halfWidth * sign
  const offY = ux * element.halfWidth * sign
  return {
    from: { x: element.start.x + offX, y: element.start.y + offY },
    to: { x: element.end.x + offX, y: element.end.y + offY },
  }
}

/**
 * What one side face loses, per neighbour — the stretches of that face buried
 * inside neighbours whose overlap this element does not own. A collinear butt
 * joint loses nothing (the footprints meet, they don't overlap); an L corner
 * loses one side; the stem of a T is buried on both sides.
 *
 * Lengths are metres of run along the face. The caller multiplies by the height
 * it is billing, which for a pour unit is the unit's height rather than the
 * element's.
 */
export function sideFaceTrim(
  element: CastableElement,
  side: 'a' | 'b',
  abutments: { start: Abutment[]; end: Abutment[] },
  elementById: (id: AnyNodeId) => CastableElement | undefined,
): TrimContribution[] {
  const edge = sideEdge(element, side)
  if (!edge) return []
  const length = elementLength(element)
  const candidates: TrimCandidate[] = []
  const seen = new Set<AnyNodeId>()

  for (const neighbour of [...abutments.start, ...abutments.end]) {
    if (seen.has(neighbour.neighbourId)) continue
    seen.add(neighbour.neighbourId)
    const other = elementById(neighbour.neighbourId)
    if (!other) continue
    // A slab overlaps the whole plan of the walls under it without burying any
    // of their vertical faces, so it never trims one.
    if (other.kind === 'slab') continue
    const monolithic = sharesPour(element, other)
    if (!monolithic && ownsOverlap(element, neighbour)) continue
    const intervals = clipSegmentToElement(other, edge.from, edge.to)
    if (intervals.length === 0) continue
    candidates.push({ id: other.id, order: other.castOrder, monolithic, intervals })
  }

  return contributionsFrom(candidates, length)
}

/**
 * What one rim edge loses, per neighbour — the stretch of a slab edge butting an
 * earlier bay, or of a column face absorbed into a wall.
 *
 * Reported as lengths rather than areas because the two callers multiply by
 * different heights: a slab edge by its thickness, a column face by its own.
 *
 * `neighbours` is whatever the caller decided is *eligible to bury this face*,
 * not every element on the level. Plan overlap alone does not bury anything —
 * a slab overlaps the whole plan of the walls beneath it and buries none of
 * their faces, and the wall under a slab's rim does not form that rim either.
 */
export function buriedEdgeLength(
  element: CastableElement,
  edge: { from: Vec2; to: Vec2 },
  neighbours: readonly CastableElement[],
  boundaryTolerance = 0,
): TrimContribution[] {
  const span = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y)
  if (span < 1e-9) return []
  const candidates: TrimCandidate[] = []

  for (const other of neighbours) {
    if (other.id === element.id) continue
    // A monolithic neighbour absorbs the face whatever the sequence says: with
    // no joint between them there is no surface there to form.
    const monolithic = sharesPour(element, other)
    if (
      !monolithic &&
      ownsOverlap(element, {
        neighbourId: other.id,
        neighbourCastOrder: other.castOrder,
        angleDeg: 90,
      })
    ) {
      continue
    }
    const intervals = clipSegmentToElement(other, edge.from, edge.to, boundaryTolerance)
    if (intervals.length === 0) continue
    candidates.push({ id: other.id, order: other.castOrder, monolithic, intervals })
  }

  return contributionsFrom(candidates, span)
}
