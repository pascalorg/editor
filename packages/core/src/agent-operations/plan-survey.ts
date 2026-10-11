import { refuse } from '../agent-tools/refusal'
import type { ReferenceContour } from '../building/reference-construction'
import type { GuideNode } from '../schema'
import { requirePlanGuide } from './plan-calibration'
import type { AgentOperation, SceneNodes } from './types'

// What a person reads off a set of plans before building, measured rather than guessed: the same
// input always gives the same survey. Every threshold is a share of the building outline's long
// side, so a 2000 px building map and a small test map read alike.

type Pt = [number, number]
type Shape = {
  id: string
  line: boolean
  points: Pt[]
  x: number
  y: number
  w: number
  h: number
  strokeWidth: number
}

export type PlanRole = 'apartment' | 'core' | 'label' | 'ignore'
export type PlanSide = 'north' | 'south' | 'east' | 'west'
/** A balcony the survey missed: a box in plan pixels, and the side of the wall behind it. */
export type AddedBalcony = { box: [Pt, Pt]; against: PlanSide }
/** What the model corrected in a building map's reading; kept on the guide. */
export type PlanReading = {
  roles?: Record<string, PlanRole>
  addBalconies?: AddedBalcony[]
  /** A point inside each balcony step read wrongly (a bay window, a jog of the drawing). */
  dropBalconies?: Pt[]
}

export const readingOf = (guide: GuideNode): PlanReading =>
  (guide.metadata.planReading as PlanReading | undefined) ?? {}

/** Text is drawn as glyph shapes at most this share of the outline's long side. */
const LABEL_MAX = 0.022
/** Apartments are at least this share. Between the two sit cores: stairs, lifts, trash rooms. */
const APARTMENT_MIN = 0.06
/** A balcony steps out of the outline at most this deep and this long. */
const BALCONY_DEPTH_MAX = 0.03
const BALCONY_LENGTH_MAX = 0.12
/** Shallower than this, a step is a jog of the drawing (Victor floor 03: 3 px, 0.15 m). */
const BALCONY_DEPTH_MIN = 0.008
/** Two outlines this close, as a share of the map's size, are one drawn twice. */
const SAME_SPOT = 0.005
/** Floors whose apartments, cores and outline coincide this much are one family. */
const IDENTICAL = 0.98
const SIMILAR = 0.6
/** A unit plan fits an apartment when their footprints overlap this much, proportions agreeing. */
const FIT_MIN = 0.8
const ASPECT_TOLERANCE = 0.15
const GRID = 32

const round = (value: number) => Math.round(value * 100) / 100 || 0
const size = (shape: Shape) => Math.max(shape.w, shape.h)
const box = (shape: Pick<Shape, 'x' | 'y' | 'w' | 'h'>) => ({
  xPx: round(shape.x),
  yPx: round(shape.y),
  widthPx: round(shape.w),
  heightPx: round(shape.h),
})

function shapesOf(guide: GuideNode): Shape[] {
  const contours = (
    Array.isArray(guide.metadata.referenceContours) ? guide.metadata.referenceContours : []
  ) as ReferenceContour[]
  return contours.map((contour) => {
    const points = contour.points as Pt[]
    const xs = points.map((point) => point[0])
    const ys = points.map((point) => point[1])
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return {
      id: contour.id,
      line: !!contour.stroke,
      points,
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      strokeWidth: (contour as { strokeWidth?: number }).strokeWidth ?? 1,
    }
  })
}

function inside([px, py]: Pt, polygon: readonly Pt[]) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

const centre = (shape: Shape): Pt => [shape.x + shape.w / 2, shape.y + shape.h / 2]

/** The corners of a closed outline: repeated and collinear points dropped. */
function corners(points: readonly Pt[]): Pt[] {
  const ring = points.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(point[0] - points[index - 1]![0], point[1] - points[index - 1]![1]) > 0.5,
  )
  if (
    ring.length > 1 &&
    Math.hypot(ring[0]![0] - ring.at(-1)![0], ring[0]![1] - ring.at(-1)![1]) <= 0.5
  )
    ring.pop()
  return ring.filter((point, index) => {
    const before = ring[(index - 1 + ring.length) % ring.length]!
    const after = ring[(index + 1) % ring.length]!
    const cross =
      (point[0] - before[0]) * (after[1] - point[1]) -
      (point[1] - before[1]) * (after[0] - point[0])
    return Math.abs(cross) > 0.5
  })
}

