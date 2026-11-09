import type { RevealPhase, RevealStyle } from '@pascal-app/core'
import { REVEAL_ARRIVAL } from './reveal-pose'
import type { CoverRange, PlayedStyle } from './reveal-wipe'

export const REVEAL_PHASE_ORDER: readonly RevealPhase[] = [
  'foundation',
  'structure',
  'circulation',
  'openings',
  'roof',
  'furnishing',
]

export type RevealTiming = {
  /** Between two nodes of one phase on one level. */
  nodeGapMs: number
  /** Between one (phase, level) group and the next. */
  groupGapMs: number
  /** A reveal ends within this however many nodes it has: the gaps shrink, no node is skipped. */
  capMs: number
  /**
   * How long each style moves its node. `assemble` holds its node still (its parts drop), `cover`
   * holds it still while its covering is laid, and the heights of the travelling styles are
   * declared by each kind (`capabilities.reveal.height`).
   */
  durationMs: Record<RevealStyle, number>
}

/** The one place to tune the reveal's pace; the heights live in the kinds' declarations. */
export const REVEAL_TIMING: RevealTiming = {
  nodeGapMs: 70,
  groupGapMs: 280,
  capMs: 6000,
  durationMs: { rise: 650, scale: 400, settle: 380, drop: 620, cut: 260, assemble: 0 },
}

/**
 * How long `style` moves its node in `table`. Only the Framing level's table has a `cover` time (it
 * lays a roof's covering where Full drops the roof whole); a plan made on a Full table or the reverse
 * play of a framing build gives a covering twice what the whole roof takes to come or go.
 */
export function styleMs(
  table: Readonly<Record<RevealStyle, number>> & { cover?: number },
  style: PlayedStyle,
): number {
  if (style !== 'cover') return table[style]
  return table.cover ?? 2 * (table.assemble > 0 ? table.assemble : table.drop)
}

export type RevealCandidate = {
  id: string
  phase: RevealPhase
  style: PlayedStyle
  /** Metres above the rest pose for the travelling styles, 0 for the others. */
  height: number
  levelId: string | null
  /** The level's storey; nodes outside any level come first. */
  levelIndex: number
  /** Ancestor count, so a host starts before what it hosts. */
  depth: number
  /** Arrival order, the last tie-break: a room's walls arrive along its outline. */
  seq: number
  /** Who wrote it, as the host named it on the commit (`'agent'`); events pass it on. */
  source?: string | null
  /** A drop's anticipation, as a share of its height (see `RevealPoseOptions.lead`). */
  lead?: number
  /**
   * The room (or wall run) it is built with, for the lazy schedule: rooms of a floor build side
   * by side, a beat apart. Absent: it belongs to its floor as a whole (a slab under every room).
   */
  cluster?: string
  /** Where its room comes in its floor's sweep: the lower first. */
  sweep?: number
  /** Its place in its room: a wall's turn around the room's outline. */
  order?: number
  /**
   * How long a plugin's own presentation plays at its turn before the node itself moves in (a wall's
   * frame and boards, Bones): the lazy schedule leaves the time, and the node starts after it.
   */
  prerollMs?: number
}

export type PlannedReveal = RevealCandidate & {
  group: string
  startMs: number
  /** The last piece of the plan to arrive: it lands with a slightly bigger beat. */
  finale?: boolean
}

export function revealGroupKey(candidate: Pick<RevealCandidate, 'phase' | 'levelId'>): string {
  return `${candidate.phase}:${candidate.levelId ?? ''}`
}

