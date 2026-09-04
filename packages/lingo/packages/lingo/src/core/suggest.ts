// Three reusable DP rows (prev-prev, prev, current) for editDistanceWithRows.
type EditDistanceRows = [number[], number[], number[]]

/** D17 hot path: caller-owned row buffers avoid per-call allocation. */
export function editDistanceWithRows(
  a: string,
  b: string,
  max: number,
  rows: EditDistanceRows,
): number {
  if (a === b) {
    return 0
  }
  const al = a.length
  const bl = b.length
  if (Math.abs(al - bl) > max) {
    return max + 1
  }
  const need = Math.min(al, bl) - max
  if (need > 0) {
    let common = 0
    for (let i = 0; i < al; i++) {
      if (b.indexOf(a[i]!) >= 0 && ++common >= need) {
        break
      }
    }
    if (common < need) {
      return max + 1
    }
  }
  if (al === 0) {
    return bl
  }
  if (bl === 0) {
    return al
  }

  let prevPrev = rows[0]
  let prev = rows[1]
  let curr = rows[2]
  for (let j = 0; j <= bl; j++) {
    prev[j] = j
  }

  for (let i = 1; i <= al; i++) {
    curr[0] = i
    let rowMin = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      let d = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      )
      if (
        i > 1 &&
        j > 1 &&
        ca === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        d = Math.min(d, prevPrev[j - 2]! + 1) // transposition
      }
      curr[j] = d
      if (d < rowMin) {
        rowMin = d
      }
    }
    if (rowMin > max) {
      return max + 1
    }
    const swap = prevPrev
    prevPrev = prev
    prev = curr
    curr = swap
  }
  const result = prev[bl]!
  return result > max ? max + 1 : result
}

/**
 * Bounded Damerau–Levenshtein (optimal string alignment) for did-you-mean
 * suggestions. Distances above `max` are cut off early and reported as
 * `max + 1`, keeping alias sweeps cheap.
 * @example
 * ```ts
 * import { editDistance } from '@pascal-app/lingo/core'
 * editDistance('kilogram', 'kilogrm', 3) // 1 (one deletion)
 * editDistance('kilogram', 'xyz', 2)     // 3 (== max + 1: too far, cut off)
 * ```
 */
export function editDistance(a: string, b: string, max: number): number {
  return editDistanceWithRows(a, b, max, [[], [], []])
}

/** One scored candidate from `rankCandidates()`. */
export interface SuggestionHit {
  candidate: string
  distance: number
  /** Lower ranks first among equal distances (data/priority order). */
  rank: number
}

/**
 * Rank `candidates` by edit distance to `input` (case-insensitive), keeping
 * only hits within `max` edits. Stable: preserves candidate order among ties.
 * @example
 * ```ts
 * import { rankCandidates } from '@pascal-app/lingo/core'
 * rankCandidates('meterz', ['meter', 'liter', 'meters'], 3)
 * // [{ candidate: 'meter', distance: 1, rank: 0 },
 * //  { candidate: 'meters', distance: 1, rank: 2 },
 * //  { candidate: 'liter', distance: 3, rank: 1 }]
 * ```
 */
export function rankCandidates(
  input: string,
  candidates: Iterable<string>,
  max: number,
  limit = 3,
): SuggestionHit[] {
  const needle = input.toLowerCase()
  const hits: SuggestionHit[] = []
  let rank = 0
  for (const candidate of candidates) {
    const d = editDistance(needle, candidate.toLowerCase(), max)
    if (d <= max) {
      hits.push({ candidate, distance: d, rank })
    }
    rank++
  }
  hits.sort(
    (x, y) => x.distance - y.distance || x.candidate.length - y.candidate.length || x.rank - y.rank,
  )
  return hits.slice(0, limit)
}

/**
 * Edit budget for a typed token: never fuzzy-match tiny tokens.
 * @example
 * ```ts
 * import { typoBudget } from '@pascal-app/lingo/core'
 * typoBudget('m')     // 0 — too short to guess safely
 * typoBudget('meter') // 2
 * ```
 */
export function typoBudget(token: string): number {
  const len = token.length
  if (len <= 2) {
    return 0
  }
  if (len <= 4) {
    return 1
  }
  return 2
}
