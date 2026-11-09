import type { StairConstruction as StairConstructionType, StairNode } from '../../schema'
import { StairConstruction } from '../../schema/nodes/stair-construction'
import {
  type StairStringerStock,
  type StairStringerType,
  StairStructure,
  type StairStructureType,
  type StairTreadStock,
} from '../../schema/nodes/stair-structure'

/**
 * A stair's structure — how it is really built, apart from the body it is drawn with — resolved
 * to numbers: the stringer layout across each flight, the cut profile of every stringer, the
 * treads and risers they carry, the construction the viewer draws for it, and the code checks the
 * panel reports. Shared by the viewer (the body), the panel (the counts) and Bones (the members),
 * so all three put a stringer in the same place.
 */

const IN = 0.0254
const EPS = 1e-9

/**
 * The stair numbers of the IRC (R311.7 stairways, R312 guards) and AWC DCA 6 (deck stairs) the
 * structure is checked against, in metres.
 */
export const STAIR_CODE = {
  /** R311.7.5.1: risers 7-3/4 in at most. */
  maxRiser: 7.75 * IN,
  /** R311.7.5.2: treads 10 in at least. */
  minTread: 10 * IN,
  /** R311.7.5.3: a 3/4 in to 1-1/4 in nosing, required where the tread is under 11 in. */
  minNosing: 0.75 * IN,
  maxNosing: 1.25 * IN,
  nosingWaivedTread: 11 * IN,
  /** R311.7.1: 36 in wide. */
  minWidth: 36 * IN,
  /** R311.7.2: 6 ft 8 in of headroom. */
  minHeadroom: 80 * IN,
  /** R311.7.3: a flight rises 151 in at most between floors or landings. */
  maxFlightRise: 151 * IN,
  /** R311.7.6: landings at least 36 in in the direction of travel. */
  minLandingDepth: 36 * IN,
  /** R311.7.8: a flight of four or more risers carries a handrail, 34–38 in over the nosings. */
  handrailRisers: 4,
  minHandrailHeight: 34 * IN,
  maxHandrailHeight: 38 * IN,
  /** R312.1.1: a guard where the open side drops more than 30 in. */
  guardDrop: 30 * IN,
  /** R311.7.5.1: open risers must stop a 4 in sphere once the stair rises more than 30 in. */
  openRiserSphere: 4 * IN,
  openRiserFreeRise: 30 * IN,
  /** DCA 6: cut stringers at most 18 in o.c. and 6 ft between supports, with a 5 in throat. */
  cutStringerMaxSpacing: 18 * IN,
  cutStringerMaxSpan: 72 * IN,
  minThroat: 5 * IN,
} as const

/** Wood stringer stock, dressed (m). */
export const STAIR_STRINGER_STOCK: Record<
  StairStringerStock,
  { thickness: number; depth: number }
> = {
  '2x12': { thickness: 1.5 * IN, depth: 11.25 * IN },
  '2x10': { thickness: 1.5 * IN, depth: 9.25 * IN },
}

/** The steel stringer: an MC12x10.6 channel, 12 in deep with a 1-1/2 in flange. */
export const STAIR_STEEL_STRINGER = { name: 'MC12x10.6', thickness: 1.5 * IN, depth: 12 * IN }

/** Steel channels stand at the sides; a third goes down the middle past this width. */
const STEEL_STRINGER_MAX_SPACING = 48 * IN

/**
 * Tread stock: the boards laid front to back across one tread (`boards` of `boardWidth`, `gap`
 * apart; a sheet fills the tread), their thickness, and the finish laid over them.
 */
export const STAIR_TREAD_STOCK: Record<
  StairTreadStock,
  { boards: number; boardWidth: number; thickness: number; gap: number; finish: number }
