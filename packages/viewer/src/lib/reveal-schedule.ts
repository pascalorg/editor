import type { RevealPhase, RevealStyle } from '@pascal-app/core'
import { REVEAL_ARRIVAL } from './reveal-pose'

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
   * How long each style moves its node. `assemble` holds its node still (its parts drop), and the
   * heights of the travelling styles are declared by each kind (`capabilities.reveal.height`).
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

export type RevealCandidate = {
  id: string
  phase: RevealPhase
  style: RevealStyle
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
        longest = Math.max(longest, timing.durationMs[candidate.style])
      })
    })
    end = phaseEnd
    phaseStart = phaseEnd + timing.groupGapMs
  }
  const room = Math.max(0, timing.capMs - longest)
  const compression = end > room ? room / end : 1
  const arrival = ({ candidate, offset }: (typeof planned)[number]) =>
    offset * compression + timing.durationMs[candidate.style] * REVEAL_ARRIVAL[candidate.style]
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

export type RetractTiming = {
  /** A reverse plan keeps the build's order, reversed, at this share of its pace. */
  speed: number
  /** Between two pieces of one phase on one level, in a reverse plan with room to spare. */
  nodeGapMs: number
  /** A reverse play ends within this however many pieces it takes back. */
  capMs: number
  /** How long each style takes to go: a rewind is quicker than the build. */
  durationMs: Record<RevealStyle, number>
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
): PlannedRetract[] {
  const forward = planReveal(candidates, 0)
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
    cursor += (last - first + REVEAL_TIMING.groupGapMs) * timing.speed
  }
  const longest = Math.max(0, ...placed.map(({ entry }) => timing.durationMs[entry.style]))
  const lastStart = Math.max(0, ...placed.map(({ offset }) => offset))
  const room = Math.max(0, timing.capMs - longest)
  const compression = lastStart > room ? room / lastStart : 1
  return placed
    .map(({ entry, offset }) => {
      const { startMs: _start, finale: _finale, ...candidate } = entry
      return {
        ...candidate,
        startMs: startMs + offset * compression,
        durationMs: timing.durationMs[entry.style],
      }
    })
    .sort((left, right) => left.startMs - right.startMs || right.seq - left.seq)
}
