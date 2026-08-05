import {
  type FormworkSystem,
  governingCapacity,
  permissiblePressureKnM2,
  type TieType,
  tieForThickness,
} from '../catalog'
import type { Course } from './stack'
import type { StripPack } from './strip-pack'

/**
 * Where the ties actually go.
 *
 * A tie calculation that returns a spacing is answering the wrong question on a
 * panel system. The frame is drilled: TRIO's 2.70 m panel has holes at 575 and
 * 2125 mm and nothing between them, so the 1550 mm gap is not available however
 * much the pressure would like a tie at 1350. If the tributary load on the holes
 * that exist exceeds what a tie carries, the answer is not another tie — there is
 * nowhere to put it — it is to **reduce the pressure**: pour slower, pour warmer,
 * use a stiffer consistency. That is the finding this module exists to produce.
 *
 * Horizontally the same: holes sit at the panel's own columns, which for a wide
 * panel is two positions and for a narrow one is one, so a run of 0.30 panels ties
 * three times as often as the pressure asks and a 2.40 panel may tie less often
 * than it asks.
 *
 * Force per tie is the tributary area times the pressure over it. `pressureAtMm`
 * lets the pressure envelope vary up the pour — the real one is hydrostatic to
 * some depth and then constant — and defaults to the flat value, so this stays
 * usable before the pressure module lands.
 */

export interface CourseLayout {
  course: Course
  pack: StripPack
}

export interface Tie {
  /** Station along the run, mm from the run's start. */
  alongMm: number
  /** Elevation above the pour base, mm. */
  elevationMm: number
  /** The panel whose hole this is. */
  panelId: string
  /** Tributary area this tie carries, m². */
  tributarySqM: number
  /** Load on it, kN, from the pressure over its tributary area. */
  forceKn: number
}

export type TieWarningKind =
  /**
   * The load on a drilled hole exceeds the tie's governing capacity and no hole
   * exists to share it with. The fix is a lower pressure, not more ties.
   */
  | 'over-capacity-no-hole'
  /** Holes further apart than the system's own practical limit. */
  | 'spacing-exceeds-practical'
  /** A stretch of the run with no tie hole at all — a filler wider than a joint. */
  | 'untied-stretch'
  /** No tie in the system reaches this wall thickness. */
  | 'no-tie-for-thickness'

export interface TieWarning {
  kind: TieWarningKind
  message: string
  alongMm?: number
  elevationMm?: number
  /** What the ties would have to carry, kN. */
  demandKn?: number
  capacityKn?: number
}

export interface TieGrid {
  ties: Tie[]
  tie: TieType | undefined
  /** What actually governs the tie — the rod, or the bracket it bears on. */
  governingCapacityKn: number
  governingComponent: string
  warnings: TieWarning[]
  /** Widest gap between adjacent tie columns, mm — what the panel has to span. */
  maxColumnGapMm: number
  maxRowGapMm: number
}

export interface TieGridOptions {
  /** Fresh-concrete pressure, kN/m². Used where `pressureAtMm` is not given. */
  pressureKnM2: number
  /** Pressure at an elevation above the pour base, kN/m² — the real envelope. */
  pressureAtMm?: (elevationMm: number) => number
  wallThicknessMm: number
  kind?: 'wall' | 'column'
  /** Overrides the system's own practical cap, mm. */
  maxSpacingMm?: number
}

/** One drilled hole, in run coordinates. */
export interface TieHole {
  alongMm: number
  elevationMm: number
  panelId: string
}

/**
 * Every hole the packed panels bring, without a load check. This is what a
 * drawing needs — a tie can only be where the frame was drilled, whatever the
 * pressure turns out to be — so it is separate from `tieGrid`, which is the same
 * positions with a force and a verdict on each.
 */
export function tieHoles(courses: readonly CourseLayout[]): TieHole[] {
  const holes: TieHole[] = []
  for (const { course, pack } of courses) {
    for (const piece of pack.pieces) {
      if (piece.kind !== 'panel') continue
      for (const column of piece.panel.tieHoles.columnsMm) {
        for (const level of piece.panel.tieHoles.levelsMm) {
          holes.push({
            alongMm: piece.fromMm + column,
            elevationMm: course.baseMm + level,
            panelId: piece.panel.id,
          })
        }
      }
    }
  }
  return holes
}

/** Half the distance to each neighbour, or out to the boundary at the ends. */
function tributarySpan(
  positions: readonly number[],
  index: number,
  loMm: number,
  hiMm: number,
): number {
  const here = positions[index] as number
  const previous = index > 0 ? (positions[index - 1] as number) : undefined
  const next = index < positions.length - 1 ? (positions[index + 1] as number) : undefined
  const lower = previous === undefined ? here - loMm : (here - previous) / 2
  const upper = next === undefined ? hiMm - here : (next - here) / 2
  return lower + upper
}

function widestGap(positions: readonly number[]): number {
  let widest = 0
  for (let i = 1; i < positions.length; i++) {
    widest = Math.max(widest, (positions[i] as number) - (positions[i - 1] as number))
  }
  return widest
}

