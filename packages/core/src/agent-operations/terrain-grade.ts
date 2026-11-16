import { heightAt, quantize, type TerrainField } from '../lib/terrain-field'
import { distance2D, pointInPolygon, type Vec2 } from './plan-geometry'

/**
 * Ground as a function of the distance to a house: a pad at the house's height as far as `marginM` from
 * its outline, then a batter, 1 metre of height for every `run` metres, to the ground that was there (the
 * daylight line) or to a stated lawn level. Distance is Euclidean to the outline, so the batter's contours
 * are the outline's offsets, rounded at convex corners and straight along walls: a curved house gets a
 * curved slope with no further rule.
 *
 * Several pads (one per level of a split-level house) each have their own height and margin; a sample
 * follows the pad whose outline is nearest. A band replaces the ring by a straight edge: the outline
 * extended across the lot along that edge, so the wall and bank run its whole width.
 */
export type GradePad = {
  /** The house outline of this pad in the site frame. */
  outline: Vec2[]
  /** Height of the pad, metres above datum. */
  heightM: number
  /** The pad reaches this far beyond its outline. */
  marginM: number
  /**
   * The pad and its batter only cut: ground that already lies under them is left as it is. The
   * high side of a house whose low side walks out: the hill is cut back where it stands over the
   * floor and keeps its own slope where it does not.
   */
  cutOnly?: boolean
}

/** The strip a band grades: the outline's extent along `normal`, unbounded across it. */
export type GradeBand = {
  /** Unit vector pointing from the house toward the edge. */
  normal: Vec2
  /** The strip's front: the outline's least distance along `normal`. */
  frontM: number
  /** The strip's edge: the line the wall and bank stand beyond, along `normal`. */
  edgeM: number
}

export type GradeSettings = {
  pads: GradePad[]
  /** Grade across the lot along one edge instead of around the outline; takes exactly one pad. */
  band?: GradeBand
  /** Horizontal metres per metre of height in the batter (2 is 1:2). */
  run: number
  /** The batter is looked for this far beyond the pad; the ground beyond is not touched (a lawn aside). */
  reachM: number
  /** Terraces: the batter in steps of this riser, each tread `run` times as wide as the riser is tall. */
  riserM?: number
  /** A retaining wall: the ground beyond the pad edge starts this much above (or below) the pad. */
  wallM?: number
  /** After the bank, a flat lawn at this level: the ground is raised or cut to it. */
  upperLevelM?: number
  /** The lawn holds out to the edge of the written region; false stops it at `reachM`. */
  lawnToEdge?: boolean
  /** The wall is an exact terrain break: the pad side is its numeric plane. Its face is not read from the tiles. */
  exactWall?: boolean
  /**
   * The pad falls away from the outline by this many metres per metre, out to its margin: water
   * leaves the walls, and under a rising bank the pad's edge is the low line that carries it round.
   * The batter and the wall start from the pad's edge height. Default 0, a level pad.
   */
  padFallPerM?: number
  /** The rectangle the batter may write in; default each pad's outline out to its margin and `reachM`. */
  region?: { minX: number; minZ: number; maxX: number; maxZ: number }
  /**
   * The first pad's high side is held, not battered back: ground that stands over the pad stays
   * against a face `atM` beyond the outline, as high as `heightM` over the pad; above that it is
   * cut back at the batter. Ground under the pad is filled to it as without. One pad, no band.
   */
  retain?: GradeRetain
  /** A low line between the first pad and the ground that rises beyond it. One pad, no band. */
  lowLine?: GradeLowLine
}

export type GradeRetain = { atM: number; heightM: number }

/**
 * The line water follows round the high side of a pad instead of running to the walls: a level
 * bottom `widthM` wide (a lattice cell and a half: it survives sampling) that falls along its
 * length from its summit to where it comes out on lower ground. Beside a pad it starts at the
 * pad's edge and the pad falls to it; before held ground it stands `offM` beyond the face,
 * `depthM` under the ground that is there, and the ground between falls to it.
 */
export type GradeLowLine = {
  widthM: number
  /** Fall along the line, metres per metre. */
  fallPerM: number
  /** Beside a pad: how far under the pad's edge the line's summit stands. */
  underPadM: number
  /** Held ground only: the line's near edge from the face, its depth under the ground, the fall of the ground from the face to it. */
  offM: number
  depthM: number
  faceFallPerM: number
  /** How far past the last ground that rises the line is carried down to find lower ground. */
  daylightM: number
}

