import { JOINT_TOLERANCE_MM, jointStationsMm, type StripPiece } from './strip-pack'
import type { CourseLayout } from './tie-grid'

/**
 * What gets craned as one piece, what it weighs, and where the hook goes.
 *
 * A ganged face is assembled flat on the ground — panels bolted together, walers on,
 * ties threaded — and lifted in as one unit. That is the whole economic argument for a
 * panel system: the crew sets a 10 m² gang in one pick instead of six panels in six.
 * Every rule in `strip-pack.ts` and `courses.ts` about aligned joints exists partly for
 * this, and `layOut`'s note that the widest panels finish at the ends is describing a
 * gang rather than a bill.
 *
 * ## A gang can only break where every course breaks
 *
 * The one hard constraint, and the reason this is not a division of the run into equal
 * lengths. A gang boundary is a physical separation: the panels either side of it are
 * bolted to different assemblies and lifted at different times. So it has to fall on a
 * joint — and on a joint in *every* course, because a course whose panel spans the
 * proposed line would have to be cut in half to allow it.
 *
 * Which is why the candidate breaks are the intersection of the courses' own joint
 * stations rather than each course's own. Where a course is staggered (`FaceLayout`'s
 * `staggeredCourseIndices` — a width the system does not sell at that height) it shares
 * few stations with the base course or none, and the intersection shrinks accordingly.
 * That is not a defect in this module: a face that cannot be divided is a face that has
 * to be craned in one pick, and if that pick is over the crane, the answer is a
 * different layout rather than a gang boundary through the middle of a panel.
 *
 * ## No limits stated means one gang, not a guessed division
 *
 * Given no crane capacity and no width limit, the whole face comes back as a single
 * gang. Nothing in the scene said it had to be split, and a division invented here
 * would be a number on a drawing that no crane, transport width or lifting frame
 * justifies. `acquire.ts` and `sets.ts` take the same line about stock: state it, or the
 * output says what it does not know.
 *
 * ## A pick weight is refused rather than estimated
 *
 * Following `bomWeightKg` exactly: one piece with no stated weight voids the gang's
 * total instead of reducing it. A gang is the one figure on the drawing somebody
 * hangs a crane off, so a total that is quietly 40 kg light is worse than no total at
 * all — and the pieces that voided it are named, so the gap is fixable rather than
 * mysterious.
 *
 * A catalog `weightKg` of `0` counts as unstated, not as weightless. Several column
 * entries carry zero because the published sheet gives a range, which `geometry-column`
 * already guards with its own `statedWeight`; the same trap reaches a gang through a
 * panel list, and a zero here would sail under any capacity check.
 *
 * The weight is the *forms*: panels and make-up pieces. Walers, ties and brackets are
 * enumerated a layer up in `geometry-wall.ts` and are not visible here, so a caller
 * that needs the full assembled weight adds them — see `gangPickWeightKg`, which is
 * where that sum belongs and says what it is missing.
 */

/**
 * Where a two-point pick balances, as a fraction of the gang's width from each end.
 *
 * A uniformly loaded beam picked at two points has its largest bending moment
 * minimised when the points sit at 0.2071 L from each end — the span moment and the
 * cantilever moment come out equal there. Ganged formwork is close enough to uniformly
 * loaded for this to be the position riggers actually use, and it is a long way from
 * the midpoint guess: on a 6 m gang it is 1.24 m in, not 1.5 m.
 */
export const IDEAL_PICK_FRACTION = 0.2071

/**
 * Sling angle from the horizontal, degrees, where none is given.
 *
 * 60° is the ordinary site rule, and it is a floor rather than a target: flatter than
 * about 45° the leg tension runs away — at 30° each leg carries the whole gang — which
 * is why lifting plans specify a minimum. It matters here because it fixes the headroom
 * the pick needs: the steeper the sling, the higher the hook sits above the gang for the
 * same spread between the eyes. A gang that wants more height under the hook than the
 * crane has does not get lifted whatever its weight says.
 */
export const DEFAULT_SLING_ANGLE_DEG = 60

/** What closed a gang at the station it closed at. */
export type GangBound =
  /** The face ran out — the ordinary last gang. */
  | 'run-end'
  /** One more segment would have gone over the crane's capacity. */
  | 'pick-weight'
  /** One more segment would have gone over the stated gang width. */
  | 'max-width'

