import { refuse } from '../agent-tools/refusal'
import {
  isRectilinear,
  lengthOnEdges,
  OPEN_PLAN_ROOMS,
  outlineEdges,
  overlapOnEdge,
  type Pt,
  polygonArea,
  polygonRects,
  type Random,
  type Rect,
  type RoomType,
  rectArea,
  roomContacts,
  roomGap,
  type Segment,
  seededRandom,
  sharedSegment,
  TOL,
  type UnitDoor,
  type UnitLayout,
  type UnitRoom,
  type UnitSpace,
} from './unit-layout'
import { UNIT_RULES } from './unit-layout-verify'

/**
 * Funnel stage 2: seeded slicing along a small apartment grammar. The outline's main rectangle is
 * cut into a day zone (living, kitchen, pantry) and a night zone. A hall strip runs through the
 * night zone with rows of rooms along it (combs), and an optional column caps its far end; with
 * no hall, one row lines up against the day zone. A bedroom's walk-in, en-suite bath or closet is
 * cut from its bedroom's slice. When the entry would land on a private room, a corridor strip
 * links it to the hall. Areas, proportions, orders and door positions are drawn; the verify
 * stage judges each result.
 */

export type OptionalRoom = 'walk_in' | 'laundry' | 'pantry' | 'closet'
/**
 * The program: bedrooms and bathrooms, and optionally how many of each optional room (0 forbids
 * one). An optional room the brief does not count is drawn at random.
 */
export type UnitBrief = {
  bedrooms: number
  bathrooms: number
  rooms?: Partial<Record<OptionalRoom, number>>
}
export type GenerateOptions = { seed: number; count: number }

/** The smallest credible areas (m²): below their sum, the brief cannot fit. */
const MIN_AREA = { bedroom: 8, bathroom: 3.2, kitchen: 4.5, living: 12, entry: 1.5 }
/** How often an uncounted optional room is drawn, and its area range (m²). */
const OPTIONAL: Record<OptionalRoom, { chance: number; area: [number, number] }> = {
  walk_in: { chance: 0.5, area: [2.2, 4] },
  laundry: { chance: 0.5, area: [1, 2] },
  pantry: { chance: 0.3, area: [0.6, 1.2] },
  closet: { chance: 0.3, area: [0.8, 1.5] },
}
/** The narrowest a slice is cut for each room, when the row has room for it. */
const MIN_SIDE: Partial<Record<RoomType, number>> = {
  bedroom: 2.6,
  bathroom: 1.6,
  walk_in: 1.2,
  laundry: 0.9,
  closet: 0.8,
  pantry: 0.8,
}
/** A row of rooms deeper than this cuts them into strips. */
const MAX_DEPTH = 4.8
const DOOR = 0.8
const ENTRY_DOOR = 0.9
const JAMB = 0.05
const GRID = 0.05
const ATTEMPTS = 12
/** Where a room's door may open, best tier first. Open-plan rooms open onto each other instead. */
const DOOR_TO: Partial<Record<RoomType, RoomType[][]>> = {
  bedroom: [['hall', 'entry'], ['living']],
  bathroom: [['hall', 'entry'], ['bedroom']],
  walk_in: [['bedroom'], ['hall', 'entry']],
  closet: [['hall', 'entry', 'bedroom']],
  pantry: [['kitchen'], ['hall', 'entry', 'living']],
  laundry: [
    ['hall', 'entry'],
    ['kitchen', 'bathroom'],
  ],
}

type Spec = { id: string; type: RoomType; area: number }
/** A room and the rooms cut from its slice (a bedroom's walk-in, en-suite, closet). */
type Item = { anchor: Spec; satellites: Spec[]; nextToCap?: boolean }
type Axis = 'x' | 'z'
type End = 'lo' | 'hi'
/** Rooms side by side along `axis`, each reaching circulation at its `open` end across it. */
type Row = { rect: Rect; axis: Axis; open: End; items: Item[] }

const clean = (v: number) => Math.round(v * 1e6) / 1e6
const snap = (v: number) => clean(Math.round(v / GRID) * GRID)
const lo = (r: Rect, a: Axis) => (a === 'x' ? r[0] : r[1])
const hi = (r: Rect, a: Axis) => (a === 'x' ? r[2] : r[3])
const span = (r: Rect, a: Axis) => hi(r, a) - lo(r, a)
const cross = (a: Axis): Axis => (a === 'x' ? 'z' : 'x')
const band = (r: Rect, a: Axis, from: number, to: number): Rect =>
  a === 'x' ? [from, r[1], to, r[3]] : [r[0], from, r[2], to]
