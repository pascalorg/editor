import type { ResolvedSectionProfile } from '../schema/types'

// F1 sections as closed rings, shared by the recipe evaluator (bounds, triangle counts) and the
// geometry builders. B-05's sweep will consume the same rings along a path.
export type Ring = [number, number][]
export type SectionRings = { outer: Ring; holes: Ring[] }

/** Sides of a round or oval section and quarter-turn segments of a rounded corner. */
export const SECTION_SEGMENTS = { round: 24, corner: 4 } as const

function ellipse(rx: number, ry: number): Ring {
  const n = SECTION_SEGMENTS.round
  return Array.from({ length: n }, (_, k) => [
    rx * Math.cos((2 * Math.PI * k) / n),
    ry * Math.sin((2 * Math.PI * k) / n),
  ])
}

function roundedRectangle(width: number, depth: number, corner: number): Ring {
  const [x, y] = [width / 2, depth / 2]
  if (corner <= 0)
    return [
      [-x, -y],
      [x, -y],
      [x, y],
      [-x, y],
    ]
  const n = SECTION_SEGMENTS.corner
  const centres: [number, number, number][] = [
    [x - corner, -y + corner, -Math.PI / 2],
    [x - corner, y - corner, 0],
    [-x + corner, y - corner, Math.PI / 2],
    [-x + corner, -y + corner, Math.PI],
  ]
  return centres.flatMap(([cx, cy, start]) =>
    Array.from({ length: n + 1 }, (_, k): [number, number] => {
      const a = start + ((Math.PI / 2) * k) / n
      return [cx + corner * Math.cos(a), cy + corner * Math.sin(a)]
    }),
  )
}

/** Drops repeated points, including a closing copy of the first. */
function distinct(ring: Ring): Ring {
  const out: Ring = []
  for (const point of ring) {
    const last = out.at(-1)
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-9) out.push(point)
  }
  while (
    out.length > 1 &&
    Math.hypot(out[0]![0] - out.at(-1)![0], out[0]![1] - out.at(-1)![1]) <= 1e-9
  )
    out.pop()
  return out
}

export function ringArea(ring: Ring): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!,
      [bx, by] = ring[(i + 1) % ring.length]!
    area += ax * by - bx * ay
  }
  return area / 2
}

function contains(ring: Ring, [x, y]: [number, number]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!,
      [xj, yj] = ring[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export const MAX_SECTION_POINTS = 256

function properlyCross(
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
  [cx, cy]: [number, number],
  [dx, dy]: [number, number],
) {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px)
  const d1 = side(cx, cy, dx, dy, ax, ay),
    d2 = side(cx, cy, dx, dy, bx, by),
    d3 = side(ax, ay, bx, by, cx, cy),
    d4 = side(ax, ay, bx, by, dx, dy)
  return d1 * d2 < -1e-18 && d3 * d4 < -1e-18
}
/** Whether any two edges of the rings cross (touching at shared ring vertices is allowed). */
function edgesCross(rings: Ring[]) {
  const edges = rings.flatMap((ring) =>
    ring.map((point, i) => [point, ring[(i + 1) % ring.length]!] as const),
  )
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++)
      if (properlyCross(edges[i]![0], edges[i]![1], edges[j]![0], edges[j]![1])) return true
  return false
}

/** An F1 structural section (I, C, L, T, Z or rect-tube), centred on its box. */
function structural(profile: Extract<ResolvedSectionProfile, { kind: 'section' }>): SectionRings {
  const { width: w, depth: d, web: t, flange: f } = profile
  const [x, y] = [w / 2, d / 2]
  // A rect-tube insets both sides by its web, as it insets top and bottom by its flange.
  const webLimit = profile.family === 'rect-tube' ? w / 2 : w
  if (!(t > 0 && f > 0 && t < webLimit && 2 * f < d))
    throw new Error('A structural section needs web and flange thinner than its size')
  const outer: Ring = {
    I: [
      [-x, -y],
      [x, -y],
      [x, -y + f],
      [t / 2, -y + f],
      [t / 2, y - f],
      [x, y - f],
      [x, y],
      [-x, y],
      [-x, y - f],
      [-t / 2, y - f],
      [-t / 2, -y + f],
      [-x, -y + f],
    ],
    C: [
      [-x, -y],
      [x, -y],
      [x, -y + f],
      [-x + t, -y + f],
      [-x + t, y - f],
      [x, y - f],
      [x, y],
      [-x, y],
    ],
    L: [
      [-x, -y],
      [x, -y],
      [x, -y + f],
      [-x + t, -y + f],
      [-x + t, y],
      [-x, y],
    ],
    T: [
      [-t / 2, -y],
      [t / 2, -y],
      [t / 2, y - f],
      [x, y - f],
      [x, y],
      [-x, y],
      [-x, y - f],
      [-t / 2, y - f],
    ],
    Z: [
      [-x, -y],
      [t / 2, -y],
      [t / 2, y - f],
      [x, y - f],
      [x, y],
      [-t / 2, y],
      [-t / 2, -y + f],
      [-x, -y + f],
    ],
    'rect-tube': [
      [-x, -y],
      [x, -y],
      [x, y],
      [-x, y],
    ],
  }[profile.family] as Ring
  const holes: Ring[] =
    profile.family === 'rect-tube'
      ? [
          [
            [-x + t, -y + f],
            [x - t, -y + f],
            [x - t, y - f],
            [-x + t, y - f],
          ],
        ]
      : []
  return { outer, holes }
}