export type GangWarningKind =
  /** A gang is over the stated pick weight and holds no joint line to split it at. */
  | 'over-pick-weight'
  /** A gang is wider than the stated limit and holds no joint line to split it at. */
  | 'over-max-width'
  /** A piece in the gang has no stated weight, so the gang has no total. */
  | 'weight-not-stated'
  /** The ideal lifting position lands on a filler or a cut board, which has no frame. */
  | 'lifting-point-moved'
  /** No panel in the top course at all, so there is nothing to bolt a lifting eye to. */
  | 'no-lifting-panel'

export interface GangWarning {
  kind: GangWarningKind
  message: string
  gangIndex: number
  /** What the gang is, against what was allowed — both in the warning's own unit. */
  actual?: number
  allowed?: number
}

/** Where a crane hooks on, and what that hook carries. */
export interface LiftingPoint {
  /** Station along the run, mm from the run's start. */
  alongMm: number
  /** Elevation above the pour base, mm — the head of the gang's top course. */
  elevationMm: number
  /** The panel the eye bolts to. A frame profile, never a make-up piece. */
  panelId: string
  /** Share of the pick, kg. Absent wherever the gang has no total. */
  loadKg?: number
  /** How far the point sits off the balanced position because the frame is where it is. */
  offsetFromIdealMm: number
}

/** One piece of a gang, and which course it is on. */
export interface GangPiece {
  courseIndex: number
  piece: StripPiece
}

export interface Gang {
  /** 0-based along the run, so a mark can name the gang a panel belongs to. */
  index: number
  /** Station of the gang's start, mm from the run's start. */
  fromMm: number
  toMm: number
  widthMm: number
  /** The stack it covers — a gang is full lift height, base of the lowest course up. */
  baseMm: number
  topMm: number
  heightMm: number
  courseCount: number
  pieces: GangPiece[]
  /** How many of those pieces are panels — what the assembly is bolted together from. */
  panelCount: number
  /** Panels and make-up pieces, kg. Absent where any piece has no stated weight. */
  pickWeightKg?: number
  /** The pieces that voided the total, by description. Empty is the ordinary case. */
  unweighed: string[]
  liftingPoints: LiftingPoint[]
  /**
   * Headroom the crane needs between the top of the gang and the hook, mm, for the
   * sling angle in force. Absent where there are fewer than two lifting points.
   */
  minHookHeightMm?: number
  endedBy: GangBound
  /** Set where the gang breaks a stated limit and no joint inside it allows a smaller one. */
  overLimit?: true
}

export interface FaceGangs {
  gangs: Gang[]
  /** Stations a gang may break at — a joint in every course, mm along the run. */
  breakStationsMm: number[]
  /** Every gang's weight summed. Absent where any one of them has no total. */
  totalWeightKg?: number
  /** The heaviest single pick, kg — the figure a crane is chosen against. */
  heaviestPickKg?: number
  warnings: GangWarning[]
}

export interface GangOptions {
  /**
   * Heaviest pick the crane will take at this gang's radius, kg.
   *
   * At *this* radius: a tower crane's capacity falls along the jib, so the figure that
   * applies to a wall 40 m out is not the one on the front of the brochure. The caller
   * reads the curve and hands in the answer, because nothing in a face layout knows
   * where the crane stands.
   */
  maxPickWeightKg?: number
  /** Widest gang that can be craned or moved on the road, mm. */
  maxWidthMm?: number
  /** Sling angle from horizontal, degrees. Defaults to `DEFAULT_SLING_ANGLE_DEG`. */
  slingAngleDeg?: number
}

/**
 * A catalog weight, or nothing where the list does not state one.
 *
 * Zero is unstated rather than weightless — the same guard `geometry-column`'s
 * `statedWeight` applies for the same reason, arriving here through a panel list.
 */
function statedWeightKg(piece: StripPiece): number | undefined {
  if (piece.kind === 'panel') return piece.panel.weightKg > 0 ? piece.panel.weightKg : undefined
  if (piece.kind === 'filler') return piece.filler.weightKg > 0 ? piece.filler.weightKg : undefined
  // A board somebody cuts. Nothing in the catalog answers its weight, because nothing in
  // the catalog is this piece.
  return undefined
}

function pieceLabel(piece: StripPiece): string {
  if (piece.kind === 'panel') return piece.panel.label
  if (piece.kind === 'filler') return piece.filler.label
  return `Cut board ${Math.round(piece.widthMm)} mm`
}

/** The run's own length, taken from the widest course — every course packs the same run. */
function runEndMm(courses: readonly CourseLayout[]): number {
  return courses.reduce((end, { pack }) => Math.max(end, pack.pieces.at(-1)?.toMm ?? 0), 0)
}