/**
 * Ties for a stack of packed courses. Rows come from each course's own panels, so
 * a 1.35 m course sitting on a 2.70 m one ties on its own schedule rather than on
 * a continuation of the one below — which is what the drilled frames actually do.
 */
export function tieGrid(
  system: FormworkSystem,
  courses: readonly CourseLayout[],
  opts: TieGridOptions,
): TieGrid {
  const warnings: TieWarning[] = []
  const tie = tieForThickness(system, opts.wallThicknessMm)
  if (!tie) {
    warnings.push({
      kind: 'no-tie-for-thickness',
      message: `No ${system.label} tie reaches a ${opts.wallThicknessMm} mm wall — the through-rod has to be specified outside the system.`,
    })
  }
  const governing = tie
    ? governingCapacity(tie)
    : { capacityKn: Number.POSITIVE_INFINITY, component: 'unspecified' }
  const pressureAt = opts.pressureAtMm ?? (() => opts.pressureKnM2)
  const practicalMm = opts.maxSpacingMm ?? system.maxPracticalTieSpacingMm
  const kind = opts.kind ?? 'wall'

  const ties: Tie[] = []
  let maxColumnGapMm = 0
  let maxRowGapMm = 0

  for (const entry of courses) {
    const { course, pack } = entry
    const holes = tieHoles([entry])
    if (holes.length === 0) {
      const first = pack.pieces[0]
      const last = pack.pieces.at(-1)
      if (first && last) {
        warnings.push({
          kind: 'untied-stretch',
          message: `Course at ${course.baseMm} mm has no drilled tie hole across ${last.toMm - first.fromMm} mm — it is held by its couplers and the course below, which has to be checked by hand.`,
          alongMm: first.fromMm,
          elevationMm: course.baseMm,
        })
      }
      continue
    }

    const columns = [...new Set(holes.map((hole) => hole.alongMm))].sort((a, b) => a - b)
    const rows = [...new Set(holes.map((hole) => hole.elevationMm))].sort((a, b) => a - b)
    const runLo = pack.pieces[0]?.fromMm ?? 0
    const runHi = pack.pieces.at(-1)?.toMm ?? runLo
    maxColumnGapMm = Math.max(maxColumnGapMm, widestGap(columns))
    maxRowGapMm = Math.max(maxRowGapMm, widestGap(rows))

    for (const hole of holes) {
      const columnIndex = columns.indexOf(hole.alongMm)
      const rowIndex = rows.indexOf(hole.elevationMm)
      const widthMm = tributarySpan(columns, columnIndex, runLo, runHi)
      const heightMm = tributarySpan(rows, rowIndex, course.baseMm, course.topMm)
      const tributarySqM = (widthMm / 1000) * (heightMm / 1000)
      const forceKn = tributarySqM * pressureAt(hole.elevationMm)
      ties.push({ ...hole, tributarySqM, forceKn })
    }

    // The panel's own rating is checked here too: a tie the frame can carry and a
    // frame the tie can carry are different questions, and the narrower panel that
    // would fix an overload may also be the one that is uprated.
    for (const piece of pack.pieces) {
      if (piece.kind !== 'panel') continue
      const permissible = permissiblePressureKnM2(piece.panel, kind)
      const worst = pressureAt(course.baseMm)
      if (worst > permissible) {
        warnings.push({
          kind: 'over-capacity-no-hole',
          message: `${piece.panel.label} is rated ${permissible} kN/m² and sees ${worst.toFixed(1)} kN/m² at ${course.baseMm} mm. Reduce the pour rate or the pressure — the panel's rating is not a spacing you can adjust.`,
          alongMm: piece.fromMm,
          elevationMm: course.baseMm,
          demandKn: worst,
          capacityKn: permissible,
        })
      }
    }
  }

  for (const entry of ties) {
    if (entry.forceKn > governing.capacityKn) {
      warnings.push({
        kind: 'over-capacity-no-hole',
        message: `The hole at ${Math.round(entry.alongMm)} × ${Math.round(entry.elevationMm)} mm carries ${entry.forceKn.toFixed(1)} kN against ${governing.capacityKn} kN at the ${governing.component}. The frame is drilled, so there is no hole to share it with: reduce the pressure — a slower rise, warmer concrete or a stiffer consistency — or change to a system whose holes are closer.`,
        alongMm: entry.alongMm,
        elevationMm: entry.elevationMm,
        demandKn: entry.forceKn,
        capacityKn: governing.capacityKn,
      })
    }
  }

  if (maxColumnGapMm > practicalMm) {
    warnings.push({
      kind: 'spacing-exceeds-practical',
      message: `Tie columns are up to ${Math.round(maxColumnGapMm)} mm apart against a practical limit of ${practicalMm} mm. The panels are stiff enough on paper; the crew will not like it.`,
    })
  }

  return {
    ties,
    tie,
    governingCapacityKn: governing.capacityKn,
    governingComponent: governing.component,
    warnings,
    maxColumnGapMm,
    maxRowGapMm,
  }
}