const segLength = (s: Segment) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])
const itemArea = (item: Item) => item.anchor.area + item.satellites.reduce((s, x) => s + x.area, 0)
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const union = (p: Rect, q: Rect): Rect => [
  Math.min(p[0], q[0]),
  Math.min(p[1], q[1]),
  Math.max(p[2], q[2]),
  Math.max(p[3], q[3]),
]
/** The thin strip along one end of a rectangle, to ask what lies there. */
const endStrip = (r: Rect, a: Axis, end: End) =>
  end === 'lo' ? band(r, a, lo(r, a), lo(r, a) + GRID) : band(r, a, hi(r, a) - GRID, hi(r, a))

/**
 * Consecutive slices along an axis, sized by weight; a slice under its minimum takes the
 * difference from the others' slack when there is enough of it. Cuts land on the grid.
 */
function slices(r: Rect, a: Axis, parts: { weight: number; min?: number }[]): Rect[] {
  const length = span(r, a)
  const total = parts.reduce((s, p) => s + p.weight, 0)
  let widths = parts.map((p) => (p.weight / total) * length)
  for (let pass = 0; pass < 3; pass++) {
    const deficit = widths.reduce((s, w, i) => s + Math.max(0, (parts[i]!.min ?? 0) - w), 0)
    const slack = widths.reduce((s, w, i) => s + Math.max(0, w - (parts[i]!.min ?? 0)), 0)
    if (deficit <= TOL || slack <= deficit) break
    widths = widths.map((w, i) => {
      const min = parts[i]!.min ?? 0
      return w < min ? min : w - ((w - min) / slack) * deficit
    })
  }
  const start = lo(r, a)
  const out: Rect[] = []
  let from = start
  let sum = 0
  widths.forEach((w, i) => {
    sum += w
    const left = widths.length - 1 - i
    const to = left
      ? clean(clamp(start + snap(sum), from + GRID, hi(r, a) - left * GRID))
      : hi(r, a)
    out.push(band(r, a, from, to))
    from = to
  })
  return out
}

/** The outside wall's straight lengths: outside edges in line, one after the other, are one. */
function outsideRuns(space: UnitSpace): number[] {
  const runs: { direction: string; length: number; outside: boolean }[] = []
  for (const { a, b, kind } of outlineEdges(space)) {
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
    const direction = `${Math.abs(dx) < TOL ? 0 : Math.sign(dx)},${Math.abs(dz) < TOL ? 0 : Math.sign(dz)}`
    const length = Math.hypot(dx, dz)
    const last = runs.at(-1)
    if (kind === 'outside' && last?.outside && last.direction === direction) last.length += length
    else runs.push({ direction, length, outside: kind === 'outside' })
  }
  const [first, last] = [runs[0], runs.at(-1)]
  if (runs.length > 1 && first?.outside && last?.outside && first.direction === last.direction) {
    first.length += last.length
    runs.pop()
  }
  return runs.flatMap((run) => (run.outside ? [run.length] : []))
}

/** Up to `count` layouts: a draw that fails twelve times in a row is left out, not forced. */
export function generateUnitLayouts(
  space: UnitSpace,
  brief: UnitBrief,
  { seed, count }: GenerateOptions,
): UnitLayout[] {
  if (!isRectilinear(space.outline))
    refuse(
      'outline_not_rectilinear',
      'The unit guesser lays out rectilinear units only; this outline has a slanted or curved edge.',
    )
  if (space.edges[space.entryEdge] !== 'shared')
    refuse(
      'entry_edge_not_shared',
      `Outline edge ${space.entryEdge} is ${space.edges[space.entryEdge] ?? 'missing'}; the entry door goes on a wall shared with a corridor or core.`,
    )
  const area = Math.round(polygonArea(space.outline) * 100) / 100
  const needed =
    Math.round(
      (brief.bedrooms * MIN_AREA.bedroom +
        brief.bathrooms * MIN_AREA.bathroom +
        MIN_AREA.kitchen +
        MIN_AREA.living +
        MIN_AREA.entry) *
        100,
    ) / 100
  if (needed > area)
    refuse(
      'brief_does_not_fit',
      `A ${area} m² unit cannot hold ${brief.bedrooms} bedrooms and ${brief.bathrooms} bathrooms: with a kitchen, a living room and an entry they need at least ${needed} m².`,
      { area, needed },
    )
  const facade = outsideRuns(space)
  const outsideWall = Math.round(facade.reduce((sum, run) => sum + run, 0) * 10) / 10
  const windows = facade.reduce(
    (sum, run) =>
      sum +
      (run >= UNIT_RULES.bedroomWidth
        ? Math.floor(run / UNIT_RULES.bedroomWidth + 1e-6)
        : run >= UNIT_RULES.window
          ? 1
          : 0),
    0,
  )
  if (brief.bedrooms > windows)
    refuse(
      'not_enough_facade',
      `A unit with ${outsideWall} m of outside wall gives a window to ${windows} bedroom${windows === 1 ? '' : 's'} at most (a bedroom is at least ${UNIT_RULES.bedroomWidth} m wide); ${brief.bedrooms} bedrooms do not fit. Ask for fewer bedrooms.`,
      { outsideWall, windows },
    )
  const regions = polygonRects(space.outline)
  const rng = seededRandom(seed)
  return Array.from({ length: count }).flatMap((_, i) => {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const layout = drawLayout(space, regions, brief, area, rng, `${seed}-${i}`)
      if (layout) return [layout]
    }
    return []
  })
}

