import type { Pt, Rect, UnitLayout, UnitSpace } from './unit-layout'

/**
 * Congruent units: the same outline turned or mirrored. One guess serves the group; each unit
 * gets it in its own orientation, mirrored where its outline is mirrored, with the entry door on
 * its own entry wall.
 */

export type Placement = {
  orientation: string
  /** p' = [m[0]·x + m[1]·z, m[2]·x + m[3]·z] + offset */
  m: readonly [number, number, number, number]
  offset: Pt
}

const ORIENTATIONS = [
  { name: 'same', m: [1, 0, 0, 1] },
  { name: 'turned 90°', m: [0, -1, 1, 0] },
  { name: 'turned 180°', m: [-1, 0, 0, -1] },
  { name: 'turned 270°', m: [0, 1, -1, 0] },
  { name: 'mirrored', m: [-1, 0, 0, 1] },
  { name: 'mirrored and turned 90°', m: [0, 1, 1, 0] },
  { name: 'mirrored and turned 180°', m: [1, 0, 0, -1] },
  { name: 'mirrored and turned 270°', m: [0, -1, -1, 0] },
] as const

const TOL = 0.05

export const applyPlacement = ({ m, offset }: Placement, [x, z]: Pt): Pt => [
  Math.round((m[0] * x + m[1] * z + offset[0]) * 1e6) / 1e6,
  Math.round((m[2] * x + m[3] * z + offset[1]) * 1e6) / 1e6,
]

/**
 * How `from` maps onto `to`: the orientation (fewest turns, unmirrored first) whose outline
 * coincides and whose edges keep their kind (the entry on the entry wall, windows on the
 * outside). Null when the units are not congruent.
 */
export function placeUnit(from: UnitSpace, to: UnitSpace): Placement | null {
  for (const { name, m } of ORIENTATIONS) {
    const turned = from.outline.map(([x, z]): Pt => [m[0] * x + m[1] * z, m[2] * x + m[3] * z])
    const min = (pts: Pt[], k: 0 | 1) => Math.min(...pts.map((p) => p[k]))
    const offset: Pt = [min(to.outline, 0) - min(turned, 0), min(to.outline, 1) - min(turned, 1)]
    const placement: Placement = { orientation: name, m, offset }
    const moved = from.outline.map((p) => applyPlacement(placement, p))
    const index = (p: Pt) =>
      to.outline.findIndex((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= TOL)
    const at = moved.map(index)
    if (at.some((i) => i < 0) || new Set(at).size !== to.outline.length) continue
    const n = to.outline.length
    const kindsMatch = from.edges.every((kind, i) => {
      const a = at[i]!
      const b = at[(i + 1) % n]!
      const edge = (b - a + n) % n === 1 ? a : (a - b + n) % n === 1 ? b : -1
      return edge >= 0 && to.edges[edge] === kind
    })
    if (kindsMatch) return placement
  }
  return null
}

export function placeLayout(layout: UnitLayout, placement: Placement): UnitLayout {
  const rect = ([x0, z0, x1, z1]: Rect): Rect => {
    const [ax, az] = applyPlacement(placement, [x0, z0])
    const [bx, bz] = applyPlacement(placement, [x1, z1])
    return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)]
  }
  return {
    ...layout,
    rooms: layout.rooms.map((r) => ({ ...r, rects: r.rects.map(rect) })),
    doors: layout.doors.map((d) => ({ ...d, at: applyPlacement(placement, d.at) })),
    entry: { ...layout.entry, at: applyPlacement(placement, layout.entry.at) },
  }
}
