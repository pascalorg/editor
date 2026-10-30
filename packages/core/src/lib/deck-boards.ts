import type { ZoneNode } from '../schema'
import { area, intersection, type MultiPolygon, type Polygon } from './polygon-boolean'

/**
 * A deck's boards (a deck room, `lib/outdoor-room`): their stock, the gap between them and the way
 * they run, kept on the room (`decking`, absent = the defaults) and laid by the engine over the
 * deck's frame (`lib/deck-framing`). Sections are the boards' actual (dressed) ones: a 5/4x6 is
 * 1 in by 5 1/2 in. The boards run along the house (square to the joists), at 45° (the joists
 * then closer, IRC Table R507.7) or out from the house (the joists turned to run along it).
 */

const IN = 0.0254
const FT = 12 * IN

type P = readonly [number, number]

export const DECK_BOARD_SIZES = ['5/4x6', '2x6', '2x4', 'composite'] as const
export type DeckBoardSize = (typeof DECK_BOARD_SIZES)[number]

export const DECK_BOARD_DIRECTIONS = ['parallel', 'diagonal', 'perpendicular'] as const
/** The boards' run against the house: along it, at 45° to it, or out from it. */
export type DeckBoardDirection = (typeof DECK_BOARD_DIRECTIONS)[number]

export type DeckBoardStock = {
  label: string
  /** Actual section, metres. */
  thickness: number
  width: number
  /**
   * The widest joist spacing the boards may span (IRC Table R507.7): square to the joists, and
   * at 45° to them. Composite boards go by their maker's listing (R507.2.2); these are the
   * common 16 in and 12 in.
   */
  maxJoistSpacing: { square: number; diagonal: number }
}

export const DECK_BOARD_STOCK: Record<DeckBoardSize, DeckBoardStock> = {
  '5/4x6': {
    label: '5/4x6',
    thickness: 1 * IN,
    width: 5.5 * IN,
    maxJoistSpacing: { square: 16 * IN, diagonal: 12 * IN },
  },
  '2x6': {
    label: '2x6',
    thickness: 1.5 * IN,
    width: 5.5 * IN,
    maxJoistSpacing: { square: 24 * IN, diagonal: 16 * IN },
  },
  '2x4': {
    label: '2x4',
    thickness: 1.5 * IN,
    width: 3.5 * IN,
    maxJoistSpacing: { square: 24 * IN, diagonal: 16 * IN },
  },
  composite: {
    label: 'Composite',
    thickness: (15 / 16) * IN,
    width: 5.5 * IN,
    maxJoistSpacing: { square: 16 * IN, diagonal: 12 * IN },
  },
}

/** The gaps boards are laid at, narrowest first: 1/8, 3/16 and 1/4 in. */
export const DECK_BOARD_GAPS = [IN / 8, (3 * IN) / 16, IN / 4] as const

/** The longest board laid in one piece (16 ft stock); longer runs butt over a joist. */
export const DECK_BOARD_MAX_LENGTH = 16 * FT
/** The gap at a butt joint. */
export const DECK_BOARD_JOINT_GAP = IN / 8

export type DeckBoardSettings = {
  boardSize: DeckBoardSize
  /** Metres between boards. */
  gap: number
  direction: DeckBoardDirection
}

export const DEFAULT_DECK_BOARDS: DeckBoardSettings = {
  boardSize: '5/4x6',
  gap: IN / 4,
  direction: 'parallel',
}

const isBoardSize = (value: unknown): value is DeckBoardSize =>
  typeof value === 'string' && (DECK_BOARD_SIZES as readonly string[]).includes(value)
const isDirection = (value: unknown): value is DeckBoardDirection =>
  typeof value === 'string' && (DECK_BOARD_DIRECTIONS as readonly string[]).includes(value)

