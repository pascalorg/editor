import {
  getRoofSegmentDeckReach,
  getSegmentSlopeFrame,
  type RoofSegmentNode,
} from '../schema/nodes/roof-segment'
import type { RoofEaveCut } from '../schema/nodes/roof-types'
import { LUMBER_DEPTH } from './build-up'

const inches = (value: number) => value * 0.0254

/** A 1x board's actual thickness: every fascia and rake board is nominal 1x. */
export const FASCIA_THICKNESS = inches(0.75)
/** How far a fascia or rake board drops below the tails' lowest point, past a soffit's edge. */
export const FASCIA_DROP = inches(0.75)
/** The least it drops where a 1x then needs no ripping. */
const FASCIA_DROP_MIN = inches(0.25)
/** The run of a plumb-and-level tail's level cut: a 2x4's width for the soffit's edge to nail to. */
export const LEVEL_CUT_RUN = inches(3.5)
/** A boxed eave's soffit: a 1/2 in panel nailed up to the level cuts. */
export const SOFFIT_THICKNESS = inches(0.5)
/** The sheathing a plane without layers is taken to carry over its tails: Bones' 7/16 in. */
const BARE_SHEATHING = inches(7 / 16)

export type FasciaStock = '1x6' | '1x8' | '1x10' | '1x12'

/** The 1x boards a fascia or rake board is cut from, narrowest first, at their actual widths. */
export const FASCIA_STOCK: readonly { size: FasciaStock; width: number }[] = [
  { size: '1x6', width: inches(5.5) },
  { size: '1x8', width: inches(7.25) },
  { size: '1x10', width: inches(9.25) },
  { size: '1x12', width: inches(11.25) },
]

/**
 * The 1x a board `width` wide is cut from: the narrowest stock as wide, ripped down to it when
 * wider. Past a 1x12 no 1x is wide enough: a ripped width of wider stock (`stock` null).
 */
export function fasciaStockFor(width: number): { stock: FasciaStock | null; ripped: boolean } {
  const stock = FASCIA_STOCK.find((candidate) => candidate.width >= width - 1e-4)
  if (!stock) return { stock: null, ripped: true }
  return { stock: stock.size, ripped: stock.width - width > 1e-3 }
}

/**
 * How wide a board covering `cover` is, `scale` its width per unit of the cover's measure (a rake
 * board's, its plumb depth's cosine): `FASCIA_DROP` past it, or a 1x whole where one drops between
 * `least` and that, so the board is stock, not ripped.
 */
function boardWidth(cover: number, scale = 1, least = FASCIA_DROP_MIN): number {
  const whole = FASCIA_STOCK.find(
    ({ width }) =>
      width >= (cover + least) * scale - 1e-6 && width <= (cover + FASCIA_DROP) * scale + 1e-6,
  )
  return whole ? whole.width : (cover + FASCIA_DROP) * scale
}

/** A point of an eave's section: `s` out from the plate line in plan, `y` up from the plate's plane there. */
export type EavePoint = readonly [number, number]

/** The numbers an eave is cut from (`roofEaveProfile`), the roof shell's and Bones' alike. */
export type RoofEaveInput = {
  /** The slope's tangent, falling outward; 0 for a flat roof, negative where it rises (a shed's high edge). */
  tan: number
  /** Out from the plate line (the wall's centre line), in plan, to the overhang's end: where the tails are cut. */
  reach: number
  /** Out from the plate line to the wall's outer face. */
  wallOut: number
  /** The tails' depth square to the slope: a rafter's, or a truss's top chord. */
  tailDepth: number
  /**
   * How far the tails' underside stands over the plate's plane, plumb: 0 for a rafter, its bottom
   * chord's depth for a truss's top chord, which rides it at the heel.
   */
  tailLift: number
  /** The deck's depth square to the slope, from the plate's plane to the sheathing's top. */
  deckDepth: number
  /** Absent, plumb. */
  cut?: RoofEaveCut
  /** The fascia's own height (its width as a board) and thickness, where the plane sets them. */
  fasciaHeight?: number
  fasciaThickness?: number
  /** How far the fascia's top stands over the sheathing's: a flat roof's coping band over its membrane. */
  fasciaRise?: number
}

/**
 * One eave's section, the rule the roof shell's eave edge, fascia and soffit and Bones' rafter tails
 * and fascia are all cut by, so the frame never hangs below the shell nor pokes out of it.
 */