function drawProgram(brief: UnitBrief, area: number, rng: Random): Spec[] {
  const specs: Spec[] = []
  const add = (type: RoomType, roomArea: number) => {
    const n = specs.filter((s) => s.type === type).length + 1
    specs.push({ id: `${type}${n}`, type, area: roomArea })
  }
  for (let b = 0; b < brief.bedrooms; b++)
    add('bedroom', b === 0 ? rng.between(11, 15) : rng.between(9, 13))
  for (let b = 0; b < brief.bathrooms; b++) add('bathroom', rng.between(3.6, 5.5))
  add('kitchen', rng.between(5, 9))
  add('entry', rng.between(2, 5))
  if (rng.chance(0.75)) add('hall', rng.between(4, 8))
  for (const [
    type,
    {
      chance,
      area: [min, max],
    },
  ] of Object.entries(OPTIONAL) as [OptionalRoom, (typeof OPTIONAL)[OptionalRoom]][]) {
    const pinned = brief.rooms?.[type]
    const n = pinned ?? (rng.chance(chance) && (type !== 'walk_in' || brief.bedrooms > 0) ? 1 : 0)
    for (let i = 0; i < n; i++) add(type, rng.between(min, max))
  }
  const optional: RoomType[] = ['closet', 'pantry', 'laundry', 'walk_in', 'hall'].filter(
    (type) => brief.rooms?.[type as OptionalRoom] === undefined,
  ) as RoomType[]
  const rest = () => area - specs.reduce((sum, s) => sum + s.area, 0)
  for (const type of optional) {
    if (rest() >= MIN_AREA.living) break
    const index = specs.findIndex((s) => s.type === type)
    if (index >= 0) specs.splice(index, 1)
  }
  if (rest() < MIN_AREA.living) {
    const scale = (area - MIN_AREA.living) / (area - rest())
    for (const s of specs) s.area *= scale
  }
  add('living', rest())
  return specs
}

/** Bedrooms become suites with their satellites; the other private rooms stand alone. */
function drawItems(specs: Spec[], rng: Random) {
  const of = (type: RoomType) => specs.filter((s) => s.type === type)
  const suites: Item[] = of('bedroom').map((anchor) => ({ anchor, satellites: [] }))
  const services: Item[] = []
  const alone = (anchor: Spec) => services.push({ anchor, satellites: [] })
  const host = () => (rng.chance(0.7) ? suites[0]! : rng.pick(suites))
  for (const s of of('walk_in')) suites.length ? host().satellites.push(s) : alone(s)
  of('bathroom').forEach((s, i) => {
    const ensuite =
      i === 0 && suites.length > 0 && rng.chance(of('bathroom').length > 1 ? 0.7 : 0.2)
    ensuite ? host().satellites.push(s) : alone(s)
  })
  for (const s of of('closet'))
    suites.length && rng.chance(0.5) ? host().satellites.push(s) : alone(s)
  for (const s of of('laundry')) alone(s)
  return {
    day: specs.filter((s) => s.type === 'living' || s.type === 'kitchen' || s.type === 'pantry'),
    suites,
    services,
    hall: of('hall')[0],
    entry: of('entry')[0]!,
  }
}

function shuffle<T>(items: T[], rng: Random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}

const part = (s: Spec) => ({ weight: s.area, min: MIN_SIDE[s.type] })

const minSide = (s: Spec) => MIN_SIDE[s.type] ?? 1

/**
 * Where a suite's satellites go: beyond the bedroom, away from circulation (when the row is deep
 * enough and that side is not the facade), or beside it along the row.
 */
const canGoFar = (item: Item, deep: number, farIsFacade: boolean) =>
  item.satellites.length > 0 &&
  !farIsFacade &&
  deep - minSide(item.anchor) >= Math.max(...item.satellites.map(minSide)) - TOL

/** The width an item needs along its row. */
function itemMin(item: Item, mode: 'far' | 'beside') {
  const satellites = item.satellites.reduce((sum, s) => sum + minSide(s), 0)
  if (!item.satellites.length) return MIN_SIDE[item.anchor.type]
  return mode === 'far'
    ? Math.max(minSide(item.anchor), satellites)
    : minSide(item.anchor) + satellites
}

