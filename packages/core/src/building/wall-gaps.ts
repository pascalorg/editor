import type { WallNode } from '../schema'

type Pt = [number, number]

/** Wall ends this close are joined. */
const JOIN = 0.05
/** The narrowest gap a door or window leaves. */
const MIN_GAP = 0.6
/** Inside, between walls in line: from a narrow door to a double one. */
const MAX_DOOR = 1.8
/** Inside, a partition stopping short of a wall: a door and its nib. */
const MAX_DOOR_TO_WALL = 1.5
/** On the outside: up to a garage door or a stacking slider. */
const MAX_OUTSIDE = 5
/** The wall left each side of an opening in its gap. */
const JAMB = 0.05
/** Two gaps closer than this, side by side, are one opening found from two wall ends. */
const DUPLICATE = 0.5
/** A swing's points lie this close to its radius, as a share of it, */
const ARC_SLACK = 0.25
/** and make up this much of the curve: a door's arc, not a curve passing by. */
const ARC_SHARE = 0.6
/**
 * The least turn of a swing about its hinge: plans draw a leaf open from 30° to 90°, and a
 * vectorised swing may be clipped at the walls; half the least.
 */
const MIN_SWEEP = Math.PI / 12
/** Rays cast over each side of a gap, across its half of the plane. */
const RAYS = 17
/** The share of them by which an outside gap's open side sees past the walls more than its other. */
const OPEN_SIDE = 0.25

export type WallGap = {
  /** The wall to build across the gap: from the open end to the wall end or face it faces. */
  start: Pt
  end: Pt
  thickness: number
  height?: number
  from: string
  to: string
  /**
   * inside: a door, as plans leave a gap at each door; outside: a window, a door or a slider,
   * which the plan's gap alone does not say.
   */
  place: 'inside' | 'outside'
  /**
   * Inside, a door the plan draws (its swing beside the gap). False when the plan draws no curves
   * at all: nothing says whether the gap is a door or a passage.
   */
  door: boolean
  /** The opening's width and its centre along the new wall. */
  width: number
  along: number
}

const sub = (a: readonly number[], b: readonly number[]): Pt => [a[0]! - b[0]!, a[1]! - b[1]!]
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0]
const round = (value: number) => Math.round(value * 1e6) / 1e6
const at = (p: readonly number[], u: Pt, s: number): Pt => [
  round(p[0]! + u[0] * s),
  round(p[1]! + u[1] * s),
]
const same = (p: readonly number[], q: readonly number[]) =>
  Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!) < JOIN

function unit(wall: WallNode): Pt {
  const [dx, dz] = sub(wall.end, wall.start)
  const length = Math.hypot(dx, dz)
  return [dx / length, dz / length]
}

/**
 * How a wall end meets the others. Closed: a wall carries on in line from it, or it runs into
 * another wall's side. Cornered: another wall turns there (a partition ending at an outside wall's
 * jamb leaves the gap open: Hawkesbury's laundry door).
 */
function endOf(p: readonly number[], self: WallNode, walls: readonly WallNode[]) {
  let cornered = false
  for (const other of walls) {
    if (other === self) continue
    const u = unit(other)
    if (same(other.start, p) || same(other.end, p)) {
      if (Math.abs(cross(u, unit(self))) < 0.05) return 'closed'
      cornered = true
      continue
    }
    const v = sub(p, other.start)
    const along = dot(v, u)
    const length = Math.hypot(...sub(other.end, other.start))
    if (
      along > JOIN &&
      along < length - JOIN &&
      Math.abs(cross(u, v)) <= (other.thickness ?? 0.2) / 2 + JOIN
    )
      return 'closed'
  }
  return cornered ? 'cornered' : 'free'
}

/**
 * Where a plan's walls leave a gap for an opening: a wall end facing, in line, the end of another
 * wall, or a partition stopping short of the wall it runs to. Each gap comes with the wall that
 * closes it and the opening it takes, as a person bridges it by hand: a door inside; outside, an
 * opening the plan's symbols name. With `only`, the gaps touching those walls.
 */
type Candidate = Omit<WallGap, 'place' | 'door'> & { inLine: boolean; clear: number }