function shapeName(points: readonly Pt[]) {
  const count = corners(points).length
  return count === 4 ? 'rectangle' : count === 6 ? 'L' : 'other'
}

const sameBox = (a: Shape, b: Shape) =>
  Math.abs(a.x - b.x) <= 1.5 &&
  Math.abs(a.y - b.y) <= 1.5 &&
  Math.abs(a.w - b.w) <= 1.5 &&
  Math.abs(a.h - b.h) <= 1.5

type Step = { corners: [Pt, Pt, Pt, Pt]; x: number; y: number; w: number; h: number; out: Pt }

/**
 * Balconies drawn as a short step out of the outline and back: three edges, out, along, back,
 * with the space between them inside the outline. Each step's four corners, in ring order.
 */
function outlineSteps(ring: readonly Pt[], long: number, outline: readonly Pt[]): Step[] {
  const steps: Step[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const c = ring[(i + 2) % ring.length]!
    const d = ring[(i + 3) % ring.length]!
    const out: Pt = [b[0] - a[0], b[1] - a[1]]
    const along: Pt = [c[0] - b[0], c[1] - b[1]]
    const back: Pt = [d[0] - c[0], d[1] - c[1]]
    const depth = Math.hypot(...out)
    const length = Math.hypot(...along)
    const straight =
      Math.abs(out[0] * along[0] + out[1] * along[1]) < 0.5 &&
      Math.abs(out[0] + back[0]) < 1 &&
      Math.abs(out[1] + back[1]) < 1
    if (!straight || depth < BALCONY_DEPTH_MIN * long || depth > BALCONY_DEPTH_MAX * long) continue
    if (length > BALCONY_LENGTH_MAX * long) continue
    const xs = [a[0], b[0], c[0], d[0]]
    const ys = [a[1], b[1], c[1], d[1]]
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    const w = Math.max(...xs) - x
    const h = Math.max(...ys) - y
    if (!inside([x + w / 2, y + h / 2], outline)) continue
    steps.push({ corners: [a, b, c, d], x, y, w, h, out })
    i += 2
  }
  return steps
}

/** The survey's balconies: each one's side, box, where it was read from, and the apartment behind. */
function balconyEntries(guide: GuideNode, map: MapReading) {
  return balconiesOf(guide, map).map(({ corners: [a, b], source, side, box: at }) => {
    // One step further in than the balcony's middle, towards the wall behind it.
    const behind: Pt = [
      at.x + at.w / 2 + (a[0] - b[0]) * 1.5,
      at.y + at.h / 2 + (a[1] - b[1]) * 1.5,
    ]
    const apartment = map.apartments.find((candidate) => inside(behind, candidate.points))
    return { side, ...box(at), source, ...(apartment ? { apartmentId: apartment.id } : {}) }
  })
}

const OPPOSITE: Record<PlanSide, PlanSide> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
}

/** An added balcony's corners in step order: from the wall out, along the front, back to the wall. */
function addedCorners({ box: [p, q], against }: AddedBalcony): [Pt, Pt, Pt, Pt] {
  const x0 = Math.min(p[0], q[0])
  const x1 = Math.max(p[0], q[0])
  const y0 = Math.min(p[1], q[1])
  const y1 = Math.max(p[1], q[1])
  if (against === 'east')
    return [
      [x1, y0],
      [x0, y0],
      [x0, y1],
      [x1, y1],
    ]
  if (against === 'west')
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]
  if (against === 'north')
    return [
      [x0, y0],
      [x0, y1],
      [x1, y1],
      [x1, y0],
    ]
  return [
    [x0, y1],
    [x0, y0],
    [x1, y0],
    [x1, y1],
  ]
}

const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5

function onEdge(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)
  return t > -0.001 && t < 1.001 && Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < 1.5
}