/** The anchor keeps the open end; satellites go beyond it, or beside it along the row. */
function fillItem(
  item: Item,
  slice: Rect,
  axis: Axis,
  open: End,
  mode: 'far' | 'beside',
  rng: Random,
  out: Map<string, Rect>,
) {
  if (!item.satellites.length) {
    out.set(item.anchor.id, slice)
    return
  }
  if (mode === 'far') {
    const depth = cross(axis)
    const deep = span(slice, depth)
    const satelliteMin = Math.max(...item.satellites.map(minSide))
    const reach = snap(
      clamp((item.anchor.area / itemArea(item)) * deep, minSide(item.anchor), deep - satelliteMin),
    )
    const near = open === 'lo' ? lo(slice, depth) : hi(slice, depth)
    const cut = clean(open === 'lo' ? near + reach : near - reach)
    out.set(
      item.anchor.id,
      open === 'lo' ? band(slice, depth, near, cut) : band(slice, depth, cut, near),
    )
    const far =
      open === 'lo'
        ? band(slice, depth, cut, hi(slice, depth))
        : band(slice, depth, lo(slice, depth), cut)
    const parts = slices(far, axis, item.satellites.map(part))
    item.satellites.forEach((s, i) => {
      out.set(s.id, parts[i]!)
    })
    return
  }
  const order = rng.chance(0.5)
    ? [item.anchor, ...item.satellites]
    : [...item.satellites, item.anchor]
  const parts = slices(slice, axis, order.map(part))
  order.forEach((s, i) => {
    out.set(s.id, parts[i]!)
  })
}

/** False when the row cannot give every room its minimum width or depth: the draw is retried. */
function fillRow(row: Row, space: UnitSpace, rng: Random, out: Map<string, Rect>) {
  const far: End = row.open === 'lo' ? 'hi' : 'lo'
  const farIsFacade =
    lengthOnEdges([endStrip(row.rect, cross(row.axis), far)], space, ['outside']) > 0.5
  const deep = span(row.rect, cross(row.axis))
  const modes = row.items.map((it): 'far' | 'beside' =>
    canGoFar(it, deep, farIsFacade) && rng.chance(0.6) ? 'far' : 'beside',
  )
  const need = () => row.items.reduce((sum, it, i) => sum + (itemMin(it, modes[i]!) ?? 0), 0)
  for (let i = 0; i < row.items.length && need() > span(row.rect, row.axis); i++)
    if (canGoFar(row.items[i]!, deep, farIsFacade)) modes[i] = 'far'
  if (need() > span(row.rect, row.axis) + TOL) return false
  if (row.items.some((it, i) => modes[i] === 'beside' && minSide(it.anchor) > deep + TOL))
    return false
  const parts = slices(
    row.rect,
    row.axis,
    row.items.map((it, i) => ({
      weight: itemArea(it) * rng.between(0.85, 1.15),
      min: itemMin(it, modes[i]!),
    })),
  )
  row.items.forEach((it, i) => {
    fillItem(it, parts[i]!, row.axis, row.open, modes[i]!, rng, out)
  })
  return true
}

/** Items into consecutive pieces, in order, roughly by area; null when nothing can take them. */
function distribute(items: Item[], pieces: Rect[]): Item[][] | null {
  if (!pieces.length) return items.length ? null : []
  const areas = pieces.map(rectArea)
  const scale =
    areas.reduce((s, a) => s + a, 0) /
    Math.max(
      1e-9,
      items.reduce((s, it) => s + itemArea(it), 0),
    )
  const result: Item[][] = pieces.map(() => [])
  let k = 0
  let used = 0
  for (const item of items) {
    const size = itemArea(item) * scale
    if (k < pieces.length - 1 && used + size / 2 > areas[k]!) {
      k++
      used = 0
    }
    result[k]!.push(item)
    used += size
  }
  return result
}

/** The kitchen strip, on the side nearest the wet rooms most of the time; a pantry off its end. */
function fillDay(rect: Rect, day: Spec[], wet: Rect[], rng: Random, out: Map<string, Rect>) {
  const living = day.find((s) => s.type === 'living')!
  const kitchen = day.find((s) => s.type === 'kitchen')!
  const pantry = day.find((s) => s.type === 'pantry')
  const total = day.reduce((s, x) => s + x.area, 0)
  const share = clamp(
    ((kitchen.area + (pantry?.area ?? 0)) / total) * rng.between(0.85, 1.15),
    0.15,
    0.5,
  )
  const options: [Rect, Rect][] = []
  for (const axis of ['x', 'z'] as const) {
    const reach = snap(Math.max(1.6, share * span(rect, axis)))
    if (reach >= span(rect, axis) - 2) continue
    options.push([
      band(rect, axis, lo(rect, axis), lo(rect, axis) + reach),
      band(rect, axis, lo(rect, axis) + reach, hi(rect, axis)),
    ])
    options.push([
      band(rect, axis, hi(rect, axis) - reach, hi(rect, axis)),
      band(rect, axis, lo(rect, axis), hi(rect, axis) - reach),
    ])
  }
  if (!options.length) {
    out.set(living.id, rect)
    out.set(kitchen.id, rect)
    return
  }
  const gap = ([k]: [Rect, Rect]) =>
    wet.length ? Math.min(...wet.map((w) => roomGap({ rects: [k] }, { rects: [w] }))) : 0
  const nearest = options.reduce((p, q) => (gap(q) < gap(p) ? q : p))
  const [k, l] = rng.chance(0.7) ? nearest : rng.pick(options)
  out.set(living.id, l)
  if (!pantry) {
    out.set(kitchen.id, k)
    return
  }
  const along: Axis = span(k, 'x') >= span(k, 'z') ? 'x' : 'z'
  const order = rng.chance(0.5) ? [kitchen, pantry] : [pantry, kitchen]
  const parts = slices(k, along, order.map(part))
  order.forEach((s, i) => {
    out.set(s.id, parts[i]!)
  })
}