/** A resolved F1 section as validated closed rings in section metres (x across, y up). */
export function sectionRings(profile: ResolvedSectionProfile): SectionRings {
  let rings: SectionRings
  switch (profile.kind) {
    case 'rectangle':
      rings = {
        outer: roundedRectangle(profile.width, profile.depth, profile.corner ?? 0),
        holes: [],
      }
      break
    case 'round':
      rings = {
        outer: ellipse(profile.radius, profile.radius),
        holes: profile.wall
          ? [ellipse(profile.radius - profile.wall, profile.radius - profile.wall)]
          : [],
      }
      break
    case 'oval':
      rings = { outer: ellipse(profile.width / 2, profile.depth / 2), holes: [] }
      break
    case 'polygon':
      rings = {
        outer: profile.outer.map(([x, y]): [number, number] => [x, y]),
        holes: (profile.holes ?? []).map((hole) => hole.map(([x, y]): [number, number] => [x, y])),
      }
      break
    case 'section':
      rings = structural(profile)
      break
    default:
      throw new Error(`Unknown section kind ${(profile as { kind: string }).kind}`)
  }
  const outer = distinct(rings.outer)
  const holes = rings.holes.map(distinct)
  for (const ring of [outer, ...holes])
    if (ring.length < 3 || Math.abs(ringArea(ring)) < 1e-8)
      throw new Error('A section ring needs three or more points enclosing an area')
  if (outer.length + holes.reduce((n, hole) => n + hole.length, 0) > MAX_SECTION_POINTS)
    throw new Error(`A section may have at most ${MAX_SECTION_POINTS} points`)
  if (holes.some((hole) => !hole.every((point) => contains(outer, point))))
    throw new Error('A section hole must lie inside its outline')
  if (holes.some((hole, i) => holes.some((other, j) => i !== j && contains(other, hole[0]!))))
    throw new Error('Section holes may not nest')
  if (edgesCross([outer, ...holes])) throw new Error('Section edges may not cross')
  return { outer, holes }
}

/**
 * Triangles of a straight extrusion: two earcut caps (V + 2H - 2 each for V vertices and H
 * holes) and two per ring edge per layer (1, or 1 + 2 × bevel segments). Exact for rings
 * without collinear points; an upper bound otherwise, since earcut drops those.
 */
export function extrusionTriangles(rings: SectionRings, bevelSegments: number): number {
  const vertices = rings.outer.length + rings.holes.reduce((n, hole) => n + hole.length, 0)
  return 2 * (vertices + 2 * rings.holes.length - 2) + 2 * vertices * (1 + 2 * bevelSegments)
}

function segmentDistance(
  [px, py]: [number, number],
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
) {
  const dx = bx - ax,
    dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
/**
 * The thinnest wall of a section: the least distance from any vertex to an edge it does not
 * touch, across the outline and holes (at most 256 points).
 */
export function sectionThickness(rings: SectionRings): number {
  const all = [rings.outer, ...rings.holes]
  if (all.reduce((n, ring) => n + ring.length, 0) > 256)
    throw new Error('A bevelled section may have at most 256 points')
  let thinnest = Infinity
  for (const [r, ring] of all.entries())
    for (const [i, point] of ring.entries())
      for (const [q, other] of all.entries())
        for (let j = 0; j < other.length; j++) {
          const k = (j + 1) % other.length
          if (q === r && (j === i || k === i)) continue
          thinnest = Math.min(thinnest, segmentDistance(point, other[j]!, other[k]!))
        }
  return thinnest
}
