/**
 * The site a building stands on, read the way an agent draws with it, and where the building's
 * footprint goes on it.
 *
 * Frames: the site polygon and the building's pose are stored in SITE metres. Everything here
 * that an agent reads to draw with is in the building's LEVEL coordinates (the frame its walls
 * are written in): `site = position + turn(level, yaw)`. A house is placed by moving the building
 * node, never its walls, so the model's coordinates survive and a storey built over several
 * programs stays in one frame. Plan sides (north, east, south, west) are the level frame's
 * −z, +x, +z and −x; true north is given separately.
 */
import type { AnyNode, BuildingNode, LevelNode, SiteNode, SiteSetbacks } from '../schema'
import { migrateSiteMetadata } from '../schema/nodes/site-facts'
import {
  footprintOutline,
  levelFootprintLoops,
  levelFrame,
  siteFrame,
  turnPlanPoint,
  yawOf,
} from './building-footprint'
import { area, containsPoint, difference, distanceToBoundary } from './polygon-boolean'
import { polygonInteriorPoint } from './polygon-label'
import { segmentsIntersect } from './polygon-relations'
import {
  edgeLength,
  envelopeFrontEdge,
  outwardNormal,
  type Pt,
  polygonAreaAbs,
  rayToPolygon,
  resolveFrontEdge,
  setbackEnvelope,
} from './setback-envelope'
import { heightAt, type TerrainField } from './terrain-field'
import { persistedTerrainFieldOf } from './terrain-source-persisted'

type Nodes = Readonly<Record<string, AnyNode>>
type P = [number, number]

export type PlanSide = 'north' | 'east' | 'south' | 'west'
export type YardKey = 'front' | 'rear' | 'left' | 'right'
export type PlanBounds = { minX: number; minZ: number; maxX: number; maxZ: number }

/**
 * An edge taken as the front of a ring: its index (it runs from ring[edge] to ring[edge + 1]),
 * its length, and how far the ring reaches back from it, square to it.
 */
export type EdgeFront = { edge: number; frontage: number; depth: number }

export type BuildableArea = {
  /**
   * `lot`: no setbacks are recorded, so the whole lot is buildable. `setbacks`: the lot inside
   * its setbacks. `none`: the setbacks leave nothing to build on. `advisory`: the inset of a
   * concave lot crosses itself, a ring to aim at but not a legal envelope.
   */
  state: 'lot' | 'setbacks' | 'none' | 'advisory'
  ring: P[]
  /** Its centroid when that lies inside, else its most interior point; null when there is none. */
  centre: P | null
  areaM2: number
  /**
   * Each edge of `ring` as a front, in ring order (`edge` is its index). An envelope traced round
   * a concave corner or a sight triangle has slivers of a few centimetres between its real edges,
   * and a curved lot line is a run of short edges.
   */
  edges: EdgeFront[]
  /**
   * The edge behind the lot's front line, which the front setback is measured from: its frontage
   * and depth are the most a house facing the street can take. While `street` is null it is
   * behind the lot edge facing most nearly north, a guess the setbacks use until the street is
   * set. Null when nothing is buildable, or when no edge faces the street (side setbacks wider
   * than a narrow frontage can leave a point there, not a front).
   */
  frontEdge: number | null
  setbacks?: SiteSetbacks
  source?: string
}

export type SiteGround = {
  /**
   * `sloped`: the site has terrain. `flat`: a terrain read found the lot flat, so it wrote none.
   * `unread`: no terrain was read, and the ground is flat until one is.
   */
  state: 'sloped' | 'flat' | 'unread'
  /**
   * Sloped: the terrain's fall across the lot, top to bottom. Flat: the read's own figure, over
   * the grid it sampled round the lot. Null while unread.
   */
  reliefM: number | null
}

export type SiteFootprint = {
  /** The union of every storey's walls (a storey's rooms where it has no walls). */
  rings: P[][]
  bounds: PlanBounds
  centre: P
  /** How far the footprint's centre is from the buildable centre. */
  offCentreM: number
  /**
   * Metres from each face of the house, square to it, to the lot line; negative past it, null
   * when the face's cast misses the lot. Keyed front / rear / left / right (seen from the street)
   * when the street is known, else by plan side.
   */
  yards: Partial<Record<YardKey | PlanSide, number | null>>
  fit: 'buildable' | 'lot' | 'outside'
  /** How far the footprint reaches past the lot line and into the setbacks, and toward which sides. */
  overhang: { lotM: number; setbacksM: number; sides: PlanSide[] }
}

export type SiteBrief = {
  siteId: string
  buildingId: string | null
  /** The building's pose on the site: its position in site metres and its yaw in degrees. */
  pose: { position: [number, number, number]; rotationDeg: number }
  lot: {
    ring: P[]
    /** The lot as stored, in site metres. */
    siteRing: P[]
    bounds: PlanBounds
    areaM2: number
    /** The parcel service found no recorded lines and drew a rectangle round the address. */
    approximate: boolean
    /** The footprint a house on this lot usually covers: 30 to 45% of its area. */
    footprintRangeM2: [number, number]
  }
  /** The new-project square: no address, no parcel, no setbacks; the real lot is unknown. */
  placeholder: boolean
  buildable: BuildableArea
  /** The street edge (the site's front edge, else its first street edge), never a guess. */
  street: {
    side: PlanSide
    edge: number
    /** The building rotation, in degrees, that squares the house to the street edge. */
    squareRotationDeg: number
    /** The lot's length along the street edge. */
    frontage: number
    /** How far the lot reaches back from the street edge, square to it. */
    depth: number
  } | null
  ground: SiteGround
  /** True north, degrees clockwise from plan up (−z) in this building's level frame. */
  northDeg: number
  address: string | null
  parcel: { apn?: string; lotAreaSqFt?: number; source?: string; notes?: string[] } | null
  zone: string | null
  footprint: SiteFootprint | null
  /** The other buildings on the site with walls, in this building's level frame. */
  others: { buildingId: string; bounds: PlanBounds }[]
}

const SIDES: Record<PlanSide, P> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }
const OPPOSITE: Record<PlanSide, PlanSide> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
}
/** What a footprint may lose to a ring's edge and still count as inside it: rounding, not a wall. */
const FIT_AREA_M2 = 0.01
const DEFAULT_SQUARE = 15
const DEG = 180 / Math.PI

const round = (n: number, step = 100) => Math.round(n * step) / step || 0
const roundPt = (p: Pt): P => [round(p[0]), round(p[1])]

function boundsOf(points: readonly Pt[]): PlanBounds {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, minZ, maxX, maxZ }
}

