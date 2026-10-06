/**
 * One coherent board-infill deck guard laid out along a rail path, as oriented
 * boxes — the AWC Deck Construction Guide (DCA 6) solid-board guard in metres: a
 * 4x4 post at each end (and every bay ≤ 4 ft between), a flat 2x6 cap over them,
 * and a stack of 1x6 boards running flat along the path between the nosing line
 * and the cap, each course held off the one below by a consistent gap. Every
 * member — the cap and every board course — follows the same path and gets a
 * fitting block at a real plan corner, so the courses read as one connected
 * panel that turns cleanly rather than butting open-ended at a corner.
 *
 * It shares the path sampling, corner finding and newel stations in
 * `guard-path.ts` with the baluster and post-and-rail guards, so a straight
 * flight, a chained L/U landing turn, a winder, a curved or spiral sweep and an
 * integrated top landing all read as the same guard; only the sections and the
 * horizontal board infill differ. Pure data — no Three.js, no React.
 *
 * `reach` runs the members that far past the top vertex along the final slope to
 * die into a post standing there; `topPost: false` then omits the top post.
 * `postThrough` runs the posts past the cap with a small cap of their own.
 */

import {
  add,
  type GuardBox,
  type GuardRail,
  postBox,
  railBars,
  resolveGuardPath,
  type Vec3,
} from './guard-path'

export type BoardsGuardOptions = {
  railHeight: number
  /** Metres between posts along the run; omit (or Infinity) for ends only. */
  postSpacing?: number
  topPost?: boolean
  postThrough?: boolean
  /** Metres the members run past the top vertex, along the final slope. */
  reach?: number
}

// Dressed deck lumber, in metres.
const POST = 0.0889 // 4x4
const POST_EMBED = 0.05 // the post foot runs this far below the nosing line
const CAP_W = 0.1397 // 2x6 cap, laid flat
const CAP_T = 0.0381
const BOARD_W = 0.019 // 1x6 board on the flat: thin across the run
const BOARD_D = 0.1397 // its vertical face height
const BOARD_GAP = 0.0889 // clear gap below the lowest board and between courses
const POST_ABOVE_CAP = 0.0762 // a through-post stands this far above the cap…
const POST_CAP_T = 0.0254 // …under a 1 in cap of its own
const POST_CAP_OVERHANG = 0.0508

/** The board guard's members, bottom-to-top: a stack of 1x6 board courses held
 * off the nosing line by `BOARD_GAP`, then the flat 2x6 cap. Each is a rail that
 * follows the path, so a corner gets a fitting block per course. Shared with the
 * flight connector so a bridge carries the same courses as the guards it joins. */
export function boardsGuardRails(railHeight: number): GuardRail[] {
  const rails: GuardRail[] = []
  const capUnderside = railHeight - CAP_T
  for (
    let bottom = BOARD_GAP;
    bottom + BOARD_D <= capUnderside + 1e-6;
    bottom += BOARD_D + BOARD_GAP
  )
    rails.push({ y: bottom + BOARD_D / 2, across: BOARD_W, vertical: BOARD_D })
  rails.push({ y: railHeight - CAP_T / 2, across: CAP_W, vertical: CAP_T })
  return rails
}

/** How far above the nosing line a post rises: under the cap, or through it. */
function postRise(railHeight: number, postThrough: boolean): number {
  return postThrough ? railHeight + POST_ABOVE_CAP : railHeight - CAP_T
}

/** The small cap sitting on a through-post's top. */
function postCap(x: number, topY: number, z: number): GuardBox {
  return {
    center: [x, topY + POST_CAP_T / 2, z],
    size: [POST + POST_CAP_OVERHANG, POST_CAP_T, POST + POST_CAP_OVERHANG],
    direction: [0, 1, 0],
  }
}

export function buildBoardsGuard(points: Vec3[], options: BoardsGuardOptions): GuardBox[] {
  const path = resolveGuardPath(points, {
    postSpacing: options.postSpacing,
    topPost: options.topPost,
    reach: options.reach,
    // Boards have no pickets; the infill is the horizontal board stack. The
    // picket fields are unused, so any valid pitch does.
    picketPitch: CAP_W,
    picketMinPitch: CAP_W,
    picketMaxPitch: CAP_W,
  })
  if (!path) return []
  const { railHeight } = options
  const postThrough = options.postThrough === true
  const rise = postRise(railHeight, postThrough)

  if (path.kind === 'pivot') {
    // A zero-radius winder's inner pivot: one plumb 4x4 standing the guard's
    // height past the top of the vertical rise, keeping the inner edge's post.
    const { lo, hi } = path
    const base: Vec3 = [lo[0], lo[1] - POST_EMBED, lo[2]]
    const height = hi[1] - lo[1] + rise + POST_EMBED
    const pivot: GuardBox[] = [postBox(base, height, POST)]
    if (postThrough) pivot.push(postCap(lo[0], base[1] + height, lo[2]))
    return pivot
  }

  const { railPoints, isCorner, postPositions } = path

  // Cap and every board course follow the path; a block closes each corner.
  const boxes: GuardBox[] = railBars(railPoints, isCorner, boardsGuardRails(railHeight))

  // Posts: both ends (the top only when `topPost`), every bay ≤ spacing between.
  for (const p of postPositions) {
    boxes.push(postBox(add(p, [0, -POST_EMBED, 0]), rise + POST_EMBED, POST))
    if (postThrough) boxes.push(postCap(p[0], p[1] + rise, p[2]))
  }

  return boxes
}