/** Drops repeated points and points where the outline turns straight back on itself. */
function withoutBacktracks(ring: Pt[]): Pt[] {
  let points = ring.filter((point, i) => !near(point, ring[(i + 1) % ring.length]!))
  let changed = true
  while (changed && points.length > 3) {
    changed = false
    for (let i = 0; i < points.length; i++) {
      const before = points[(i - 1 + points.length) % points.length]!
      const point = points[i]!
      const after = points[(i + 1) % points.length]!
      const u: Pt = [point[0] - before[0], point[1] - before[1]]
      const v: Pt = [after[0] - point[0], after[1] - point[1]]
      const lengths = Math.hypot(...u) * Math.hypot(...v)
      // Straight back on itself, within a few degrees: plans are drawn with noise.
      if (Math.abs(u[0] * v[1] - u[1] * v[0]) < 0.05 * lengths && u[0] * v[0] + u[1] * v[1] < 0) {
        points = points.filter((_, j) => j !== i)
        points = points.filter((p, j) => !near(p, points[(j + 1) % points.length]!))
        changed = true
        break
      }
    }
  }
  return points
}

/** A loggia inside the outline: the walls go round it, behind it, instead of along its front. */
function withDetour(ring: Pt[], [a, b, c, d]: [Pt, Pt, Pt, Pt]): Pt[] {
  const distance = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1])
  const onFront = ring.map((point) => onEdge(point, b, c))
  const n = ring.length
  const start = onFront.findIndex((on, i) => on && !onFront[(i - 1 + n) % n])
  if (start >= 0) {
    // The outline runs down the front in pieces: that stretch becomes the detour.
    let end = start
    while (onFront[(end + 1) % n] && (end + 1) % n !== start) end = (end + 1) % n
    const before = ring[(start - 1 + n) % n]!
    const detour = distance(before, b) <= distance(before, c) ? [b, a, d, c] : [c, d, a, b]
    const kept: Pt[] = []
    for (let k = (end + 1) % n; k !== start; k = (k + 1) % n) kept.push(ring[k]!)
    return withoutBacktracks([...kept, ...detour])
  }
  for (let i = 0; i < ring.length; i++) {
    const from = ring[i]!
    const to = ring[(i + 1) % ring.length]!
    if (!(onEdge(b, from, to) && onEdge(c, from, to))) continue
    const bFirst =
      Math.hypot(b[0] - from[0], b[1] - from[1]) <= Math.hypot(c[0] - from[0], c[1] - from[1])
    const detour = bFirst ? [b, a, d, c] : [c, d, a, b]
    return withoutBacktracks([...ring.slice(0, i + 1), ...detour, ...ring.slice(i + 1)])
  }
  return ring
}

type MapBalcony = {
  corners: [Pt, Pt, Pt, Pt]
  source: 'plan' | 'corrected'
  side: PlanSide
  box: { x: number; y: number; w: number; h: number }
}

