import type { GroundRead } from './ground-read'
import {
  type HedgeLine,
  type HedgeRun,
  type HedgeStation,
  hedgeEndScale,
  hedgeLateral,
  hedgeNormal,
} from './hedge-line'

/** A station with the ground under it: under its centre and under its two base edges. */
export type HedgeFootStation = HedgeStation & {
  /** Ground under the centreline. */
  yC: number
  /** Ground under the base edge on the side of `hedgeNormal`, and under the other. */
  yR: number
  yL: number
  /** The centre ground evened out along the run: what the top is measured from. */
  yTop: number
  /** Half the width of the base here, as the edges were read. */
  half: number
}

export type HedgeFootRun = Omit<HedgeRun, 'stations'> & { stations: HedgeFootStation[] }

/** How far the base sinks under the ground it was read on, so no edge shows daylight. */
export const HEDGE_EMBED = 0.08
/** The top follows the ground evened out over this length each way, not every dip of it. */
const TOP_EVEN_M = 0.6
/** The two stations a break is crossed between stand this far from it, one on each side. */
const BREAK_CLEARANCE_M = 0.01
/** At most this many break crossings are given their own stations. */
const MAX_BREAK_STEPS = 64

const mix = (a: number, b: number, t: number) => a + (b - a) * t

function between(a: HedgeStation, b: HedgeStation, t: number, s: number): HedgeStation {
  const [tx, tz] = [mix(a.tx, b.tx, t), mix(a.tz, b.tz, t)]
  const d = Math.sqrt(tx * tx + tz * tz) || 1
  return {
    x: mix(a.x, b.x, t),
    z: mix(a.z, b.z, t),
    tx: tx / d,
    tz: tz / d,
    s,
    k: mix(a.k, b.k, t),
  }
}

/**
 * The stations of a run with two more wherever the centreline crosses a terrain break, one just
 * before the face and one just after: the body steps there with the ground instead of leaning
 * across it. `breaks` holds the index of each station that begins a new stretch of ground.
 */
function splitAtBreaks(
  run: HedgeRun,
  length: number,
  ground: GroundRead,
  budget: { steps: number },
): { stations: HedgeStation[]; starts: number[] } {
  const region = ground.regionAt
  if (!region) return { stations: run.stations, starts: [] }
  const stations: HedgeStation[] = []
  const starts: number[] = []
  const count = run.stations.length
  const pairs = run.ring ? count : count - 1
  for (let i = 0; i < count; i++) {
    const a = run.stations[i] as HedgeStation
    stations.push(a)
    if (i >= pairs) break
    const b = run.stations[(i + 1) % count] as HedgeStation
    const [ra, rb] = [region(a.x, a.z), region(b.x, b.z)]
    if (ra === rb || budget.steps <= 0) continue
    budget.steps--
    let [low, high] = [0, 1]
    for (let n = 0; n < 16; n++) {
      const middle = (low + high) / 2
      if (region(mix(a.x, b.x, middle), mix(a.z, b.z, middle)) === ra) low = middle
      else high = middle
    }
    const dx = b.x - a.x
    const dz = b.z - a.z
    const span = Math.sqrt(dx * dx + dz * dz)
    const clear = span > 0 ? BREAK_CLEARANCE_M / span : 0
    const sSpan = run.ring && b.s < a.s ? b.s + length - a.s : b.s - a.s
    const [before, after] = [Math.max(0, low - clear), Math.min(1, high + clear)]
    stations.push(between(a, b, before, a.s + sSpan * before))
    starts.push(stations.length)
    stations.push(between(a, b, after, a.s + sSpan * after))
  }
  return { stations, starts }
}

/** `values` evened out over `TOP_EVEN_M` each way, within one stretch of unbroken ground. */
function evened(stations: HedgeFootStation[], from: number, to: number) {
  for (let i = from; i < to; i++) {
    const here = stations[i] as HedgeFootStation
    let [sum, count] = [0, 0]
    for (let j = i; j >= from && here.s - (stations[j] as HedgeFootStation).s <= TOP_EVEN_M; j--) {
      sum += (stations[j] as HedgeFootStation).yC
      count++
    }
    for (let j = i + 1; j < to && (stations[j] as HedgeFootStation).s - here.s <= TOP_EVEN_M; j++) {
      sum += (stations[j] as HedgeFootStation).yC
      count++
    }
    here.yTop = sum / count
  }
}

/**
 * Stands a hedge's line on the ground. Each station reads the ground under its centre and under
 * both base edges, so the base sits on a cross slope; an edge that would hang over a terrain
 * break keeps the centre's ground instead of dropping down the face.
 */
export function standHedgeLine(line: HedgeLine, width: number, ground: GroundRead): HedgeFootRun[] {
  const budget = { steps: MAX_BREAK_STEPS }
  return line.runs.map((run) => {
    const { stations: split, starts } = splitAtBreaks(run, line.length, ground, budget)
    const stations = split.map((station): HedgeFootStation => {
      const half = Math.abs(
        hedgeLateral(station, (width / 2) * hedgeEndScale(run, station.s, line.endRadius)),
      )
      const [nx, nz] = hedgeNormal(station)
      const yC = ground.heightAt(station.x, station.z)
      const home = ground.regionAt?.(station.x, station.z)
      const edge = (side: 1 | -1) => {
        const offset = hedgeLateral(station, side * half)
        const [x, z] = [station.x + nx * offset, station.z + nz * offset]
        return ground.regionAt && ground.regionAt(x, z) !== home ? yC : ground.heightAt(x, z)
      }
      return { ...station, yC, yR: edge(1), yL: edge(-1), yTop: yC, half }
    })
    const bounds = [0, ...starts, stations.length]
    for (let i = 0; i + 1 < bounds.length; i++)
      evened(stations, bounds[i] as number, bounds[i + 1] as number)
    return { from: run.from, to: run.to, ring: run.ring, stations }
  })
}

/** The lowest and highest ground under the hedge's centreline and base edges. */
export function hedgeGroundRange(runs: readonly HedgeFootRun[]): {
  lowest: number
  highest: number
} {
  let [lowest, highest] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const run of runs)
    for (const { yC, yL, yR } of run.stations) {
      lowest = Math.min(lowest, yC, yL, yR)
      highest = Math.max(highest, yC, yL, yR)
    }
  return Number.isFinite(lowest) ? { lowest, highest } : { lowest: 0, highest: 0 }
}
