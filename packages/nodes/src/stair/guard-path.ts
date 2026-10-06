/**
 * The style-agnostic chassis a stair guard is laid out on, as pure data (no
 * Three.js, no React). A guard — baluster (`baluster-guard.ts`) or deck
 * post-and-rail (`post-and-rail-guard.ts`) — differs only in the sections and
 * y of its rails, its newel and its infill; where those members *go* is the
 * same problem for both: sample the rail path by run so density tracks the run
 * rather than the path's tessellation, extend it `reach` past the top vertex,
 * stand newels by spacing, and close a plan corner with a fitting block. That
 * shared geometry lives here so there is one path/corner/station convention to
 * maintain and no duplicated arc sampling between the styles.
 */

export type Vec3 = [number, number, number]

/** An oriented box in the guard's frame; see `GuardBox`'s consumers for UVs. */
export type GuardBox = {
  /** Box centre. */
  center: Vec3
  /** Local box size: x across the run, y vertical, z along the run. */
  size: Vec3
  /** Unit direction the box's z axis runs along (for sloped/plan-turned bars). */
  direction: Vec3
  /** Render as a round member (a cylinder about `direction`); `size[0]` is its
   * diameter. Cables and their terminal sleeves set this; everything else is a
   * rectangular bar. */
  round?: boolean
}

export const UP: Vec3 = [0, 1, 0]

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t))
export const horizontalLength = (d: Vec3) => Math.hypot(d[0], d[2])

/** An oriented bar between two points; `width` is across the run, `depth` vertical. */
export function barBox(a: Vec3, b: Vec3, width: number, depth: number): GuardBox | null {
  const d = sub(b, a)
  const length = Math.hypot(d[0], d[1], d[2])
  if (length < 1e-6) return null
  return {
    center: lerp(a, b, 0.5),
    size: [width, depth, length],
    direction: scale(d, 1 / length),
  }
}

/** A plumb box standing from `base` up `height`, square section `width`. */
export function postBox(base: Vec3, height: number, width: number): GuardBox {
  return {
    center: [base[0], base[1] + height / 2, base[2]],
    size: [width, width, height],
    direction: UP,
  }
}

/** A guard rail: its centre `y` off the nosing line and its section (`across`
 * the run, `vertical`), bottom-to-top. */
export type GuardRail = { y: number; across: number; vertical: number }

/** The rails of a guard following `railPoints`, with a cube fitting block
 * closing every real plan corner — the shared joinery for both guard styles. */
export function railBars(
  railPoints: Vec3[],
  isCorner: (i: number) => boolean,
  rails: GuardRail[],
): GuardBox[] {
  const boxes: GuardBox[] = []
  for (const rail of rails) {
    for (let i = 1; i < railPoints.length; i++) {
      const bar = barBox(
        add(railPoints[i - 1]!, [0, rail.y, 0]),
        add(railPoints[i]!, [0, rail.y, 0]),
        rail.across,
        rail.vertical,
      )
      if (bar) boxes.push(bar)
    }
    for (let i = 1; i < railPoints.length - 1; i++) {
      if (!isCorner(i)) continue
      const block = Math.max(rail.across, rail.vertical)
      boxes.push({
        center: add(railPoints[i]!, [0, rail.y, 0]),
        size: [block, block, block],
        direction: UP,
      })
    }
  }
  return boxes
}

/** A plan direction change past this at an interior vertex gets a corner fitting
 * block; collinear points and curve tessellation stay under it, so a dense path
 * does not bulge a block at every vertex. */
export const CORNER_MIN_TURN = Math.PI / 8

export type GuardPathOptions = {
  /** Metres between newels along the run; omit (or Infinity) for ends only. */
  postSpacing?: number
  cornerPosts?: boolean
  topPost?: boolean
  /** Metres the rails run past the top vertex, along the final slope. */
  reach?: number
  /** The requested infill pitch, clamped into [min, max] below. */
  picketPitch?: number
  picketMinPitch?: number
  picketMaxPitch?: number
}