type Night = { rows: Row[]; hall?: Rect; stacks: Row[]; along: Axis }

function drawNight(
  N: Rect,
  splitAxis: Axis,
  dayFirst: boolean,
  hasHall: boolean,
  facadeAt: (strip: Rect) => boolean,
  rng: Random,
): Night | null {
  const toDay: End = dayFirst ? 'lo' : 'hi'
  const t = snap(rng.between(1, 1.3))
  const sideways = cross(splitAxis)
  if (!hasHall) {
    if (span(N, splitAxis) > MAX_DEPTH) return null
    return {
      rows: [{ rect: N, axis: sideways, open: toDay, items: [] }],
      stacks: [],
      along: sideways,
    }
  }
  const lengthwise = span(N, splitAxis) >= 3 && rng.chance(0.75)
  if (!lengthwise) {
    if (span(N, splitAxis) - t > MAX_DEPTH) return null
    const n0 = lo(N, splitAxis)
    const n1 = hi(N, splitAxis)
    return {
      rows: [
        {
          rect: dayFirst ? band(N, splitAxis, n0 + t, n1) : band(N, splitAxis, n0, n1 - t),
          axis: sideways,
          open: toDay,
          items: [],
        },
      ],
      hall: dayFirst ? band(N, splitAxis, n0, n0 + t) : band(N, splitAxis, n1 - t, n1),
      stacks: [],
      along: sideways,
    }
  }
  const along = splitAxis
  const depth = sideways
  let body = N
  let cap: Rect | null = null
  if (span(N, along) >= 6 && rng.chance(0.45)) {
    const w = snap(rng.between(1.5, 2.3))
    cap = dayFirst
      ? band(N, along, hi(N, along) - w, hi(N, along))
      : band(N, along, lo(N, along), lo(N, along) + w)
    body = dayFirst
      ? band(N, along, lo(N, along), hi(N, along) - w)
      : band(N, along, lo(N, along) + w, hi(N, along))
  }
  const d0 = lo(N, depth)
  const d1 = hi(N, depth)
  const d = d1 - d0
  let h0: number
  // The facade side holds the bedrooms: it gets the deeper row.
  const facadeLo = facadeAt(endStrip(N, depth, 'lo'))
  const facadeHi = facadeAt(endStrip(N, depth, 'hi'))
  const [loMin, hiMin] =
    facadeHi && !facadeLo ? [1.5, 2.7] : [2.7, facadeLo && !facadeHi ? 1.5 : 2.7]
  const aMin = Math.max(loMin, d - t - MAX_DEPTH)
  const aMax = Math.min(MAX_DEPTH, d - t - hiMin)
  const single = d - t <= MAX_DEPTH
  if (aMin <= aMax && (!single || rng.chance(0.6))) h0 = d0 + snap(rng.between(aMin, aMax))
  else if (single) h0 = rng.chance(0.5) ? d0 : d1 - t
  else return null
  const h1 = clean(h0 + t)
  const rows: Row[] = []
  const stacks: Row[] = []
  if (h0 - d0 > GRID) {
    rows.push({ rect: band(body, depth, d0, h0), axis: along, open: 'hi', items: [] })
    if (cap) stacks.push({ rect: band(cap, depth, d0, h0), axis: depth, open: 'hi', items: [] })
  }
  if (d1 - h1 > GRID) {
    rows.push({ rect: band(body, depth, h1, d1), axis: along, open: 'lo', items: [] })
    if (cap) stacks.push({ rect: band(cap, depth, h1, d1), axis: depth, open: 'lo', items: [] })
  }
  return { rows, hall: band(N, depth, h0, h1), stacks, along }
}