const boundsCentre = (b: PlanBounds): P => [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]

function sideOf(dx: number, dz: number): PlanSide {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'east' : 'west'
  return dz > 0 ? 'south' : 'north'
}

function selfIntersects(ring: readonly Pt[]): boolean {
  const n = ring.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const a = ring[i] as P
      const b = ring[(i + 1) % n] as P
      const c = ring[j] as P
      const d = ring[(j + 1) % n] as P
      if (segmentsIntersect(a, b, c, d)) return true
    }
  }
  return false
}

/** A ring's centroid when it lies inside the ring, else its most interior point. */
function ringCentre(ring: readonly Pt[]): P | null {
  if (ring.length < 3 || polygonAreaAbs(ring) <= 0) return null
  return polygonInteriorPoint({ polygon: ring.map((p) => [p[0], p[1]]) }, true)
}

function isPlaceholderSquare(points: readonly Pt[]): boolean {
  if (points.length !== 4) return false
  const corners = new Set(points.map(([x, z]) => `${Math.sign(x)},${Math.sign(z)}`))
  return (
    corners.size === 4 &&
    points.every(
      ([x, z]) =>
        Math.abs(Math.abs(x) - DEFAULT_SQUARE) < 1e-6 &&
        Math.abs(Math.abs(z) - DEFAULT_SQUARE) < 1e-6,
    )
  )
}

/** The site with its legacy metadata lifted onto the real fields (read-side only). */
function readSiteNode(node: SiteNode): SiteNode {
  const patch = migrateSiteMetadata(node)
  return Object.keys(patch).length > 0 ? { ...node, ...patch } : node
}

type SiteEdges = Pick<SiteNode, 'polygon' | 'frontEdge' | 'streetEdges' | 'northRotation'>

/** The street edge the site records: its front edge, else its first street edge; never a guess. */
function recordedStreetEdge(site: SiteEdges): number | undefined {
  const n = site.polygon?.points?.length ?? 0
  const valid = (i: unknown): i is number =>
    Number.isInteger(i) && (i as number) >= 0 && (i as number) < n
  return valid(site.frontEdge) ? site.frontEdge : site.streetEdges?.find(valid)
}

/**
 * The lot's front edge, which the setbacks, the yards and the street are all measured from: the
 * street edge the site records, else the edge facing most nearly north.
 */
export function siteFrontEdge(site: SiteEdges): number {
  return resolveFrontEdge(
    (site.polygon?.points ?? []) as P[],
    recordedStreetEdge(site),
    site.northRotation ?? 0,
  )
}

/**
 * Which way a building's street is, from the house toward it: a unit vector in the site's plan
 * (x east, z south). The street edge its site records (its frontEdge, else its first street edge);
 * with none recorded, the house's own front, its −z turned by its yaw, the way a generated house
 * faces. Every side named as seen from the street reads this one street: a view's street sides,
 * Architect's street order, plan labels and the gables its auto_roof names from the street.
 */
export function buildingStreet(nodes: Nodes, buildingId?: string | null): P {
  const node = buildingId ? nodes[buildingId] : undefined
  const building = node?.type === 'building' ? node : null
  const stored = siteOfBuilding(nodes, building)
  const site = stored && readSiteNode(stored)
  const lot = (site?.polygon?.points ?? []) as P[]
  const edge = site ? recordedStreetEdge(site) : undefined
  if (edge !== undefined && lot.length >= 3) return outwardNormal(lot, edge) as P
  return turnPlanPoint(0, -1, yawOf(building?.rotation)) as P
}

/**
 * The lot's buildable envelope, in site metres, as the site plan and the 3D site draw it: every
 * lot line pushed in by its setback from the front edge's roles, the corner sight triangles kept
 * clear. Empty when the site records no setbacks, when none of them is more than zero, or when
 * they leave nothing.
 */
export function siteSetbackEnvelope(
  site: SiteEdges & Pick<SiteNode, 'setbacks' | 'sightTriangleFt'>,
): P[] {
  const points = (site.polygon?.points ?? []) as P[]
  if (!site.setbacks || points.length < 3) return []
  const sightTriangleM =
    typeof site.sightTriangleFt === 'number' && site.sightTriangleFt > 0
      ? site.sightTriangleFt * 0.3048
      : 0
  return setbackEnvelope(points, site.setbacks, siteFrontEdge(site), {
    streetEdges: (site.streetEdges ?? []).filter((i) => Number.isFinite(i)),
    sightTriangleM,
  }).map((p) => [p[0], p[1]])
}

/** The buildable area in SITE metres; `inset` when its ring is the setback envelope, not the lot. */
function buildableInSite(site: SiteNode): {
  state: BuildableArea['state']
  ring: P[]
  inset: boolean
} {
  const lot = (site.polygon?.points ?? []) as P[]
  if (!site.setbacks) return { state: 'lot', ring: lot, inset: false }
  const envelope = siteSetbackEnvelope(site)
  if (envelope.length >= 3)
    return {
      state: selfIntersects(envelope) ? 'advisory' : 'setbacks',
      ring: envelope,
      inset: true,
    }
  // setbacks of zero exclude nothing (the envelope is empty because there is nothing to draw)
  const excludes = Object.values(site.setbacks).some((m) => typeof m === 'number' && m > 0)
  return excludes
    ? { state: 'none', ring: [], inset: false }
    : { state: 'setbacks', ring: lot, inset: false }
}

/**
 * Each edge of a ring taken as a front: its length, and how far the ring reaches back from it,
 * square to it (inward by the ring's winding, so an L or a U measures right).
 */
export function edgeFronts(ring: readonly Pt[]): EdgeFront[] {
  return ring.map((p, edge) => {
    const frontage = edgeLength(ring, edge)
    if (frontage < 1e-9) return { edge, frontage: 0, depth: 0 }
    const [nx, nz] = outwardNormal(ring, edge)
    let depth = 0
    for (const v of ring) depth = Math.max(depth, -((v[0] - p[0]) * nx + (v[1] - p[1]) * nz))
    return { edge, frontage, depth }
  })
}

/**
 * The fall of a terrain over a lot: its highest point on the lot less its lowest. The ground is
 * a plane on each of the field's triangles (the cells split by the diagonal `heightAt` uses), so the
 * extremes lie at the field's samples on the lot, at the lot's corners, or where a lot line
 * crosses a triangle's edge: a grid line (u or v whole, in samples) or a diagonal (u + v whole).
 * Past the field `heightAt` holds its edge, so only the lines of the field itself count.
 */