/**
 * Stations that are a joint in every course — the only places a gang may break.
 *
 * Intersected rather than unioned: a station that is a joint on three courses and the
 * middle of a panel on the fourth cannot be a gang boundary, because separating the
 * assemblies there means cutting that panel.
 */
function commonBreakStationsMm(courses: readonly CourseLayout[]): number[] {
  const first = courses[0]
  if (first === undefined) return []
  let shared = jointStationsMm(first.pack)
  for (const { pack } of courses.slice(1)) {
    const here = jointStationsMm(pack)
    shared = shared.filter((station) =>
      here.some((other) => Math.abs(other - station) <= JOINT_TOLERANCE_MM),
    )
    if (shared.length === 0) break
  }
  return [...new Set(shared.map((station) => Math.round(station)))].sort((a, b) => a - b)
}

interface Span {
  pieces: GangPiece[]
  panelCount: number
  weightKg?: number
  unweighed: string[]
}

/** Everything the courses hold between two stations, weighed if every piece can be. */
function spanBetween(courses: readonly CourseLayout[], fromMm: number, toMm: number): Span {
  const pieces: GangPiece[] = []
  const unweighed: string[] = []
  let panelCount = 0
  let weightKg = 0
  let weighable = true
  for (const [courseIndex, { pack }] of courses.entries()) {
    for (const piece of pack.pieces) {
      if (piece.fromMm < fromMm - JOINT_TOLERANCE_MM) continue
      if (piece.toMm > toMm + JOINT_TOLERANCE_MM) continue
      pieces.push({ courseIndex, piece })
      if (piece.kind === 'panel') panelCount++
      const stated = statedWeightKg(piece)
      if (stated === undefined) {
        weighable = false
        unweighed.push(pieceLabel(piece))
      } else weightKg += stated
    }
  }
  return {
    pieces,
    panelCount,
    ...(weighable ? { weightKg } : {}),
    unweighed: [...new Set(unweighed)],
  }
}

/**
 * Where the eyes go on one gang.
 *
 * The balanced position is `IDEAL_PICK_FRACTION` in from each end, and then the frame
 * has the last word: a lifting eye bolts through a panel's steel profile, so a point
 * that lands on a filler plate or on a board somebody cut is moved to the nearest panel
 * and the move is reported. Two points on the same panel is a perfectly ordinary pick
 * and not treated as a special case — a single wide panel is craned on two eyes.
 */
function liftingPointsFor(
  gang: Pick<Gang, 'fromMm' | 'toMm' | 'widthMm' | 'topMm' | 'pickWeightKg'>,
  topCoursePieces: readonly StripPiece[],
): { points: LiftingPoint[]; moved: boolean } {
  const panels = topCoursePieces.filter((piece) => piece.kind === 'panel')
  if (panels.length === 0) return { points: [], moved: false }
  const inset = gang.widthMm * IDEAL_PICK_FRACTION
  const ideals = [gang.fromMm + inset, gang.toMm - inset]
  const points: LiftingPoint[] = []
  let moved = false
  for (const ideal of ideals) {
    const over = panels.find((piece) => piece.fromMm <= ideal && ideal <= piece.toMm)
    const host =
      over ??
      panels.reduce((nearest, piece) => {
        const mid = (piece.fromMm + piece.toMm) / 2
        const held = (nearest.fromMm + nearest.toMm) / 2
        return Math.abs(mid - ideal) < Math.abs(held - ideal) ? piece : nearest
      }, panels[0] as StripPiece)
    // On the host panel the eye can sit anywhere along the top rail, so an ideal that
    // already falls on a panel is used as it stands. One that does not is brought to the
    // panel's centre, which is the strongest point of the rail rather than its edge.
    const alongMm = over ? ideal : (host.fromMm + host.toMm) / 2
    if (!over) moved = true
    points.push({
      alongMm: Math.round(alongMm),
      elevationMm: Math.round(gang.topMm),
      panelId: host.kind === 'panel' ? host.panel.id : '',
      ...(gang.pickWeightKg === undefined
        ? {}
        : { loadKg: Math.round((gang.pickWeightKg / ideals.length) * 10) / 10 }),
      offsetFromIdealMm: Math.round(alongMm - ideal),
    })
  }
  return { points, moved }
}