function drawLayout(
  space: UnitSpace,
  regions: Rect[],
  brief: UnitBrief,
  area: number,
  rng: Random,
  id: string,
): UnitLayout | null {
  const entryEdge = outlineEdges(space)[space.entryEdge]!
  const main = regions.reduce((p, q) => (rectArea(q) > rectArea(p) ? q : p))
  const entryRegion = regions.find((r) => overlapOnEdge(r, entryEdge)) ?? main
  const annex = entryRegion === main ? null : entryRegion
  const specs = drawProgram(brief, area, rng)
  const { day, suites, services, hall, entry } = drawItems(specs, rng)
  const types = new Map<string, RoomType>(specs.map((s) => [s.id, s.type]))
  const out = new Map<string, Rect>()
  const outside = (r: Rect) => lengthOnEdges([r], space, ['outside'])

  const long: Axis = span(main, 'x') >= span(main, 'z') ? 'x' : 'z'
  const splitAxis = rng.chance(0.75) ? long : cross(long)
  const dayArea = day.reduce((s, x) => s + x.area, 0)
  const nightArea =
    [...suites, ...services].reduce((s, it) => s + itemArea(it), 0) + (hall ? 0.12 * area : 0)
  const dayShare = clamp((dayArea / (dayArea + nightArea)) * rng.between(0.9, 1.1), 0.2, 0.75)
  const dayFirst = rng.chance(0.5)
  const m0 = lo(main, splitAxis)
  const m1 = hi(main, splitAxis)
  const at = clean(m0 + snap((dayFirst ? dayShare : 1 - dayShare) * (m1 - m0)))
  const D = dayFirst ? band(main, splitAxis, m0, at) : band(main, splitAxis, at, m1)
  const N = dayFirst ? band(main, splitAxis, at, m1) : band(main, splitAxis, m0, at)
  const night = drawNight(N, splitAxis, dayFirst, !!hall, (strip) => outside(strip) > 0.5, rng)
  if (!night) return null
  let hallRect = night.hall
  const corridors: Rect[] = []

  // Suites go to rows on the facade; services to the other rows and the cap.
  const facing = (row: Row) => {
    const far: End = row.open === 'lo' ? 'hi' : 'lo'
    return outside(endStrip(row.rect, cross(row.axis), far)) + 0.25 * outside(row.rect)
  }
  const rows = [...night.rows].sort((p, q) => facing(q) - facing(p))
  for (const suite of shuffle([...suites], rng))
    (rows.length > 1 && !rng.chance(0.85) ? rows[1]! : rows[0]!).items.push(suite)
  for (const service of shuffle([...services], rng)) {
    const stack = night.stacks.length && rng.chance(0.45) ? rng.pick(night.stacks) : null
    if (stack) stack.items.push(service)
    else rows[rows.length > 1 && rng.chance(0.7) ? rows.length - 1 : 0]!.items.push(service)
  }
  const capEnd: End = dayFirst ? 'hi' : 'lo'
  if (night.stacks.length && rng.chance(0.5)) {
    const row = rows.find((r) => r.items.some((it) => it.satellites.length))
    const host = row?.items.find((it) => it.satellites.length)
    const stack =
      row && night.stacks.find((s) => Math.abs(lo(s.rect, s.axis) - lo(row.rect, s.axis)) < TOL)
    if (host && stack) {
      const moved = host.satellites.filter((s) => s.type !== 'closet')
      host.satellites = host.satellites.filter((s) => s.type === 'closet')
      host.nextToCap = true
      stack.items.push(...moved.map((anchor) => ({ anchor, satellites: [] })))
    }
  }
  for (const row of rows) {
    shuffle(row.items, rng)
    const far: End = row.open === 'lo' ? 'hi' : 'lo'
    if (outside(endStrip(row.rect, cross(row.axis), far)) <= 0.5) {
      const atLo = outside(endStrip(row.rect, row.axis, 'lo')) > 0.5
      const atHi = outside(endStrip(row.rect, row.axis, 'hi')) > 0.5
      const isSuite = (it: Item) => (it.anchor.type === 'bedroom' ? 1 : 0)
      if (atLo && !atHi) row.items.sort((p, q) => isSuite(q) - isSuite(p))
      if (atHi && !atLo) row.items.sort((p, q) => isSuite(p) - isSuite(q))
    }
    const adjacent = row.items.findIndex((it) => it.nextToCap)
    if (adjacent >= 0) {
      const [it] = row.items.splice(adjacent, 1)
      capEnd === 'hi' ? row.items.push(it!) : row.items.unshift(it!)
    }
  }
  const absorb = (rect: Rect) => {
    if (
      hallRect &&
      sharedSegment(hallRect, rect) &&
      Math.abs(lo(rect, night.along) - lo(hallRect, night.along)) < TOL &&
      Math.abs(hi(rect, night.along) - hi(hallRect, night.along)) < TOL
    )
      hallRect = union(hallRect, rect)
    else corridors.push(rect)
  }
  let filled = rows.filter((r) => r.items.length)
  for (const row of rows.filter((r) => !r.items.length)) {
    if (!hallRect) return null
    absorb(row.rect)
  }
  let stacks = night.stacks.filter((s) => s.items.length)
  for (const stack of night.stacks.filter((s) => !s.items.length)) corridors.push(stack.rect)
  if (!filled.length && !hallRect) return null

  const target = entryTarget(annex, main, entryEdge, D, hallRect, rng)
  if (!target) return null
  const touches = (r: Rect) => {
    const o = overlapOnEdge(r, target)
    return !!o && segLength(o) > TOL
  }
  const reached = filled.find((r) => touches(r.rect))
  if (reached) {
    const pieces = splitForCorridor(reached, target, snap(rng.between(1.05, 1.3)))
    const sides = [pieces.before, pieces.after].filter((p): p is Rect => !!p)
    const groups = distribute(reached.items, sides)
    if (!groups) return null
    let corridor = pieces.corridor
    const keep: Row[] = []
    sides.forEach((rect, i) => {
      if (groups[i]?.length) keep.push({ ...reached, rect, items: groups[i]! })
      else corridor = union(corridor, rect)
    })
    corridors.push(corridor)
    filled = filled.flatMap((r) => (r === reached ? keep : [r]))
  }
  const reachedStack = stacks.find((s) => touches(s.rect))
  if (reachedStack) {
    const other = stacks.find((s) => s !== reachedStack)
    if (!other && reachedStack.items.length) return null
    other?.items.push(...reachedStack.items)
    corridors.push(reachedStack.rect)
    stacks = stacks.filter((s) => s !== reachedStack)
  }
  for (const row of filled) if (!fillRow(row, space, rng, out)) return null
  for (const stack of stacks) {
    const items = stack.open === 'lo' ? stack.items : [...stack.items].reverse()
    if (items.reduce((sum, it) => sum + minSide(it.anchor), 0) > span(stack.rect, stack.axis) + TOL)
      return null
    const parts = slices(
      stack.rect,
      stack.axis,
      items.map((it) => ({ weight: itemArea(it), min: MIN_SIDE[it.anchor.type] })),
    )
    items.forEach((it, i) => {
      fillItem(it, parts[i]!, stack.axis, stack.open, 'beside', rng, out)
    })
  }
  const wet = [...out].filter(([roomId]) => {
    const type = types.get(roomId)
    return type === 'bathroom' || type === 'laundry'
  })
  fillDay(
    D,
    day,
    wet.map(([, rect]) => rect),
    rng,
    out,
  )

  const rooms: UnitRoom[] = []
  for (const [roomId, rect] of out)
    rooms.push({ id: roomId, type: types.get(roomId)!, rects: [rect] })
  if (hallRect) rooms.push({ id: hall?.id ?? 'hall1', type: 'hall', rects: [hallRect] })
  corridors.forEach((rect, i) => {
    const hostsEntry = !annex && i === corridors.length - 1 && reached
    rooms.push({
      id: hostsEntry ? entry.id : `corridor${i + 1}`,
      type: hostsEntry ? 'entry' : 'hall',
      rects: [rect],
    })
  })
  if (annex) rooms.push({ id: entry.id, type: 'entry', rects: [annex] })
  for (const extra of regions) {
    if (extra === main || extra === annex) continue
    let host: UnitRoom | undefined
    let best = 0
    for (const room of rooms) {
      const s = sharedSegment(room.rects[0]!, extra)
      if (s && segLength(s) > best) {
        best = segLength(s)
        host = room
      }
    }
    host?.rects.push(extra)
  }
  return finish(id, rooms, entryEdge, annex ? null : target, rng)
}

