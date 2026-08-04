import type { CastableElement } from '../coverage/elements'
import { elementLength } from '../coverage/elements'
import type { PourCutReason, PourLimits, PourSegment } from './types'

/**
 * Plan split — solver Phase 3.
 *
 * Two kinds of cut, and the difference matters downstream. A **hard cut** is an
 * expansion or isolation joint: the two sides are structurally independent, no
 * pour may ever bridge it, and the solver is not allowed to move it. A **soft
 * cut** is the solver's own choice — made to keep a pour inside the max length
 * for shrinkage control, or inside what the batch plant can deliver before the
 * first concrete placed reaches initial set — and it may be moved later.
 *
 * Hard cuts are applied first and then subdivided, because a soft limit applies
 * *within* each structurally independent bay, not across the whole element.
 */

const MIN_SEGMENT_LENGTH = 1e-3

/** A hard cut position along the element's centreline, from a joint node. */
export interface HardCut {
  along: number
}

interface Cut {
  along: number
  reason: PourCutReason
}

/**
 * Subdivides `[start, end]` into the fewest equal parts that each satisfy
 * `limit`. Equal parts rather than greedy max-length runs: a greedy split
 * leaves a short remainder bay, and a short bay still needs two stop-ends and
 * a full mobilisation, so it costs nearly as much as a full one.
 */
function uniformCuts(start: number, end: number, limit: number, reason: PourCutReason): Cut[] {
  const span = end - start
  if (!(limit > MIN_SEGMENT_LENGTH) || span <= limit) return []
  const count = Math.ceil(span / limit)
  const step = span / count
  const out: Cut[] = []
  for (let index = 1; index < count; index++) out.push({ along: start + step * index, reason })
  return out
}

/**
 * `maxPourVolume` is a volume limit, but the cut is a length, so it converts
 * through the element's cross-section. Using the whole element's height is
 * correct even when it is also split into lifts: the segment boundary is a
 * vertical joint running the element's full height, and each lift within that
 * segment is a separate pour anyway, so a per-lift conversion would cut the
 * plan more finely than the concrete requires.
 */
function tighter(projectLimit?: number, elementLimit?: number): number | undefined {
  const caps = [projectLimit, elementLimit].filter(
    (value): value is number => value !== undefined && value > 0,
  )
  return caps.length === 0 ? undefined : Math.min(...caps)
}

function volumeLimitLength(element: CastableElement, maxPourVolume: number): number | undefined {
  const crossSection = element.coreThickness * element.height
  if (!(crossSection > 0)) return undefined
  return maxPourVolume / crossSection
}

export function splitIntoSegments(
  element: CastableElement,
  limits: PourLimits = {},
  hardCuts: readonly HardCut[] = [],
): PourSegment[] {
  const length = elementLength(element)
  if (length <= MIN_SEGMENT_LENGTH) {
    return [{ index: 0, startAlong: 0, endAlong: Math.max(0, length) }]
  }

  const hard: Cut[] = hardCuts
    .map((cut) => ({ along: cut.along, reason: 'HARD_JOINT' as PourCutReason }))
    .filter((cut) => cut.along > MIN_SEGMENT_LENGTH && cut.along < length - MIN_SEGMENT_LENGTH)
    .sort((a, b) => a.along - b.along)

  // The element's own cap and the project limit are both ceilings, so the
  // tighter one governs — the same rule the lift split follows.
  const maxLength = tighter(limits.maxPourLength, element.maxPourLength)
  const maxVolume = tighter(limits.maxPourVolume, element.maxPourVolume)
  const byVolume = maxVolume === undefined ? undefined : volumeLimitLength(element, maxVolume)
  const softLimits: Array<{ limit: number; reason: PourCutReason }> = []
  if (maxLength !== undefined) {
    softLimits.push({ limit: maxLength, reason: 'MAX_POUR_LENGTH' })
  }
  if (byVolume !== undefined) softLimits.push({ limit: byVolume, reason: 'MAX_POUR_VOLUME' })
  // The binding soft limit is the smallest one; applying both would cut twice
  // for a single physical constraint.
  const soft = softLimits.sort((a, b) => a.limit - b.limit)[0]

  const cuts: Cut[] = [...hard]
  if (soft) {
    const bayEdges = [0, ...hard.map((cut) => cut.along), length]
    for (let index = 0; index < bayEdges.length - 1; index++) {
      const start = bayEdges[index]
      const end = bayEdges[index + 1]
      if (start === undefined || end === undefined) continue
      cuts.push(...uniformCuts(start, end, soft.limit, soft.reason))
    }
  }

  cuts.sort((a, b) => a.along - b.along)
  const distinct: Cut[] = []
  for (const cut of cuts) {
    const previous = distinct[distinct.length - 1]
    if (previous && cut.along - previous.along <= MIN_SEGMENT_LENGTH) continue
    distinct.push(cut)
  }

  const segments: PourSegment[] = []
  let start = 0
  for (const [index, cut] of distinct.entries()) {
    segments.push({
      index,
      startAlong: start,
      endAlong: cut.along,
      startCutReason: distinct[index - 1]?.reason,
      endCutReason: cut.reason,
    })
    start = cut.along
  }
  segments.push({
    index: distinct.length,
    startAlong: start,
    endAlong: length,
    startCutReason: distinct[distinct.length - 1]?.reason,
  })

  return segments
}