> = {
  '2x6-pair': { boards: 2, boardWidth: 5.5 * IN, thickness: 1.5 * IN, gap: 0.25 * IN, finish: 0 },
  '5/4x6-pair': { boards: 2, boardWidth: 5.5 * IN, thickness: 1 * IN, gap: 0.25 * IN, finish: 0 },
  '2x12': { boards: 1, boardWidth: 11.25 * IN, thickness: 1.5 * IN, gap: 0, finish: 0 },
  'plywood-finish': {
    boards: 1,
    boardWidth: Number.POSITIVE_INFINITY,
    thickness: 0.75 * IN,
    gap: 0,
    finish: 0.75 * IN,
  },
}

/** Riser boards are 1x stock, 3/4 in. */
export const STAIR_RISER_THICKNESS = 0.75 * IN
/** A wood or steel tread's nosing when none is set: 1 in, inside R311.7.5.3's 3/4–1-1/4 in. */
export const DEFAULT_STAIR_NOSING = 1 * IN
/** A housed stringer's top edge stands this far over the nosing line, square to it. */
export const HOUSED_STRINGER_REVEAL = 2 * IN
/** A housed stringer runs this far ahead of the bottom nosing before its plumb cut. */
const HOUSED_STRINGER_LEAD = 1 * IN
/** The housing (dado) a housed tread or riser sits in. */
export const STAIR_HOUSING_DEPTH = 0.5 * IN
/** A concrete flight's nosing lip, when it has one. */
const CONCRETE_NOSING_LIP = 1.5 * IN

export type ResolvedStairStructure = {
  type: StairStructureType
  stringerStock: StairStringerStock
  stringerType: StairStringerType
  /** The most the stringers may stand apart on centre (m). */
  stringerSpacing: number
  /** The count set by hand; undefined = automatic. */
  stringerCount: number | undefined
  treadStock: StairTreadStock
  closedRisers: boolean
  treated: boolean
  nosing: number
  exterior: boolean
}

/** What a structure is read off: the stair's own fields (any of them may be absent). */
export type StairStructureHost = Partial<
  Pick<StairNode, 'structure' | 'totalRise' | 'deckSlabId' | 'destinationSurfaceId' | 'stairType'>
>

/** An exterior stair: one fitted to a deck, porch or patio edge. */
export function stairIsExterior(
  stair: Pick<StairNode, 'deckSlabId' | 'destinationSurfaceId'>,
): boolean {
  return Boolean(stair.deckSlabId || stair.destinationSurfaceId)
}

/**
 * The stair's structure with every automatic choice made: two 2x6 treads and treated stock on an
 * exterior stair, a 2x12 tread inside; risers closed once the stair rises more than 30 in; a 1 in
 * nosing on wood and steel treads. `context` overrides what the stair alone cannot tell (Bones
 * knows a stair that lands on grade is exterior). Null without a structure.
 */
export function resolveStairStructure(
  stair: StairStructureHost,
  context: { exterior?: boolean; totalRise?: number } = {},
): ResolvedStairStructure | null {
  if (!stair.structure) return null
  const parsed = StairStructure.safeParse(stair.structure)
  if (!parsed.success) return null
  const structure = parsed.data
  const exterior = context.exterior ?? stairIsExterior(stair)
  // a stair that follows its level climbs a whole storey
  const rise = context.totalRise ?? stair.totalRise ?? Number.POSITIVE_INFINITY
  return {
    type: structure.type,
    stringerStock: structure.stringerStock,
    stringerType: structure.stringerType,
    stringerSpacing: structure.stringerSpacing,
    stringerCount: structure.stringerCount,
    treadStock: structure.treadStock ?? (exterior ? '2x6-pair' : '2x12'),
    closedRisers: structure.closedRisers ?? rise > STAIR_CODE.openRiserFreeRise + EPS,
    treated: structure.treated ?? exterior,
    nosing: structure.nosing ?? (structure.type === 'concrete' ? 0 : DEFAULT_STAIR_NOSING),
    exterior,
  }
}

/**
 * The structure a stair is framed with: its own, or for a stair drawn before structures existed
 * the one its body reads as — a concrete flight when it is painted concrete, wood stringers
 * otherwise.
 */
