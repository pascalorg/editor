import type { FormworkSystem, PanelType } from '../catalog'
import { type PanelStack, type StackOptions, stackCourses } from './stack'
import { packStrip, type StripPackOptions, type StripPiece } from './strip-pack'
import type { CourseLayout } from './tie-grid'

/**
 * One face of one lift, packed: courses up it and panels along each of them.
 *
 * The reason this is a function rather than a loop at the call site is rule 3 —
 * panel joints are aligned up the wall, not staggered. That is the reverse of
 * masonry and it is not an aesthetic preference: a tie has to pass through holes
 * that line up on both skins, a waler coupler clamps across the joint and needs
 * coincident frame profiles, and the panels are craned as gangs. So the run is
 * packed once and every course above reuses the same stations, taking a panel of
 * its own height at each width.
 *
 * A course whose height has no panel at some station is packed on its own — a
 * staggered joint is worse than an aligned one, but a missing panel is worse than
 * either, and the systems where this happens (a 0.72 m TRIO width that exists at
 * 2.70 m and 1.20 m but not 0.60 m) are real.
 */
export interface FaceLayout {
  stack: PanelStack
  courses: CourseLayout[]
  /** Courses that could not reuse the base stations, so their joints do not align. */
  staggeredCourseIndices: number[]
  /** Width left unformed on any course, mm. */
  unfilledMm: number
}

export interface FaceLayoutOptions extends StackOptions {
  /** Length of the face run, mm — already clipped clear of the corner units. */
  runMm: number
  /** Height of concrete to form above the pour base, mm. */
  liftHeightMm: number
  fillerPosition?: StripPackOptions['fillerPosition']
  avoidPanelIds?: readonly string[]
  preferredWidthMm?: number
  maxPanelWeightKg?: number
  /** Stations along the run where a joint must fall — jambs, or a specified grid. */
  requiredJointsMm?: readonly number[]
  /** Elevations where a horizontal joint must fall. Separate from the stations. */
  requiredCourseJointsMm?: readonly number[]
}

function panelOfWidth(
  system: FormworkSystem,
  widthMm: number,
  heightMm: number,
  avoid: ReadonlySet<string>,
): PanelType | undefined {
  return system.panels
    .filter(
      (panel) =>
        panel.widthMm === widthMm &&
        panel.heightMm === heightMm &&
        !panel.universal &&
        !panel.selfCompacting &&
        !avoid.has(panel.id),
    )
    .sort((a, b) => a.weightKg - b.weightKg)[0]
}

/** The same pieces at another course height, or nothing if a width is missing there. */
function restack(
  system: FormworkSystem,
  pieces: readonly StripPiece[],
  heightMm: number,
  avoid: ReadonlySet<string>,
): StripPiece[] | undefined {
  const out: StripPiece[] = []
  for (const piece of pieces) {
    if (piece.kind !== 'panel') {
      out.push(piece)
      continue
    }
    const panel = panelOfWidth(system, piece.widthMm, heightMm, avoid)
    if (!panel) return undefined
    out.push({ ...piece, panel })
  }
  return out
}

export function layOutFace(system: FormworkSystem, opts: FaceLayoutOptions): FaceLayout {
  const stack = stackCourses(system, opts.liftHeightMm, {
    kickerMm: opts.kickerMm,
    minFreeboardMm: opts.minFreeboardMm,
    maxFreeboardMm: opts.maxFreeboardMm,
    avoidHeightsMm: opts.avoidHeightsMm,
    requiredJointsMm: opts.requiredCourseJointsMm,
  })
  const avoid = new Set(opts.avoidPanelIds ?? [])
  const packOptions = (heightMm: number): StripPackOptions => ({
    heightMm,
    fillerPosition: opts.fillerPosition,
    avoidPanelIds: opts.avoidPanelIds,
    preferredWidthMm: opts.preferredWidthMm,
    maxPanelWeightKg: opts.maxPanelWeightKg,
    requiredJointsMm: opts.requiredJointsMm,
  })

  const courses: CourseLayout[] = []
  const staggeredCourseIndices: number[] = []
  let unfilledMm = 0
  let base: CourseLayout | undefined

  for (const [index, course] of stack.courses.entries()) {
    const reused = base ? restack(system, base.pack.pieces, course.panelHeightMm, avoid) : undefined
    const pack =
      base && reused
        ? { ...base.pack, pieces: reused }
        : packStrip(system, opts.runMm, packOptions(course.panelHeightMm))
    if (base && !reused) staggeredCourseIndices.push(index)
    unfilledMm += base && reused ? 0 : pack.unfilledMm
    courses.push({ course, pack })
    base ??= { course, pack }
  }

  return { stack, courses, staggeredCourseIndices, unfilledMm }
}