export type LowLineFacts = {
  lengthM: number
  /** Its highest and lowest bottom, metres above datum. */
  summitM: number
  lowestM: number
  /** The deepest it stands under the ground that was there. */
  deepestCutM: number
  /** Ends that came out on lower ground, and ends that did not within `daylightM`. */
  outlets: number
  blindEnds: number
  /** The ground rises on every side: the line is a ring with nowhere to run to. */
  closed: boolean
}

export type GradeOutcome = {
  heights: Int16Array
  changedSamples: number
  cutVolumeM3: number
  fillVolumeM3: number
  padAreaM2: number
  /** Per pad, the area of the ground it levelled. */
  padAreasM2: number[]
  /** The farthest a changed sample lies from the pad edge. */
  farthestChangeM: number
  /** Samples the batter would have changed beyond the property, which were left as they were. */
  outsideLotSamples: number
  /** The most one of them would have moved: the step the ground makes at the property line. */
  outsideLotMaxM: number
  /** The ground a lawn holds at its level, inside the property. */
  lawnAreaM2: number
  steepestSlopeDeg: number
  lowLine?: LowLineFacts
}

const EPS_M = 0.005

function distanceToSegment(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const lengthSq = dx * dx + dz * dz
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / lengthSq))
  return distance2D(point, [from[0] + dx * t, from[1] + dz * t])
}

/** Signed Euclidean distance to the outline: negative inside. */
export function outlineDistance(point: Vec2, outline: Vec2[]): number {
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i < outline.length; i++) {
    const to = outline[(i + 1) % outline.length] as Vec2
    nearest = Math.min(nearest, distanceToSegment(point, outline[i] as Vec2, to))
  }
  return pointInPolygon(point, outline, true) ? -nearest : nearest
}

/** How far the batter has risen (or fallen) `u` metres from the pad edge. */
export function batterRise(u: number, run: number, riserM?: number): number {
  if (!riserM) return u / run
  return riserM * Math.floor(u / (run * riserM) + 1e-9)
}

/** The horizontal run of a bank that climbs `heightM`: where `batterRise` first reaches it. */
export function bankRunM(heightM: number, run: number, riserM?: number): number {
  if (heightM <= 0) return 0
  return riserM ? Math.ceil(heightM / riserM - 1e-9) * run * riserM : heightM * run
}

/** The convex hull of a set of points, counter-clockwise in the site frame (shoelace area positive). */
export function convexHull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Vec2[]) => {
    const chain: Vec2[] = []
    for (const p of list) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2] as Vec2, chain[chain.length - 1] as Vec2, p) <= 0
      )
        chain.pop()
      chain.push(p)
    }
    chain.pop()
    return chain
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

const LOW_STATION_M = 0.25
/** The most corners and stations an outline may have for a low line to be solved round it. */
export const MAX_LOW_LINE_CORNERS = 256
const MAX_LOW_LINE_STATIONS = 4000
/** The most stations a line is carried along the house past the end of a stretch. */
const MAX_CARRY_STEPS = 64

type LowLine = {
  /** Per edge of the outline: its first station and how many it holds. */
  edges: { first: number; count: number }[]
  /** The bottom of the line at each station round the outline; NaN where there is none. */
  bottoms: Float64Array
  /** Stations where an earlier seating's line lies: the ground there is left as it is. */
  kept: boolean[]
  /** Where a stretch ends the line leaves the house and runs down the ground to come out. */
  tails: LowTail[]
  /** Absent when every stretch was already there. */
  facts: LowLineFacts | undefined
}

/** A straight run from `from` along the unit `way`, `lengthM` long, its bottom `fromM` falling `fallPerM`. */
type LowTail = { from: Vec2; way: Vec2; lengthM: number; fromM: number; fallPerM: number }

/** The nearest point of an outline: how far (negative inside), on which edge, how far along it (0..1). */
function nearestOnOutline(point: Vec2, outline: Vec2[]) {
  let distance = Number.POSITIVE_INFINITY
  let edge = 0
  let along = 0
  for (let i = 0; i < outline.length; i++) {
    const from = outline[i] as Vec2
    const to = outline[(i + 1) % outline.length] as Vec2
    const dx = to[0] - from[0]
    const dz = to[1] - from[1]
    const lengthSq = dx * dx + dz * dz
    const t =
      lengthSq === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / lengthSq),
          )
    const d = Math.hypot(point[0] - from[0] - dx * t, point[1] - from[1] - dz * t)
    if (d < distance) {
      distance = d
      edge = i
      along = t
    }
  }
  return { distance: pointInPolygon(point, outline, true) ? -distance : distance, edge, along }
}