/** A deck's boards: its own settings, else the defaults (an unknown size or run is the default). */
export function deckBoardSettings(
  zone: Pick<ZoneNode, 'decking'> | null | undefined,
): DeckBoardSettings {
  const own = zone?.decking
  return {
    boardSize: isBoardSize(own?.boardSize) ? own.boardSize : DEFAULT_DECK_BOARDS.boardSize,
    gap: typeof own?.gap === 'number' && own.gap > 0 ? own.gap : DEFAULT_DECK_BOARDS.gap,
    direction: isDirection(own?.direction) ? own.direction : DEFAULT_DECK_BOARDS.direction,
  }
}

/** The boards on a deck room's floor plate, read from its room's intent. */
export function deckSlabBoards(
  slab: { zoneIds?: readonly string[] },
  zoneOf: (id: string) => Pick<ZoneNode, 'decking' | 'roomType'> | null | undefined,
): DeckBoardSettings {
  const zone = slab.zoneIds?.length === 1 ? zoneOf(slab.zoneIds[0]!) : undefined
  return zone?.roomType === 'deck' ? deckBoardSettings(zone) : DEFAULT_DECK_BOARDS
}

/** The boards' thickness: how far under the walking surface the joists' tops stand. */
export function deckBoardThickness(settings: Pick<DeckBoardSettings, 'boardSize'>): number {
  return DECK_BOARD_STOCK[settings.boardSize].thickness
}

/** The widest joist spacing these boards allow, laid as they run (Table R507.7). */
export function deckJoistSpacingLimit(
  settings: Pick<DeckBoardSettings, 'boardSize' | 'direction'>,
): number {
  const { maxJoistSpacing } = DECK_BOARD_STOCK[settings.boardSize]
  return settings.direction === 'diagonal' ? maxJoistSpacing.diagonal : maxJoistSpacing.square
}

/** The deck's frame axes (`deckAxes`): `u` along the house edge, `v` square to it, into the deck. */
export type DeckBoardAxes = { origin: P; u: P; v: P }

export type DeckBoardRun = {
  /** The way the boards run, a plan unit vector. */
  along: [number, number]
  /** Square to it: the way the rows are laid. */
  across: [number, number]
}

/** Which way a deck's boards run over its frame. */
export function deckBoardRun(axes: DeckBoardAxes, direction: DeckBoardDirection): DeckBoardRun {
  const { u, v } = axes
  if (direction === 'perpendicular') return { along: [v[0], v[1]], across: [u[0], u[1]] }
  if (direction === 'diagonal') {
    const k = Math.SQRT1_2
    return {
      along: [(u[0] + v[0]) * k, (u[1] + v[1]) * k],
      across: [(v[0] - u[0]) * k, (v[1] - u[1]) * k],
    }
  }
  return { along: [u[0], u[1]], across: [v[0], v[1]] }
}

/**
 * The joists a long board butts over: their centrelines, the lines where a point's distance
 * along `axis` from `origin` is one of `stations`.
 */
export type DeckBoardJoists = { origin: P; axis: P; stations: readonly number[] }

/** A sliver under this (m²) is not laid. */
const MIN_BOARD_AREA = 1e-4
/** No board is cut shorter than this at a butt joint. */
const MIN_BOARD_PIECE = 2 * FT

/**
 * The boards over `outline` (a deck's top): rows of the board's width, the gap apart, run as the
 * settings say and cut along the outline, any shape. Boards running along the house start full at
 * its outer edge, the last row ripped against the house; the others are centred, ripped alike at
 * both sides. A row longer than 16 ft is laid in lengths butted over the joists (`joists`), the
 * joints of neighbouring rows staggered.
 */