export function inferStairStructure(
  stair: Pick<StairNode, 'structure' | 'material' | 'materialPreset' | 'slots'>,
): StairStructure {
  if (stair.structure) {
    const parsed = StairStructure.safeParse(stair.structure)
    if (parsed.success) return parsed.data
  }
  const refs = [stair.materialPreset, stair.material?.preset, ...Object.values(stair.slots ?? {})]
  const concrete = refs.some((ref) => typeof ref === 'string' && /concrete/i.test(ref))
  return StairStructure.parse({ type: concrete ? 'concrete' : 'wood-stringers' })
}

/**
 * The automatic stringer count: enough that no bay between neighbours exceeds `maxSpacing` —
 * ceil(width / spacing) + 1 — and never fewer than two, or three on a stair 36 in wide or more.
 */
export function autoStairStringerCount(width: number, maxSpacing: number): number {
  const floor = width >= STAIR_CODE.minWidth - EPS ? 3 : 2
  if (!(width > 0 && maxSpacing > 0)) return floor
  return Math.max(Math.ceil(width / maxSpacing - EPS) + 1, floor)
}

export type StairStringerBand = {
  index: number
  /** Centre across the flight, in the flight's frame (m). */
  x: number
  x0: number
  x1: number
  thickness: number
  depth: number
  /** 'cut' — notched under the treads; 'housed' — a solid board over the nosing line. */
  kind: 'cut' | 'housed'
  steel: boolean
}

export type StairStringerLayout = {
  count: number
  /** True when the count follows the width and the spacing. */
  auto: boolean
  /** Centre to centre between neighbouring stringers (m). */
  spacing: number
  thickness: number
  depth: number
  steel: boolean
  bands: StairStringerBand[]
}

/**
 * The stringers across a flight of `width`: the outer two flush with its sides and the rest evenly
 * between them, as many as the structure asks (or as its spacing needs). Housed wood stringers
 * and steel channels are the outer two; any between them are cut carriages.
 */
export function resolveStairStringerLayout(
  width: number,
  structure: Pick<
    ResolvedStairStructure,
    'type' | 'stringerStock' | 'stringerType' | 'stringerSpacing' | 'stringerCount'
  >,
): StairStringerLayout {
  const steel = structure.type === 'steel-stringers'
  const stock = steel ? STAIR_STEEL_STRINGER : STAIR_STRINGER_STOCK[structure.stringerStock]
  const auto = structure.stringerCount === undefined
  const wanted =
    structure.stringerCount ??
    (steel
      ? Math.max(2, Math.ceil(width / STEEL_STRINGER_MAX_SPACING - EPS) + 1)
      : autoStairStringerCount(width, structure.stringerSpacing))
  const count = Math.max(0, Math.min(wanted, Math.floor((width + EPS) / stock.thickness)))
  const spacing = count > 1 ? (width - stock.thickness) / (count - 1) : 0
  const housedSides = steel || structure.stringerType === 'housed'
  const bands: StairStringerBand[] = []
  for (let index = 0; index < count; index++) {
    const x = count > 1 ? -width / 2 + stock.thickness / 2 + index * spacing : 0
    bands.push({
      index,
      x,
      x0: x - stock.thickness / 2,
      x1: x + stock.thickness / 2,
      thickness: stock.thickness,
      depth: stock.depth,
      kind: housedSides && (index === 0 || index === count - 1) ? 'housed' : 'cut',
      steel,
    })
  }
  return {
    count,
    auto,
    spacing,
    thickness: stock.thickness,
    depth: stock.depth,
    steel,
    bands,
  }
}

/** A construction a structure draws, carrying the structure so the stringers can be laid out. */
export type ResolvedStairConstruction = StairConstructionType & {
  structure?: ResolvedStairStructure
}

/**
 * The body a structure draws: a solid mass for concrete (its nosing a lip over each riser); open
 * treads of the tread stock — closed risers when it has them — over the stringers otherwise.
 */
