import { layoutWalls, type Pt, type Segment, type UnitLayout } from './unit-layout'

/**
 * The plan score, render and compare: a unit's plan image is the target. Its thick strokes are
 * the walls (text, furniture and dimension lines are thin and drop out); the unit outline
 * registers it in the unit frame across the 8 orientations; each candidate's walls, door openings
 * cut out, are scored by chamfer distance to those strokes, both ways. Pure: the host decodes the
 * image into grey pixels.
 */

/** Points along segments, about every `step` metres, ends included. */
export function sampleSegments(segments: readonly Segment[], step = 0.05): Pt[] {
  const points: Pt[] = []
  for (const { a, b } of segments) {
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let i = 0; i <= n; i++)
      points.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
  }
  return points
}

export const outlineSegments = (outline: readonly Pt[]): Segment[] =>
  outline.map((a, i) => ({ a, b: outline[(i + 1) % outline.length]! }))

/**
 * `distance` is to the walls' centrelines, not their ink: inside a wall it is how far a pixel sits
 * from the stroke's ridge, outside the distance to the ink plus half a wall. `ridge` marks the
 * centreline pixels.
 */
export type PlanMask = {
  width: number
  height: number
  walls: Uint8Array
  ridge: Uint8Array
  distance: Float32Array
}

/** A plan pixel darker than this is ink. */
const INK = 120
/** Strokes thinner than 2r+1 px are clutter. Walls in the Victor's unit JPGs are ~9 px. */
const OPEN_RADIUS = 3
/** Registration caps each outline sample's distance (px): a window run has no wall ink under it. */
const TRUNCATE = 12

function morph(
  mask: Uint8Array,
  w: number,
  h: number,
  r: number,
  keep: (hits: number, n: number) => boolean,
) {
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let hits = 0
        let n = 0
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x
          const yy = horizontal ? y : y + k
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          n++
          hits += src[yy * w + xx]!
        }
        out[y * w + x] = keep(hits, n) ? 1 : 0
      }
    return out
  }
  return pass(pass(mask, true), false)
}

/** Exact Euclidean distance transform (Felzenszwalb–Huttenlocher), in pixels, to the nearest set pixel. */
export function distanceTransform(mask: Uint8Array, w: number, h: number) {
  const INF = 1e20
  const f = new Float64Array(Math.max(w, h))
  const d = new Float64Array(Math.max(w, h))
  const v = new Int32Array(Math.max(w, h))
  const z = new Float64Array(Math.max(w, h) + 1)
  const grid = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? 0 : INF
  const line = (n: number) => {
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
      while (s <= z[k]!) {
        k--
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++
      d[q] = (q - v[k]!) ** 2 + f[v[k]!]!
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!
    line(h)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!
    line(w)
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x]!
  }
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(grid[i]!)
  return out
}

/** Ink, opened to drop thin strokes, and its distance field. */
export function planMask(grey: Uint8Array, width: number, height: number): PlanMask {
  const ink = new Uint8Array(width * height)
  for (let i = 0; i < ink.length; i++) ink[i] = grey[i]! < INK ? 1 : 0
  const eroded = morph(ink, width, height, OPEN_RADIUS, (hits, n) => hits === n)
  const walls = morph(eroded, width, height, OPEN_RADIUS, (hits) => hits > 0)
  const outside = distanceTransform(walls, width, height)
  const paper = new Uint8Array(walls.length)
  for (let i = 0; i < walls.length; i++) paper[i] = walls[i] ? 0 : 1
  const depth = distanceTransform(paper, width, height)
  const depths = [...depth.filter((_, i) => walls[i])].sort((a, b) => a - b)
  const half = depths[Math.floor(depths.length * 0.9)] ?? 1
  const distance = new Float32Array(walls.length)
  const ridge = new Uint8Array(walls.length)
  for (let i = 0; i < walls.length; i++) {
    distance[i] = walls[i] ? Math.max(0, half - depth[i]!) : outside[i]! + half
    ridge[i] = walls[i] && depth[i]! >= half - 0.75 ? 1 : 0
  }
  return { width, height, walls, ridge, distance }
}