export type RoofEaveProfile = {
  /** The cut drawn: a flat eave, or an edge rising outward, is plumb whatever the plane asks. */
  cut: RoofEaveCut
  tan: number
  cos: number
  sin: number
  reach: number
  wallOut: number
  /** The sheathing's top at `s`. */
  top: (s: number) => number
  /** The tails' underside at `s`. */
  under: (s: number) => number
  /**
   * The tails' end, from its top corner on the sheathing's top down: a plumb or square cut's two
   * ends, or a plumb cut's and then its level cut's inner end.
   */
  end: readonly EavePoint[]
  /** The tails' lowest point's height. */
  low: number
  fascia: {
    /** Its section: back top, front top, front bottom, back bottom. */
    corners: readonly [EavePoint, EavePoint, EavePoint, EavePoint]
    /** Its width as a board: plumb, its height; square to the slope, its depth along its face. */
    height: number
    thickness: number
    /** Square to the slope (a `square` cut's), else plumb. */
    square: boolean
    stock: FasciaStock | null
    ripped: boolean
  }
  /** A boxed eave's soffit: its top (on the level cuts) and thickness, from the wall's outer face out to the fascia's back. */
  soffit: { y: number; thickness: number; from: number; to: number } | null
  /**
   * The rake board over a barge rafter on this slope: plumb, its top on the sheathing's top, as deep
   * plumb (`height`) as the fascia is at the corner, or over a boxed eave as the barge with the
   * fascia's drop; `width` is square to its edges, as a board.
   */
  rake: { height: number; width: number; stock: FasciaStock | null; ripped: boolean }
}

/**
 * An eave cut to its plane's rule. The tails reach `reach` out from the plate line along the
 * sheathing's top, the deck's full depth under it:
 *  - plumb: the tails cut plumb there; a plumb 1x fascia covers their face, its top flush with the
 *    sheathing's top (under the drip edge), its bottom about `FASCIA_DROP` below their lowest point;
 *  - square: the tails cut square to the slope through the sheathing's outer edge, the fascia square
 *    to the slope on them, its top face in the sheathing's plane;
 *  - plumb-level: the plumb cut, and under it a level cut `LEVEL_CUT_RUN` long (at most half the tail's
 *    plumb depth deep) that a soffit nails up to, run level from the fascia's back to the wall.
 * The fascia is as deep as that takes (a whole 1x where one drops at least 1/4 in under the tails,
 * else one ripped to it), unless the plane sets its own.
 */
export function roofEaveProfile(input: RoofEaveInput): RoofEaveProfile {
  const tan = Number.isFinite(input.tan) ? input.tan : 0
  const cos = 1 / Math.hypot(1, tan)
  const sin = tan * cos
  const { reach, wallOut, tailLift } = input
  const deck = Math.max(0, input.deckDepth)
  const top = (s: number) => deck / cos - s * tan
  const under = (s: number) => tailLift - s * tan
  const thickness = input.fasciaThickness ?? FASCIA_THICKNESS
  const cut: RoofEaveCut = tan > 1e-6 ? (input.cut ?? 'plumb') : 'plumb'
  const corner: EavePoint = [reach, top(reach)]
  let end: EavePoint[]
  let low: number
  let height: number
  let corners: [EavePoint, EavePoint, EavePoint, EavePoint]
  let soffit: RoofEaveProfile['soffit'] = null
  if (cut === 'square') {
    // the sheathing's top to the tails' underside, square to the slope
    const depth = deck - tailLift * cos
    height = input.fasciaHeight ?? boardWidth(depth)
    const down = (d: number): EavePoint => [reach - d * sin, corner[1] - d * cos]
    const out = (point: EavePoint): EavePoint => [
      point[0] + thickness * cos,
      point[1] - thickness * sin,
    ]
    const foot = down(depth)
    end = [corner, foot]
    low = foot[1]
    const bottom = down(height)
    corners = [corner, out(corner), out(bottom), bottom]
  } else {
    let foot = under(reach)
    if (cut === 'plumb-level') {
      const run = Math.min(LEVEL_CUT_RUN, input.tailDepth / cos / (2 * tan))
      foot = under(reach) + run * tan
      end = [corner, [reach, foot], [reach - run, foot]]
      soffit = { y: foot, thickness: SOFFIT_THICKNESS, from: wallOut, to: reach }
    } else end = [corner, [reach, foot]]
    low = foot
    const topY = corner[1] + (input.fasciaRise ?? 0)
    // past a boxed eave's soffit, the fascia drops its whole 3/4 in under the level cuts
    height =
      input.fasciaHeight ??
      boardWidth(
        topY - foot,
        1,
        cut === 'plumb-level' ? SOFFIT_THICKNESS + FASCIA_DROP_MIN : FASCIA_DROP_MIN,
      )
    corners = [
      [reach, topY],
      [reach + thickness, topY],
      [reach + thickness, topY - height],
      [reach, topY - height],
    ]
  }
  // A rake board meets the eave's fascia flush at the corner: as deep at its foot (plumb, or square
  // along the cut), so neither hangs past the other. Over a boxed eave it covers the barge whole,
  // held level with the fascia's bottom at the corner.
  const rakeHeight =
    input.fasciaHeight ??
    (cut === 'plumb'
      ? height
      : cut === 'square'
        ? height / cos
        : boardWidth(deck / cos - tailLift, cos) / cos)
  return {
    cut,
    tan,
    cos,
    sin,
    reach,
    wallOut,
    top,
    under,
    end,
    low,
    fascia: {
      corners,
      height,
      thickness,
      square: cut === 'square',
      ...fasciaStockFor(height),
    },
    soffit,
    rake: { height: rakeHeight, width: rakeHeight * cos, ...fasciaStockFor(rakeHeight * cos) },
  }
}