export function stairStructureConstruction(
  structure: ResolvedStairStructure,
): ResolvedStairConstruction {
  if (structure.type === 'concrete')
    return {
      ...StairConstruction.parse({
        mode: 'solid',
        nosing: structure.nosing,
        treadThickness: CONCRETE_NOSING_LIP,
        finishThickness: 0,
      }),
      structure,
    }
  const tread = STAIR_TREAD_STOCK[structure.treadStock]
  const stringer =
    structure.type === 'steel-stringers'
      ? STAIR_STEEL_STRINGER
      : STAIR_STRINGER_STOCK[structure.stringerStock]
  return {
    ...StairConstruction.parse({
      mode: 'open',
      treadThickness: tread.thickness,
      finishThickness: tread.finish,
      nosing: structure.nosing,
      riserThickness: STAIR_RISER_THICKNESS,
      closedRisers: structure.closedRisers,
      stringerWidth: stringer.thickness,
      stringerDepth: stringer.depth,
    }),
    structure,
  }
}

const constructionMemo = new WeakMap<object, { key: string; value: ResolvedStairConstruction }>()

/**
 * The construction a straight stair's structure draws, or null (no structure, or a curved or
 * spiral stair, which keeps its own body). Memoised on the structure object.
 */
export function stairStructureConstructionOf(
  stair: StairStructureHost,
): ResolvedStairConstruction | null {
  if (!stair.structure || (stair.stairType ?? 'straight') !== 'straight') return null
  const key = `${stair.totalRise ?? ''}|${stairIsExterior(stair)}`
  const cached = constructionMemo.get(stair.structure)
  if (cached?.key === key) return cached.value
  const structure = resolveStairStructure(stair)
  if (!structure) return null
  const value = stairStructureConstruction(structure)
  constructionMemo.set(stair.structure, { key, value })
  return value
}

/** A landing's joists and rims: 2x8, 16 in o.c. — a stair landing spans a few feet at most. */
export const STAIR_LANDING_JOIST = { size: '2x8', thickness: 1.5 * IN, depth: 7.25 * IN } as const
export const STAIR_LANDING_JOIST_SPACING = 16 * IN
/** A landing's corner posts: 4x4. */
export const STAIR_LANDING_POST = 3.5 * IN
/** A landing closer to the base than this over its frame sits on blocking, not posts. */
const STAIR_LANDING_MIN_POST = 6 * IN

/** A box in a segment's frame: across `x0..x1`, along the run `z0..z1`, `bottom..top` high. */
export type StairFrameBox = {
  x0: number
  x1: number
  z0: number
  z1: number
  bottom: number
  top: number
}

/**
 * A wood landing's frame, in the landing's frame (its top at 0): rims all round under the decking
 * (`drop` thick), joists between them along the run at 16 in o.c., and a 4x4 post under each
 * corner down to the stair's base `baseDepth` below — none when the frame sits within 6 in of it.
 */
export function stairLandingFrame(
  landing: { width: number; length: number },
  drop: number,
  baseDepth: number,
): { rims: StairFrameBox[]; joists: StairFrameBox[]; posts: StairFrameBox[] } {
  const { width, length } = landing
  const t = STAIR_LANDING_JOIST.thickness
  const top = -drop
  const bottom = top - STAIR_LANDING_JOIST.depth
  const x0 = -width / 2
  const x1 = width / 2
  const rims: StairFrameBox[] = []
  const joists: StairFrameBox[] = []
  const posts: StairFrameBox[] = []
  if (!(width > 2 * t && length > 2 * t)) return { rims, joists, posts }
  rims.push(
    { x0, x1, z0: 0, z1: t, bottom, top },
    { x0, x1, z0: length - t, z1: length, bottom, top },
    { x0, x1: x0 + t, z0: t, z1: length - t, bottom, top },
    { x0: x1 - t, x1, z0: t, z1: length - t, bottom, top },
  )
  const bays = Math.max(1, Math.ceil((width - t) / STAIR_LANDING_JOIST_SPACING - EPS))
  for (let i = 1; i < bays; i++) {
    const x = x0 + t / 2 + (i * (width - t)) / bays
    joists.push({ x0: x - t / 2, x1: x + t / 2, z0: t, z1: length - t, bottom, top })
  }
  if (baseDepth + bottom >= STAIR_LANDING_MIN_POST - EPS) {
    const p = STAIR_LANDING_POST
    for (const [px, pz] of [
      [x0, 0],
      [x1 - p, 0],
      [x0, length - p],
      [x1 - p, length - p],
    ] as const)
      posts.push({ x0: px, x1: px + p, z0: pz, z1: pz + p, bottom: -baseDepth, top: bottom })
  }
  return { rims, joists, posts }
}

