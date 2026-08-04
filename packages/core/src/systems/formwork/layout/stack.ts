import type { FormworkSystem, PanelType } from '../catalog'

/**
 * How many courses of panels stand up one lift, and where their horizontal joints
 * fall.
 *
 * The horizontal joint *is* the lift line: panels are set in whole courses, so the
 * pour stops where a course stops. A stack that ends level with the concrete has
 * no freeboard and the last 50 mm goes over the top, so the panels are run 50–150
 * mm proud — and running them much prouder than that means a taller panel was
 * spent than the lift needed.
 *
 * Panel heights are the alphabet here as widths are in `strip-pack.ts`, but the
 * cost is not the same shape. Horizontally the widest panel is always the best
 * one, because the widths have to sum exactly and a wider panel is a joint fewer.
 * Vertically they do not have to sum exactly — the stack only has to *reach* the
 * lift — so the tallest panel is not free: standing a 3.30 m panel to form 2.60 m
 * of concrete hires 700 mm of panel that holds nothing back. Every course costs
 * the same to crane and couple, so the choice is fewest courses first, then least
 * panel standing in the air.
 *
 * A stack that falls short cannot happen — another course can always be added.
 * What can happen is that the only combination reaching the lift overshoots the
 * 50–150 mm freeboard band, and that is worth saying rather than silently
 * accepting.
 */

/** Panels are run this far above the concrete so the last of the pour has a side. */
export const MIN_FREEBOARD_MM = 50
export const MAX_FREEBOARD_MM = 150

/**
 * A kicker — the 75–150 mm upstand cast with the slab that the wall form stands
 * against and locates off. It is part of the wall, not the form, so the courses
 * start at its top.
 */
export const DEFAULT_KICKER_MM = 100

const COURSE_COST = 1

export interface Course {
  /** Elevation of the course's base above the pour base, mm — kicker included. */
  baseMm: number
  topMm: number
  heightMm: number
  /** The panel heights available at this course; the strip pack picks widths. */
  panelHeightMm: number
}

export interface PanelStack {
  courses: Course[]
  /** How far the top course stands above the concrete, mm. */
  freeboardMm: number
  /** True when nothing in the system lands inside the 50–150 mm band. */
  freeboardOutOfBand: boolean
  kickerMm: number
  cost: number
}