export function layoutDeckBoards(
  outline: MultiPolygon,
  axes: DeckBoardAxes,
  settings: DeckBoardSettings,
  joists?: DeckBoardJoists,
): Polygon[] {
  const { along, across } = deckBoardRun(axes, settings.direction)
  const { width } = DECK_BOARD_STOCK[settings.boardSize]
  const pitch = width + settings.gap
  const [ox, oz] = axes.origin
  const alongOf = (p: P) => (p[0] - ox) * along[0] + (p[1] - oz) * along[1]
  const acrossOf = (p: P) => (p[0] - ox) * across[0] + (p[1] - oz) * across[1]
  const at = (a: number, c: number): [number, number] => [
    ox + along[0] * a + across[0] * c,
    oz + along[1] * a + across[1] * c,
  ]
  let aMin = Number.POSITIVE_INFINITY
  let aMax = Number.NEGATIVE_INFINITY
  let cMin = Number.POSITIVE_INFINITY
  let cMax = Number.NEGATIVE_INFINITY
  for (const { outer } of outline)
    for (const p of outer) {
      aMin = Math.min(aMin, alongOf(p))
      aMax = Math.max(aMax, alongOf(p))
      cMin = Math.min(cMin, acrossOf(p))
      cMax = Math.max(cMax, acrossOf(p))
    }
  if (!(cMax - cMin > 1e-6 && aMax - aMin > 1e-6)) return []
  const rows = Math.ceil((cMax - cMin + settings.gap) / pitch - 1e-9)
  // Along the house the first row is a full board at the outer edge; otherwise centred.
  const first =
    settings.direction === 'parallel'
      ? cMax - width
      : cMin - (rows * pitch - settings.gap - (cMax - cMin)) / 2
  const step = settings.direction === 'parallel' ? -pitch : pitch
  const band = (a0: number, a1: number, c0: number, c1: number): Polygon => ({
    outer: [at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)],
    holes: [],
  })
  // A joist's centreline crossing a row's middle, as a distance along the row.
  const crossings = (c: number): number[] => {
    if (!joists) return []
    const [ax, az] = joists.axis
    const dot = along[0] * ax + along[1] * az
    if (Math.abs(dot) < 1e-6) return []
    const offset =
      (ox - joists.origin[0]) * ax +
      (oz - joists.origin[1]) * az +
      c * (across[0] * ax + across[1] * az)
    return joists.stations.map((s) => (s - offset) / dot).sort((a, b) => a - b)
  }
  const boards: Polygon[] = []
  for (let row = 0; row < rows; row++) {
    const c0 = first + step * row
    const pieces = intersection(band(aMin - 1, aMax + 1, c0, c0 + width), outline).filter(
      (piece) => area([piece]) >= MIN_BOARD_AREA,
    )
    const joints = crossings(c0 + width / 2)
    for (const piece of pieces) {
      let start = Number.POSITIVE_INFINITY
      let end = Number.NEGATIVE_INFINITY
      for (const p of piece.outer) {
        start = Math.min(start, alongOf(p))
        end = Math.max(end, alongOf(p))
      }
      // Butt joints, staggered by row: the first length a third shorter each row in three.
      const cuts: number[] = []
      let from = start
      let limit = DECK_BOARD_MAX_LENGTH * (1 - (row % 3) / 3)
      while (end - from > DECK_BOARD_MAX_LENGTH + 1e-9) {
        const joint = joints
          .filter(
            (a) => a > from + MIN_BOARD_PIECE && a <= from + limit && a < end - MIN_BOARD_PIECE,
          )
          .at(-1)
        if (joint === undefined) break
        cuts.push(joint)
        from = joint
        limit = DECK_BOARD_MAX_LENGTH
      }
      if (!cuts.length) {
        boards.push(piece)
        continue
      }
      const half = DECK_BOARD_JOINT_GAP / 2
      const bounds = [start - 1, ...cuts.flatMap((a) => [a - half, a + half]), end + 1]
      for (let i = 0; i + 1 < bounds.length; i += 2)
        boards.push(
          ...intersection(band(bounds[i]!, bounds[i + 1]!, c0 - 1, c0 + width + 1), piece).filter(
            (part) => area([part]) >= MIN_BOARD_AREA,
          ),
        )
    }
  }
  return boards
}