/** One flight as its stringers see it. */
export type StairStringerFlight = {
  stepCount: number
  height: number
  length: number
  /** The structural tread sits this far under each walking top: the tread and its finish. */
  treadDrop: number
  /** Each riser cut sits this far behind its riser face: the riser board, when there is one. */
  riserSetback: number
  nosing: number
  /** False when the flight starts on another flight, not on a floor, pad or landing. */
  bearsOnBase?: boolean
}

/** The flight a segment and its construction make for the stringers. */
export function stairStringerFlight(
  segment: { stepCount: number; height: number; length: number },
  construction: Pick<
    StairConstructionType,
    'treadThickness' | 'finishThickness' | 'riserThickness' | 'closedRisers' | 'nosing'
  >,
): StairStringerFlight {
  return {
    stepCount: Math.max(1, Math.round(segment.stepCount)),
    height: segment.height,
    length: segment.length,
    treadDrop: construction.treadThickness + construction.finishThickness,
    riserSetback: construction.closedRisers ? construction.riserThickness : 0,
    nosing: construction.nosing,
  }
}

export type StairStringerSlice = {
  index: number
  /** Closed (run, height) outline in the flight's frame; always convex. */
  profile: [number, number][]
  /** The board's underside: height = slope · run + intercept. */
  underside: [number, number]
  top: number
}