/** Every gap a wall end leaves, found once each, before it is read as inside or outside. */
function gapCandidates(walls: readonly WallNode[], only?: ReadonlySet<string>) {
  const straight = walls.filter(
    (wall) => !wall.curveOffset && Math.hypot(...sub(wall.end, wall.start)) > JOIN,
  )
  const found = new Map<string, Candidate>()
  for (const wall of straight) {
    const u = unit(wall)
    for (const [p, out] of [
      [wall.end, u],
      [wall.start, [-u[0], -u[1]] as Pt],
    ] as const) {
      const end = endOf(p, wall, straight)
      if (end === 'closed') continue
      // The nearest thing ahead: a wall end in line, or a wall across the way.
      let nearest: { s: number; end: Pt; to: WallNode; clear: number; atEnd: boolean } | null = null
      for (const other of straight) {
        if (other === wall) continue
        const w = unit(other)
        const half = (wall.thickness ?? 0.2) / 2
        if (Math.abs(cross(u, w)) < 0.05) {
          for (const q of [other.start, other.end]) {
            const v = sub(q, p)
            const s = dot(v, out)
            if (s > JOIN && Math.abs(cross(out, v)) < Math.max(half, (other.thickness ?? 0.2) / 2))
              if (!nearest || s < nearest.s)
                nearest = { s, end: [q[0], q[1]], to: other, clear: s, atEnd: true }
          }
          continue
        }
        if (Math.abs(cross(out, w)) < 0.5) continue
        const v = sub(other.start, p)
        const s = cross(v, w) / cross(out, w)
        const t = cross(v, out) / cross(out, w)
        const length = Math.hypot(...sub(other.end, other.start))
        // The ray meets the wall's body, which reaches half its thickness past its centreline's end.
        const reach = Math.max(JOIN, (other.thickness ?? 0.2) / 2)
        if (s <= JOIN || t < -reach || t > length + reach) continue
        const clear = s - (other.thickness ?? 0.2) / 2
        if (!nearest || s < nearest.s)
          nearest = {
            s,
            end: at(p, out, s),
            to: other,
            clear,
            atEnd: t < reach || t > length - reach,
          }
      }
      if (!nearest || nearest.clear < MIN_GAP - 1e-9 || nearest.clear > MAX_OUTSIDE + 1e-9) continue
      // From a corner, only a gap that ends at a wall end: the outside past a building's corner
      // runs to whatever wall lies across it.
      if (end === 'cornered' && !nearest.atEnd) continue
      if (only && !only.has(wall.id) && !only.has(nearest.to.id)) continue
      const start: Pt = [p[0], p[1]]
      const key = [start, nearest.end]
        .map((q) => `${Math.round(q[0] * 100)},${Math.round(q[1] * 100)}`)
        .sort()
        .join('|')
      if (found.has(key)) continue
      found.set(key, {
        start,
        end: nearest.end,
        // In line, the gap belongs to the thicker of its two walls (an outside wall's last jamb is
        // often a thin stub); across, to the wall it starts from.
        thickness:
          Math.abs(cross(u, unit(nearest.to))) < 0.05
            ? Math.max(wall.thickness ?? 0.2, nearest.to.thickness ?? 0.2)
            : (wall.thickness ?? 0.2),
        ...(wall.height !== undefined ? { height: wall.height } : {}),
        from: wall.id,
        to: nearest.to.id,
        width: round(nearest.clear - 2 * JAMB),
        along: round(nearest.clear / 2),
        inLine: Math.abs(cross(u, unit(nearest.to))) < 0.05,
        clear: nearest.clear,
      })
    }
  }
  // One gap per opening: two wall ends a few centimetres apart find it twice.
  const candidates: Candidate[] = []
  for (const gap of [...found.values()].sort((a, b) => a.clear - b.clear)) {
    const centre = mid(gap)
    const direction = unitOf(gap)
    if (
      !candidates.some(
        (kept) =>
          Math.hypot(...sub(mid(kept), centre)) < DUPLICATE &&
          Math.abs(cross(unitOf(kept), direction)) < 0.1,
      )
    )
      candidates.push(gap)
  }
  return { straight, candidates }
}

/**
 * The walls that close every gap a plan's walls leave, whatever opening each takes: a storey's
 * outline for its roof, whether or not its doors and windows are in yet.
 */
export function gapBridges(walls: readonly WallNode[]) {
  return gapCandidates(walls).candidates.map(({ start, end, thickness }) => ({
    start,
    end,
    thickness,
  }))
}

export function wallGaps(
  walls: readonly WallNode[],
  { only, drawing }: { only?: ReadonlySet<string>; drawing?: readonly (readonly Pt[])[] } = {},
): WallGap[] {
  const { straight, candidates } = gapCandidates(walls, only)
  const outside = outsideFlags(
    walls.filter((wall) => Math.hypot(...sub(wall.end, wall.start)) > JOIN),
    candidates,
  )
  // A door is drawn with its swing: an arc about one jamb, as wide as the door (half for each
  // leaf of a double door). Plans that draw no curves at all say nothing either way.
  const curves = (drawing ?? []).filter((line) => line.length >= 3)
  const swung = (gap: Candidate) => {
    const direction = unitOf(gap)
    const jambs: Pt[] = [gap.start, at(gap.start, direction, gap.clear)]
    const centre = at(gap.start, direction, gap.clear / 2)
    // A leaf closes across the gap: its arc starts at the other jamb, or for a double door's two
    // leaves at the gap's middle.
    const swings = jambs.flatMap((hinge, i) => [
      { hinge, radius: gap.clear, closed: jambs[1 - i]! },
      { hinge, radius: gap.clear / 2, closed: centre },
    ])
    return curves.some((line) => {
      const drawn = line.filter((point) => !straight.some((wall) => inside(point, wall)))
      return swings.some(({ hinge, radius, closed }) => {
        const near = (point: Pt) =>
          Math.abs(Math.hypot(...sub(point, hinge)) - radius) <= ARC_SLACK * radius
        const onArc = drawn.filter(near)
        return (
          onArc.length >= 3 &&
          onArc.length >= ARC_SHARE * line.length &&
          sweep(onArc, hinge) >= MIN_SWEEP &&
          line.some((point) => Math.hypot(...sub(point, closed)) <= ARC_SLACK * radius)
        )
      })
    })
  }
  return candidates.flatMap((candidate, i): WallGap[] => {
    const { inLine, clear, ...gap } = candidate
    if (outside[i]) return [{ ...gap, place: 'outside', door: false }]
    if (clear > (inLine ? MAX_DOOR : MAX_DOOR_TO_WALL) + 1e-9) return []
    if (!curves.length) return [{ ...gap, place: 'inside', door: false }]
    // Where the plan draws swings, an inside gap without one is an open passage.
    return swung(candidate) ? [{ ...gap, place: 'inside', door: true }] : []
  })
}

