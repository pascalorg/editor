import type { AnyNode, WallFace, WallNode } from '@pascal-app/core'
import { getWallFaceBaseAt } from '@pascal-app/viewer'

// Snapping for the paint tool's wall region gestures, in face coordinates:
// `u` is metres from the wall start along the reference line (the chord on a
// curved wall), `v` metres above the face's own base. Modes mirror the 'polygon'
// snap context: `grid` rounds to the grid step, `lines` catches the face's own
// features within a tolerance, `off` (or Alt held) leaves the pointer raw.

export type WallRegionSnapMode = 'grid' | 'lines' | 'off'

export type WallRegionSnap = {
  mode: WallRegionSnapMode
  /** Grid step (m) used by `grid`. */
  gridStep: number
  /** Catch distance (m) used by `lines`. */
  tolerance: number
}

/** One face's base runs, as `getWallFinishData(geometry).faceBase[face]` carries them. */
export type WallFaceBaseRuns = readonly { start: number; end: number; y: number }[] | null

export type WallRegionSnapTargets = { u: number[]; v: number[] }

/** The wainscot height a Horizontal region starts at. */
export const DEFAULT_WAINSCOT_HEIGHT = 0.9
/** Regions narrower or shorter than this are a slip, not a gesture. */
export const MIN_WALL_REGION_SIZE = 0.02
export const DEFAULT_LINE_SNAP_TOLERANCE = 0.1

export function resolveWallRegionSnapMode(flags: {
  grid: boolean
  magnetic: boolean
  alt?: boolean
}): WallRegionSnapMode {
  if (flags.alt) return 'off'
  if (flags.grid) return 'grid'
  if (flags.magnetic) return 'lines'
  return 'off'
}

/** Base (local y) of a face at station `u`: 0 when the faces share the wall base. */
export function faceBaseAt(runs: WallFaceBaseRuns, u: number): number {
  return runs?.length ? getWallFaceBaseAt({ faceBase: { a: [...runs], b: [] } }, 'a', u) : 0
}

function uniqueSorted(values: number[]): number[] {
  const out: number[] = []
  for (const value of values.filter(Number.isFinite).sort((a, b) => a - b))
    if (out.length === 0 || value - out.at(-1)! > 1e-6) out.push(value)
  return out
}

/**
 * What a region on this face snaps to: the wall ends, openings' jambs, sills
 * and heads, other regions' bounds on the same face, the face base and the
 * wainscot height. Opening heights are local y, so each is measured above the
 * face base under the opening's centre.
 */
export function wallRegionSnapTargets(
  wall: Pick<WallNode, 'start' | 'end' | 'children' | 'faceRegions'>,
  face: WallFace,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
  runs: WallFaceBaseRuns = null,
  options: { excludeRegionId?: string } = {},
): WallRegionSnapTargets {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const u = [0, length]
  const v = [0, DEFAULT_WAINSCOT_HEIGHT]
  for (const childId of wall.children ?? []) {
    const child = nodes[childId]
    if (child?.type !== 'door' && child?.type !== 'window') continue
    const [x, y] = child.position
    u.push(x - child.width / 2, x + child.width / 2)
    const base = faceBaseAt(runs, x)
    v.push(y - child.height / 2 - base, y + child.height / 2 - base)
  }
  for (const region of wall.faceRegions ?? []) {
    if (region.face !== face || region.id === options.excludeRegionId) continue
    for (const bound of [region.u0, region.u1]) if (bound !== undefined) u.push(bound)
    for (const bound of [region.v0, region.v1]) if (bound !== undefined) v.push(bound)
  }
  return {
    u: uniqueSorted(u.filter((value) => value >= -1e-6 && value <= length + 1e-6)),
    v: uniqueSorted(v.filter((value) => value >= -1e-6)),
  }
}

/** Snaps one face coordinate. `target` is the feature it caught in `lines` mode. */
export function snapWallRegionValue(
  value: number,
  targets: readonly number[],
  snap: WallRegionSnap,
): { value: number; target: number | null } {
  if (snap.mode === 'grid' && snap.gridStep > 0) {
    const stepped = Math.round(value / snap.gridStep) * snap.gridStep
    return { value: Math.round(stepped * 1e6) / 1e6, target: null }
  }
  if (snap.mode === 'lines') {
    let best: number | null = null
    for (const target of targets)
      if (
        Math.abs(target - value) <= snap.tolerance &&
        (best === null || Math.abs(target - value) < Math.abs(best - value))
      )
        best = target
    if (best !== null) return { value: best, target: best }
  }
  return { value, target: null }
}