const ORIENTATIONS = [
  { name: 'as drawn', m: [1, 0, 0, 1] },
  { name: 'mirrored', m: [-1, 0, 0, 1] },
  { name: 'turned 180°', m: [-1, 0, 0, -1] },
  { name: 'mirrored and turned 180°', m: [1, 0, 0, -1] },
  { name: 'turned 90°', m: [0, -1, 1, 0] },
  { name: 'turned 270°', m: [0, 1, -1, 0] },
  { name: 'mirrored and turned 90°', m: [0, 1, 1, 0] },
  { name: 'mirrored and turned 270°', m: [0, -1, -1, 0] },
] as const

export type Registration = {
  orientation: string
  /** Pixels per metre. */
  scale: number
  offset: Pt
  /** Mean capped distance (px) from the outline to the plan's walls, and the best other orientation's. */
  residual: number
  runnerUp: { orientation: string; residual: number }
  frame: (p: Pt) => Pt
}

const lookup = (mask: PlanMask, [x, y]: Pt) => {
  const xi = Math.round(x)
  const yi = Math.round(y)
  if (xi < 0 || yi < 0 || xi >= mask.width || yi >= mask.height) return 50
  return mask.distance[yi * mask.width + xi]!
}

/** The outline's pose on the plan: orientation, scale and offset with the least chamfer residual. */
export function registerOutline(outline: readonly Pt[], mask: PlanMask): Registration {
  const points = sampleSegments(outlineSegments(outline), 0.1)
  let inkX0 = mask.width
  let inkY0 = mask.height
  let inkX1 = 0
  let inkY1 = 0
  for (let y = 0; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++)
      if (mask.walls[y * mask.width + x]) {
        inkX0 = Math.min(inkX0, x)
        inkX1 = Math.max(inkX1, x)
        inkY0 = Math.min(inkY0, y)
        inkY1 = Math.max(inkY1, y)
      }
  const results = ORIENTATIONS.map(({ name, m }) => {
    const turned = points.map(([x, z]): Pt => [m[0] * x + m[1] * z, m[2] * x + m[3] * z])
    const x0 = Math.min(...turned.map((p) => p[0]))
    const z0 = Math.min(...turned.map((p) => p[1]))
    const local = turned.map(([x, z]): Pt => [x - x0, z - z0])
    const w = Math.max(...local.map((p) => p[0]))
    const h = Math.max(...local.map((p) => p[1]))
    const s0 = Math.min((inkX1 - inkX0) / w, (inkY1 - inkY0) / h)
    const score = (s: number, tx: number, ty: number) => {
      let sum = 0
      for (const [x, z] of local) sum += Math.min(TRUNCATE, lookup(mask, [x * s + tx, z * s + ty]))
      return sum / local.length
    }
    let best = { s: s0, tx: inkX0, ty: inkY0, residual: Number.POSITIVE_INFINITY }
    for (let ds = -0.06; ds <= 0.0601; ds += 0.005)
      for (let tx = inkX0 - 4; tx <= inkX0 + 12; tx++)
        for (let ty = inkY0 - 4; ty <= inkY0 + 12; ty++) {
          const s = s0 * (1 + ds)
          const residual = score(s, tx, ty)
          if (residual < best.residual) best = { s, tx, ty, residual }
        }
    for (let step = 0; step < 2; step++)
      for (const ds of [-0.002, 0, 0.002])
        for (const dx of [-0.5, 0, 0.5])
          for (const dy of [-0.5, 0, 0.5]) {
            const s = best.s * (1 + ds)
            const residual = score(s, best.tx + dx, best.ty + dy)
            if (residual < best.residual) best = { s, tx: best.tx + dx, ty: best.ty + dy, residual }
          }
    const frame = ([x, z]: Pt): Pt => [
      (m[0] * x + m[1] * z - x0) * best.s + best.tx,
      (m[2] * x + m[3] * z - z0) * best.s + best.ty,
    ]
    return { name, scale: best.s, offset: [best.tx, best.ty] as Pt, residual: best.residual, frame }
  }).sort((p, q) => p.residual - q.residual)
  const [first, second] = results as [(typeof results)[number], (typeof results)[number]]
  return {
    orientation: first.name,
    scale: first.scale,
    offset: first.offset,
    residual: first.residual,
    runnerUp: { orientation: second.name, residual: second.residual },
    frame: first.frame,
  }
}