export interface StackOptions {
  kickerMm?: number
  minFreeboardMm?: number
  maxFreeboardMm?: number
  /**
   * Panel heights the site will not use. A job that holds only 2.70 m stock does
   * not want a 1.35 m course proposed on top of it.
   */
  avoidHeightsMm?: readonly number[]
  /**
   * Elevations, mm above the pour base, where a horizontal joint must fall — a
   * construction joint the drawings fix, or a day-joint the programme fixes.
   */
  requiredJointsMm?: readonly number[]
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

interface HeightChoice {
  heightMm: number
}

/**
 * Course heights, tallest first. Only heights the system sells a plain run panel
 * in: a universal panel's height is the same, but the layout is not choosing to
 * spend one here.
 */
function heightChoices(system: FormworkSystem, opts: StackOptions): HeightChoice[] {
  const avoid = new Set(opts.avoidHeightsMm ?? [])
  return [
    ...new Set(
      system.panels
        .filter((panel: PanelType) => !panel.universal && !panel.selfCompacting)
        .map((panel) => panel.heightMm),
    ),
  ]
    .filter((heightMm) => !avoid.has(heightMm))
    .sort((a, b) => b - a)
    .map((heightMm) => ({ heightMm }))
}

interface StackChoice {
  heights: number[]
  cost: number
}

/**
 * The fewest courses reaching at least `targetMm`, and among those the one that
 * overshoots least. Both halves matter: a 4.00 m lift is two courses however you
 * cut it, and of 2.70 + 1.35 and 3.30 + 1.35 the first stands 50 mm proud where
 * the second stands 650 mm of hired panel in the air.
 */
function cheapestStack(
  choices: readonly HeightChoice[],
  targetMm: number,
): StackChoice | undefined {
  if (choices.length === 0 || targetMm <= 0) return { heights: [], cost: 0 }
  const grid = choices.reduce((held, choice) => gcd(held, choice.heightMm), 0)
  const tallest = choices[0]?.heightMm ?? 0
  // One course past the target is as far as it can pay to look: a stack
  // overshooting by a whole panel has a prefix that already cleared it.
  const steps = Math.ceil((targetMm + tallest) / grid)
  const courses = new Float64Array(steps + 1).fill(Number.POSITIVE_INFINITY)
  const via = new Int32Array(steps + 1).fill(-1)
  courses[0] = 0
  for (let i = 1; i <= steps; i++) {
    for (let c = 0; c < choices.length; c++) {
      const choice = choices[c] as HeightChoice
      const from = i - choice.heightMm / grid
      if (from < 0) continue
      const candidate = (courses[from] as number) + COURSE_COST
      if (candidate < (courses[i] as number)) {
        courses[i] = candidate
        via[i] = c
      }
    }
  }

  let bestIndex = -1
  for (let i = Math.ceil(targetMm / grid); i <= steps; i++) {
    if (!Number.isFinite(courses[i] as number)) continue
    // Ascending, so the first reachable index is already the least overshoot at
    // its course count — only a strictly smaller count can displace it.
    if (bestIndex < 0 || (courses[i] as number) < (courses[bestIndex] as number)) bestIndex = i
  }
  if (bestIndex < 0) return undefined

  const heights: number[] = []
  let at = bestIndex
  while (at > 0) {
    const choice = choices[via[at] as number]
    if (!choice) break
    heights.push(choice.heightMm)
    at -= choice.heightMm / grid
  }
  return { heights, cost: courses[bestIndex] as number }
}

/**
 * Courses for one lift. `liftHeightMm` is the wall's own height above the pour
 * base; the kicker is part of that wall and already cast, so the courses start at
 * its top and only the concrete above it has to be formed.
 *
 * With `requiredJointsMm` the lift is divided at those elevations and each stretch
 * stacked on its own, which is how a construction joint the drawings fix becomes a
 * panel joint rather than a line the layout happens to miss. Only the topmost
 * stretch carries freeboard — a joint mid-lift is one the concrete comes up to
 * exactly.
 */
export function stackCourses(
  system: FormworkSystem,
  liftHeightMm: number,
  opts: StackOptions = {},
): PanelStack {
  const kickerMm = opts.kickerMm ?? DEFAULT_KICKER_MM
  const minFreeboard = opts.minFreeboardMm ?? MIN_FREEBOARD_MM
  const maxFreeboard = opts.maxFreeboardMm ?? MAX_FREEBOARD_MM
  const choices = heightChoices(system, opts)

  const stops = [
    ...new Set(
      (opts.requiredJointsMm ?? [])
        .filter((elevation) => elevation > kickerMm && elevation < liftHeightMm)
        .sort((a, b) => a - b),
    ),
    liftHeightMm,
  ]

  const courses: Course[] = []
  let at = kickerMm
  let cost = 0
  for (const [index, stop] of stops.entries()) {
    const isTop = index === stops.length - 1
    const stack = cheapestStack(choices, stop - at + (isTop ? minFreeboard : 0))
    if (!stack) break
    cost += stack.cost
    for (const heightMm of stack.heights) {
      courses.push({ baseMm: at, topMm: at + heightMm, heightMm, panelHeightMm: heightMm })
      at += heightMm
    }
  }

  const freeboardMm = (courses.at(-1)?.topMm ?? kickerMm) - liftHeightMm
  return {
    courses,
    freeboardMm,
    freeboardOutOfBand: freeboardMm < minFreeboard || freeboardMm > maxFreeboard,
    kickerMm,
    cost,
  }
}

/** Elevations of the horizontal joints between courses, mm above the pour base. */
export function courseJointsMm(stack: PanelStack): number[] {
  return stack.courses.slice(0, -1).map((course) => course.topMm)
}