/** A map's balconies: the steps of its outline the reading keeps, and those it added. */
function balconiesOf(guide: GuideNode, map: MapReading): MapBalcony[] {
  const reading = readingOf(guide)
  const drops = reading.dropBalconies ?? []
  const steps = outlineSteps(corners(map.envelope.points), map.long, map.envelope.points)
    .filter(
      (step) =>
        !drops.some(
          ([px, py]) =>
            px >= step.x && px <= step.x + step.w && py >= step.y && py <= step.y + step.h,
        ),
    )
    .map(
      (step): MapBalcony => ({
        corners: step.corners,
        source: 'plan',
        side:
          Math.abs(step.out[1]) > Math.abs(step.out[0])
            ? step.out[1] > 0
              ? 'south'
              : 'north'
            : step.out[0] > 0
              ? 'east'
              : 'west',
        box: { x: step.x, y: step.y, w: step.w, h: step.h },
      }),
    )
  const added = (reading.addBalconies ?? []).map((balcony): MapBalcony => {
    const cornersOf = addedCorners(balcony)
    const xs = cornersOf.map(([x]) => x)
    const ys = cornersOf.map(([, y]) => y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return {
      corners: cornersOf,
      source: 'corrected',
      side: OPPOSITE[balcony.against],
      box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
    }
  })
  return [...steps, ...added]
}

/**
 * A building map's outline without its balcony steps, and each balcony as a footprint, in image
 * pixels: the facade runs straight past a balcony step, the balcony stands outside it. A loggia the
 * reading added takes the walls round behind it (`outline`); the floor plate keeps its floor
 * (`plate`). Null when the plan is not a building map or has no balcony.
 */
export function buildingMapBalconies(guide: GuideNode): {
  outlineId: string
  outline: Pt[]
  plate: Pt[]
  balconies: Pt[][]
  /** The balconies stepping out of the outline, open on three sides (a loggia is not). */
  projecting: Pt[][]
} | null {
  const map = readGuide(guide)
  if (!map) return null
  const balconies = balconiesOf(guide, map)
  if (!balconies.length) return null
  const ring = corners(map.envelope.points)
  const stepped = new Set(
    balconies
      .filter((balcony) => balcony.source === 'plan')
      .flatMap((balcony) => [balcony.corners[1], balcony.corners[2]]),
  )
  const plate = ring.filter((point) => !stepped.has(point))
  const outline = balconies
    .filter((balcony) => balcony.source === 'corrected')
    .reduce((current, balcony) => withDetour(current, balcony.corners), plate)
  return {
    outlineId: map.envelope.id,
    outline,
    plate,
    balconies: balconies.map((balcony) => [...balcony.corners]),
    projecting: balconies
      .filter((balcony) => balcony.source === 'plan')
      .map((balcony) => [...balcony.corners]),
  }
}

type MapReading = {
  shapes: Shape[]
  envelope: Shape
  long: number
  labels: Shape[]
  apartments: Shape[]
  cores: Shape[]
  compared: Shape[]
}

/**
 * A building map: an outline holding at least four other areas. Null for any other plan. Shapes
 * are read by size unless the reading was corrected (correct_plan_reading) with a role.
 */
function readMap(all: Shape[], roles: Readonly<Record<string, PlanRole>> = {}): MapReading | null {
  const shapes = all.filter((shape) => roles[shape.id] !== 'ignore')
  const areas = shapes.filter((shape) => !shape.line)
  if (areas.length < 5) return null
  const envelope = areas.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b))
  const long = size(envelope)
  const within = areas.filter(
    (shape) => shape !== envelope && inside(centre(shape), envelope.points),
  )
  if (within.length < 4) return null
  const read = (shape: Shape, role: PlanRole, bySize: boolean) =>
    roles[shape.id] ? roles[shape.id] === role : bySize
  const labels = areas.filter(
    (shape) => shape !== envelope && read(shape, 'label', size(shape) <= LABEL_MAX * long),
  )
  // A map may draw an outline twice at the same spot: one apartment, not two (Victor run 10 counted
  // the doubles, and every floor came out a unit and a door short).
  const apartments = within
    .filter((shape) => read(shape, 'apartment', size(shape) >= APARTMENT_MIN * long))
    .filter(
      (shape, index, all) =>
        !all
          .slice(0, index)
          .some(
            (other) =>
              Math.abs(other.x - shape.x) <= SAME_SPOT * long &&
              Math.abs(other.y - shape.y) <= SAME_SPOT * long &&
              Math.abs(other.w - shape.w) <= SAME_SPOT * long &&
              Math.abs(other.h - shape.h) <= SAME_SPOT * long,
          ),
    )
  const coreSized = within.filter((shape) =>
    read(shape, 'core', size(shape) > LABEL_MAX * long && size(shape) < APARTMENT_MIN * long),
  )
  // What a core draws inside it (a stair's flights, a lift car) is the core's, not a core: read as
  // cores, the Victor's flights were walled in under the stair (run 9b).
  const cores = coreSized.filter(
    (shape) =>
      roles[shape.id] === 'core' ||
      !coreSized.some(
        (other) =>
          other !== shape &&
          other.w * other.h > shape.w * shape.h &&
          inside(centre(shape), other.points),
      ),
  )
  const compared = areas.filter((shape) => !labels.includes(shape))
  return { shapes, envelope, long, labels, apartments, cores, compared }
}