/**
 * Group a packed face into craneable gangs.
 *
 * Greedy along the run and deliberately so: the boundaries are joints that already
 * exist, the objective is the fewest picks, and taking each gang as far as the limits
 * allow is what produces them. There is nothing to optimise between — a division that
 * balances the gangs' weights costs an extra pick to do it, and a pick is the unit the
 * crane charges in.
 */
export function gangFace(courses: readonly CourseLayout[], opts: GangOptions = {}): FaceGangs {
  const breakStationsMm = commonBreakStationsMm(courses)
  const end = runEndMm(courses)
  const warnings: GangWarning[] = []
  if (courses.length === 0 || end <= 0) {
    return { gangs: [], breakStationsMm, warnings }
  }

  const baseMm = Math.min(...courses.map(({ course }) => course.baseMm))
  const topMm = Math.max(...courses.map(({ course }) => course.topMm))
  const bounds = [...breakStationsMm.filter((station) => station < end), end]

  const overWidth = (fromMm: number, toMm: number): boolean =>
    opts.maxWidthMm !== undefined && toMm - fromMm > opts.maxWidthMm
  const overWeight = (span: Span): boolean =>
    opts.maxPickWeightKg !== undefined &&
    span.weightKg !== undefined &&
    span.weightKg > opts.maxPickWeightKg

  const gangs: Gang[] = []
  let fromMm = 0
  let cursor = 0
  while (cursor < bounds.length) {
    // The furthest boundary still inside every limit. `-1` means even the first segment
    // breaks one, and no joint exists to make it smaller.
    let best = -1
    let bestSpan: Span | undefined
    for (let index = cursor; index < bounds.length; index++) {
      const toMm = bounds[index] as number
      const span = spanBetween(courses, fromMm, toMm)
      if (overWidth(fromMm, toMm) || overWeight(span)) break
      best = index
      bestSpan = span
    }

    let overLimit = false
    if (best < 0) {
      best = cursor
      overLimit = true
      bestSpan = spanBetween(courses, fromMm, bounds[best] as number)
    }
    const toMm = bounds[best] as number
    const span = bestSpan as Span
    const nextBound = bounds[best + 1]
    const endedBy: GangBound =
      nextBound === undefined
        ? 'run-end'
        : overWidth(fromMm, nextBound)
          ? 'max-width'
          : 'pick-weight'

    const index = gangs.length
    const shell = {
      index,
      fromMm,
      toMm,
      widthMm: toMm - fromMm,
      baseMm,
      topMm,
      heightMm: topMm - baseMm,
      courseCount: courses.length,
      ...(span.weightKg === undefined ? {} : { pickWeightKg: Math.round(span.weightKg * 10) / 10 }),
    }
    const topCourse = courses[courses.length - 1] as CourseLayout
    const { points, moved } = liftingPointsFor(
      shell,
      topCourse.pack.pieces.filter(
        (piece) =>
          piece.fromMm >= fromMm - JOINT_TOLERANCE_MM && piece.toMm <= toMm + JOINT_TOLERANCE_MM,
      ),
    )
    const spread =
      points.length < 2
        ? undefined
        : (points[1] as LiftingPoint).alongMm - (points[0] as LiftingPoint).alongMm
    gangs.push({
      ...shell,
      pieces: span.pieces,
      panelCount: span.panelCount,
      unweighed: span.unweighed,
      liftingPoints: points,
      ...(spread === undefined
        ? {}
        : {
            minHookHeightMm: Math.round(
              (Math.abs(spread) / 2) *
                Math.tan(((opts.slingAngleDeg ?? DEFAULT_SLING_ANGLE_DEG) * Math.PI) / 180),
            ),
          }),
      endedBy,
      ...(overLimit ? { overLimit: true as const } : {}),
    })

    if (span.unweighed.length > 0) {
      warnings.push({
        kind: 'weight-not-stated',
        gangIndex: index,
        message: `Gang ${index + 1} has no pick weight: ${span.unweighed.join(', ')} ${span.unweighed.length === 1 ? 'carries' : 'carry'} no stated weight. The rest of it comes to ${Math.round(span.pieces.reduce((sum, entry) => sum + (statedWeightKg(entry.piece) ?? 0), 0))} kg, which is a floor rather than a figure to lift against.`,
      })
    }
    if (overLimit && overWidth(fromMm, toMm)) {
      warnings.push({
        kind: 'over-max-width',
        gangIndex: index,
        actual: toMm - fromMm,
        allowed: opts.maxWidthMm,
        message: `Gang ${index + 1} is ${Math.round(toMm - fromMm)} mm wide against a ${opts.maxWidthMm} mm limit, and there is no joint line inside it to break at — every course would have to be cut. Re-lay the face with narrower panels or a joint at the width you need.`,
      })
    }
    if (overLimit && overWeight(span)) {
      warnings.push({
        kind: 'over-pick-weight',
        gangIndex: index,
        actual: span.weightKg,
        allowed: opts.maxPickWeightKg,
        message: `Gang ${index + 1} picks ${Math.round(span.weightKg ?? 0)} kg against ${opts.maxPickWeightKg} kg at this radius, and there is no joint line inside it to break at. This is a layout to redo, not a boundary to move: narrower panels give more joints, and a lighter panel of the same width gives a lighter gang.`,
      })
    }
    if (points.length === 0) {
      warnings.push({
        kind: 'no-lifting-panel',
        gangIndex: index,
        message: `Gang ${index + 1} has no panel on its top course, so there is nothing to bolt a lifting eye to — it is made up of fillers and cut boards and has to be hand-set or carried on a lifting frame.`,
      })
    } else if (moved) {
      warnings.push({
        kind: 'lifting-point-moved',
        gangIndex: index,
        message: `A lifting point on gang ${index + 1} sits off the balanced position because the balanced position lands on a make-up piece. An eye bolts to a panel's frame, so it has moved to the nearest panel and the gang lifts slightly out of level.`,
      })
    }

    fromMm = toMm
    cursor = best + 1
  }

  const weights = gangs.map((gang) => gang.pickWeightKg)
  const complete = weights.every((weight) => weight !== undefined)
  return {
    gangs,
    breakStationsMm,
    ...(complete
      ? {
          totalWeightKg:
            Math.round(weights.reduce((sum, weight) => sum + (weight as number), 0) * 10) / 10,
          heaviestPickKg: Math.max(...(weights as number[])),
        }
      : {}),
    warnings,
  }
}