/** Keeps the part of a convex polygon on one side of a level line (Sutherland–Hodgman). */
function clipLevel(
  polygon: [number, number][],
  level: number,
  keepAbove: boolean,
): [number, number][] {
  const inside = (p: [number, number]) => (keepAbove ? p[1] >= level - EPS : p[1] <= level + EPS)
  const out: [number, number][] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const aIn = inside(a)
    const bIn = inside(b)
    if (aIn) out.push(a)
    if (aIn !== bIn) {
      const t = (level - a[1]) / (b[1] - a[1])
      out.push([a[0] + (b[0] - a[0]) * t, level])
    }
  }
  const same = (a: [number, number], b: [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPS
  const kept = out.filter((p, i) => i === 0 || !same(p, out[i - 1]!))
  if (kept.length > 1 && same(kept[0]!, kept.at(-1)!)) kept.pop()
  return kept
}

/**
 * The uncut board's edges, as heights over the run (height = slope · run + intercept): a cut
 * stringer's top edge runs through the outer corners of its notches, a housed one stands
 * `HOUSED_STRINGER_REVEAL` over the nosing line; the bottom edge is the board's depth under it.
 */
export function stairStringerEdges(
  band: Pick<StairStringerBand, 'kind' | 'depth'>,
  flight: StairStringerFlight,
): { slope: number; top: number; bottom: number } {
  const count = Math.max(1, Math.round(flight.stepCount))
  const riser = flight.height / count
  const slope = flight.length > 0 ? flight.height / flight.length : 0
  const vertical = band.depth * Math.hypot(1, slope)
  const top =
    band.kind === 'cut'
      ? riser - flight.treadDrop - slope * flight.riserSetback
      : slope * flight.nosing + riser + HOUSED_STRINGER_REVEAL * Math.hypot(1, slope)
  return { slope, top, bottom: top - vertical }
}

/**
 * One stringer down a flight, sliced per step (each slice convex, so the viewer extrudes it and
 * Bones boxes it). A cut stringer is notched for every tread and riser: each slice tops out flat
 * at its tread seat — the walking top less the tread — its riser cut set back behind the riser
 * board, its underside the board's bottom edge. A housed stringer is the solid board standing
 * `HOUSED_STRINGER_REVEAL` over the nosing line. Both are cut level where they bear on the base,
 * plumb at the top of the run, and a housed one level at the floor it reaches.
 */
export function stairStringerSlices(
  band: Pick<StairStringerBand, 'kind' | 'depth'>,
  flight: StairStringerFlight,
): StairStringerSlice[] {
  const count = Math.max(1, Math.round(flight.stepCount))
  const { height, length } = flight
  if (!(height > 0 && length > 0 && band.depth > 0)) return []
  const going = length / count
  const riser = height / count
  const { slope, top, bottom } = stairStringerEdges(band, flight)
  const slices: StairStringerSlice[] = []
  const finish = (index: number, polygon: [number, number][], underside: [number, number]) => {
    let profile = polygon
    if (flight.bearsOnBase !== false) profile = clipLevel(profile, 0, true)
    if (band.kind === 'housed') profile = clipLevel(profile, height, false)
    if (profile.length < 3) return
    slices.push({
      index,
      profile,
      underside,
      top: Math.max(...profile.map((point) => point[1])),
    })
  }
  if (band.kind === 'cut') {
    const setback = flight.riserSetback
    for (let index = 0; index < count; index++) {
      const z0 = setback + index * going
      const z1 = Math.min(length, setback + (index + 1) * going)
      const seat = (index + 1) * riser - flight.treadDrop
      if (!(z1 - z0 > EPS && seat > EPS)) continue
      finish(
        index,
        [
          [z0, seat],
          [z1, seat],
          [z1, slope * z1 + bottom],
          [z0, slope * z0 + bottom],
        ],
        [slope, bottom],
      )
    }
    return slices
  }
  for (let index = 0; index < count; index++) {
    const z0 = index === 0 ? -(flight.nosing + HOUSED_STRINGER_LEAD) : index * going
    const z1 = index === count - 1 ? length : (index + 1) * going
    finish(
      index,
      [
        [z0, slope * z0 + top],
        [z1, slope * z1 + top],
        [z1, slope * z1 + bottom],
        [z0, slope * z0 + bottom],
      ],
      [slope, bottom],
    )
  }
  return slices
}

export type StairStringerCut = {
  slices: StairStringerSlice[]
  /** Rise over run of the flight. */
  slope: number
  /** The board's cut length: the stringer's extent along the slope. */
  length: number
  /** Wood left under the notches, square to the slope (DCA 6 asks 5 in); the board depth when housed. */
  throat: number
  /** The run the stringer bears on its base along (its level cut), or null when it bears on none. */
  seat: [number, number] | null
  /** The plumb cut at the top of the run: its run and the heights it spans. */
  plumb: { z: number; top: number; bottom: number }
  /** The uncut board's top and bottom edges (intercepts: height = slope · run + intercept). */
  edge: { top: number; bottom: number }
}

/** A stringer's cut: its slices and the numbers the takeoff and the code checks read off them. */
export function stairStringerCut(
  band: Pick<StairStringerBand, 'kind' | 'depth'>,
  flight: StairStringerFlight,
): StairStringerCut {
  const slices = stairStringerSlices(band, flight)
  const { slope, top, bottom } = stairStringerEdges(band, flight)
  const norm = Math.hypot(1, slope)
  const along = (point: [number, number]) => (point[0] + point[1] * slope) / norm
  const points = slices.flatMap((slice) => slice.profile)
  const extents = points.map(along)
  const riser = flight.height / Math.max(1, Math.round(flight.stepCount))
  const onBase = points.filter((point) => Math.abs(point[1]) < 1e-7).map((point) => point[0])
  const atTop = points
    .filter((point) => Math.abs(point[0] - flight.length) < 1e-7)
    .map((point) => point[1])
  return {
    slices,
    slope,
    length: extents.length ? Math.max(...extents) - Math.min(...extents) : 0,
    throat: band.kind === 'cut' ? band.depth - riser / norm : band.depth,
    seat: onBase.length > 1 ? [Math.min(...onBase), Math.max(...onBase)] : null,
    plumb: {
      z: flight.length,
      top: atTop.length ? Math.max(...atTop) : 0,
      bottom: atTop.length ? Math.min(...atTop) : 0,
    },
    edge: { top, bottom },
  }
}

/** Inches as a builder reads them, to the nearest eighth: 7.75 in → `7-3/4 in`. */
export function formatStairInches(metres: number): string {
  const eighths = Math.round(metres / IN / 0.125)
  const whole = Math.floor(eighths / 8)
  let numerator = eighths - whole * 8
  let denominator = 8
  while (numerator > 0 && numerator % 2 === 0) {
    numerator /= 2
    denominator /= 2
  }
  if (numerator === 0) return `${whole} in`
  return whole > 0 ? `${whole}-${numerator}/${denominator} in` : `${numerator}/${denominator} in`
}

export type StairStructureIssue = {
  code: string
  severity: 'error' | 'warning'
  nodeId: string
  message: string
}

/**
 * The IRC R311.7 / R312 and DCA 6 checks a stair with a structure owes: risers, treads, nosings,
 * width, flight rise, headroom, the handrail on four or more risers, the guard past a 30 in drop,
 * open risers on a tall stair, and for cut wood stringers their spacing, throat and span. Stairs
 * without a structure keep the design-target checks alone.
 */
export function stairStructureDiagnostics(
  stair: StairNode,
  flights: readonly {
    nodeId: string
    count: number
    rise: number
    length: number
    width: number
    riserHeight: number | null
    going: number | null
  }[],
  options: { totalRise: number; headroom: number | null },
): StairStructureIssue[] {
  if ((stair.stairType ?? 'straight') !== 'straight') return []
  const structure = resolveStairStructure(stair)
  if (!structure) return []
  const issues: StairStructureIssue[] = []
  const warn = (code: string, nodeId: string, message: string) =>
    issues.push({ code, severity: 'warning', nodeId, message })
  const construction = stairStructureConstruction(structure)
  const railings = (stair.railingMode ?? 'none') !== 'none'
  const handrail = stair.handrail && stair.handrail.mode !== 'none'
  for (const flight of flights) {
    const { riserHeight: riser, going } = flight
    if (riser === null || going === null) continue
    if (riser > STAIR_CODE.maxRiser + EPS)
      warn(
        'code-riser',
        flight.nodeId,
        `Risers of ${formatStairInches(riser)} exceed the 7-3/4 in maximum (IRC R311.7.5.1).`,
      )
    if (going < STAIR_CODE.minTread - EPS)
      warn(
        'code-tread',
        flight.nodeId,
        `Treads of ${formatStairInches(going)} fall short of the 10 in minimum (IRC R311.7.5.2).`,
      )
    if (structure.type !== 'concrete' || structure.nosing > 0) {
      if (
        going < STAIR_CODE.nosingWaivedTread - EPS &&
        structure.nosing < STAIR_CODE.minNosing - EPS
      )
        warn(
          'code-nosing',
          flight.nodeId,
          'Treads under 11 in need a 3/4 in to 1-1/4 in nosing (IRC R311.7.5.3).',
        )
      else if (structure.nosing > STAIR_CODE.maxNosing + EPS)
        warn(
          'code-nosing',
          flight.nodeId,
          `A ${formatStairInches(structure.nosing)} nosing projects past the 1-1/4 in IRC R311.7.5.3 allows.`,
        )
    }
    if (flight.width < STAIR_CODE.minWidth - EPS)
      warn(
        'code-width',
        flight.nodeId,
        `The flight is ${formatStairInches(flight.width)} wide; IRC R311.7.1 asks 36 in.`,
      )
    if (flight.rise > STAIR_CODE.maxFlightRise + EPS)
      warn(
        'code-flight-rise',
        flight.nodeId,
        `A flight rises ${formatStairInches(flight.rise)}; IRC R311.7.3 allows 151 in between floors or landings. Add a landing.`,
      )
    if (flight.count >= STAIR_CODE.handrailRisers && !railings && !handrail)
      warn(
        'code-handrail',
        flight.nodeId,
        `A flight of ${flight.count} risers needs a handrail 34 in to 38 in over the nosings (IRC R311.7.8).`,
      )
    if (structure.type !== 'concrete') {
      const layout = resolveStairStringerLayout(flight.width, structure)
      const carriages = layout.bands.some((band) => band.kind === 'cut')
      if (!layout.steel && carriages) {
        if (layout.spacing > STAIR_CODE.cutStringerMaxSpacing + EPS)
          warn(
            'stringer-spacing',
            flight.nodeId,
            `Stringers stand ${formatStairInches(layout.spacing)} on centre; DCA 6 allows cut stringers 18 in at most. Add a stringer.`,
          )
        const cut = stairStringerCut(
          { kind: 'cut', depth: layout.depth },
          stairStringerFlight(
            { stepCount: flight.count, height: flight.rise, length: flight.length },
            construction,
          ),
        )
        if (cut.throat < STAIR_CODE.minThroat - EPS)
          warn(
            'stringer-throat',
            flight.nodeId,
            `The cut stringers keep ${formatStairInches(cut.throat)} of wood under the notches; DCA 6 asks 5 in. Use 2x12 stock or a shallower riser.`,
          )
        // DCA 6's span limit is the deck stair's, open below; inside, the walls alongside carry them
        if (structure.exterior && flight.length > STAIR_CODE.cutStringerMaxSpan + EPS)
          warn(
            'stringer-span',
            flight.nodeId,
            `The cut stringers span ${formatStairInches(flight.length)} level; DCA 6 limits them to 6 ft between supports. Support them at mid-span on a beam and posts.`,
          )
      }
    }
  }
  if (railings && !handrail && Number.isFinite(stair.railingHeight)) {
    const height = stair.railingHeight
    if (height < STAIR_CODE.minHandrailHeight - EPS || height > STAIR_CODE.maxHandrailHeight + EPS)
      warn(
        'code-handrail-height',
        stair.id,
        `The railing stands ${formatStairInches(height)} over the nosings; a handrail belongs 34 in to 38 in (IRC R311.7.8.1).`,
      )
  }
  if (options.totalRise > STAIR_CODE.guardDrop + EPS && !railings)
    warn(
      'code-guard',
      stair.id,
      `The stair rises ${formatStairInches(options.totalRise)}; an open side more than 30 in above the floor needs a guard (IRC R312.1.1) unless a wall encloses it.`,
    )
  if (
    structure.type !== 'concrete' &&
    !structure.closedRisers &&
    options.totalRise > STAIR_CODE.openRiserFreeRise + EPS
  ) {
    const opening = Math.max(
      0,
      ...flights.map(
        (flight) =>
          (flight.riserHeight ?? 0) - construction.treadThickness - construction.finishThickness,
      ),
    )
    if (opening >= STAIR_CODE.openRiserSphere - EPS)
      warn(
        'code-open-risers',
        stair.id,
        `Open risers leave ${formatStairInches(opening)} between treads; past a 30 in rise they must stop a 4 in sphere (IRC R311.7.5.1). Close them with riser boards.`,
      )
  }
  if (options.headroom !== null && options.headroom < STAIR_CODE.minHeadroom - EPS)
    warn(
      'code-headroom',
      stair.id,
      `Headroom of ${formatStairInches(options.headroom)} is under the 6 ft 8 in minimum (IRC R311.7.2).`,
    )
  return issues
}