function terrainFall(field: TerrainField, lot: readonly Pt[]): number {
  // a field a single sample wide is its first sample everywhere, as heightAt reads it
  if (field.cols < 2 || field.rows < 2) return 0
  const [ox, oz] = field.origin
  const s = field.spacing
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  const take = (height: number) => {
    low = Math.min(low, height)
    high = Math.max(high, height)
  }
  lot.forEach((a, i) => {
    const b = lot[(i + 1) % lot.length] as Pt
    const [ua, va] = [(a[0] - ox) / s, (a[1] - oz) / s]
    const [du, dv] = [(b[0] - a[0]) / s, (b[1] - a[1]) / s]
    take(heightAt(field, a[0], a[1]))
    // where this lot line crosses u = k, v = k and u + v = k, k on the field
    for (const [from, along, lines] of [
      [ua, du, field.cols - 1],
      [va, dv, field.rows - 1],
      [ua + va, du + dv, field.cols + field.rows - 2],
    ] as const) {
      if (Math.abs(along) < 1e-12) continue
      const to = from + along
      const first = Math.max(0, Math.ceil(Math.min(from, to)))
      const last = Math.min(lines, Math.floor(Math.max(from, to)))
      for (let k = first; k <= last; k++) {
        const t = (k - from) / along
        if (t > 0 && t < 1)
          take(heightAt(field, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
      }
    }
  })
  // the samples inside, row by row between the lot lines' crossings of that row
  for (let row = 0; row < field.rows; row++) {
    const z = oz + row * s
    const crossings: number[] = []
    lot.forEach((a, i) => {
      const b = lot[(i + 1) % lot.length] as Pt
      if (a[1] <= z !== b[1] <= z)
        crossings.push(a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
    })
    crossings.sort((x0, x1) => x0 - x1)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const first = Math.max(0, Math.ceil(((crossings[k] as number) - ox) / s))
      const last = Math.min(field.cols - 1, Math.floor(((crossings[k + 1] as number) - ox) / s))
      // as heightAt shows it at the sample's place: a spacing finer than the coordinates can
      // hold puts some samples where no point of the lot is
      for (let col = first; col <= last; col++) take(heightAt(field, ox + col * s, z))
    }
  }
  return high - low
}

const METRES_PER_FOOT = 0.3048

/**
 * The ground under the lot: the fall of its terrain across the lot, as the scene holds it (the
 * lot drop-in's read records its own figure over the grid it sampled, which reaches past the
 * lot); with no terrain, what that read found (`metadata.terrainSample`: a lot it found flat
 * gets none), else unread.
 */
function groundOf(site: SiteNode, lot: readonly Pt[]): SiteGround {
  const field = persistedTerrainFieldOf(site)
  const sample = (site.metadata as { terrainSample?: { flat?: unknown; reliefFt?: unknown } })
    ?.terrainSample
  if (field) return { state: 'sloped', reliefM: terrainFall(field, lot) }
  if (sample?.flat === true)
    return {
      state: 'flat',
      reliefM: typeof sample.reliefFt === 'number' ? sample.reliefFt * METRES_PER_FOOT : 0,
    }
  return { state: 'unread', reliefM: null }
}

/* ------------------------------------------------- what stands where */

function sitesOf(nodes: Nodes): SiteNode[] {
  return Object.values(nodes).filter((node): node is SiteNode => node.type === 'site')
}

function buildingsOf(nodes: Nodes): BuildingNode[] {
  return Object.values(nodes).filter((node): node is BuildingNode => node.type === 'building')
}

function buildingLevels(nodes: Nodes, building: BuildingNode): LevelNode[] {
  return (building.children ?? [])
    .map((id) => nodes[id])
    .filter((node): node is LevelNode => node?.type === 'level')
}

/** The building a level belongs to. */
function levelBuilding(nodes: Nodes, levelId: string): BuildingNode | null {
  const level = nodes[levelId]
  const parent = level?.parentId ? nodes[level.parentId] : undefined
  return parent?.type === 'building' ? parent : null
}

function siteOfBuilding(nodes: Nodes, building: BuildingNode | null): SiteNode | null {
  const parent = building?.parentId ? nodes[building.parentId] : undefined
  if (parent?.type === 'site') return parent
  return sitesOf(nodes)[0] ?? null
}

/**
 * The building a site read or a placement is about: the one named, else the named level's, else
 * the scene's only building. `ambiguous` when there are several and nothing names one.
 */
export function resolveSiteBuilding(
  nodes: Nodes,
  target: { buildingId?: string | null; levelId?: string | null } = {},
): { building: BuildingNode | null; ambiguous: boolean } {
  if (target.buildingId) {
    const node = nodes[target.buildingId]
    return { building: node?.type === 'building' ? node : null, ambiguous: false }
  }
  if (target.levelId) {
    const building = levelBuilding(nodes, target.levelId)
    if (building) return { building, ambiguous: false }
  }
  const buildings = buildingsOf(nodes)
  return {
    building: buildings.length === 1 ? (buildings[0] ?? null) : null,
    ambiguous: buildings.length > 1,
  }
}

/**
 * The building's footprint in its level frame: the union of every storey's wall bands, a
 * storey's rooms where it has no walls.
 */
export function buildingFootprintRings(nodes: Nodes, building: BuildingNode): P[][] {
  const loops: Pt[][] = []
  for (const level of buildingLevels(nodes, building)) {
    const walls = levelFootprintLoops(nodes, level, null)
    if (walls.length > 0) {
      loops.push(...walls)
      continue
    }
    for (const id of level.children ?? []) {
      const child = nodes[id]
      if (child?.type === 'zone' && child.polygon.length >= 3) loops.push(child.polygon)
    }
  }
  if (loops.length === 0) return []
  return footprintOutline(loops).map((ring) => ring.map((p) => [p[0], p[1]] as P))
}

/* ------------------------------------------------------- measuring */

/** The ring edge nearest `p`, or the two edges of the corner nearest it. */
function nearestEdges(ring: readonly Pt[], p: Pt): number[] {
  const n = ring.length
  let best = 0
  let bestD = Number.POSITIVE_INFINITY
  let bestT = 0
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Pt
    const b = ring[(i + 1) % n] as Pt
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const l2 = dx * dx + dz * dz
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0
    const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t)
    if (d < bestD - 1e-9) {
      bestD = d
      best = i
      bestT = t
    }
  }
  if (bestT <= 1e-6) return [best, (best - 1 + n) % n]
  if (bestT >= 1 - 1e-6) return [best, (best + 1) % n]
  return [best]
}