export type GuardPath =
  /** A path with no horizontal run — a zero-radius winder's inner pivot: the
   * caller stands one plumb newel over the vertical rise `lo`→`hi`. */
  | { kind: 'pivot'; lo: Vec3; hi: Vec3 }
  | {
      kind: 'path'
      /** Total horizontal run, including `reach`. */
      run: number
      /** The vertices the rails follow, extended `reach` past the top. */
      railPoints: Vec3[]
      /** The point at horizontal station `s` along the run. */
      pointAt: (s: number) => Vec3
      /** Whether interior vertex `i` of `railPoints` is a real plan corner. */
      isCorner: (i: number) => boolean
      /** Newel foot positions, bottom-to-top along the run. */
      postPositions: Vec3[]
      /** Horizontal stations of `postPositions`, bottom-to-top. */
      postStations: number[]
      /** Infill (picket) foot positions, newel clashes left to the caller. */
      picketStations: Vec3[]
    }

/**
 * Resolve the shared chassis for a guard laid along `points` (bottom first).
 * Returns `null` for a degenerate path (fewer than two points, or a vertical
 * run with no rise). The caller turns the stations into its own members.
 */
export function resolveGuardPath(points: Vec3[], options: GuardPathOptions): GuardPath | null {
  if (points.length < 2) return null
  const topPost = options.topPost !== false
  const reach = Math.max(options.reach ?? 0, 0)
  const postSpacing =
    options.postSpacing && Number.isFinite(options.postSpacing) && options.postSpacing > 0
      ? options.postSpacing
      : Number.POSITIVE_INFINITY

  const cumulative: number[] = [0]
  for (let i = 1; i < points.length; i++)
    cumulative.push(cumulative[i - 1]! + horizontalLength(sub(points[i]!, points[i - 1]!)))
  const run = cumulative.at(-1)!
  if (run < 1e-4) {
    const lo = points.reduce((low, p) => (p[1] < low[1] ? p : low))
    const hi = points.reduce((high, p) => (p[1] > high[1] ? p : high))
    if (hi[1] - lo[1] < 1e-4) return null
    return { kind: 'pivot', lo, hi }
  }
  const pointAt = (s: number): Vec3 => {
    const clamped = Math.min(Math.max(s, 0), run)
    for (let i = 1; i < points.length; i++) {
      if (clamped <= cumulative[i]! || i === points.length - 1) {
        const span = cumulative[i]! - cumulative[i - 1]!
        const t = span > 1e-9 ? (clamped - cumulative[i - 1]!) / span : 0
        return lerp(points[i - 1]!, points[i]!, t)
      }
    }
    return points[0]!
  }

  // The top vertex, extended `reach` along the final slope.
  const lastEdge = sub(points.at(-1)!, points.at(-2)!)
  const lastLen = Math.hypot(lastEdge[0], lastEdge[1], lastEdge[2])
  const railEnd =
    reach > 0 && lastLen > 1e-6
      ? add(points.at(-1)!, scale(lastEdge, reach / lastLen))
      : points.at(-1)!
  const railPoints: Vec3[] = reach > 0 ? [...points, railEnd] : [...points]

  // A fitting block belongs only at a real corner. A tessellated curve or a
  // spiral turns a similar amount at every vertex, so a sharp turn is a corner
  // only when it stands out from its neighbours; collinear points never turn.
  const horizontalDir = (a: Vec3, b: Vec3): [number, number] | null => {
    const dx = b[0] - a[0],
      dz = b[2] - a[2]
    const length = Math.hypot(dx, dz)
    return length < 1e-6 ? null : [dx / length, dz / length]
  }
  const turnAt = (i: number): number | null => {
    if (i < 1 || i > railPoints.length - 2) return null
    const incoming = horizontalDir(railPoints[i - 1]!, railPoints[i]!)
    const outgoing = horizontalDir(railPoints[i]!, railPoints[i + 1]!)
    if (!incoming || !outgoing) return null
    const dot = Math.min(Math.max(incoming[0] * outgoing[0] + incoming[1] * outgoing[1], -1), 1)
    return Math.acos(dot)
  }
  const isCorner = (i: number): boolean => {
    const turn = turnAt(i)
    if (turn === null || turn <= CORNER_MIN_TURN) return false
    // Cable runs need anchors at consecutive sharp turns as well as isolated corners.
    if (options.cornerPosts && turn >= Math.PI / 6) return true
    const neighbour = Math.max(turnAt(i - 1) ?? 0, turnAt(i + 1) ?? 0)
    return neighbour < turn * 0.5
  }

  const postStations = new Set<number>([0])
  if (topPost) postStations.add(run)
  if (Number.isFinite(postSpacing)) {
    const bays = Math.max(1, Math.ceil(run / postSpacing))
    for (let i = 1; i < bays; i++) postStations.add((run * i) / bays)
  }
  if (options.cornerPosts) {
    for (let i = 1; i < points.length - 1; i++) {
      if (isCorner(i)) postStations.add(cumulative[i]!)
    }
  }
  const sortedStations = [...postStations].sort((a, b) => a - b)
  const postPositions = sortedStations.map(pointAt)

  const picketStations: Vec3[] = []
  if (options.picketPitch !== undefined) {
    const pitch = Math.min(
      Math.max(options.picketPitch, options.picketMinPitch ?? options.picketPitch),
      options.picketMaxPitch ?? options.picketPitch,
    )
    const bays = Math.max(2, Math.ceil(run / pitch))
    for (let i = 1; i < bays; i++) picketStations.push(pointAt((run * i) / bays))
  }

  return {
    kind: 'path',
    run,
    railPoints,
    pointAt,
    isCorner,
    postPositions,
    postStations: sortedStations,
    picketStations,
  }
}