/**
 * The low line round a pad's high side. Stations stand every quarter metre round the outline;
 * each reads the ground on the line's centre. Where that ground rises over the pad the line
 * exists: at the pad's edge height beside a pad, `depthM` under the ground before held ground.
 * Each stretch then falls from its summit both ways and is carried on down past its ends until
 * the ground is lower than it.
 */
function solveLowLine(
  pad: GradePad,
  low: GradeLowLine,
  padFallPerM: number,
  retain: GradeRetain | undefined,
  ground: (point: Vec2, distance: number) => number,
): LowLine | undefined {
  const outline = pad.outline
  const count = outline.length
  // The line is solved station by station round the outline: an outline of more corners or more
  // stations than a house has is not walked.
  if (count < 3 || count > MAX_LOW_LINE_CORNERS) return undefined
  let perimeter = 0
  for (let i = 0; i < count; i++) {
    const from = outline[i] as Vec2
    const to = outline[(i + 1) % count] as Vec2
    perimeter += Math.max(LOW_STATION_M, Math.hypot(to[0] - from[0], to[1] - from[1]))
  }
  if (perimeter / LOW_STATION_M > MAX_LOW_LINE_STATIONS) return undefined
  const signed = outline.reduce((sum, a, i) => {
    const b = outline[(i + 1) % count] as Vec2
    return sum + a[0] * b[1] - b[0] * a[1]
  }, 0)
  const turn = signed >= 0 ? 1 : -1
  const normalOf = (i: number): Vec2 => {
    const from = outline[i] as Vec2
    const to = outline[(i + 1) % count] as Vec2
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
    return [(turn * (to[1] - from[1])) / length, (-turn * (to[0] - from[0])) / length]
  }
  const padEdgeM = pad.heightM - padFallPerM * pad.marginM
  const nearM = retain ? retain.atM + low.offM : pad.marginM
  const centreM = nearM + low.widthM / 2
  const edges: LowLine['edges'] = []
  const natural: number[] = []
  const spacing: number[] = []
  const centres: Vec2[] = []
  const normals: Vec2[] = []
  const tails: LowTail[] = []
  const beyond: number[] = []
  const kept: boolean[] = []
  for (let i = 0; i < count; i++) {
    const from = outline[i] as Vec2
    const to = outline[(i + 1) % count] as Vec2
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    const stations = Math.max(1, Math.ceil(length / LOW_STATION_M))
    edges.push({ first: natural.length, count: stations })
    const normal = normalOf(i)
    const before = normalOf((i + count - 1) % count)
    for (let k = 0; k < stations; k++) {
      // The corner station looks out along the bisector of the two walls that meet there.
      let [nx, nz] = normal
      if (k === 0) {
        const bx = normal[0] + before[0]
        const bz = normal[1] + before[1]
        const b = Math.hypot(bx, bz)
        if (b > 1e-6) [nx, nz] = [bx / b, bz / b]
      }
      const x = from[0] + ((to[0] - from[0]) * k) / stations + nx * centreM
      const z = from[1] + ((to[1] - from[1]) * k) / stations + nz * centreM
      const here = ground([x, z], centreM)
      natural.push(here)
      spacing.push(length / stations)
      centres.push([x, z])
      normals.push([nx, nz])
      // A line an earlier seating left: the ground on the centre lower than on both sides of it
      // (and, beside a pad, no higher than this pad would put it). It is kept as it lies.
      const side = (distance: number) =>
        ground([x + nx * (distance - centreM), z + nz * (distance - centreM)], distance)
      // Past the lattice cell at the face, where the tiles under a face's plane still show.
      const inner = side(retain ? retain.atM + 0.55 : nearM - 0.3)
      const outer = side(nearM + low.widthM + 1.5)
      beyond.push(outer)
      kept.push(
        here < outer - 0.1 &&
          here < inner - 0.005 &&
          (retain !== undefined || here <= padEdgeM - low.underPadM + 0.015),
      )
    }
  }
  const total = natural.length
  // A gap of a station or three in a line that is there (a corner the lattice reads badly) is the line too.
  for (let index = 0; index < total; index++) {
    if (kept[index] || !kept[(index + total - 1) % total]) continue
    let gap = 1
    while (gap <= 3 && !kept[(index + gap) % total]) gap++
    if (gap <= 3) for (let k = 0; k < gap; k++) kept[(index + k) % total] = true
  }
  // Where the line is wanted, and the height it starts from before it is made to fall.
  const start = natural.map((height, index) =>
    kept[index]
      ? Number.NaN
      : retain
        ? height > pad.heightM + 0.05
          ? Math.min(
              height - low.depthM,
              // Under ground cut back to what the face holds, the line is the foot of that cut.
              pad.heightM + retain.heightM - low.faceFallPerM * low.offM,
            )
          : Number.NaN
        : // Beside a pad: wherever the ground on the line, or past it, stands over the pad's edge.
          Math.max(height, beyond[index] as number) > padEdgeM + 0.03
          ? padEdgeM - low.underPadM
          : Number.NaN,
  )
  const wanted = start.map((height) => !Number.isNaN(height))
  if (!wanted.some(Boolean) && !kept.some(Boolean)) return undefined
  const bottoms = new Float64Array(total).fill(Number.NaN)
  const facts: LowLineFacts = {
    lengthM: 0,
    summitM: Number.NEGATIVE_INFINITY,
    lowestM: Number.POSITIVE_INFINITY,
    deepestCutM: 0,
    outlets: 0,
    blindEnds: 0,
    closed: wanted.every(Boolean),
  }
  if (!wanted.some(Boolean)) return { edges, bottoms, kept, tails, facts: undefined }
  const lower = (index: number, height: number) => {
    const held = bottoms[index] as number
    bottoms[index] = Number.isNaN(held) ? height : Math.min(held, height)
  }
  if (facts.closed) for (let index = 0; index < total; index++) lower(index, start[index] as number)
  else {
    // Each stretch of stations that want the line, the first after one that does not.
    for (let first = 0; first < total; first++) {
      if (!wanted[first] || wanted[(first + total - 1) % total]) continue
      let length = 1
      while (wanted[(first + length) % total]) length++
      const at = (k: number) => (first + k + total) % total
      // The summit: the highest start, the middle of the stations that share it.
      let top = Number.NEGATIVE_INFINITY
      for (let k = 0; k < length; k++) top = Math.max(top, start[at(k)] as number)
      const tops: number[] = []
      for (let k = 0; k < length; k++) if ((start[at(k)] as number) > top - 0.005) tops.push(k)
      const summit = tops[Math.floor(tops.length / 2)] as number
      lower(at(summit), start[at(summit)] as number)
      for (const way of [1, -1] as const) {
        let height = start[at(summit)] as number
        let k = summit
        // Down the stretch: never above its start, never flatter than the fall.
        for (;;) {
          const next = k + way
          if (next < 0 || next >= length) break
          height = Math.min(
            start[at(next)] as number,
            height - low.fallPerM * (spacing[at(way === 1 ? k : next)] as number),
          )
          lower(at(next), height)
          k = next
        }
        // Past its end the line is carried on along the house while the ground there still runs
        // back to it, and leaves the house where the ground falls away: straight down the ground,
        // falling as it goes, until the ground is lower than it.
        let carried = 0
        let out = false
        for (let step = 0; step < Math.min(total, MAX_CARRY_STEPS); step++) {
          const index = at(k + way * step)
          const from = centres[index] as Vec2
          const slopeX =
            (ground([from[0] + 1, from[1]], centreM) - ground([from[0] - 1, from[1]], centreM)) / 2
          const slopeZ =
            (ground([from[0], from[1] + 1], centreM) - ground([from[0], from[1] - 1], centreM)) / 2
          const slope = Math.hypot(slopeX, slopeZ)
          const downhill: Vec2 = slope > 1e-6 ? [-slopeX / slope, -slopeZ / slope] : [0, 0]
          const outward = normals[index] as Vec2
          if (slope > 0.005 && downhill[0] * outward[0] + downhill[1] * outward[1] >= 0) {
            for (let run = LOW_STATION_M; run <= low.daylightM - carried; run += LOW_STATION_M) {
              const there: Vec2 = [from[0] + downhill[0] * run, from[1] + downhill[1] * run]
              if (ground(there, centreM) > height - low.fallPerM * run + 0.01) continue
              out = true
              tails.push({
                from,
                way: downhill,
                lengthM: run,
                fromM: height,
                fallPerM: low.fallPerM,
              })
              facts.lengthM += run
              facts.lowestM = Math.min(facts.lowestM, height - low.fallPerM * run)
              break
            }
            break
          }
          const next = at(k + way * (step + 1))
          // It meets the line an earlier seating left: that line is its way out.
          if (kept[next]) {
            out = true
            break
          }
          const run = spacing[way === 1 ? index : next] as number
          carried += run
          height -= low.fallPerM * run
          if ((natural[next] as number) <= height + 0.01) {
            out = true
            break
          }
          if (carried > low.daylightM || wanted[next]) break
          lower(next, height)
        }
        if (out) facts.outlets++
        else facts.blindEnds++
      }
    }
  }
  for (let index = 0; index < total; index++) {
    const bottom = bottoms[index] as number
    if (Number.isNaN(bottom)) continue
    facts.lengthM += spacing[index] as number
    facts.summitM = Math.max(facts.summitM, bottom)
    facts.lowestM = Math.min(facts.lowestM, bottom)
    facts.deepestCutM = Math.max(facts.deepestCutM, (natural[index] as number) - bottom)
  }
  return { edges, bottoms, kept, tails, facts }
}