/**
 * What of `rings` lies outside `ring`, by area (an edge across a notch counts, not only its
 * corners), how far it reaches past the ring's edge, and toward which sides.
 */
function spill(
  rings: readonly (readonly Pt[])[],
  ring: readonly Pt[],
): { areaM2: number; reachM: number; sides: PlanSide[] } {
  const shapes = rings.map((r) => ({ outer: r.map((p) => [p[0], p[1]] as P), holes: [] }))
  if (ring.length < 3) {
    const all = area(shapes)
    return { areaM2: all, reachM: Number.POSITIVE_INFINITY, sides: [] }
  }
  const outside = difference(
    shapes,
    ring.map((p) => [p[0], p[1]] as P),
  )
  const areaM2 = area(outside)
  if (areaM2 <= FIT_AREA_M2) return { areaM2: 0, reachM: 0, sides: [] }
  const boundary = [{ outer: ring.map((p) => [p[0], p[1]] as P), holes: [] }]
  let reachM = 0
  const sides = new Set<PlanSide>()
  for (const piece of outside) {
    // a piece's corners can all lie on the line it crosses (a house bridging a notch); its most
    // interior point is at least as far past the line as it is from the piece's own edges
    const pole = polygonInteriorPoint({ polygon: piece.outer, holes: piece.holes })
    for (const p of [...[piece.outer, ...piece.holes].flat(), pole]) {
      const d = distanceToBoundary(boundary, p)
      if (d <= 0.005) continue
      reachM = Math.max(reachM, d)
      // past the edge nearest it, or past both edges of the corner nearest it
      for (const edge of nearestEdges(ring, p)) {
        const [nx, nz] = outwardNormal(ring, edge)
        const a = ring[edge] as Pt
        if ((p[0] - a[0]) * nx + (p[1] - a[1]) * nz > 0.005) sides.add(sideOf(nx, nz))
      }
    }
  }
  return { areaM2, reachM, sides: [...sides] }
}

/** Signed metres from each face's midpoint, square to the house, to the lot line. */
function planYards(rings: readonly (readonly Pt[])[], lot: readonly Pt[]) {
  const b = boundsOf(rings.flat())
  const [mx, mz] = boundsCentre(b)
  const lotShape = [{ outer: lot.map((p) => [p[0], p[1]] as P), holes: [] }]
  const from: Record<PlanSide, P> = {
    north: [mx, b.minZ],
    south: [mx, b.maxZ],
    west: [b.minX, mz],
    east: [b.maxX, mz],
  }
  const yards = {} as Record<PlanSide, number | null>
  for (const side of Object.keys(SIDES) as PlanSide[]) {
    const [dx, dz] = SIDES[side]
    const origin = from[side]
    if (distanceToBoundary(lotShape, origin) < 1e-6) yards[side] = 0
    else if (containsPoint(lotShape, origin)) {
      yards[side] = rayToPolygon(lot, origin, dx, dz)?.distance ?? null
    } else {
      const back = rayToPolygon(lot, origin, -dx, -dz)
      yards[side] = back ? -back.distance : null
    }
  }
  return yards
}

/** The plan side of each yard, seen from the street: standing in it, facing the house. */
function streetFaces(front: PlanSide): Record<YardKey, PlanSide> {
  const [fx, fz] = SIDES[front]
  // facing the house is −front; its right hand, with z pointing south, is (−dz, dx)
  const right = sideOf(fz, -fx)
  return { front, rear: OPPOSITE[front], left: OPPOSITE[right], right }
}

/**
 * The recorded street edge seen from a building turned `yaw`: the plan side it lies on, and the
 * yaw nearest `yaw` that squares the house to it, in radians.
 */
function streetAt(site: SiteNode, yaw: number) {
  const lot = (site.polygon?.points ?? []) as P[]
  const n = lot.length
  const named = recordedStreetEdge(site)
  if (named === undefined || n < 3) return null
  const [nx, nz] = outwardNormal(lot, named)
  const [lx, lz] = turnPlanPoint(nx, nz, -yaw)
  const p = lot[named] as P
  const q = lot[(named + 1) % n] as P
  // the house's local x runs along site angle −yaw; square to the edge when −yaw ≡ α (mod 90°)
  const alpha = Math.atan2(q[1] - p[1], q[0] - p[0])
  const quarter = Math.PI / 2
  return {
    side: sideOf(lx, lz),
    edge: named,
    squareYaw: -alpha + Math.round((yaw + alpha) / quarter) * quarter,
  }
}

function formatAddress(site: SiteNode): string | null {
  const a = site.address
  if (!a) return null
  const tail = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const text = [a.street, tail].filter(Boolean).join(', ')
  return text || null
}

/**
 * How a footprint (rings in the building's level frame) sits on the site the brief reads: its
 * bounds and centre, how far it is off the buildable centre, its yards, and whether it stays in
 * the buildable area, on the lot, or past the lot line.
 */
export function measureFootprint(
  rings: readonly (readonly Pt[])[],
  site: Pick<SiteBrief, 'lot' | 'buildable' | 'street'>,
): SiteFootprint {
  const { lot, buildable, street } = site
  const bounds = boundsOf(rings.flat())
  const centre = boundsCentre(bounds)
  const aim = buildable.centre ?? ringCentre(lot.ring) ?? centre
  const past = spill(rings, lot.ring)
  const inYards = buildable.state === 'lot' ? past : spill(rings, buildable.ring)
  const plan = planYards(rings, lot.ring)
  const faces = street ? streetFaces(street.side) : null
  const yards = faces
    ? Object.fromEntries((Object.keys(faces) as YardKey[]).map((key) => [key, plan[faces[key]]]))
    : plan
  return {
    rings: rings.map((ring) => ring.map((p) => [p[0], p[1]] as P)),
    bounds,
    centre,
    offCentreM: Math.hypot(centre[0] - aim[0], centre[1] - aim[1]),
    yards,
    fit: past.areaM2 > 0 ? 'outside' : inYards.areaM2 > 0 ? 'lot' : 'buildable',
    overhang: {
      lotM: past.reachM,
      setbacksM: Number.isFinite(inYards.reachM) ? inYards.reachM : 0,
      sides: past.areaM2 > 0 ? past.sides : inYards.sides,
    },
  }
}

/**
 * Where new geometry on a level (rings in its level coordinates) crosses its lot line: null
 * while it stays on the lot, or when the level's building has no site. Only the lot is read, so
 * a program drawing room by room pays for no footprint.
 */