const mid = (gap: { start: Pt; end: Pt }): Pt => [
  (gap.start[0] + gap.end[0]) / 2,
  (gap.start[1] + gap.end[1]) / 2,
]
const unitOf = (gap: { start: Pt; end: Pt }): Pt => {
  const [dx, dz] = sub(gap.end, gap.start)
  const length = Math.hypot(dx, dz)
  return [dx / length, dz / length]
}

/** The angle a curve turns through about a point, measured from its first point's bearing. */
function sweep(points: readonly Pt[], about: Pt) {
  const [first] = points
  const reference = Math.atan2(first![1] - about[1], first![0] - about[0])
  const turns = points.map((point) => {
    const turn = Math.atan2(point[1] - about[1], point[0] - about[0]) - reference
    return Math.atan2(Math.sin(turn), Math.cos(turn))
  })
  return Math.max(...turns) - Math.min(...turns)
}

/** Whether a point lies in a wall's body. */
function inside(point: readonly number[], wall: WallNode) {
  const u = unit(wall)
  const v = sub(point, wall.start)
  const along = dot(v, u)
  const length = Math.hypot(...sub(wall.end, wall.start))
  return (
    along > -JOIN &&
    along < length + JOIN &&
    Math.abs(cross(u, v)) < (wall.thickness ?? 0.2) / 2 + 0.06
  )
}

/**
 * Which gaps are on the outside. A plan whose outside walls are drawn thicker than its partitions
 * says it by thickness, which a missed gap cannot spoil. Otherwise by what each side of a gap looks
 * out on, the other gaps closed: a room's side meets walls nearly all round, the outside's sees
 * past them. That holds while the outline is still open elsewhere (a garage door, a porch, walls
 * not drawn yet), where its loop does not; both sides of an inside gap see as far through it.
 */
function outsideFlags(walls: readonly WallNode[], gaps: readonly Candidate[]): boolean[] {
  const classes = [...new Set(walls.map((wall) => Math.round((wall.thickness ?? 0.2) * 100)))].sort(
    (a, b) => a - b,
  )
  if (classes.length >= 2 && classes.at(-1)! - classes[0]! >= 5) {
    const middle = (classes[0]! + classes.at(-1)!) / 2
    return gaps.map((gap) => gap.thickness * 100 > middle)
  }
  const segments: [Pt, Pt][] = [
    ...walls.map((wall): [Pt, Pt] => [
      [wall.start[0], wall.start[1]],
      [wall.end[0], wall.end[1]],
    ]),
    ...gaps.map((gap): [Pt, Pt] => [gap.start, gap.end]),
  ]
  return gaps.map((gap, i) => {
    const others = segments.filter((_, j) => j !== walls.length + i)
    const u = unitOf(gap)
    const centre = mid(gap)
    const open = (side: number) => {
      let escaped = 0
      for (let k = 0; k < RAYS; k++) {
        const angle = ((k + 0.5) / RAYS - 0.5) * Math.PI
        const direction: Pt = [
          -u[1] * side * Math.cos(angle) + u[0] * Math.sin(angle),
          u[0] * side * Math.cos(angle) + u[1] * Math.sin(angle),
        ]
        if (!others.some(([p, q]) => crosses(centre, direction, p, q))) escaped++
      }
      return escaped / RAYS
    }
    return Math.abs(open(1) - open(-1)) >= OPEN_SIDE
  })
}

/** Whether a ray from `origin` meets the segment from `p` to `q`. */
function crosses(origin: Pt, direction: Pt, p: Pt, q: Pt) {
  const edge = sub(q, p)
  const denominator = cross(direction, edge)
  if (Math.abs(denominator) < 1e-12) return false
  const offset = sub(p, origin)
  const t = cross(offset, edge) / denominator
  const k = cross(offset, direction) / denominator
  return t > 1e-6 && k >= 0 && k <= 1
}