/** The line's bottom abreast of a point of the outline, between its two stations there. */
function lowLineBottom(line: LowLine, edge: number, along: number): number {
  const { first, count } = line.edges[edge] as LowLine['edges'][number]
  const u = Math.max(0, Math.min(1, along)) * count
  const k = Math.min(count - 1, Math.floor(u))
  const a = line.bottoms[first + k] as number
  const b = line.bottoms[(first + k + 1) % line.bottoms.length] as number
  if (Number.isNaN(a)) return b
  if (Number.isNaN(b)) return a
  return a + (b - a) * (u - k)
}

/** Whether the line an earlier seating left runs abreast of a point of the outline. */
function lowLineKept(line: LowLine, edge: number, along: number): boolean {
  const { first, count } = line.edges[edge] as LowLine['edges'][number]
  const k = Math.min(count - 1, Math.floor(Math.max(0, Math.min(1, along)) * count))
  return (
    (line.kept[first + k] as boolean) || (line.kept[(first + k + 1) % line.kept.length] as boolean)
  )
}

type Governing = {
  pad: number
  /** Distance beyond the pad edge (negative inside the pad). */
  u: number
  /** The sample lies beyond the band's edge, not before its front. */
  onEdgeSide: boolean
}

/**
 * The ground the pads, batter, wall and lawn make over `field`. `inside` keeps the write on the property: a
 * sample outside it is left as it was, and counted when the rule would have moved it.
 */