export function lotOverhang(
  nodes: Nodes,
  levelId: string,
  rings: readonly (readonly Pt[])[],
): { fit: 'outside'; overhangM: number; sides: PlanSide[] } | null {
  const building = resolveSiteBuilding(nodes, { levelId }).building
  const lot = (siteOfBuilding(nodes, building)?.polygon?.points ?? []) as P[]
  if (lot.length < 3) return null
  const toLevel = levelFrame(building)
  const past = spill(
    rings,
    lot.map((p) => toLevel(p[0], p[1])),
  )
  if (past.areaM2 === 0) return null
  return { fit: 'outside', overhangM: round(past.reachM), sides: past.sides }
}

/** The building a brief is read for, and the site it stands on (the scene's first site for none). */
function forBuilding(
  nodes: Nodes,
  target: { buildingId?: string | null; levelId?: string | null },
): { building: BuildingNode | null; stored: SiteNode | null } {
  const resolved = resolveSiteBuilding(nodes, target)
  let building = resolved.building
  if (!building && resolved.ambiguous) {
    const site = sitesOf(nodes)[0]
    const first = site?.children?.map((id) => nodes[id]).find((node) => node?.type === 'building')
    building = (first as BuildingNode | undefined) ?? buildingsOf(nodes)[0] ?? null
  }
  return { building, stored: siteOfBuilding(nodes, building) }
}

/**
 * A site named by its id, and the building read on it: the viewed level's when it stands there,
 * else the first standing on it (none on a vacant lot).
 */
function onSite(
  nodes: Nodes,
  siteId: string,
  levelId: string | null | undefined,
): { building: BuildingNode | null; stored: SiteNode | null } {
  const site = nodes[siteId]
  if (site?.type !== 'site') return { building: null, stored: null }
  const viewed = levelId ? levelBuilding(nodes, levelId) : null
  return {
    building:
      viewed?.parentId === site.id
        ? viewed
        : (buildingsOf(nodes).find((building) => building.parentId === site.id) ?? null),
    stored: site,
  }
}

/**
 * The site a building stands on, in that building's level coordinates. The building is the one
 * named, else the named level's, else the scene's only one, else the site's first; or the site
 * is named, and the building is the named level's when it stands there, else the first standing
 * on it. In site coordinates when no building stands on it; null when the scene has no site with
 * a lot.
 */
export function siteBrief(
  nodes: Nodes,
  target: { buildingId?: string | null; levelId?: string | null; siteId?: string | null } = {},
): SiteBrief | null {
  const { building, stored } = target.siteId
    ? onSite(nodes, target.siteId, target.levelId)
    : forBuilding(nodes, target)
  if (!stored) return null
  const site = readSiteNode(stored)
  const siteRing = ((site.polygon?.points ?? []) as P[]).map((p) => [p[0], p[1]] as P)
  if (siteRing.length < 3) return null

  const yaw = building?.rotation?.[1] ?? 0
  const toLevel = levelFrame(building)
  const inLevel = (ring: readonly Pt[]) => ring.map((p) => toLevel(p[0], p[1]) as P)
  const ring = inLevel(siteRing)
  const inSite = buildableInSite(site)
  const buildableRing = inLevel(inSite.ring)
  const facing = streetAt(site, yaw)
  const lotFront = facing ? edgeFronts(siteRing)[facing.edge] : undefined
  const street =
    facing && lotFront
      ? {
          side: facing.side,
          edge: facing.edge,
          squareRotationDeg: round(facing.squareYaw * DEG, 10),
          frontage: lotFront.frontage,
          depth: lotFront.depth,
        }
      : null
  const buildable: BuildableArea = {
    state: inSite.state,
    ring: buildableRing,
    centre: inSite.state === 'none' ? null : ringCentre(buildableRing),
    areaM2: polygonAreaAbs(inSite.ring),
    edges: edgeFronts(inSite.ring),
    frontEdge:
      inSite.state === 'none'
        ? null
        : inSite.inset
          ? envelopeFrontEdge(siteRing, siteFrontEdge(site), inSite.ring)
          : siteFrontEdge(site),
    ...(site.setbacks ? { setbacks: site.setbacks } : {}),
    ...(site.setbacksSource ? { source: site.setbacksSource } : {}),
  }
  const parcel = site.parcel
  const lotArea = polygonAreaAbs(siteRing)
  const lot: SiteBrief['lot'] = {
    ring,
    siteRing,
    bounds: boundsOf(ring),
    areaM2: lotArea,
    approximate: Boolean(
      parcel && ((parcel.notes ?? []).some((note) => /approximate/i.test(note)) || !parcel.apn),
    ),
    footprintRangeM2: [lotArea * 0.3, lotArea * 0.45],
  }

  const rings = building ? buildingFootprintRings(nodes, building) : []
  const footprint = rings.length > 0 ? measureFootprint(rings, { lot, buildable, street }) : null

  const others: SiteBrief['others'] = []
  for (const other of buildingsOf(nodes)) {
    if (other.id === building?.id || siteOfBuilding(nodes, other)?.id !== stored.id) continue
    const toSite = siteFrame(other)
    const ringsOther = buildingFootprintRings(nodes, other)
    if (ringsOther.length === 0) continue
    const points = ringsOther.flat().map((p) => {
      const s = toSite(p[0], p[1])
      return toLevel(s[0], s[1])
    })
    others.push({ buildingId: other.id, bounds: boundsOf(points) })
  }

  return {
    siteId: stored.id,
    buildingId: building?.id ?? null,
    pose: {
      position: [...(building?.position ?? [0, 0, 0])] as [number, number, number],
      rotationDeg: yaw * DEG,
    },
    lot,
    placeholder: !formatAddress(site) && !parcel && !site.setbacks && isPlaceholderSquare(siteRing),
    buildable,
    street,
    ground: groundOf(stored, siteRing),
    northDeg: (((((site.northRotation ?? 0) + yaw) * DEG) % 360) + 360) % 360,
    address: formatAddress(site),
    parcel: parcel
      ? {
          ...(parcel.apn ? { apn: parcel.apn } : {}),
          ...(parcel.lotAreaSqFt ? { lotAreaSqFt: parcel.lotAreaSqFt } : {}),
          ...(parcel.source ? { source: parcel.source } : {}),
          ...(parcel.notes?.length ? { notes: parcel.notes } : {}),
        }
      : null,
    zone: site.zone ?? null,
    footprint,
    others,
  }
}

/* ------------------------------------------------------- placing */

export type PlacementRefusal = {
  ok: false
  code:
    | 'no_site'
    | 'not_a_building'
    | 'no_building'
    | 'which_building'
    | 'needs_footprint'
    | 'other_building_on_site'
    | 'no_street'
    | 'yards_conflict'
    | 'yards_infeasible'
  message: string
}

