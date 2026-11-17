import type { HedgeNode } from '../schema'
import { lineWalker, smoothLine } from './smooth-line'

type Point = [number, number]

/** What of a hedge its line is a function of. */
export type HedgeLineInput = Pick<
  HedgeNode,
  'path' | 'closed' | 'curve' | 'width' | 'clip' | 'gaps'
>

/**
 * A cross-section's place on the line: where it stands, the direction of travel, the metres
 * travelled from the start (`s`, past the length on a ring's run that crosses its seam) and the
 * signed curvature (1/m, positive where the line turns toward `hedgeNormal`).
 */
export type HedgeStation = { x: number; z: number; tx: number; tz: number; s: number; k: number }

/** One planted stretch between two openings, or the whole hedge. */
export type HedgeRun = {
  from: number
  to: number
  /** A closed hedge with no opening: the last station joins the first, and no end is rounded. */
  ring: boolean
  stations: HedgeStation[]
}

/** What became of an opening that was asked for. */
export type HedgeGapFact = {
  atM: number
  widthM: number
  /** The stretch left open on the line, in metres from its start; absent when nothing was left. */
  fromM?: number
  toM?: number
  left: boolean
  note?: 'outside the line' | 'cut at an end of the line' | 'joined with the opening before it'
}

export type HedgeLine = {
  /** Length of the smoothed centreline, openings included. */
  length: number
  /** Length that is planted. */
  planted: number
  closed: boolean
  /** Metres between two stations away from the ends. */
  step: number
  /** The length over which an end is rounded. */
  endRadius: number
  runs: HedgeRun[]
  gaps: HedgeGapFact[]
  /** Stretches between two openings too short to plant, left open with them. */
  tooShort: { fromM: number; toM: number }[]
}

/** However long the line, it is cut into at most this many stations. */
export const HEDGE_MAX_STATIONS = 2000
/** Stations kept back for the rounded ends of the runs (17 runs at most, two ends each). */
const END_STATIONS_RESERVE = 300
/** Where the stations of a rounded end stand, as shares of its radius from the tip. */
const END_TAPER = [0, 0.04, 0.12, 0.25, 0.42, 0.62, 0.82]

const length2 = (x: number, z: number) => Math.sqrt(x * x + z * z)

/** The side a positive lateral offset is on: the direction of travel turned a quarter turn. */
export function hedgeNormal(station: Pick<HedgeStation, 'tx' | 'tz'>): Point {
  return [-station.tz, station.tx]
}

/** A stretch shorter than this between two openings is not planted. */
export function hedgeMinRun(width: number): number {
  return Math.max(0.3, width * 0.6)
}

/** The smoothed centreline as a polyline; a ring ends on its first point. */
export function hedgeCentreline(
  input: Pick<HedgeLineInput, 'path' | 'closed' | 'curve' | 'width'>,
) {
  // A clipped hedge turns a corner over a length its width sets.
  return smoothLine(input.path, {
    closed: input.closed,
    curve: input.curve,
    cornerReach: Math.max(0.25, input.width * 0.8),
  })
}

type Interval = { from: number; to: number }

/** The openings as stretches of the line, and what became of each one asked for. */
function openings(
  gaps: HedgeLineInput['gaps'],
  length: number,
  closed: boolean,
): { open: Interval[]; facts: HedgeGapFact[] } {
  const facts: HedgeGapFact[] = []
  const asked: { interval: Interval; fact: HedgeGapFact }[] = []
  for (const gap of gaps) {
    const fact: HedgeGapFact = { atM: gap.at, widthM: gap.width, left: false }
    facts.push(fact)
    let [from, to] = [gap.at - gap.width / 2, gap.at + gap.width / 2]
    if (closed) {
      const width = Math.min(gap.width, length)
      from = (((gap.at - width / 2) % length) + length) % length
      to = from + width
    } else {
      if (to <= 0 || from >= length) {
        fact.note = 'outside the line'
        continue
      }
      if (from < 0 || to > length) fact.note = 'cut at an end of the line'
      from = Math.max(0, from)
      to = Math.min(length, to)
    }
    fact.left = true
    fact.fromM = from
    fact.toM = to
    asked.push({ interval: { from, to }, fact })
  }
  asked.sort((a, b) => a.interval.from - b.interval.from)
  const open: Interval[] = []
  for (const { interval, fact } of asked) {
    const last = open.at(-1)
    if (last && interval.from <= last.to) {
      last.to = Math.max(last.to, interval.to)
      fact.note = 'joined with the opening before it'
    } else open.push({ ...interval })
  }
  const [first, last] = [open[0], open.at(-1)]
  if (closed && first && last && first !== last && last.to - length >= first.from) {
    first.from = last.from - length
    first.to = Math.max(first.to, last.to - length)
    open.pop()
  }
  return { open, facts }
}

/** The planted stretches: what the openings leave, a ring's last stretch running past its seam. */
function plantedStretches(open: Interval[], length: number, closed: boolean): Interval[] {
  if (!open.length) return [{ from: 0, to: length }]
  const stretches: Interval[] = []
  if (closed) {
    open.forEach((gap, i) => {
      const next = open[(i + 1) % open.length] as Interval
      stretches.push({ from: gap.to, to: i + 1 < open.length ? next.from : next.from + length })
    })
    return stretches
  }
  let from = 0
  for (const gap of open) {
    stretches.push({ from, to: gap.from })
    from = gap.to
  }
  stretches.push({ from, to: length })
  return stretches
}