/** A layout's walls with its door openings cut out: what the plan draws. */
export function drawnWalls(layout: UnitLayout): Segment[] {
  const out: Segment[] = []
  const doors = [...layout.doors, layout.entry]
  for (const wall of layoutWalls(layout)) {
    const vertical = Math.abs(wall.a[0] - wall.b[0]) < 1e-6
    const k = vertical ? 1 : 0
    const line = vertical ? wall.a[0] : wall.a[1]
    let cuts: [number, number][] = [
      [Math.min(wall.a[k], wall.b[k]), Math.max(wall.a[k], wall.b[k])],
    ]
    for (const door of doors) {
      if (Math.abs(door.at[vertical ? 0 : 1] - line) > 1e-3) continue
      const d0 = door.at[k] - door.width / 2
      const d1 = door.at[k] + door.width / 2
      cuts = cuts
        .flatMap(([c0, c1]): [number, number][] => [
          ...(d0 > c0 ? [[c0, Math.min(c1, d0)] as [number, number]] : []),
          ...(d1 < c1 ? [[Math.max(c0, d1), c1] as [number, number]] : []),
        ])
        .filter(([c0, c1]) => c1 - c0 > 1e-3)
    }
    for (const [c0, c1] of cuts)
      out.push(vertical ? { a: [line, c0], b: [line, c1] } : { a: [c0, line], b: [c1, line] })
  }
  return out
}

/** The cheap half of the plan score (m): the candidate's walls to the plan's, for a first sort. */
export function candidateToPlan(
  layout: UnitLayout,
  mask: PlanMask,
  registration: Pick<Registration, 'frame' | 'scale'>,
) {
  const samples = sampleSegments(drawnWalls(layout), 0.1)
  let sum = 0
  for (const p of samples) sum += lookup(mask, registration.frame(p)) / registration.scale
  return samples.length ? sum / samples.length : 0
}

export type PlanScore = { score: number; candidateToPlan: number; planToCandidate: number }

/**
 * Metres. Candidate walls to the plan's walls (a wall where the plan has none costs; clutter costs
 * nothing), and the plan's interior walls to the candidate's walls or outline (a missing wall
 * costs). `score` is their mean.
 */
export function scoreAgainstPlan(
  layout: UnitLayout,
  outline: readonly Pt[],
  mask: PlanMask,
  registration: Pick<Registration, 'frame' | 'scale'>,
  planInterior: Pt[],
): PlanScore {
  const { frame, scale } = registration
  const walls = drawnWalls(layout)
  const forward = sampleSegments(walls, 0.05).map((p) => lookup(mask, frame(p)) / scale)
  const drawn = new Uint8Array(mask.width * mask.height)
  const plot = (p: Pt) => {
    const [x, y] = frame(p).map(Math.round) as [number, number]
    if (x >= 0 && y >= 0 && x < mask.width && y < mask.height) drawn[y * mask.width + x] = 1
  }
  for (const p of sampleSegments([...walls, ...outlineSegments(outline)], 0.5 / scale)) plot(p)
  const field = distanceTransform(drawn, mask.width, mask.height)
  const backward = planInterior.map(([x, y]) => field[y * mask.width + x]! / scale)
  const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0)
  const candidateToPlan = mean(forward)
  const planToCandidate = mean(backward)
  return { score: (candidateToPlan + planToCandidate) / 2, candidateToPlan, planToCandidate }
}

/** The plan's wall centreline pixels away from the registered outline: its interior walls. */
export function planInteriorPixels(
  mask: PlanMask,
  outline: readonly Pt[],
  frame: (p: Pt) => Pt,
  scale: number,
  stride = 1,
): Pt[] {
  const ring = new Uint8Array(mask.width * mask.height)
  for (const p of sampleSegments(outlineSegments(outline), 0.5 / scale)) {
    const [x, y] = frame(p).map(Math.round) as [number, number]
    if (x >= 0 && y >= 0 && x < mask.width && y < mask.height) ring[y * mask.width + x] = 1
  }
  const near = distanceTransform(ring, mask.width, mask.height)
  const pixels: Pt[] = []
  for (let y = 0; y < mask.height; y += stride)
    for (let x = 0; x < mask.width; x += stride)
      if (mask.ridge[y * mask.width + x] && near[y * mask.width + x]! > 0.2 * scale)
        pixels.push([x, y])
  return pixels
}