export type BuildingPlacement = {
  ok: true
  buildingId: string
  position: [number, number, number]
  rotation: [number, number, number]
  /** False when the building already stood there: a replayed call changes nothing. */
  moved: boolean
  /** The site read with the building at its new pose. */
  brief: SiteBrief
  /** How the footprint placed (the outline, else the walls) sits at the new pose. */
  footprint: SiteFootprint
}

export type PlaceBuildingInput = {
  buildingId?: string
  levelId?: string
  /**
   * The footprint about to be drawn, in the level coordinates it will be drawn in; without it,
   * the walls standing.
   */
  outline?: readonly Pt[]
  /** Metres from the lot line, square to the house: at most one of front / rear and of left / right. */
  yards?: Partial<Record<YardKey, number>>
  /** The building's rotation; absent, a house standing keeps its own, one about to rise is squared to the street. */
  rotationDeg?: number
}

const refusal = (code: PlacementRefusal['code'], message: string): PlacementRefusal => ({
  ok: false,
  code,
  message,
})

/**
 * Where a building goes on its site: the building's position (and, when asked, its rotation)
 * that puts its footprint's centre on the buildable centre, or at the yards a site plan or the
 * person gives. The inputs are pose-independent (an outline in the drawing's own coordinates,
 * yards from the lot lines), so a repeated call gives the same pose. The lot is never resized: a
 * footprint too big for it is still centred, and the brief reports it outside.
 */
export function placeBuildingPose(
  nodes: Nodes,
  input: PlaceBuildingInput,
): BuildingPlacement | PlacementRefusal {
  if (!sitesOf(nodes).some((site) => (site.polygon?.points?.length ?? 0) >= 3))
    return refusal('no_site', 'The scene has no site with a lot to stand a building on.')
  const resolved = resolveSiteBuilding(nodes, input)
  if (input.buildingId && !resolved.building)
    return refusal('not_a_building', `${input.buildingId} is not a building.`)
  if (resolved.ambiguous)
    return refusal(
      'which_building',
      'The site has several buildings: name the one to place (its id from list_levels, parentId).',
    )
  const building = resolved.building
  if (!building) return refusal('no_building', 'The scene has no building to place.')
  const site = readSiteNode(siteOfBuilding(nodes, building) as SiteNode)

  const standing = buildingFootprintRings(nodes, building)
  const current = building.rotation?.[1] ?? 0
  // a standing house keeps its facing; one about to rise faces the street square
  const yaw =
    input.rotationDeg !== undefined
      ? input.rotationDeg / DEG
      : standing.length === 0
        ? (streetAt(site, current)?.squareYaw ?? current)
        : current
  const rings: P[][] =
    input.outline && input.outline.length >= 3
      ? [input.outline.map((p) => [p[0], p[1]] as P)]
      : standing
  if (rings.length === 0)
    return refusal(
      'needs_footprint',
      'The building has no walls or rooms yet: pass the outline of the plan you are about to draw, in the coordinates you will draw it.',
    )

  const yards = input.yards ?? {}
  const given = (Object.keys(yards) as YardKey[]).filter((key) => Number.isFinite(yards[key]))
  if (given.includes('front') && given.includes('rear'))
    return refusal(
      'yards_conflict',
      'Give the front yard or the rear one, not both: the house fills the rest.',
    )
  if (given.includes('left') && given.includes('right'))
    return refusal(
      'yards_conflict',
      'Give the left yard or the right one, not both: the house fills the rest.',
    )

  const before = siteBrief(nodes, { buildingId: building.id }) as SiteBrief
  if (given.length > 0 && !before.street)
    return refusal(
      'no_street',
      'The site has no street edge, so front, rear, left and right mean nothing yet: set the site frontEdge first.',
    )
  if (given.length === 0 && before.others.length > 0)
    return refusal(
      'other_building_on_site',
      `Another building stands on this site (${before.others.map((o) => o.buildingId).join(', ')}): centring could put one on the other, so give yards.`,
    )

  const lotSite = before.lot.siteRing
  const inSite = buildableInSite(site)
  const aimRing = inSite.state === 'none' ? lotSite : inSite.ring
  const [cx, cz] = boundsCentre(boundsOf(rings.flat()))
  const poseAt = (target: Pt): P => {
    const [tx, tz] = turnPlanPoint(cx, cz, yaw)
    return [target[0] - tx, target[1] - tz]
  }
  const siteRings = (at: Pt) => {
    const toSite = siteFrame({ position: [at[0], 0, at[1]], rotation: [0, yaw, 0] })
    return rings.map((ring) => ring.map((p) => toSite(p[0], p[1])))
  }
  const fits = (at: Pt) => spill(siteRings(at), aimRing).areaM2 === 0

  const centre = ringCentre(aimRing) ?? boundsCentre(boundsOf(lotSite))
  let at = poseAt(centre)
  if (!fits(at)) {
    const pole = polygonInteriorPoint({ polygon: aimRing.map((p) => [p[0], p[1]]) })
    const atPole = poseAt(pole)
    if (fits(atPole)) at = atPole
  }

  if (given.length > 0) {
    // the street's side as the house will face it, not as it faces now
    const faces = streetFaces(
      (streetAt(site, yaw) as NonNullable<ReturnType<typeof streetAt>>).side,
    )
    const yardsAt = (p: Pt) => {
      const toLevel = levelFrame({ position: [p[0], 0, p[1]], rotation: [0, yaw, 0] })
      return planYards(
        rings,
        lotSite.map((q) => toLevel(q[0], q[1])),
      )
    }
    const misses = (p: Pt) => {
      const now = yardsAt(p)
      return given.map((key) => {
        const yard = now[faces[key]]
        return yard === null ? null : yard - (yards[key] as number)
      })
    }
    // Each yard is moved along its own face's normal; on a turned lot moving one moves the other,
    // so both are solved together. Straight lot lines make it exact in one step.
    const along = given.map((key) => turnPlanPoint(...SIDES[faces[key]], yaw))
    const step = 0.5
    for (let pass = 0; pass < 6; pass++) {
      const miss = misses(at)
      const blind = given.find((_, i) => miss[i] === null)
      if (blind)
        return refusal('yards_infeasible', `The ${blind} face does not look onto a lot line.`)
      const [r0 = 0, r1 = 0] = miss as number[]
      if (Math.abs(r0) < 1e-3 && Math.abs(r1) < 1e-3) break
      // how each miss changes per metre moved along each face's normal (one yard: a 1×1 system)
      const slope = along.map(([dx, dz]) =>
        (misses([at[0] + dx * step, at[1] + dz * step]) as number[]).map(
          (m, i) => (m - (miss[i] as number)) / step,
        ),
      )
      const [[a = 0, c = 0] = [], [b = 0, d = 1] = []] = slope
      const det = a * d - b * c
      if (Math.abs(det) < 1e-6) break
      const moves = [(r1 * b - r0 * d) / det, (r0 * c - r1 * a) / det]
      at = along.reduce<P>(
        (p, [dx, dz], i) => [p[0] + dx * (moves[i] ?? 0), p[1] + dz * (moves[i] ?? 0)],
        [at[0], at[1]],
      )
    }
    const placed = yardsAt(at)
    for (const key of given) {
      const yard = placed[faces[key]]
      if (yard === null || Math.abs(yard - (yards[key] as number)) > 0.01)
        return refusal(
          'yards_infeasible',
          `No place on this lot gives a ${yards[key]} m ${key} yard with the other yards asked: give one of them, or turn the house square to the street (rotationDeg).`,
        )
    }
    for (const key of given) {
      const across = placed[OPPOSITE[faces[key]]]
      if (across === null || across < 0)
        return refusal(
          'yards_infeasible',
          `A ${yards[key]} m ${key} yard pushes the house ${across === null ? 'off' : `${round(-across)} m past`} the lot line opposite: the lot is too shallow for it on that side.`,
        )
    }
  }

  const position: [number, number, number] = [
    round(at[0], 1e4),
    building.position?.[1] ?? 0,
    round(at[1], 1e4),
  ]
  const rotation: [number, number, number] = [
    building.rotation?.[0] ?? 0,
    round(yaw, 1e6),
    building.rotation?.[2] ?? 0,
  ]
  const moved =
    Math.hypot(
      position[0] - (building.position?.[0] ?? 0),
      position[2] - (building.position?.[2] ?? 0),
    ) > 1e-3 || Math.abs(rotation[1] - (building.rotation?.[1] ?? 0)) > 1e-5
  const placedNodes = { ...nodes, [building.id]: { ...building, position, rotation } } as Nodes
  const brief = siteBrief(placedNodes, { buildingId: building.id }) as SiteBrief
  return {
    ok: true,
    buildingId: building.id,
    position,
    rotation,
    moved,
    brief,
    footprint: measureFootprint(rings, brief),
  }
}

