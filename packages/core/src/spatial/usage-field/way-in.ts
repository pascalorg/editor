import { polygonInteriorPoint } from '../../lib/polygon-label'
import { cellOf, cellX, cellZ } from './field'
import { PASSAGE_M, TOLERANCE_M } from './findings'
import { BODY_BAND, buildField, inRegion, maskOf } from './level-field'
import { boundingObstacles, type Obstacle, passagePair } from './obstacles'
import { pathTo, refinePassage, widestPath } from './path'
import type { FloorRegion, LevelShapes, Prism, Ring, UsageShapes } from './types'

type Point = [number, number]

/** Grid step of the local field; the pinch is then solved to the millimetre, as a passage is. */
const CELL_M = 0.05
/** The way is read inside this radius of where it starts: a leaf and a passage's width past its tip, or the first metres of a room. */
const REACH_M = 3

export type Way = {
  /** The clear width of the best way from the entrance to the room's open floor. */
  width: number
  at: Point
  /** The two things that bound the pinch. */
  by: Obstacle[]
}

/**
 * The best way from an entrance into the room it leads to: the widest path (as the passage measure reads
 * one) from the entrance's opening (`entrance`, a ring across a doorway or an open edge) to the room's
 * open floor, the cells where a disc of a passage's width fits. `leaf` is a line (a door's leaf standing
 * open) added to what stands in the way. The entrance's own clear width caps that path, and an entrance is
 * measured elsewhere, so a way is only returned when it is under a passage's width and `bounds` holds of
 * one of the two things that bound its pinch. Null otherwise: the way is clear, or what narrows it is not
 * what the caller asks about.
 */
export function wayIn(
  shapes: UsageShapes,
  level: LevelShapes,
  zone: { id: string; polygon: Ring; holes?: Ring[] },
  entrance: Ring,
  around: Point,
  floorY: number,
  underlay: (prism: Prism) => boolean,
  bounds: (prism: Prism) => boolean,
  leaf: Prism | null = null,
): Way | null {
  const ring = entrance
  const holes = (zone.holes ?? []) as FloorRegion['holes']
  const region = { outer: zone.polygon as FloorRegion['outer'], holes }
  const probe = polygonInteriorPoint({ polygon: zone.polygon, holes: zone.holes }, true)
  const y = level.floors.find((floor) => inRegion(probe[0], probe[1], floor))?.y ?? floorY
  const [hx, hz] = around
  const zx = region.outer.map((p) => p[0])
  const zz = region.outer.map((p) => p[1])
  const domain: [number, number, number, number] = [
    Math.max(hx - REACH_M, Math.min(...zx) - 0.2),
    Math.max(hz - REACH_M, Math.min(...zz) - 0.2),
    Math.min(hx + REACH_M, Math.max(...zx) + 0.2),
    Math.min(hz + REACH_M, Math.max(...zz) + 0.2),
  ]
  // the prisms near the room only: the field builder makes an obstacle of every prism before it looks where it is
  const near = (prism: Prism) => {
    let x0 = Number.POSITIVE_INFINITY
    let z0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let z1 = Number.NEGATIVE_INFINITY
    for (const [x, z] of prism.outer) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      z0 = Math.min(z0, z)
      z1 = Math.max(z1, z)
    }
    return !(x1 < domain[0] || x0 > domain[2] || z1 < domain[1] || z0 > domain[3])
  }
  const field = buildField(
    {
      ...shapes,
      levels: shapes.levels.map((l) => ({ ...l, prisms: l.prisms.filter(near) })),
    },
    {
      levelId: '',
      y,
      regions: [{ id: zone.id, nodeId: zone.id, ...region, y, outdoor: false, shape: 'exact' }],
      domain,
    },
    BODY_BAND,
    CELL_M,
    underlay,
    leaf ? [leaf] : [],
  )
  const { grid, F, floor } = field
  if (leaf) {
    // a line is no wall to a grid path, which steps between the cells either side of it: the cells it runs through are shut
    const [from, tip] = leaf.outer as [Point, Point]
    const reach = Math.hypot(tip[0] - from[0], tip[1] - from[1])
    for (let s = 0; s <= reach; s += CELL_M / 4) {
      const c = cellOf(
        grid,
        from[0] + ((tip[0] - from[0]) * s) / reach,
        from[1] + ((tip[1] - from[1]) * s) / reach,
      )
      if (c >= 0) F[c] = 0
    }
  }
  const doorway = maskOf(grid, [{ outer: ring, holes: [] }])
  const plate = Uint8Array.from(floor)
  const sources: number[] = []
  for (let c = 0; c < doorway.length; c++)
    if (doorway[c]) {
      plate[c] = 1
      if (F[c]! > 0) sources.push(c)
    }
  if (sources.length === 0) return null
  const sourceSet = new Set(sources)
  const widest = widestPath(grid, F, plate, sources)
  const open = (PASSAGE_M - TOLERANCE_M) / 2
  let best = -1
  for (let c = 0; c < floor.length; c++)
    if (
      floor[c] &&
      F[c]! >= open &&
      widest.B[c]! > Number.NEGATIVE_INFINITY &&
      (best < 0 || widest.B[c]! > widest.B[best]!)
    )
      best = c
  if (best < 0) return null
  // the grid is within a cell of the millimetre figure: a way a cell over the limit is not narrow
  if (2 * widest.B[best]! > PASSAGE_M + 2 * CELL_M) return null

  const path = pathTo(widest.P, F, best)
  const refined = refinePassage(
    grid,
    F,
    field.index,
    path,
    (c) => sourceSet.has(c),
    (x, z) => inRegion(x, z, region),
  )
  // what bounds the way is read where the path is narrowest, not where the refinement says a cell of that clearance is
  const narrowest = path.cells[path.narrowest]!
  const here: Point = [cellX(grid, narrowest % grid.W), cellZ(grid, (narrowest / grid.W) | 0)]
  const grided = 2 * F[narrowest]!
  const pair = passagePair(field.obstacles, here[0], here[1])
  const exact = pair !== null && Math.abs(pair.width - refined.width) < 0.02
  const width = exact ? pair.width : Math.min(refined.width, grided + 2 * grid.h)
  if (!(width < PASSAGE_M - TOLERANCE_M)) return null
  const by = exact
    ? [pair.a, pair.b]
    : boundingObstacles(field.obstacles, here[0], here[1], width / 2)
  const at: Point = exact ? [(pair.pa[0] + pair.pb[0]) / 2, (pair.pa[1] + pair.pb[1]) / 2] : here
  if (!by.some((o) => bounds(o.prism))) return null
  return { width: Math.round(width * 1000) / 1000, at, by }
}