/** Where a run's stations stand: closer together over its two rounded ends. */
function stationsAlong({ from, to }: Interval, step: number, endRadius: number): number[] {
  const radius = Math.min(endRadius, (to - from) / 2)
  const inner = to - from - 2 * radius
  const count = Math.max(1, Math.ceil(inner / step))
  const at: number[] = END_TAPER.map((share) => from + share * radius)
  for (let i = 0; i <= count; i++) at.push(from + radius + (inner * i) / count)
  for (let i = END_TAPER.length - 1; i >= 0; i--) at.push(to - (END_TAPER[i] as number) * radius)
  return at.filter((s, i) => i === 0 || s - (at[i - 1] as number) > 1e-6)
}

/**
 * The hedge's line: its smoothed centreline cut into planted runs of stations, between the
 * openings. Bounded whatever the node holds: at most `HEDGE_MAX_STATIONS` stations.
 */
export function hedgeLine(input: HedgeLineInput): HedgeLine {
  const centre = hedgeCentreline(input)
  const { total: length, at } = lineWalker(centre.points, centre.closed)
  const endRadius = input.width * (0.85 - 0.55 * input.clip)
  const base = Math.min(0.2, Math.max(0.1, input.width * 0.2))
  const step = Math.max(base, length / (HEDGE_MAX_STATIONS - END_STATIONS_RESERVE))
  const line: HedgeLine = {
    length,
    planted: 0,
    closed: centre.closed,
    step,
    endRadius,
    runs: [],
    gaps: [],
    tooShort: [],
  }
  if (!(length > 0)) {
    line.gaps = input.gaps.map((gap) => ({
      atM: gap.at,
      widthM: gap.width,
      left: false,
      note: 'outside the line',
    }))
    return line
  }
  const { open, facts } = openings(input.gaps, length, centre.closed)
  line.gaps = facts
  const ring = centre.closed && !open.length
  const reach = Math.max(step, input.width * 0.3)
  const tangentAt = (s: number): Point => {
    const [a, b] = [at(s - reach), at(s + reach)]
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
    const d = length2(dx, dz)
    return d > 1e-9 ? [dx / d, dz / d] : [1, 0]
  }
  for (const stretch of plantedStretches(open, length, centre.closed)) {
    if (stretch.to - stretch.from < hedgeMinRun(input.width)) {
      if (stretch.to > stretch.from) line.tooShort.push({ fromM: stretch.from, toM: stretch.to })
      continue
    }
    const count = Math.max(3, Math.ceil(length / step))
    const along = ring
      ? Array.from({ length: count }, (_, i) => (length * i) / count)
      : stationsAlong(stretch, step, endRadius)
    const stations = along.map((s): HedgeStation => {
      const [x, z] = at(s)
      const [tx, tz] = tangentAt(s)
      return { x, z, tx, tz, s, k: 0 }
    })
    // The turn of the frame a metre: read between two tangents so close that their turn is small.
    const near = Math.min(step, reach) / 4
    for (const station of stations) {
      const [before, after] = [tangentAt(station.s - near), tangentAt(station.s + near)]
      station.k = (before[0] * after[1] - before[1] * after[0]) / (2 * near)
    }
    line.runs.push({ from: stretch.from, to: stretch.to, ring, stations })
    line.planted += stretch.to - stretch.from
  }
  return line
}

/** How much of its width a run keeps at a station: narrowing to nothing over a rounded end. */
export function hedgeEndScale(run: HedgeRun, s: number, endRadius: number): number {
  if (run.ring) return 1
  const radius = Math.min(endRadius, (run.to - run.from) / 2)
  if (!(radius > 0)) return 1
  const e = Math.min(1, Math.max(0, Math.min(s - run.from, run.to - s) / radius))
  return Math.sqrt(1 - (1 - e) * (1 - e))
}

/**
 * A lateral offset as far from the centreline as the line's bend allows: on the inside of a
 * tight turn the body stops short of the centre of the turn, so it never folds over itself.
 */
export function hedgeLateral(station: HedgeStation, offset: number): number {
  if (station.k * offset <= 0) return offset
  const limit = 0.85 / Math.abs(station.k)
  return offset > 0 ? Math.min(offset, limit) : Math.max(offset, -limit)
}

/**
 * The ground a hedge covers, as plan rings: one a run, outline first; a ring hedge gives its
 * outer and inner edge. The 2D symbol, and the same edges the 3D body stands on.
 */
export function hedgeBands(line: HedgeLine, width: number): Point[][][] {
  const half = width / 2
  return line.runs.map((run) => {
    const edge = (side: 1 | -1) =>
      run.stations.map((station): Point => {
        const [nx, nz] = hedgeNormal(station)
        const offset = hedgeLateral(
          station,
          side * half * hedgeEndScale(run, station.s, line.endRadius),
        )
        return [station.x + nx * offset, station.z + nz * offset]
      })
    return run.ring ? [edge(1), edge(-1)] : [[...edge(1), ...edge(-1).reverse()]]
  })
}
