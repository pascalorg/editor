import {
  type AnyNode,
  type AnyNodeId,
  buildingFoundationNodes,
  type FloorplanGeometry,
  type FloorplanPoint,
  traceFoundationOutlines,
  union,
} from '@pascal-app/core'
import { houseFoundationOutlines } from '../foundation-view'

type P = [number, number]
type DimensionString = Extract<FloorplanGeometry, { kind: 'dimension-string' }>

/** The rows' distances out of the foundation, metres: each corner and break, then the overall length. */
const ROWS: readonly [number, number] = [0.6, 1.2]
/** How far an extension line runs past its dimension line, metres. */
const OVERSHOOT = 0.12
/** Corners closer than this along a side are one station of its dimension string, metres. */
const SAME_STATION = 0.01
/** A side facing a row at least this much (the cosine) is dimensioned on it. */
const FACING = 0.1
const DIMENSION_STROKE = '#475569'

/** A ring as the clipper returns it, closed by repeating its first point: open it again. */
function openRing(ring: ReadonlyArray<readonly [number, number]>): P[] {
  const points = ring.map(([x, z]) => [x, z] as P)
  const first = points[0]
  const last = points[points.length - 1]
  if (first && last && points.length > 1 && first[0] === last[0] && first[1] === last[1])
    points.pop()
  return points
}

/**
 * The foundation's outline in the plan, the outlines it pours merged (the house's, traced from the
 * walls while it follows them, and every outline drawn: a porch slab joins it): one ring per piece,
 * level-local.
 */
export function foundationOutlineRings(nodes: Record<string, AnyNode>, buildingId: string): P[][] {
  const graph = nodes as Record<AnyNodeId, AnyNode>
  const drawn = buildingFoundationNodes(graph, buildingId).map((node) => node.polygon)
  const traced =
    houseFoundationOutlines(graph, buildingId).length > 0
      ? []
      : traceFoundationOutlines(graph, buildingId)
  const rings = [...traced, ...drawn]
    .map((ring) => ring.map(([x, z]) => [x, z] as P))
    .filter((ring) => ring.length >= 3)
  if (rings.length === 0) return []
  return union(rings)
    .map((polygon) => openRing(polygon.outer))
    .filter((ring) => ring.length >= 3)
}

/** The four rows round a foundation: their outward normal, and the coordinate they run along. */
const SIDES: { normal: FloorplanPoint; run: 0 | 1 }[] = [
  { normal: [0, -1], run: 0 },
  { normal: [1, 0], run: 1 },
  { normal: [0, 1], run: 0 },
  { normal: [-1, 0], run: 1 },
]

/**
 * A foundation plan's dimensions, as a drafter strings them round it: on every side two rows out
 * of it, the first chained through each corner and break the side shows (the sides facing that
 * way, however the outline steps or turns), the second the overall length, where the first has
 * more than one piece. Each station's extension line starts at its corner; `format` writes the
 * lengths. `rows` and `overshoot` (metres) set the rows' distances out and how far the extension
 * lines run past them: a plan on screen keeps them a constant size in pixels.
 */
export function foundationDimensionStrings(
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  format: (meters: number) => string,
  {
    rows = ROWS,
    overshoot = OVERSHOOT,
  }: { rows?: readonly [number, number]; overshoot?: number } = {},
): DimensionString[] {
  const strings: DimensionString[] = []
  for (const input of rings) {
    if (input.length < 3) continue
    let area = 0
    for (let i = 0; i < input.length; i++) {
      const a = input[i]!
      const b = input[(i + 1) % input.length]!
      area += a[0] * b[1] - b[0] * a[1]
    }
    // Counter-clockwise, so each side's outward normal is to its right.
    const ring = area > 0 ? [...input] : [...input].reverse()
    for (const { normal, run } of SIDES) {
      const depth = run === 0 ? 1 : 0
      const sign = normal[depth]
      // The side's stations: the corners of the sides facing it, the one nearest it at each.
      const stations: { at: number; witness: P }[] = []
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!
        const b = ring[(i + 1) % ring.length]!
        const length = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (length < 1e-9) continue
        const out: P = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length]
        if (out[0] * normal[0] + out[1] * normal[1] <= FACING) continue
        for (const corner of [a, b]) {
          const station = stations.find((s) => Math.abs(s.at - corner[run]) < SAME_STATION)
          if (!station) stations.push({ at: corner[run], witness: [corner[0], corner[1]] })
          else if (corner[depth] * sign > station.witness[depth] * sign)
            station.witness = [corner[0], corner[1]]
        }
      }
      if (stations.length < 2) continue
      stations.sort((p, q) => p.at - q.at)
      const edge = Math.max(...ring.map((point) => point[depth] * sign)) * sign
      const onRow = (row: number, at: number): FloorplanPoint =>
        run === 0 ? [at, edge + sign * row] : [edge + sign * row, at]
      const row = (distance: number, from: number, to: number) => ({
        start: stations[from]!.witness,
        end: stations[to]!.witness,
        dimensionStart: onRow(distance, stations[from]!.at),
        dimensionEnd: onRow(distance, stations[to]!.at),
        text: format(stations[to]!.at - stations[from]!.at),
      })
      const pieces = stations.slice(1).map((_, i) => row(rows[0], i, i + 1))
      strings.push({
        kind: 'dimension-string',
        segments: pieces,
        offsetNormal: normal,
        offsetDistance: rows[0],
        extensionOvershoot: overshoot,
        stroke: DIMENSION_STROKE,
      })
      if (stations.length > 2)
        strings.push({
          kind: 'dimension-string',
          segments: [row(rows[1], 0, stations.length - 1)],
          offsetNormal: normal,
          offsetDistance: rows[1],
          extensionOvershoot: overshoot,
          stroke: DIMENSION_STROKE,
        })
    }
  }
  return strings
}