/** A site brief's numbers rounded to the centimetre (angles to a tenth of a degree), as agents read them. */
export function roundedSiteBrief(brief: SiteBrief) {
  const bounds = (b: PlanBounds) => ({
    minX: round(b.minX),
    minZ: round(b.minZ),
    maxX: round(b.maxX),
    maxZ: round(b.maxZ),
  })
  const front = <T extends { frontage: number; depth: number }>(edge: T): T => ({
    ...edge,
    frontage: round(edge.frontage),
    depth: round(edge.depth),
  })
  const { footprint, street, ground } = brief
  const [fewest, most] = brief.lot.footprintRangeM2
  return {
    ...brief,
    pose: {
      position: brief.pose.position.map((n) => round(n)) as [number, number, number],
      rotationDeg: round(brief.pose.rotationDeg, 10),
    },
    lot: {
      ...brief.lot,
      ring: brief.lot.ring.map(roundPt),
      siteRing: brief.lot.siteRing.map(roundPt),
      bounds: bounds(brief.lot.bounds),
      areaM2: round(brief.lot.areaM2, 10),
      footprintRangeM2: [Math.round(fewest), Math.round(most)] as [number, number],
    },
    buildable: {
      ...brief.buildable,
      ring: brief.buildable.ring.map(roundPt),
      centre: brief.buildable.centre ? roundPt(brief.buildable.centre) : null,
      areaM2: round(brief.buildable.areaM2, 10),
      edges: brief.buildable.edges.map(front),
    },
    street: street ? front(street) : null,
    ground: { ...ground, reliefM: ground.reliefM === null ? null : round(ground.reliefM) },
    northDeg: round(brief.northDeg, 10),
    footprint: footprint
      ? {
          bounds: bounds(footprint.bounds),
          centre: roundPt(footprint.centre),
          offCentreM: round(footprint.offCentreM),
          yards: Object.fromEntries(
            Object.entries(footprint.yards).map(([key, m]) => [
              key,
              m === null ? null : round(m ?? 0),
            ]),
          ),
          fit: footprint.fit,
          overhang: {
            lotM: round(footprint.overhang.lotM),
            setbacksM: round(footprint.overhang.setbacksM),
            sides: footprint.overhang.sides,
          },
        }
      : null,
    others: brief.others.map((other) => ({ ...other, bounds: bounds(other.bounds) })),
  }
}

const num = (n: number) => {
  const r = Math.round(n * 10) / 10 || 0
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}
const fmtPt = (p: Pt) => `[${num(p[0])}, ${num(p[1])}]`
const span = (b: PlanBounds) => `x ${num(b.minX)}..${num(b.maxX)}, z ${num(b.minZ)}..${num(b.maxZ)}`
const size = (b: PlanBounds) => `${num(b.maxX - b.minX)}×${num(b.maxZ - b.minZ)} m`

/** `18×32 m` for a rectangular lot, whatever its turn; null for any other shape. */
function rectangleSize(ring: readonly Pt[]): string | null {
  if (ring.length !== 4) return null
  const side = (i: number) => {
    const a = ring[i] as Pt
    const b = ring[(i + 1) % 4] as Pt
    return [b[0] - a[0], b[1] - a[1]] as const
  }
  for (let i = 0; i < 4; i++) {
    const [ax, az] = side(i)
    const [bx, bz] = side((i + 1) % 4)
    if (Math.abs(ax * bx + az * bz) > 1e-3 * Math.hypot(ax, az) * Math.hypot(bx, bz)) return null
  }
  return `${num(Math.hypot(...side(0)))}×${num(Math.hypot(...side(1)))} m`
}

function describeSetbacks(setbacks: SiteSetbacks): string {
  const parts = [`front ${num(setbacks.front)}`]
  if (setbacks.left !== undefined || setbacks.right !== undefined)
    parts.push(
      `left ${num(setbacks.left ?? setbacks.side)}`,
      `right ${num(setbacks.right ?? setbacks.side)}`,
    )
  else parts.push(`sides ${num(setbacks.side)}`)
  parts.push(`rear ${num(setbacks.rear)}`)
  if (setbacks.streetSide !== undefined) parts.push(`street side ${num(setbacks.streetSide)}`)
  return `${parts.join(', ')} m`
}