/** Open plan between day rooms, doors by the rules, and the entry door. */
function finish(
  id: string,
  rooms: UnitRoom[],
  entryEdge: Segment,
  target: Segment | null,
  rng: Random,
): UnitLayout | null {
  const contacts = roomContacts({ rooms })
  const contact = (p: string, q: string) => contacts.get(p < q ? `${p}|${q}` : `${q}|${p}`) ?? []
  const typeOf = new Map(rooms.map((r) => [r.id, r.type]))
  const open: [string, string][] = []
  for (const shared of contacts.values()) {
    const [p, q] = shared[0]!.rooms
    if (
      OPEN_PLAN_ROOMS.has(typeOf.get(p)!) &&
      OPEN_PLAN_ROOMS.has(typeOf.get(q)!) &&
      shared.some((s) => segLength(s) >= 0.9)
    )
      open.push([p, q])
  }

  const doors: UnitDoor[] = []
  const ensuite = new Set<string>()
  for (const room of rooms) {
    const tiers = DOOR_TO[room.type]
    if (!tiers) continue
    for (const tier of tiers) {
      const options = rooms.filter(
        (other) =>
          other !== room &&
          tier.includes(other.type) &&
          !(room.type === 'bathroom' && other.type === 'bedroom' && ensuite.has(other.id)) &&
          contact(room.id, other.id).some((s) => segLength(s) >= DOOR + 2 * JAMB),
      )
      if (!options.length) continue
      const other = rng.pick(options)
      if (room.type === 'bathroom' && other.type === 'bedroom') ensuite.add(other.id)
      const wall = contact(room.id, other.id).reduce((p, q) =>
        segLength(q) > segLength(p) ? q : p,
      )
      doors.push({ rooms: [room.id, other.id], at: doorOn(wall, DOOR, rng), width: DOOR })
      break
    }
  }

  let entryRoom: UnitRoom | undefined
  let entrySpan: Segment | null = null
  for (const room of rooms) {
    if (!OPEN_PLAN_ROOMS.has(room.type)) continue
    for (const rect of room.rects) {
      const onEdge = overlapOnEdge(rect, entryEdge)
      const span = onEdge && target ? overlapOnEdge(rect, target) : onEdge
      if (span && (!entrySpan || segLength(span) > segLength(entrySpan))) {
        entrySpan = span
        entryRoom = room
      }
    }
  }
  if (!(entryRoom && entrySpan && segLength(entrySpan) >= ENTRY_DOOR + 2 * JAMB)) return null
  return {
    id,
    rooms,
    open,
    doors,
    entry: { room: entryRoom.id, at: doorOn(entrySpan, ENTRY_DOOR, rng), width: ENTRY_DOOR },
  }
}