/**
 * A gang's full assembled weight: its forms, plus what a caller adds to them.
 *
 * The forms are all this module can see. A ganged wall is craned with its walers,
 * ties, couplers, brackets and often its working platform attached — on a TRIO gang the
 * steelwork is a fifth of the pick — so a capacity check against the panel weight alone
 * passes gangs that do not lift. The extras are enumerated a layer up, in the geometry,
 * which is why they arrive as an argument rather than being guessed at here.
 *
 * `undefined` propagates in both directions: no forms total or no extras total means no
 * assembled total, for the reason the gang refuses one in the first place.
 */
export function gangPickWeightKg(gang: Gang, extrasKg: number | undefined): number | undefined {
  if (gang.pickWeightKg === undefined || extrasKg === undefined) return undefined
  return Math.round((gang.pickWeightKg + extrasKg) * 10) / 10
}

/** What makes a gang list wrong, in words, for a surface that prints one. */
export function formworkGangCaveats(gangs: FaceGangs, opts: GangOptions = {}): string[] {
  const out: string[] = []
  if (gangs.gangs.length === 0) return out
  if (opts.maxPickWeightKg === undefined && opts.maxWidthMm === undefined) {
    out.push(
      'No crane capacity or gang width was stated, so the face comes back as one gang. That is what the layout allows rather than what the site can lift — state the crane and the gangs divide at the joints that are already there.',
    )
  }
  out.push(
    'A pick weight is the panels and make-up pieces only. Walers, ties, couplers, brackets and any working platform travel with a ganged face and are not in these figures, so the load on the hook is higher than what is printed here.',
  )
  if (gangs.totalWeightKg === undefined) {
    out.push(
      'At least one gang has no weight at all, because a piece in it carries no stated weight — a site-cut board, or a catalog entry whose published sheet gives a range. Those gangs cannot be checked against a crane by this takeoff.',
    )
  }
  if (gangs.gangs.some((gang) => gang.overLimit)) {
    out.push(
      'A gang exceeds a stated limit and holds no joint line to break at. The face has to be re-laid — narrower panels, or a required joint where the boundary is needed — because a boundary anywhere else means cutting a panel in half.',
    )
  }
  if (
    gangs.gangs.some((gang) => gang.liftingPoints.some((point) => point.offsetFromIdealMm !== 0))
  ) {
    out.push(
      'Some lifting points sit off the balanced position, because an eye bolts to a panel frame and the balanced position landed on a make-up piece. Those gangs hang slightly out of level and want checking against the tag line before the first pick.',
    )
  }
  return out
}
