import { calculateLevelMiters, type WallMiterData, type WallNode } from '@pascal-app/core'

// A progressive rebuild drains 8 walls per frame, so a 1081-wall import takes
// ~136 frames. The miter solution does not change across those frames — nothing
// dirties the geometry in between — yet the naive code recomputed it every
// frame. Cache it, keyed on the exact wall data the miters depend on.
//
// The comparison is exact (no hashing): a stale hit would silently render wrong
// joints, and 7 numeric compares × N walls is microseconds — far cheaper than
// the risk.
type LevelMiterCacheEntry = { walls: WallNode[]; data: WallMiterData }
const levelMiterCache = new Map<string, LevelMiterCacheEntry>()

export function sameMiterInputs(a: WallNode[], b: WallNode[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (!x || !y) return false
    if (
      x.id !== y.id ||
      x.start[0] !== y.start[0] ||
      x.start[1] !== y.start[1] ||
      x.end[0] !== y.end[0] ||
      x.end[1] !== y.end[1] ||
      x.thickness !== y.thickness ||
      x.curveOffset !== y.curveOffset
    ) {
      return false
    }
  }
  return true
}

export function getCachedLevelMiters(levelId: string, levelWalls: WallNode[]): WallMiterData {
  const cached = levelMiterCache.get(levelId)
  if (cached && sameMiterInputs(cached.walls, levelWalls)) return cached.data

  const data = calculateLevelMiters(levelWalls)
  levelMiterCache.set(levelId, { walls: levelWalls, data })
  return data
}

/**
 * The cache is module-level, so it outlives any single mount. Editor teardown
 * resets the other shared singletons; without the same reset a remount in the
 * same tab keeps every previous level's walls reachable.
 */
export function clearLevelMiterCache(): void {
  levelMiterCache.clear()
}