/**
 * The site in a few lines, as the agent reads it before drawing: the lot (in the building's level
 * coordinates), its facts, the buildable area and its centre, the street and north, and where the
 * footprint stands, or where a new one goes.
 */
export function describeSiteBrief(brief: SiteBrief): string[] {
  const { lot, buildable, street, footprint } = brief
  const [px, py, pz] = brief.pose.position
  const posed = Math.hypot(px, pz) > 1e-3 || Math.abs(brief.pose.rotationDeg) > 0.05
  const lines = [
    `lot, in ${brief.buildingId ? "this building's level" : 'site (no building stands on it yet)'} coordinates: [${lot.ring.map(fmtPt).join(', ')}]${
      posed
        ? ` (stored in site coordinates; building at [${num(px)}, ${num(py)}, ${num(pz)}], ${num(brief.pose.rotationDeg)}°)`
        : ''
    }`,
  ]

  const dims = rectangleSize(lot.ring)
  const [fewest, most] = lot.footprintRangeM2
  // the placeholder is no real lot: a share of it says nothing of the house
  const facts = [
    `lot ${dims ? `${dims}, ` : ''}${Math.round(lot.areaM2)} m²${brief.placeholder ? '' : ` (a house usually covers 30–45%: ${Math.round(fewest)}–${Math.round(most)} m²)`}`,
  ]
  if (brief.placeholder)
    facts.push('the new-project placeholder: no address or parcel, real property lines unknown')
  if (brief.address) facts.push(brief.address)
  if (brief.parcel?.apn) facts.push(`APN ${brief.parcel.apn}`)
  if (brief.zone) facts.push(`zone ${brief.zone}`)
  if (lot.approximate) facts.push('approximate rectangle: real property lines not found')
  lines.push(facts.join(' · '))

  const centre = buildable.centre
  if (buildable.state === 'none')
    lines.push(
      `buildable: none — the setbacks (${describeSetbacks(buildable.setbacks as SiteSetbacks)}) leave nothing on this lot`,
    )
  else if (buildable.state === 'lot')
    lines.push(
      `buildable: the whole lot (no setbacks recorded) · centre ${centre ? fmtPt(centre) : 'none'}`,
    )
  else {
    const front = buildable.edges.find((edge) => edge.edge === buildable.frontEdge)
    const along = street
      ? 'along the street'
      : 'along its edge facing north (the setbacks take it as the front until the street is set)'
    lines.push(
      `buildable${buildable.state === 'advisory' ? ' (advisory: the inset of this concave lot crosses itself)' : ''}: setbacks ${describeSetbacks(buildable.setbacks as SiteSetbacks)}${buildable.source ? ` (${buildable.source})` : ''} · ${span(boundsOf(buildable.ring))} · centre ${centre ? fmtPt(centre) : 'none'} · ${Math.round(buildable.areaM2)} m² · ${
        front
          ? `${num(front.frontage)} m ${along}, ${num(front.depth)} m deep (its edge ${front.edge})`
          : `no edge of it faces ${street ? 'the street' : 'north'}, so no frontage to build along`
      }`,
    )
  }

  const north =
    Math.abs(((brief.northDeg + 180) % 360) - 180) < 0.5
      ? 'plan up'
      : `${num(brief.northDeg)}° clockwise of plan up`
  const squared = !street || Math.abs(street.squareRotationDeg - brief.pose.rotationDeg) < 0.06
  const squaring = street ? `place_building rotationDeg ${num(street.squareRotationDeg)}` : ''
  // a house yet to rise is squared by place_building itself: naming a rotation for it reads as
  // one to draw the plan at
  const facing = !footprint
    ? 'a new house is stood square to it'
    : squared
      ? 'the house square to it'
      : `${squaring} squares the house to it`
  lines.push(
    `${street ? `street: ${street.side} (lot edge ${street.edge}, ${num(street.frontage)} m of frontage, ${num(street.depth)} m deep; ${facing})` : 'street: not set'} · north: ${north}`,
  )
  const { ground } = brief
  lines.push(
    ground.state === 'sloped'
      ? `ground: sloped, ${num(ground.reliefM ?? 0)} m of fall across the lot`
      : ground.state === 'flat'
        ? `ground: read flat (${num(ground.reliefM ?? 0)} m of fall over the grid read round the lot)`
        : 'ground: not read, flat until it is',
  )

  if (!footprint) {
    const aim = centre ?? boundsCentre(lot.bounds)
    lines.push(
      `footprint: none yet — centre it on ${fmtPt(aim)} (a 12×10 m footprint spans ${span({ minX: aim[0] - 6, maxX: aim[0] + 6, minZ: aim[1] - 5, maxZ: aim[1] + 5 })})${
        squared
          ? ''
          : '; place_building with its outline first stands it there square to the street'
      }`,
    )
    return lines
  }
  const measured = Object.entries(footprint.yards).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  )
  const yards = measured.length
    ? ` · yards ${measured.map(([key, m]) => `${key} ${num(m)}`).join(', ')} m`
    : ''
  const room = buildable.ring.length >= 3 ? boundsOf(buildable.ring) : lot.bounds
  const tooBig =
    footprint.bounds.maxX - footprint.bounds.minX > room.maxX - room.minX ||
    footprint.bounds.maxZ - footprint.bounds.minZ > room.maxZ - room.minZ
  const centred = footprint.offCentreM < 0.25
  const fix = centred
    ? tooBig
      ? `: it is bigger than the buildable area (${size(room)}) even centred, so say so`
      : squared
        ? ': even centred, the shape of the lot leaves it out: give yards or reshape the plan'
        : `: even centred, it stands askew to the lot: ${squaring} squares it to the street`
    : `: place_building centres it${tooBig ? `, but it is bigger than the buildable area (${size(room)}): say so` : ''}`
  const where =
    footprint.fit === 'outside'
      ? `${num(footprint.overhang.lotM)} m past the lot line (${footprint.overhang.sides.join(', ')})${fix}`
      : footprint.fit === 'lot'
        ? buildable.state === 'none'
          ? 'on the lot, with nothing buildable inside the setbacks'
          : `on the lot but ${num(footprint.overhang.setbacksM)} m into the required yards (${footprint.overhang.sides.join(', ')})${fix}`
        : centred
          ? 'inside the buildable area, on its centre'
          : `inside the buildable area, ${num(footprint.offCentreM)} m off its centre`
  lines.push(
    `footprint: ${size(footprint.bounds)} centred ${fmtPt(footprint.centre)}${yards} · ${where}`,
  )
  return lines
}