/** A stable pseudo-random key from a node id (FNV-1a): a plan scatters the same way every time. */
function scatterKey(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Start times for `candidates`, from `startMs`. Phase after phase; within a phase every floor
 * plays at once, its nodes in a scattered order (GSAP's stagger from "random") and evenly spaced,
 * floors interleaved within one gap, so no frame starts a crowd. On a floor, what stands on
 * something (a book on a shelf) starts after it.
 */
export function planReveal(
  candidates: readonly RevealCandidate[],
  startMs: number,
  timing: RevealTiming = REVEAL_TIMING,
): PlannedReveal[] {
  const floorsByPhase = new Map<RevealPhase, Map<string, RevealCandidate[]>>()
  for (const candidate of candidates) {
    const floors = floorsByPhase.get(candidate.phase) ?? new Map<string, RevealCandidate[]>()
    floorsByPhase.set(candidate.phase, floors)
    const floor = `${candidate.levelIndex}:${candidate.levelId ?? ''}`
    floors.set(floor, [...(floors.get(floor) ?? []), candidate])
  }
  const planned: { candidate: RevealCandidate; offset: number }[] = []
  let phaseStart = 0
  let end = 0
  let longest = 0
  for (const phase of REVEAL_PHASE_ORDER) {
    const floors = floorsByPhase.get(phase)
    if (!floors) continue
    const lanes = [...floors.entries()].sort(([left], [right]) =>
      left.localeCompare(right, undefined, { numeric: true }),
    )
    let phaseEnd = phaseStart
    lanes.forEach(([, nodes], lane) => {
      const scattered = [...nodes].sort(
        (left, right) =>
          left.depth - right.depth ||
          scatterKey(left.id) - scatterKey(right.id) ||
          left.seq - right.seq,
      )
      scattered.forEach((candidate, index) => {
        const offset = phaseStart + (index + lane / lanes.length) * timing.nodeGapMs
        planned.push({ candidate, offset })
        phaseEnd = Math.max(phaseEnd, offset)
        longest = Math.max(longest, styleMs(timing.durationMs, candidate.style))
      })
    })
    end = phaseEnd
    phaseStart = phaseEnd + timing.groupGapMs
  }
  const room = Math.max(0, timing.capMs - longest)
  const compression = end > room ? room / end : 1
  const arrival = ({ candidate, offset }: (typeof planned)[number]) =>
    offset * compression +
    styleMs(timing.durationMs, candidate.style) * REVEAL_ARRIVAL[candidate.style]
  let finale: (typeof planned)[number] | null = null
  for (const entry of planned) {
    // Held still, an assembled node never arrives; its parts do.
    if (entry.candidate.style === 'assemble') continue
    if (!finale || arrival(entry) >= arrival(finale)) finale = entry
  }
  return planned
    .sort((left, right) => left.offset - right.offset || left.candidate.seq - right.candidate.seq)
    .map((entry) => ({
      ...entry.candidate,
      group: revealGroupKey(entry.candidate),
      startMs: startMs + entry.offset * compression,
      ...(entry === finale ? { finale: true } : {}),
    }))
}

/**
 * The lazy, nested schedule (the `framing` level): floors a beat apart, the rooms of a floor a beat
 * apart, the pieces of a room a beat apart, each with a little jitter, so many small builds progress
 * side by side instead of one global pulse. A big build takes proportionally longer, up to `capMs`.
 */
export type LazyRevealTiming = {
  /** Between one floor's build and the next one's: floors go up side by side, offset. */
  floorOffsetMs: number
  /** Between one room (or wall run) of a floor and the next, in each phase. */
  roomOffsetMs: number
  /** Between two pieces of one room, by phase: a room's walls go up one after the other. */
  elementOffsetMs: Record<RevealPhase, number>
  /** After a floor's phase has started its last piece, before its next phase starts. */
  phaseGapMs: number
  /** Each start moves by up to this share of its offset, either way (never mechanical). */
  jitter: number
  /** A plan longer than this is pulled together to end by it: a huge build does not take forever. */
  capMs: number
  /** How long each style moves its node at this level; `cover` is the longest a roof's covering takes to lay. */
  durationMs: Record<PlayedStyle, number>
  /**
   * A covering takes this long for each metre of what it covers, never under `coverMinMs` nor over
   * `durationMs.cover` (`coverRangeAt`).
   */
  coverMsPerM: number
  coverMinMs: number
  /**
   * How far a rise, a scale or a settle goes past its rest before it settles (GSAP's `back.out`
   * strength; 0 is a plain ease out). A rise's is gentler: a wall 2 % past its top, not into the slab over it.
   */
  overshoot: Record<'rise' | 'scale' | 'settle', number>
  /** Drops and settles fall from at least this high (m), whatever their kind declares. */
  minHeightM: Partial<Record<PlayedStyle, number>>
}

/**
 * The Framing level's pace: one factor on its whole timeline, the staging and the motions alike. 1 is
 * the pace it was built at; 1.75 makes a build that took 20 s take 35 s, and anything smaller or
 * larger takes proportionally longer. A pace of `p` multiplies every offset, gap, beat, duration and
 * cap of this level (`LAZY_REVEAL_TIMING`) and of the frame each wall plays before it rises (Bones'
 * `WALL_BUILD`), so pieces still snap and the build only plays out slower. The Full level reads
 * `REVEAL_TIMING` and does not move with it.
 */
export const FRAMING_PACE = 1.75

/** The lazy schedule at pace 1; `LAZY_REVEAL_TIMING` is this at `FRAMING_PACE`. */
export const LAZY_REVEAL_BASE_TIMING: LazyRevealTiming = {
  floorOffsetMs: 1200,
  roomOffsetMs: 420,
  elementOffsetMs: {
    foundation: 200,
    structure: 360,
    circulation: 260,
    openings: 140,
    roof: 180,
    furnishing: 110,
  },
  phaseGapMs: 260,
  jitter: 0.3,
  capMs: 40_000,
  durationMs: { rise: 760, scale: 520, settle: 640, drop: 820, cut: 320, assemble: 0, cover: 4200 },
  coverMsPerM: 450,
  coverMinMs: 1400,
  overshoot: { rise: 0.7, scale: 1.6, settle: 1.6 },
  minHeightM: { drop: 1.8, settle: 0.6 },
}

/** `timing` played at `pace` times its length: times scale, shares and heights do not. */
export function pacedLazyTiming(timing: LazyRevealTiming, pace: number): LazyRevealTiming {
  const scaled = <K extends string>(table: Record<K, number>) =>
    Object.fromEntries(
      (Object.entries(table) as [K, number][]).map(([key, ms]) => [key, ms * pace]),
    ) as Record<K, number>
  return {
    ...timing,
    floorOffsetMs: timing.floorOffsetMs * pace,
    roomOffsetMs: timing.roomOffsetMs * pace,
    elementOffsetMs: scaled(timing.elementOffsetMs),
    phaseGapMs: timing.phaseGapMs * pace,
    capMs: timing.capMs * pace,
    durationMs: scaled(timing.durationMs),
    coverMsPerM: timing.coverMsPerM * pace,
    coverMinMs: timing.coverMinMs * pace,
  }
}

/** The one place the lazy schedule and the framing level's motion are read from. */
export const LAZY_REVEAL_TIMING: LazyRevealTiming = pacedLazyTiming(
  LAZY_REVEAL_BASE_TIMING,
  FRAMING_PACE,
)

/**
 * The person's animation speed: how fast the build animations play, as a multiple of today's.
 * Higher is faster, so every time of a schedule is divided by it: ×2 plays a build in half the
 * time, ×0.5 in twice as long. ×1 is every table exactly as shipped (the very same objects).
 */
export const ANIMATION_SPEEDS = [0.5, 0.75, 1, 1.5, 2] as const
export type AnimationSpeed = (typeof ANIMATION_SPEEDS)[number]
export const DEFAULT_ANIMATION_SPEED: AnimationSpeed = 1

/** The step nearest to `value`; anything that is not a finite positive number is ×1. */
export function normalizeAnimationSpeed(value: unknown): AnimationSpeed {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    return DEFAULT_ANIMATION_SPEED
  return ANIMATION_SPEEDS.reduce((best, step) =>
    Math.abs(step - value) < Math.abs(best - value) ? step : best,
  )
}

/** `timing` with every time divided by `speed`: durations, gaps and the cap. */
export function pacedRevealTiming(timing: RevealTiming, speed: number): RevealTiming {
  return {
    nodeGapMs: timing.nodeGapMs / speed,
    groupGapMs: timing.groupGapMs / speed,
    capMs: timing.capMs / speed,
    durationMs: scaleTimes(timing.durationMs, 1 / speed),
  }
}

/** `timing` with every time divided by `speed`; the share `speed` of its pace is not a time. */
export function pacedRetractTiming(timing: RetractTiming, speed: number): RetractTiming {
  return {
    ...timing,
    nodeGapMs: timing.nodeGapMs / speed,
    capMs: timing.capMs / speed,
    durationMs: scaleTimes(timing.durationMs, 1 / speed),
  }
}

function scaleTimes<T extends Partial<Record<string, number>>>(table: T, factor: number): T {
  return Object.fromEntries(
    Object.entries(table).map(([key, ms]) => [key, ms === undefined ? ms : ms * factor]),
  ) as T
}

/** The Full level's schedule at `speed`; at ×1 it is `REVEAL_TIMING` itself. */
export const revealTimingAt = (speed: number): RevealTiming =>
  speed === 1 ? REVEAL_TIMING : pacedRevealTiming(REVEAL_TIMING, speed)

/** The Framing level's schedule at `speed`; at ×1 it is `LAZY_REVEAL_TIMING` itself. */
export const lazyTimingAt = (speed: number): LazyRevealTiming =>
  speed === 1 ? LAZY_REVEAL_TIMING : pacedLazyTiming(LAZY_REVEAL_BASE_TIMING, FRAMING_PACE / speed)

/** The reverse play's schedule at `speed`; at ×1 it is `RETRACT_TIMING` itself. */
export const retractTimingAt = (speed: number): RetractTiming =>
  speed === 1 ? RETRACT_TIMING : pacedRetractTiming(RETRACT_TIMING, speed)

/** A stable share in [0, 1) from an id: the same jitter every time. */
function jitterKey(id: string): number {
  return (scatterKey(`${id}#jitter`) % 10_007) / 10_007
}

const STAGE_A: readonly RevealPhase[] = ['foundation', 'structure', 'circulation', 'openings']

/**
 * Start times for `candidates` on the lazy, nested schedule, from `startMs`:
 * - each floor builds its foundation, structure, stairs and openings, a phase after the other, and
 *   the floors go up side by side, `floorOffsetMs` apart;
 * - in a phase, the rooms (`cluster`) start `roomOffsetMs` apart in their sweep order, and the
 *   pieces of a room `elementOffsetMs` apart around it; what belongs to the whole floor comes first;
 * - roofs come once every floor is up, then the furniture, floor by floor and room by room again;
 * - a piece with a preroll starts after it (its plugin plays then), and its room's next phase waits.
 * Every start is jittered. The plan grows with the build (its biggest room, its rooms, its floors),
 * and is pulled together only past `capMs`. `startMs` of a planned entry is when the node itself
 * moves; its preroll plays before.
 */
export function planLazyReveal(
  candidates: readonly RevealCandidate[],
  startMs: number,
  timing: LazyRevealTiming = LAZY_REVEAL_TIMING,
): PlannedReveal[] {
  type Placed = { candidate: RevealCandidate; motion: number; preroll: number }
  const placed: Placed[] = []
  const floors = new Map<string, RevealCandidate[]>()
  for (const candidate of candidates) {
    const floor = `${candidate.levelIndex}:${candidate.levelId ?? ''}`
    const list = floors.get(floor)
    if (list) list.push(candidate)
    else floors.set(floor, [candidate])
  }
  const lanes = [...floors.entries()].sort(([left], [right]) =>
    left.localeCompare(right, undefined, { numeric: true }),
  )
  const jittered = (id: string, offset: number) => (2 * jitterKey(id) - 1) * timing.jitter * offset

  /** Places one floor's nodes of one phase from `from`; returns when its last piece moves, or null. */
  const placePhase = (nodes: readonly RevealCandidate[], phase: RevealPhase, from: number) => {
    if (nodes.length === 0) return null
    const rooms = new Map<string, RevealCandidate[]>()
    for (const node of nodes) {
      const room = node.cluster ?? ''
      const list = rooms.get(room)
      if (list) list.push(node)
      else rooms.set(room, [node])
    }
    const sweepOf = (members: readonly RevealCandidate[]) =>
      Math.min(...members.map((member) => member.sweep ?? Number.NEGATIVE_INFINITY))
    const ordered = [...rooms.entries()].sort(
      ([leftKey, left], [rightKey, right]) =>
        // What belongs to the whole floor first, then the rooms in their sweep.
        (leftKey === '' ? -1 : 0) - (rightKey === '' ? -1 : 0) ||
        sweepOf(left) - sweepOf(right) ||
        leftKey.localeCompare(rightKey),
    )
    const step = timing.elementOffsetMs[phase]
    let last = from
    ordered.forEach(([room, members], index) => {
      const roomStart =
        from +
        index * timing.roomOffsetMs +
        jittered(`${room}:${phase}`, index > 0 ? timing.roomOffsetMs : 0)
      members.sort(
        (left, right) =>
          left.depth - right.depth ||
          (left.order ?? 0) - (right.order ?? 0) ||
          scatterKey(left.id) - scatterKey(right.id) ||
          left.seq - right.seq,
      )
      members.forEach((candidate, rank) => {
        const turn = Math.max(from, roomStart + rank * step + jittered(candidate.id, step))
        const preroll = Math.max(0, candidate.prerollMs ?? 0)
        placed.push({ candidate, motion: turn + preroll, preroll })
        last = Math.max(last, turn + preroll)
      })
    })
    return last
  }

  const phaseOf = (nodes: readonly RevealCandidate[], phase: RevealPhase) =>
    nodes.filter((node) => node.phase === phase)
  /** Every floor builds `phases` from `from`, `floorOffsetMs` apart; returns when the last piece moves. */
  const stage = (phases: readonly RevealPhase[], from: number) => {
    let end: number | null = null
    let lane = 0
    for (const [, nodes] of lanes) {
      const own = phases.flatMap((phase) => phaseOf(nodes, phase))
      if (own.length === 0) continue
      let cursor = from + lane * timing.floorOffsetMs
      lane += 1
      for (const phase of phases) {
        const last = placePhase(phaseOf(nodes, phase), phase, cursor)
        if (last === null) continue
        end = Math.max(end ?? last, last)
        cursor = last + timing.phaseGapMs
      }
    }
    return end
  }

  let cursor = 0
  for (const phases of [STAGE_A, ['roof'], ['furnishing']] as const) {
    const end = stage(phases, cursor)
    if (end !== null) cursor = end + timing.phaseGapMs
  }

  const longest = Math.max(0, ...placed.map(({ candidate }) => timing.durationMs[candidate.style]))
  const lastMotion = Math.max(0, ...placed.map(({ motion }) => motion))
  const room = Math.max(0, timing.capMs - longest)
  const compression = lastMotion > room ? room / lastMotion : 1
  const arrival = ({ candidate, motion }: Placed) =>
    motion * compression + timing.durationMs[candidate.style] * REVEAL_ARRIVAL[candidate.style]
  let finale: Placed | null = null
  for (const entry of placed) {
    if (entry.candidate.style === 'assemble') continue
    if (!finale || arrival(entry) >= arrival(finale)) finale = entry
  }
  return placed
    .sort((left, right) => left.motion - right.motion || left.candidate.seq - right.candidate.seq)
    .map((entry) => ({
      ...entry.candidate,
      group: revealGroupKey(entry.candidate),
      startMs: startMs + entry.motion * compression,
      ...(entry.preroll > 0 ? { prerollMs: entry.preroll * compression } : {}),
      ...(entry === finale ? { finale: true } : {}),
    }))
}

export type RetractTiming = {
  /** A reverse plan keeps the build's order, reversed, at this share of its pace. */
  speed: number
  /** Between two pieces of one phase on one level, in a reverse plan with room to spare. */
  nodeGapMs: number
  /** A reverse play ends within this however many pieces it takes back. */
  capMs: number
  /** How long each style takes to go: a rewind is quicker than the build. */
  durationMs: Record<RevealStyle, number> & { cover?: number }
}

/** The one place to tune the reverse play's pace. */
export const RETRACT_TIMING: RetractTiming = {
  speed: 0.62,
  nodeGapMs: REVEAL_TIMING.nodeGapMs * 0.62,
  capMs: 2400,
  durationMs: { rise: 420, scale: 300, settle: 380, drop: 400, cut: 260, assemble: 520 },
}

export type PlannedRetract = RevealCandidate & {
  group: string
  startMs: number
  durationMs: number
}

/**
 * The reverse play at the Framing level: the rewind's durations at the Framing pace, so a deleted
 * floor comes apart as slowly as it went up. `capMs` keeps a whole floor's deconstruction in a
 * bounded time however many pieces it takes back.
 */
/** A covering lifts off in this share of the time it took to lay. */
export const COVER_REVERSE_SHARE = 0.6

export const LAZY_RETRACT_TIMING: RetractTiming = {
  speed: RETRACT_TIMING.speed,
  nodeGapMs: RETRACT_TIMING.nodeGapMs * FRAMING_PACE,
  capMs: 14_000,
  durationMs: {
    ...scaleTimes(RETRACT_TIMING.durationMs, FRAMING_PACE),
    cover: LAZY_REVEAL_TIMING.durationMs.cover * COVER_REVERSE_SHARE,
  },
}

/**
 * How long a roof's covering takes by the size it covers at the Framing level at `speed`: its range
 * in metres of sweep (`coverDurationMs`); `reverse` for the lifting off of a deletion or an undo.
 */
export function coverRangeAt(speed: number, reverse = false): CoverRange {
  const timing = lazyTimingAt(speed)
  const share = reverse ? COVER_REVERSE_SHARE : 1
  return {
    perMeterMs: timing.coverMsPerM * share,
    minMs: timing.coverMinMs * share,
    maxMs: timing.durationMs.cover * share,
  }
}

/** The Framing level's reverse play at `speed`; at ×1 it is `LAZY_RETRACT_TIMING` itself. */
export const lazyRetractTimingAt = (speed: number): RetractTiming =>
  speed === 1 ? LAZY_RETRACT_TIMING : pacedRetractTiming(LAZY_RETRACT_TIMING, speed)

/**
 * The Framing build played backwards, for a deletion or an undo: the plan of the build (floor by
 * floor, room by room, piece by piece, `planLazyReveal`) read from its end, so the furniture lifts
 * out first, then the roof, the openings, the walls and the slabs last, and the floors come apart
 * from the top down, each room as it went up. Each piece takes its own style's rewind time; a piece
 * that had a preroll keeps it, after its own going, for the plugin that took it apart (a wall's
 * boards come off and its studs fly up then). The whole ends within the cap by pulling the starts
 * closer, never by skipping a piece.
 */
export function planLazyRetract(
  candidates: readonly RevealCandidate[],
  startMs: number,
  timing: RetractTiming = LAZY_RETRACT_TIMING,
  build: LazyRevealTiming = LAZY_REVEAL_TIMING,
): PlannedRetract[] {
  const forward = planLazyReveal(candidates, 0, build)
  const lastTurn = Math.max(0, ...forward.map((entry) => entry.startMs))
  const placed = forward.map((entry) => ({
    entry,
    offset: (lastTurn - entry.startMs) * timing.speed,
  }))
  const longest = Math.max(0, ...placed.map(({ entry }) => styleMs(timing.durationMs, entry.style)))
  const lastStart = Math.max(0, ...placed.map(({ offset }) => offset))
  const room = Math.max(0, timing.capMs - longest)
  const compression = lastStart > room ? room / lastStart : 1
  return placed
    .map(({ entry, offset }) => {
      const { startMs: _start, finale: _finale, prerollMs, ...candidate } = entry
      return {
        ...candidate,
        ...(prerollMs ? { prerollMs: prerollMs * timing.speed * compression } : {}),
        startMs: startMs + offset * compression,
        durationMs: styleMs(timing.durationMs, entry.style),
      }
    })
    .sort((left, right) => left.startMs - right.startMs || right.seq - left.seq)
}

/**
 * The build played backwards, for an undo: the last phase goes first and each goes after the one
 * built on it (the furniture, the roof, the openings, the walls, the slab), and inside a phase the last
 * piece to arrive is the first to go, so the plan reads one phase at a time as the build did. It is
 * quicker; each piece takes its own style's rewind duration; and the whole ends within the cap by
 * pulling the starts closer, never by skipping a piece.
 */
export function planRetract(
  candidates: readonly RevealCandidate[],
  startMs: number,
  timing: RetractTiming = RETRACT_TIMING,
  build: RevealTiming = REVEAL_TIMING,
): PlannedRetract[] {
  const forward = planReveal(candidates, 0, build)
  const byPhase = new Map<RevealPhase, PlannedReveal[]>()
  for (const entry of forward)
    byPhase.set(entry.phase, [...(byPhase.get(entry.phase) ?? []), entry])
  const placed: { entry: PlannedReveal; offset: number }[] = []
  let cursor = 0
  for (const phase of [...REVEAL_PHASE_ORDER].reverse()) {
    const entries = byPhase.get(phase)
    if (!entries) continue
    const first = Math.min(...entries.map((entry) => entry.startMs))
    const last = Math.max(...entries.map((entry) => entry.startMs))
    for (const entry of entries)
      placed.push({ entry, offset: cursor + (last - entry.startMs) * timing.speed })
    cursor += (last - first + build.groupGapMs) * timing.speed
  }
  const longest = Math.max(0, ...placed.map(({ entry }) => styleMs(timing.durationMs, entry.style)))
  const lastStart = Math.max(0, ...placed.map(({ offset }) => offset))
  const room = Math.max(0, timing.capMs - longest)
  const compression = lastStart > room ? room / lastStart : 1
  return placed
    .map(({ entry, offset }) => {
      const { startMs: _start, finale: _finale, ...candidate } = entry
      return {
        ...candidate,
        startMs: startMs + offset * compression,
        durationMs: styleMs(timing.durationMs, entry.style),
      }
    })
    .sort((left, right) => left.startMs - right.startMs || right.seq - left.seq)
}