export const GUARD_POST_SPACING = 1.2192
export const GUARD_PICKET_PITCH = 0.127

export type GuardOptions = {
  railHeight: number
  postSpacing?: number
  topPost?: boolean
  postThrough?: boolean
  reach?: number
}

type PostProfile = {
  width: number
  embed: number
  top: number
  throughTop: number
  capThickness: number
  capOverhang: number
  foot?: (x: number, y: number, z: number) => GuardBox
}

/** Posts, caps and the vertical-pivot case have the same assembly in every style. */
export function buildGuardChassis(
  points: Vec3[],
  options: GuardOptions,
  rails: GuardRail[],
  profile: PostProfile,
  sampling: Pick<
    GuardPathOptions,
    'cornerPosts' | 'picketPitch' | 'picketMinPitch' | 'picketMaxPitch'
  > = {},
) {
  const path = resolveGuardPath(points, { ...options, ...sampling })
  if (!path) return null
  const rise = options.railHeight + (options.postThrough ? profile.throughTop : profile.top)
  const boxes = path.kind === 'pivot' ? [] : railBars(path.railPoints, path.isCorner, rails)
  const posts = path.kind === 'pivot' ? [path.lo] : path.postPositions
  for (const p of posts) {
    const height = rise + profile.embed + (path.kind === 'pivot' ? path.hi[1] - path.lo[1] : 0)
    const base = add(p, [0, -profile.embed, 0])
    boxes.push(postBox(base, height, profile.width))
    if (profile.foot) boxes.push(profile.foot(p[0], p[1], p[2]))
    if (options.postThrough)
      boxes.push({
        center: [p[0], base[1] + height + profile.capThickness / 2, p[2]],
        size: [
          profile.width + profile.capOverhang,
          profile.capThickness,
          profile.width + profile.capOverhang,
        ],
        direction: UP,
      })
  }
  return { path, boxes }
}

export function guardPickets(
  path: Extract<GuardPath, { kind: 'path' }>,
  width: number,
  postWidth: number,
  bottom: number,
  top: number,
): GuardBox[] {
  const boxes: GuardBox[] = []
  for (const p of path.picketStations) {
    if (
      !path.postPositions.every(
        (post) => Math.hypot(post[0] - p[0], post[2] - p[2]) > postWidth / 2 + width / 2,
      )
    )
      continue
    const picket = barBox([p[0], p[1] + bottom, p[2]], [p[0], p[1] + top, p[2]], width, width)
    if (picket) boxes.push(picket)
  }
  return boxes
}