/** Where the entry reaches the main rectangle: the annex it sits in, or a stretch of the entry edge. */
function entryTarget(
  annex: Rect | null,
  main: Rect,
  edge: Segment,
  day: Rect,
  hall: Rect | undefined,
  rng: Random,
): Segment | null {
  if (annex) return sharedSegment(main, annex)
  const options = [hall && overlapOnEdge(hall, edge), overlapOnEdge(day, edge)].filter(
    (o): o is Segment => !!o && segLength(o) >= ENTRY_DOOR + 2 * JAMB + 0.1,
  )
  if (options.length && rng.chance(0.8)) return rng.pick(options)
  const run = overlapOnEdge(main, edge)
  if (!run || segLength(run) < 1.2) return null
  const vertical = Math.abs(run.a[0] - run.b[0]) < TOL
  const axis = vertical ? 1 : 0
  const start = Math.min(run.a[axis], run.b[axis]) + snap(rng.between(0, segLength(run) - 1.2))
  const at = (v: number): Pt => (vertical ? [run.a[0], clean(v)] : [clean(v), run.a[1]])
  return { a: at(start), b: at(start + 1.2) }
}

/** A corridor strip across a row, over the stretch where the entry reaches it. */
function splitForCorridor(row: Row, target: Segment, width: number) {
  const { rect, axis } = row
  const k = axis === 'x' ? 0 : 1
  const parallel = Math.abs(target.a[k] - target.b[k]) > TOL
  let from: number
  let to: number
  if (parallel) {
    const t0 = Math.min(target.a[k], target.b[k])
    const t1 = Math.max(target.a[k], target.b[k])
    const w = Math.max(width, t1 - t0)
    from = clean(clamp((t0 + t1) / 2 - w / 2, lo(rect, axis), hi(rect, axis) - w))
    to = clean(Math.min(hi(rect, axis), from + w))
  } else if (Math.abs(target.a[k] - lo(rect, axis)) < TOL) {
    from = lo(rect, axis)
    to = clean(from + width)
  } else {
    to = hi(rect, axis)
    from = clean(to - width)
  }
  const before = from - lo(rect, axis) > GRID
  const after = hi(rect, axis) - to > GRID
  return {
    before: before ? band(rect, axis, lo(rect, axis), from) : null,
    corridor: band(rect, axis, before ? from : lo(rect, axis), after ? to : hi(rect, axis)),
    after: after ? band(rect, axis, to, hi(rect, axis)) : null,
  }
}

/** A door of `width` along a segment: near one end, the other, or centred. */
function doorOn(segment: Segment, width: number, rng: Random): Pt {
  const vertical = Math.abs(segment.a[0] - segment.b[0]) < TOL
  const axis = vertical ? 1 : 0
  const s0 = Math.min(segment.a[axis], segment.b[axis])
  const s1 = Math.max(segment.a[axis], segment.b[axis])
  const slack = s1 - s0 - width - 2 * JAMB
  const near = Math.min(0.1, Math.max(0, slack / 2))
  const choice = rng.pick([0, 0.5, 1])
  const offset =
    slack <= 0 ? slack / 2 : choice === 0.5 ? slack / 2 : choice === 0 ? near : slack - near
  const centre = clean(s0 + JAMB + offset + width / 2)
  return vertical ? [segment.a[0], centre] : [centre, segment.a[1]]
}