/**
 * Whether a point of an eave's section, out past the wall's outer face, lies in the shell's eave
 * (`tolerance` either way): under the sheathing's top, inside the tails' end cut, and over their
 * underside or a boxed eave's soffit.
 */
export function eaveContains(profile: RoofEaveProfile, [s, y]: EavePoint, tolerance = 0): boolean {
  const { reach, cut, cos, sin, top, under, soffit } = profile
  if (y > top(s) + tolerance || s > reach + tolerance) return false
  const [cs, cy] = profile.end[0] as EavePoint
  if (cut === 'square' && (s - cs) * cos - (y - cy) * sin > tolerance) return false
  // a boxed eave stands on its soffit: under it the deck is cut away
  const floor = soffit ? soffit.y - soffit.thickness : under(s)
  return y >= floor - tolerance
}

type EaveSegment = Pick<
  RoofSegmentNode,
  'roofType' | 'pitch' | 'width' | 'depth' | 'wallThickness' | 'overhang' | 'deckThickness'
> &
  Partial<
    Pick<
      RoofSegmentNode,
      | 'gableOverhang'
      | 'buildUp'
      | 'eaveCut'
      | 'fasciaHeight'
      | 'fasciaDepth'
      | 'shingleThickness'
      | 'barrelRise'
      | 'barrelSegments'
    >
  >

/**
 * The numbers a roof plane's eaves are cut from (`roofEaveProfile`): its reach and wall, its layers'
 * structure and deck, its eave cut and fascia. Its rafters sit on the plate; a truss's top chord on
 * its bottom chord at the heel. A plane without layers is taken as rafters under a 7/16 in sheet,
 * as deep as its deck. `high`: a shed's high edge, rising outward, cut plumb.
 */
export function roofSegmentEaveInput(
  node: EaveSegment,
  edge: 'eave' | 'high' = 'eave',
): RoofEaveInput {
  const { tanTheta } = getSegmentSlopeFrame(node)
  const deck = Math.max(0, node.deckThickness)
  const structure = node.buildUp?.structure
  const chord = structure ? LUMBER_DEPTH[structure.size] : 0
  const tailDepth = structure ? chord : Math.max(0, deck - Math.min(BARE_SHEATHING, deck / 2))
  return {
    tan: edge === 'high' ? -tanTheta : tanTheta,
    reach: getRoofSegmentDeckReach(node).z,
    wallOut: Math.max(0, node.wallThickness) / 2,
    tailDepth,
    tailLift: structure?.system === 'trusses' ? chord : 0,
    deckDepth: deck,
    cut: edge === 'high' ? 'plumb' : (node.eaveCut ?? 'plumb'),
    ...(node.fasciaHeight !== undefined ? { fasciaHeight: node.fasciaHeight } : {}),
    ...(node.fasciaDepth !== undefined ? { fasciaThickness: node.fasciaDepth } : {}),
    // a flat roof's boards sized on purpose rise over its membrane's edge: a coping band
    ...(node.roofType === 'flat' && node.fasciaHeight !== undefined
      ? { fasciaRise: Math.max(0, node.shingleThickness ?? 0) }
      : {}),
  }
}

/** A roof plane's eave (`roofSegmentEaveInput`, `roofEaveProfile`). */
export function roofSegmentEaveProfile(
  node: EaveSegment,
  edge: 'eave' | 'high' = 'eave',
): RoofEaveProfile {
  return roofEaveProfile(roofSegmentEaveInput(node, edge))
}