export function gradeGround(
  field: TerrainField,
  settings: GradeSettings,
  inside: (point: Vec2) => boolean = () => true,
): GradeOutcome {
  const {
    pads,
    band,
    run,
    reachM,
    riserM = 0,
    wallM = 0,
    upperLevelM,
    exactWall = false,
  } = settings
  const lawnToEdge = settings.lawnToEdge ?? false
  const padFallPerM = settings.padFallPerM ?? 0
  const riser = riserM || undefined
  const governing = (point: Vec2): Governing => {
    if (band) {
      const pad = pads[0] as GradePad
      const along = point[0] * band.normal[0] + point[1] * band.normal[1]
      const rear = along - band.edgeM - pad.marginM
      const front = band.frontM - along - pad.marginM
      return {
        pad: 0,
        u: Math.max(rear, front),
        onEdgeSide: rear >= front,
      }
    }
    let inZone: Governing | undefined
    let inZoneD = Number.POSITIVE_INFINITY
    let nearest: Governing | undefined
    pads.forEach((pad, index) => {
      const distance = outlineDistance(point, pad.outline)
      const u = distance - pad.marginM
      if (u <= 0 && distance < inZoneD) {
        inZoneD = distance
        inZone = { pad: index, u, onEdgeSide: true }
      }
      if (!nearest || u < nearest.u) nearest = { pad: index, u, onEdgeSide: true }
    })
    return (inZone ?? nearest) as Governing
  }
  const span = Math.max(...pads.map((pad) => pad.marginM)) + reachM + field.spacing
  const region = settings.region ?? {
    minX: Math.min(...pads.flatMap((pad) => pad.outline.map((p) => p[0]))) - span,
    minZ: Math.min(...pads.flatMap((pad) => pad.outline.map((p) => p[1]))) - span,
    maxX: Math.max(...pads.flatMap((pad) => pad.outline.map((p) => p[0]))) + span,
    maxZ: Math.max(...pads.flatMap((pad) => pad.outline.map((p) => p[1]))) + span,
  }
  const col0 = Math.max(0, Math.floor((region.minX - field.origin[0]) / field.spacing))
  const col1 = Math.min(field.cols - 1, Math.ceil((region.maxX - field.origin[0]) / field.spacing))
  const row0 = Math.max(0, Math.floor((region.minZ - field.origin[1]) / field.spacing))
  const row1 = Math.min(field.rows - 1, Math.ceil((region.maxZ - field.origin[1]) / field.spacing))
  const heights = new Int16Array(field.heights)
  const reached = new Float32Array(field.heights.length).fill(Number.NaN)
  const cell = field.spacing * field.spacing
  const padSamples = pads.map(() => 0)
  const first = pads[0] as GradePad
  const retain = band ? undefined : settings.retain
  /** Ground the first pad's face holds: as it was, cut back only over what the face can hold. */
  const low = settings.lowLine
  // Over the face the cut starts past the low line, so the line is its foot and not the face's top.
  const heldFromM = retain ? retain.atM + (low && !band ? low.offM + low.widthM : 0) : 0
  const held = (beforeM: number, distance: number) =>
    retain
      ? Math.min(
          beforeM,
          first.heightM +
            retain.heightM +
            batterRise(Math.max(0, distance - heldFromM), run, riser),
        )
      : beforeM
  const line =
    low && !band
      ? solveLowLine(first, low, padFallPerM, retain, (point, distance) =>
          held(heightAt(field, point[0], point[1]), distance),
        )
      : undefined
  /** The most the ground may stand at a point beside the first pad for the low line to run there. */
  const lowLineCap = (point: Vec2): number => {
    if (!line || !low) return Number.POSITIVE_INFINITY
    const { distance, edge, along } = nearestOnOutline(point, first.outline)
    const near = retain ? retain.atM + low.offM : first.marginM
    // The pad itself, and an areaway before a face, are as they were made.
    if (distance <= (retain ? retain.atM : near)) return Number.POSITIVE_INFINITY
    let cap = Number.POSITIVE_INFINITY
    const bottom = lowLineBottom(line, edge, along)
    if (!Number.isNaN(bottom))
      cap =
        distance < near
          ? bottom + (near - distance) * low.faceFallPerM
          : distance <= near + low.widthM
            ? bottom
            : bottom + batterRise(distance - near - low.widthM, run, riser)
    for (const tail of line.tails) {
      const dx = point[0] - tail.from[0]
      const dz = point[1] - tail.from[1]
      const along = dx * tail.way[0] + dz * tail.way[1]
      if (along < 0 || along > tail.lengthM) continue
      const beside = Math.abs(dx * tail.way[1] - dz * tail.way[0]) - low.widthM / 2
      cap = Math.min(
        cap,
        tail.fromM - tail.fallPerM * along + (beside > 0 ? batterRise(beside, run, riser) : 0),
      )
    }
    return cap
  }
  let changedSamples = 0
  let cutVolumeM3 = 0
  let fillVolumeM3 = 0
  let farthestChangeM = 0
  let outsideLotSamples = 0
  let outsideLotMaxM = 0
  let lawnSamples = 0
  const changed: number[] = []
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      const index = row * field.cols + col
      const point: Vec2 = [
        field.origin[0] + col * field.spacing,
        field.origin[1] + row * field.spacing,
      ]
      const { pad: padIndex, u, onEdgeSide } = governing(point)
      const lawn = upperLevelM !== undefined && onEdgeSide
      if (u > reachM && !(lawn && lawnToEdge)) continue
      reached[index] = u
      const pad = pads[padIndex] as GradePad
      // The pad's height at its edge, where the batter and the wall start.
      const padHeightM = pad.heightM - padFallPerM * pad.marginM
      const beforeQ = field.heights[index] ?? 0
      const beforeM = beforeQ * field.step
      const rise = () => batterRise(u, run, riser)
      let target = beforeM
      // Beside a pad that holds its high side: ground over the pad's own surface stays, held.
      const distance = u + pad.marginM
      const surfaceM =
        u <= 0 ? pad.heightM - padFallPerM * Math.max(0, distance) : padHeightM - rise()
      if (retain && padIndex === 0 && distance > 0 && beforeM > surfaceM + EPS_M)
        target = distance <= retain.atM ? pad.heightM : held(beforeM, distance)
      else if (u <= 0) target = pad.heightM - padFallPerM * Math.max(0, u + pad.marginM)
      else if (lawn)
        target =
          upperLevelM >= padHeightM
            ? Math.min(upperLevelM, padHeightM + wallM + rise())
            : Math.max(upperLevelM, padHeightM - wallM - rise())
      else if (beforeM > padHeightM + EPS_M) target = Math.min(beforeM, padHeightM + wallM + rise())
      else if (beforeM < padHeightM - EPS_M) target = Math.max(beforeM, padHeightM - wallM - rise())
      if (pad.cutOnly && target > beforeM) target = beforeM
      if (line && low && padIndex === 0) {
        target = Math.min(target, lowLineCap(point))
        // A line already there is not filled back in.
        const near = retain ? retain.atM + low.offM : pad.marginM
        if (target > beforeM && distance > near - 0.01 && distance < near + low.widthM + 2) {
          const { edge, along } = nearestOnOutline(point, first.outline)
          if (lowLineKept(line, edge, along)) target = beforeM
        }
      }
      const nextQ = quantize(field, target)
      const here = inside(point)
      if (here && u <= 0) padSamples[padIndex] = (padSamples[padIndex] ?? 0) + 1
      if (nextQ === beforeQ) {
        if (here && lawn && u > 0 && nextQ === quantize(field, upperLevelM)) lawnSamples++
        continue
      }
      if (!here) {
        outsideLotSamples++
        outsideLotMaxM = Math.max(outsideLotMaxM, Math.abs(nextQ - beforeQ) * field.step)
        continue
      }
      heights[index] = nextQ
      changedSamples++
      changed.push(index)
      if (lawn && u > 0 && nextQ === quantize(field, upperLevelM)) lawnSamples++
      if (u > 0) farthestChangeM = Math.max(farthestChangeM, u)
      const movedM = (nextQ - beforeQ) * field.step
      if (movedM < 0) cutVolumeM3 += -movedM * cell
      else fillVolumeM3 += movedM * cell
    }
  }
  return {
    heights,
    changedSamples,
    cutVolumeM3,
    fillVolumeM3,
    padAreaM2: padSamples.reduce((sum, count) => sum + count, 0) * cell,
    padAreasM2: padSamples.map((count) => count * cell),
    farthestChangeM,
    outsideLotSamples,
    outsideLotMaxM,
    lawnAreaM2: lawnSamples * cell,
    steepestSlopeDeg: steepestSlope(field, heights, changed, exactWall ? reached : undefined),
    ...(line?.facts ? { lowLine: line.facts } : {}),
  }
}