/** A building map as read, with the corrections kept on its guide. */
const readGuide = (guide: GuideNode) => readMap(shapesOf(guide), readingOf(guide).roles)

// ─── Unit footprints ──────────────────────────────────────────────────────────

type Grid = { cells: boolean[]; aspect: number }
type Box = { x: number; y: number; w: number; h: number }

function distanceToSegment([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * A unit plan's footprint: the space its walls (its heaviest lines) enclose. Walls leave gaps at
 * doors and windows, so every other line (door leaves, glazing) closes them too, and walls are
 * thickened to close what is left.
 */
function unitFootprint(shapes: Shape[]): (Grid & { walls: Box }) | null {
  const lines = shapes.filter((shape) => shape.line && shape.points.length > 1)
  if (!lines.length) return null
  const heaviest = Math.max(...lines.map((shape) => shape.strokeWidth))
  const walls = lines.filter((shape) => shape.strokeWidth >= heaviest - 0.05)
  const points = walls.flatMap((shape) => shape.points)
  const x0 = Math.min(...points.map((point) => point[0]))
  const y0 = Math.min(...points.map((point) => point[1]))
  const w = Math.max(...points.map((point) => point[0])) - x0
  const h = Math.max(...points.map((point) => point[1])) - y0
  const long = Math.max(w, h)
  if (long <= 0) return null
  const half = Math.max(heaviest / 2, 0.045 * long)
  const thin = Math.max(0.015 * long, 0.5)
  const cell = long / 96
  const columns = Math.ceil((w + 2 * half) / cell) + 2
  const rows = Math.ceil((h + 2 * half) / cell) + 2
  const left = x0 - half - cell
  const top = y0 - half - cell
  const wall = new Array<boolean>(columns * rows).fill(false)
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const p: Pt = [left + (column + 0.5) * cell, top + (row + 0.5) * cell]
      wall[row * columns + column] = lines.some((shape) => {
        const reach = walls.includes(shape) ? half : Math.max(shape.strokeWidth / 2, thin)
        return shape.points.some(
          (point, index) =>
            index > 0 && distanceToSegment(p, shape.points[index - 1]!, point) <= reach,
        )
      })
    }
  const outside = new Array<boolean>(columns * rows).fill(false)
  const queue: number[] = []
  for (let column = 0; column < columns; column++) queue.push(column, (rows - 1) * columns + column)
  for (let row = 0; row < rows; row++) queue.push(row * columns, row * columns + columns - 1)
  while (queue.length) {
    const index = queue.pop()!
    if (outside[index] || wall[index]) continue
    outside[index] = true
    const row = Math.floor(index / columns)
    const column = index % columns
    if (column > 0) queue.push(index - 1)
    if (column < columns - 1) queue.push(index + 1)
    if (row > 0) queue.push(index - columns)
    if (row < rows - 1) queue.push(index + columns)
  }
  let minRow = rows
  let maxRow = -1
  let minColumn = columns
  let maxColumn = -1
  for (let index = 0; index < outside.length; index++) {
    if (outside[index]) continue
    const row = Math.floor(index / columns)
    const column = index % columns
    minRow = Math.min(minRow, row)
    maxRow = Math.max(maxRow, row)
    minColumn = Math.min(minColumn, column)
    maxColumn = Math.max(maxColumn, column)
  }
  if (maxRow < 0) return null
  const spanColumns = maxColumn - minColumn + 1
  const spanRows = maxRow - minRow + 1
  const cells: boolean[] = []
  for (let row = 0; row < GRID; row++)
    for (let column = 0; column < GRID; column++) {
      const sourceRow = minRow + Math.floor(((row + 0.5) / GRID) * spanRows)
      const sourceColumn = minColumn + Math.floor(((column + 0.5) / GRID) * spanColumns)
      cells.push(!outside[sourceRow * columns + sourceColumn])
    }
  // The aspect of the walls themselves: the thickening that closes the doors widens a narrow plan
  // (the Victor's A6 read 0.49 for 0.437, and fitted no apartment, 2026-10-03).
  return { cells, aspect: w / (h || 1), walls: { x: x0, y: y0, w, h } }
}

function apartmentGrid(shape: Shape): Grid {
  const cells: boolean[] = []
  for (let row = 0; row < GRID; row++)
    for (let column = 0; column < GRID; column++)
      cells.push(
        inside(
          [shape.x + ((column + 0.5) / GRID) * shape.w, shape.y + ((row + 0.5) / GRID) * shape.h],
          shape.points,
        ),
      )
  return { cells, aspect: shape.w / (shape.h || 1) }
}

/**
 * The eight ways a plan can lie on a floor: `at` looks up the unit's cell for a turned cell; `place`
 * takes a point of the unit, as a share of its width and height, to the same share of the floor's.
 */
const TURNS: {
  name: string
  swaps: boolean
  at: (row: number, column: number) => [number, number]
  place: (u: number, v: number) => [number, number]
}[] = [
  { name: 'same', swaps: false, at: (r, c) => [r, c], place: (u, v) => [u, v] },
  { name: 'mirrored', swaps: false, at: (r, c) => [r, GRID - 1 - c], place: (u, v) => [1 - u, v] },
  {
    name: 'turned 180°',
    swaps: false,
    at: (r, c) => [GRID - 1 - r, GRID - 1 - c],
    place: (u, v) => [1 - u, 1 - v],
  },
  {
    name: 'mirrored and turned 180°',
    swaps: false,
    at: (r, c) => [GRID - 1 - r, c],
    place: (u, v) => [u, 1 - v],
  },
  { name: 'turned 90°', swaps: true, at: (r, c) => [GRID - 1 - c, r], place: (u, v) => [1 - v, u] },
  {
    name: 'turned 270°',
    swaps: true,
    at: (r, c) => [c, GRID - 1 - r],
    place: (u, v) => [v, 1 - u],
  },
  { name: 'mirrored and turned 90°', swaps: true, at: (r, c) => [c, r], place: (u, v) => [v, u] },
  {
    name: 'mirrored and turned 270°',
    swaps: true,
    at: (r, c) => [GRID - 1 - c, GRID - 1 - r],
    place: (u, v) => [1 - v, 1 - u],
  },
]

function bestTurn(unit: Grid, apartment: Grid) {
  let best: { name: string; score: number; place: (u: number, v: number) => Pt } | null = null
  for (const turn of TURNS) {
    const aspect = turn.swaps ? 1 / unit.aspect : unit.aspect
    if (Math.abs(Math.log(aspect / apartment.aspect)) > ASPECT_TOLERANCE) continue
    let both = 0
    let either = 0
    for (let row = 0; row < GRID; row++)
      for (let column = 0; column < GRID; column++) {
        const [r, c] = turn.at(row, column)
        const a = unit.cells[r * GRID + c]!
        const b = apartment.cells[row * GRID + column]!
        if (a && b) both++
        if (a || b) either++
      }
    const score = either ? both / either : 0
    if (!best || score > best.score) best = { name: turn.name, score, place: turn.place }
  }
  return best
}

// ─── The survey ───────────────────────────────────────────────────────────────

function keysOf(reading: MapReading) {
  const keys = new Map<string, string>()
  for (const shape of reading.compared)
    keys.set(
      [shape.x, shape.y, shape.w, shape.h].map((value) => Math.round(value / 2)).join(':'),
      shape.id,
    )
  return keys
}

const planGuides = (nodes: SceneNodes) =>
  Object.values(nodes).filter(
    (node): node is GuideNode =>
      node.type === 'guide' &&
      typeof (node.metadata.planReference as { width?: unknown } | undefined)?.width === 'number',
  )

type Placement = {
  floorGuide: GuideNode
  apartmentId: string
  turn: string
  score: number
  /** A point of the unit plan, in its pixels, to where it lands on the floor's map, in the map's. */
  toMap: (point: Pt) => Pt
}

function placementsOn(
  unitShapes: Shape[],
  maps: readonly { guide: GuideNode; map: MapReading | null }[],
): Placement[] {
  const footprint = unitFootprint(unitShapes)
  if (!footprint) return []
  const { walls } = footprint
  const placements: Placement[] = []
  for (const floor of maps)
    for (const apartment of floor.map?.apartments ?? []) {
      const best = bestTurn(footprint, apartmentGrid(apartment))
      if (!best || best.score < FIT_MIN) continue
      placements.push({
        floorGuide: floor.guide,
        apartmentId: apartment.id,
        turn: best.name,
        score: best.score,
        toMap: ([x, y]) => {
          const [u, v] = best.place((x - walls.x) / (walls.w || 1), (y - walls.y) / (walls.h || 1))
          return [apartment.x + u * apartment.w, apartment.y + v * apartment.h]
        },
      })
    }
  return placements
}

export const isBuildingMap = (guide: GuideNode) => !!readGuide(guide)

export const BUILDING_MAP_GROUPS = ['outline', 'apartments', 'cores'] as const
export type BuildingMapGroup = (typeof BUILDING_MAP_GROUPS)[number]

/** A building map's shape ids by what the survey reads them as; null for any other plan. */
export function buildingMapGroups(guide: GuideNode): Record<BuildingMapGroup, string[]> | null {
  const map = readGuide(guide)
  if (!map) return null
  return {
    outline: [map.envelope.id],
    apartments: map.apartments.map((shape) => shape.id),
    cores: map.cores.map((shape) => shape.id),
  }
}

/** Every apartment of every building map a unit plan fits, and how it lies there. */
export function unitPlacements(nodes: SceneNodes, unit: GuideNode): Placement[] {
  const maps = planGuides(nodes)
    .map((guide) => ({ guide, map: readGuide(guide) }))
    .filter((entry) => entry.map)
  return placementsOn(shapesOf(unit), maps)
}

type MapEntry = { guide: GuideNode; frame: string }

/** Families: floors in one frame whose outline, apartments and cores coincide; each guide's lead. */
function familyLeads(
  maps: readonly MapEntry[],
  keys: ReadonlyMap<string, ReadonlyMap<string, string>>,
) {
  const familyOf = new Map<string, string>()
  for (const [index, entry] of maps.entries()) {
    if (familyOf.has(entry.guide.id)) continue
    familyOf.set(entry.guide.id, entry.guide.id)
    for (const other of maps.slice(index + 1)) {
      if (familyOf.has(other.guide.id) || other.frame !== entry.frame) continue
      const a = keys.get(entry.guide.id)!
      const b = keys.get(other.guide.id)!
      const shared = [...a.keys()].filter((key) => b.has(key)).length
      const jaccard = shared / (a.size + b.size - shared)
      if (jaccard >= IDENTICAL) familyOf.set(other.guide.id, entry.guide.id)
    }
  }
  return familyOf
}

/** The building maps the survey reads as one family of floors, by guide id, families of two or more. */
export function planFamilies(nodes: SceneNodes): GuideNode[][] {
  const maps = planGuides(nodes).flatMap((guide) => {
    const map = readGuide(guide)
    const reference = guide.metadata.planReference as { width: number; height: number }
    return map ? [{ guide, frame: `${reference.width}x${reference.height}`, map }] : []
  })
  const familyOf = familyLeads(
    maps,
    new Map(maps.map((entry) => [entry.guide.id, keysOf(entry.map)])),
  )
  return [...new Set(familyOf.values())]
    .map((lead) =>
      maps.filter((entry) => familyOf.get(entry.guide.id) === lead).map((e) => e.guide),
    )
    .filter((family) => family.length > 1)
}

export const surveyPlanReferences: AgentOperation<{ guideIds?: string[] }> = (nodes, input) => {
  const guides = input.guideIds
    ? input.guideIds.map((id) => requirePlanGuide(nodes, id).guide)
    : planGuides(nodes)
  if (!guides.length) refuse('no_plans', 'No plan is placed yet: import_plan_reference first.')

  const read = guides.map((guide) => {
    const shapes = shapesOf(guide)
    const reference = guide.metadata.planReference as { width: number; height: number }
    const map = readMap(shapes, readingOf(guide).roles)
    return { guide, shapes, frame: `${reference.width}x${reference.height}`, map }
  })

  const maps = read.filter((entry) => entry.map)
  const keys = new Map(maps.map((entry) => [entry.guide.id, keysOf(entry.map!)]))
  const familyOf = familyLeads(maps, keys)
  const similar: Record<string, unknown>[] = []
  const families = [...new Set(familyOf.values())].map((lead) => ({
    guideIds: maps.filter((entry) => familyOf.get(entry.guide.id) === lead).map((e) => e.guide.id),
  }))
  const leads = families.map((family) => family.guideIds[0]!)
  for (const [index, lead] of leads.entries())
    for (const other of leads.slice(index + 1)) {
      const a = keys.get(lead)!
      const b = keys.get(other)!
      if (
        read.find((e) => e.guide.id === lead)!.frame !==
        read.find((e) => e.guide.id === other)!.frame
      )
        continue
      const shared = [...a.keys()].filter((key) => b.has(key)).length
      const jaccard = shared / (a.size + b.size - shared)
      if (jaccard < SIMILAR) continue
      const differing = [
        ...new Set([
          ...[...a.entries()].filter(([key]) => !b.has(key)).map(([, id]) => id),
          ...[...b.entries()].filter(([key]) => !a.has(key)).map(([, id]) => id),
        ]),
      ].slice(0, 20)
      similar.push({ guideIds: [lead, other], similarity: round(jaccard), differing })
    }

  const plans = read.map(({ guide, shapes, map }) => {
    const head = {
      guideId: guide.id,
      name: guide.name,
      levelId: guide.parentId,
      calibrated: !!guide.scaleReference,
    }
    if (map) {
      const lead = familyOf.get(guide.id)
      if (lead && lead !== guide.id) return { ...head, kind: 'building-map', sameAs: lead }
      return {
        ...head,
        kind: 'building-map',
        envelope: { id: map.envelope.id, ...box(map.envelope) },
        apartments: map.apartments.map((shape) => ({
          id: shape.id,
          shape: shapeName(shape.points),
          ...box(shape),
        })),
        cores: map.cores.map((shape) => ({ id: shape.id, ...box(shape) })),
        balconies: balconyEntries(guide, map),
        labels: map.labels.length,
        drawnTwice: shapes.filter(
          (shape) => shape.line && shapes.some((area) => !area.line && sameBox(area, shape)),
        ).length,
      }
    }
    const footprint = unitFootprint(shapes)
    return {
      ...head,
      kind: footprint ? 'unit-plan' : 'plan',
      contours: shapes.length,
      ...(footprint ? { footprintAspect: round(footprint.aspect) } : {}),
    }
  })

  // Where each unit plan fits: the eight ways it can lie on each apartment of each map.
  const unitFits = read
    .filter((entry) => !entry.map)
    .flatMap((unit) =>
      placementsOn(unit.shapes, maps).map(({ floorGuide, apartmentId, turn, score }) => ({
        unitGuideId: unit.guide.id,
        floorGuideId: floorGuide.id,
        apartmentId,
        turn,
        score: round(score),
      })),
    )

  return {
    result: {
      plans,
      families,
      similar,
      unitFits: unitFits.slice(0, 120),
      next: 'Tell the user the plan (floor families, where the scale comes from, where each unit goes, the facade kinds in the photo), then build from general to particular: massing on every floor, envelope, layout, interiors.',
    },
  }
}

/**
 * Walls from a building map need a selection: its outlines are footprints, and it draws its text,
 * cores and some outlines twice as shapes too. Both agent surfaces check before building.
 */
export function requireWallSelection(
  nodes: SceneNodes,
  {
    guideIds,
    kind,
    shapeIds,
    select,
  }: { guideIds: string[]; kind: string; shapeIds?: string[]; select?: readonly string[] },
) {
  if (kind !== 'walls' || shapeIds?.length || select?.length) return
  for (const id of guideIds) {
    const guide = nodes[id]
    if (guide?.type !== 'guide' || !readGuide(guide)) continue
    refuse(
      'building_map_needs_selection',
      `Plan ${id} is a building map: its outlines are footprints, and its text and symbols are drawn as shapes too. Build apartments as unit or zone and the floor as slab; for walls, pass select (outline, apartments, cores) or shapeIds (survey_plan_references lists them).`,
      { guideId: id },
    )
  }
}