/**
 * The steepest central-difference slope, in degrees, over the changed samples and their neighbours. With an
 * exact wall the face between the pad and the bank is not ground the tiles describe: samples within a cell
 * of the pad edge are left out.
 */
function steepestSlope(
  field: TerrainField,
  heights: Int16Array,
  changed: number[],
  reached?: Float32Array,
): number {
  const clamp = (col: number, row: number) =>
    Math.max(0, Math.min(field.rows - 1, row)) * field.cols +
    Math.max(0, Math.min(field.cols - 1, col))
  const at = (col: number, row: number) => (heights[clamp(col, row)] ?? 0) * field.step
  const nearPadEdge = (col: number, row: number) =>
    [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dc, dr]) => {
      const u = reached?.[clamp(col + (dc as number), row + (dr as number))]
      return u === undefined || Number.isNaN(u) || u <= 0
    })
  let steepest = 0
  for (const index of changed) {
    const col = index % field.cols
    const row = Math.floor(index / field.cols)
    if (reached && nearPadEdge(col, row)) continue
    const dhdx = (at(col + 1, row) - at(col - 1, row)) / (2 * field.spacing)
    const dhdz = (at(col, row + 1) - at(col, row - 1)) / (2 * field.spacing)
    steepest = Math.max(steepest, Math.atan(Math.hypot(dhdx, dhdz)))
  }
  return (steepest * 180) / Math.PI
}
