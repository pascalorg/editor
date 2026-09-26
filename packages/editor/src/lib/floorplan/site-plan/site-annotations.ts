/**
 * The permit-set layers of the site plan (A1.0) beyond the lot, the yards
 * and the house: the street each street edge fronts, the contour labels,
 * the driveway and walks, the utility services Bones placed, the drainage
 * arrows, and the finish-floor and spot elevations. Every function is pure
 * and returns site-metre primitives (x east, y south) for
 * `buildSitePlanDrawing`, which owns the order they stack in.
 */
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type FloorplanGeometry,
  heightAt,
  type LevelNode,
  type SceneSnapshot,
  type SiteNode,
  type TerrainField,
  terrainContours,
} from '@pascal-app/core'
import {
  formatFeetInches,
  METRES_PER_FOOT,
  outwardNormal,
  type Pt,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
} from './geometry'
import { flatworkKindOf, type OutdoorPart, siteFrame } from './site-parts'

const INK = '#111827'
const INK_SOFT = '#4b5563'
const CONTOUR_INK = '#8b5a2b'
const HALO = '#ffffff'
const FT = METRES_PER_FOOT

/** An angle a label reads at: within a quarter turn of the paper's horizontal. */
function readable(a: number): number {
  let r = a
  while (r > Math.PI / 2) r -= Math.PI
  while (r <= -Math.PI / 2) r += Math.PI
  return r
}

/** A label laid along a run, centred on `at`, knocked out of what it crosses. */
function runLabel(
  at: Pt,
  angle: number,
  text: string,
  fontSize: number,
  fill: string,
  metadata: Record<string, unknown>,
  weight = 600,
): FloorplanGeometry {
  return {
    kind: 'group',
    transform: { translate: at, rotate: readable(angle) },
    children: [
      {
        kind: 'text',
        x: 0,
        y: 0,
        text,
        fontSize,
        fill,
        fontWeight: weight,
        textAnchor: 'middle',
        dominantBaseline: 'middle',
        stroke: HALO,
        strokeWidth: fontSize * 0.28,
        paintOrder: 'stroke',
      },
    ],
    metadata,
  }
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k]
const len = (a: Pt) => Math.hypot(a[0], a[1])
const unit = (a: Pt): Pt => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l]
}

/** The nearest point to `p` on segment ab. */
function footOn(p: Pt, a: Pt, b: Pt): Pt {
  const ab = sub(b, a)
  const l2 = ab[0] * ab[0] + ab[1] * ab[1]
  const t =
    l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2))
  return [a[0] + ab[0] * t, a[1] + ab[1] * t]
}

/** Proper crossing of segments pq and ab. */
function crosses(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const d = (u: Pt, v: Pt, w: Pt) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0])
  const d1 = d(a, b, p)
  const d2 = d(a, b, q)
  const d3 = d(p, q, a)
  const d4 = d(p, q, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

function crossesRings(p: Pt, q: Pt, rings: readonly Pt[][]): boolean {
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      if (crosses(p, q, ring[i] as Pt, ring[(i + 1) % ring.length] as Pt)) return true
    }
  }
  return false
}

/* ============================================================ streets */

const DIRECTIONS: Record<string, string> = {
  north: 'N',
  south: 'S',
  east: 'E',
  west: 'W',
  northeast: 'NE',
  northwest: 'NW',
  southeast: 'SE',
  southwest: 'SW',
  n: 'N',
  s: 'S',
  e: 'E',
  w: 'W',
  ne: 'NE',
  nw: 'NW',
  se: 'SE',
  sw: 'SW',
}

const SUFFIXES: Record<string, string> = {
  st: 'STREET',
  street: 'STREET',
  ave: 'AVENUE',
  av: 'AVENUE',
  avenue: 'AVENUE',
  rd: 'ROAD',
  road: 'ROAD',
  dr: 'DRIVE',
  drive: 'DRIVE',
  ln: 'LANE',
  lane: 'LANE',
  ct: 'COURT',
  court: 'COURT',
  pl: 'PLACE',
  place: 'PLACE',
  blvd: 'BOULEVARD',
  boulevard: 'BOULEVARD',
  cir: 'CIRCLE',
  circle: 'CIRCLE',
  ter: 'TERRACE',
  terr: 'TERRACE',
  terrace: 'TERRACE',
  trl: 'TRAIL',
  trail: 'TRAIL',
  pkwy: 'PARKWAY',
  parkway: 'PARKWAY',
  hwy: 'HIGHWAY',
  highway: 'HIGHWAY',
  way: 'WAY',
  loop: 'LOOP',
}

/**
 * A street name as a site plan prints it: the house number dropped, the
 * quadrant abbreviated, the street type spelled out — "4121 NW 34th St" and
 * OSM's "Northwest 34th Street" both read "NW 34TH STREET", and "Northwest
 * 34th Terrace" reads "NW 34TH TERRACE" (a different street: the type is part
 * of the name). Empty for an empty name.
 */
export function formatStreetName(raw: string | null | undefined): string {
  const words = String(raw ?? '')
    .replace(/^\s*\d+[A-Za-z]?(?:[-–]\d+)?\s+/, '')
    .replace(/\./g, '')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return ''
  const out = words.map((w) => w.toUpperCase())
  const first = DIRECTIONS[(words[0] as string).toLowerCase()]
  if (first && words.length > 1) out[0] = first
  const lastIndex = words.length - 1
  const last = (words[lastIndex] as string).toLowerCase()
  const trailingDir = DIRECTIONS[last]
  if (trailingDir && lastIndex > 0) {
    out[lastIndex] = trailingDir
    const type = SUFFIXES[(words[lastIndex - 1] as string).toLowerCase()]
    if (type && lastIndex - 1 > 0) out[lastIndex - 1] = type
  } else {
    const type = SUFFIXES[last]
    if (type && lastIndex > 0) out[lastIndex] = type
  }
  return out.join(' ')
}

/** The front edge's street as the lot drop-in's note recorded it (scenes dropped before per-edge names were kept). */
function frontStreetFromNotes(
  notes: readonly string[] | undefined,
  frontEdge: number,
): string | null {
  for (const note of notes ?? []) {
    const osm = /^Front edge (\d+): fronts "([^"]+)"/.exec(note)
    if (osm && Number(osm[1]) - 1 === frontEdge) return osm[2] as string
    const fabric =
      /^Front edge: edge (\d+) of the parcel fabric's frontage \([^,)]*,\s*([^)]+)\)/.exec(note)
    if (fabric && Number(fabric[1]) - 1 === frontEdge) return (fabric[2] as string).trim()
  }
  return null
}

/** Printed on a street edge whose street the lot drop-in could not name. */
export const UNNAMED_STREET = 'STREET (NAME NOT ON RECORD — VERIFY)'

/**
 * The street each street edge of the lot runs along, as printed: only the
 * edges that front a street — `site.streetEdges` and the front edge — and
 * each with ITS street: the name the lot drop-in stored for that edge
 * (`site.metadata.streetNames`, from the mapped roads), else — for a lot dropped
 * before names were kept per edge — the front edge's street from the
 * drop-in's note, the address's street on the one other street edge when
 * the front is a different street (a through or corner lot is addressed on
 * one of its streets), and "name not on record" where neither says.
 */
export function streetEdgeNames(
  site: Pick<SiteNode, 'address' | 'parcel' | 'streetEdges'> & { metadata?: unknown },
  frontEdge: number,
): Map<number, string> {
  const edges = [...new Set([frontEdge, ...(site.streetEdges ?? [])])].filter(
    (i) => Number.isInteger(i) && i >= 0,
  )
  const stored = ((site.metadata as { streetNames?: unknown } | undefined)?.streetNames ??
    {}) as Record<string, string>
  const address = formatStreetName(site.address?.street)
  const names = new Map<number, string>()
  for (const i of edges) {
    const own = formatStreetName(stored[String(i)])
    if (own) names.set(i, own)
  }
  if (!names.has(frontEdge)) {
    const noted = formatStreetName(frontStreetFromNotes(site.parcel?.notes, frontEdge))
    const front = noted || address
    if (front) names.set(frontEdge, front)
  }
  const unnamed = edges.filter((i) => !names.has(i))
  const taken = new Set(names.values())
  if (address && unnamed.length === 1 && !taken.has(address))
    names.set(unnamed[0] as number, address)
  for (const i of edges) if (!names.has(i)) names.set(i, UNNAMED_STREET)
  return names
}

/* =========================================================== contours */

type ContourLine = { levelM: number; absFt: number | null; points: Pt[]; index: boolean }

function polylineLength(points: readonly Pt[]): number {
  let s = 0
  for (let i = 1; i < points.length; i++) s += len(sub(points[i] as Pt, points[i - 1] as Pt))
  return s
}

/** The point `t` (0–1) of the way along a polyline, with the run's direction there. */
function alongPolyline(points: readonly Pt[], t: number): { at: Pt; angle: number } {
  const total = polylineLength(points)
  let want = total * t
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Pt
    const b = points[i] as Pt
    const l = len(sub(b, a))
    if (want <= l || i === points.length - 1) {
      const k = l > 0 ? Math.min(1, want / l) : 0
      return {
        at: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k],
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      }
    }
    want -= l
  }
  const p = points[0] as Pt
  return { at: p, angle: 0 }
}

/**
 * The contour lines and their labels. With a survey datum (the terrain
 * sample's USGS elevation, or the dossier's 3DEP lines) the lines fall on
 * whole multiples of the interval in ABSOLUTE feet — 173, 174, 175 — not on
 * the site datum's fraction, and each is labelled with its elevation; every
 * fifth is an index contour (heavier). Each elevation is labelled once, or
 * twice on a long line, on its longest pieces — never on every loop.
 */
export function contourPrimitives(args: {
  site: SiteNode
  lot: readonly Pt[]
  field: TerrainField
  intervalIn: number
  datumFt: number | null
  fontSize: number
  /** Rings no label is set inside (the house, porches, paving). */
  avoid?: readonly Pt[][]
}): FloorplanGeometry[] {
  const { site, lot, field, intervalIn, datumFt, fontSize } = args
  const avoid = args.avoid ?? []
  const clear = (p: Pt) => !avoid.some((ring) => pointInPolygon(ring, p[0], p[1]))
  const stepFt = intervalIn / 12
  const isIndex = (ft: number) => Math.abs(ft / (stepFt * 5) - Math.round(ft / (stepFt * 5))) < 1e-6
  let lines: ContourLine[]
  const surveyed = site.terrainContours
  const useSurveyed =
    surveyed !== undefined &&
    surveyed.lines.length > 0 &&
    Math.abs(stepFt / surveyed.intervalFt - Math.round(stepFt / surveyed.intervalFt)) < 1e-9
  if (useSurveyed) {
    lines = surveyed.lines
      .filter((l) => Math.abs(l.elevationFt / stepFt - Math.round(l.elevationFt / stepFt)) < 1e-9)
      .map((l) => ({
        levelM: (l.elevationFt - (datumFt ?? 0)) * FT,
        absFt: datumFt !== null ? l.elevationFt : null,
        points: l.points.filter((p) => lot.length < 3 || pointInPolygon(lot, p[0], p[1])) as Pt[],
        index: isIndex(l.elevationFt),
      }))
      .filter((c) => c.points.length >= 2)
  } else if (datumFt !== null) {
    // shift the field by the datum's fraction of an interval so the lines
    // land on whole absolute elevations
    const frac = ((datumFt % stepFt) + stepFt) % stepFt
    const shift = Math.round((frac * FT) / field.step)
    const shifted: TerrainField =
      shift === 0 ? field : { ...field, heights: field.heights.map((h) => h + shift) }
    lines = terrainContours(shifted, stepFt * FT, lot).map((c) => {
      const rel = c.levelM - shift * field.step
      const absFt = Math.round((datumFt + rel / FT) / stepFt) * stepFt
      return { levelM: rel, absFt, points: c.points, index: isIndex(absFt) }
    })
  } else {
    lines = terrainContours(field, stepFt * FT, lot).map((c) => ({
      levelM: c.levelM,
      absFt: null,
      points: c.points,
      index: c.index,
    }))
  }

  const out: FloorplanGeometry[] = []
  for (const c of lines) {
    out.push({
      kind: 'polyline',
      points: c.points,
      stroke: CONTOUR_INK,
      strokeWidth: c.index ? 0.045 : 0.02,
      opacity: c.index ? 0.85 : 0.6,
      fill: 'none',
      metadata: { sitePlan: 'contour', levelM: c.levelM },
    })
  }
  // labels: per elevation, on its longest pieces — two on a long line, one otherwise
  const byLevel = new Map<string, ContourLine[]>()
  for (const c of lines) {
    const key = c.levelM.toFixed(4)
    const list = byLevel.get(key)
    if (list) list.push(c)
    else byLevel.set(key, [c])
  }
  for (const pieces of byLevel.values()) {
    const ranked = pieces
      .map((c) => ({ c, length: polylineLength(c.points) }))
      .filter((p) => p.length >= fontSize * 6)
      .sort((a, b) => b.length - a.length)
    const first = ranked[0]
    if (!first) continue
    const text =
      first.c.absFt !== null
        ? first.c.absFt.toFixed(stepFt < 1 ? 1 : 0)
        : `${first.c.levelM >= 0 ? '+' : ''}${(first.c.levelM / FT).toFixed(1)}'`
    // two labels on a long line, one otherwise; each at the first clear
    // station near its mark (never on the house, a porch or the paving),
    // the two kept apart
    const wanted = first.length >= fontSize * 40 ? [0.28, 0.72] : [0.5]
    const placed: Pt[] = []
    for (const [k, t] of wanted.entries()) {
      const candidates = [t, t - 0.1, t + 0.1, t - 0.2, t + 0.2, 0.5, 0.35, 0.65, 0.15, 0.85]
      const pieceList = k === 1 || ranked.length === 1 ? [first] : ranked.slice(0, 3)
      let done = false
      for (const piece of pieceList) {
        for (const u of candidates) {
          if (u <= 0.02 || u >= 0.98) continue
          const { at, angle } = alongPolyline(piece.c.points, u)
          if (!clear(at) || placed.some((p) => len(sub(p, at)) < fontSize * 12)) continue
          out.push(
            runLabel(at, angle, text, fontSize, CONTOUR_INK, { sitePlan: 'contour-label' }, 500),
          )
          placed.push(at)
          done = true
          break
        }
        if (done) break
      }
    }
  }
  return out
}

/* ========================================================== flatwork */

type FlatworkDims = {
  /** Level-local points across the driveway's throat at the garage door, and across its mouth at the street. */
  throat?: [number, number][]
  mouth?: [number, number][]
  widthM?: number
}

/**
 * The driveway and walks: a concrete tone under a fine edge, the driveway
 * dimensioned across its throat (the garage door) and its flared mouth at
 * the property line, the walk's width printed along it.
 */
export function flatworkPrimitives(
  scene: SceneSnapshot,
  building: BuildingNode | null,
  parts: readonly OutdoorPart[],
  fontSize: number,
): FloorplanGeometry[] {
  const toSite = siteFrame(building)
  const out: FloorplanGeometry[] = []
  for (const part of parts) {
    if (part.kind !== 'driveway' && part.kind !== 'walk') continue
    out.push({
      kind: 'polygon',
      points: part.ring,
      fill: '#e5e7eb',
      fillOpacity: 0.95,
      stroke: INK,
      strokeWidth: 0.03,
      metadata: { sitePlan: part.kind },
    })
    out.push({ kind: 'hatch', points: part.ring, color: '#9ca3af', opacity: 0.35 })
    const node = scene.nodes[part.id as AnyNodeId] as
      | (AnyNode & { metadata?: Record<string, unknown> })
      | undefined
    const dims = (node?.metadata?.flatworkDims ?? {}) as FlatworkDims
    const c = polygonCentroid(part.ring)
    if (part.kind === 'driveway') {
      const lines = ['CONC. DRIVEWAY']
      out.push(
        runLabel(c, 0, lines[0] as string, fontSize, INK, { sitePlan: 'driveway-label' }, 700),
      )
      for (const [key, across] of [
        ['throat', dims.throat],
        ['mouth', dims.mouth],
      ] as const) {
        if (across?.length !== 2) continue
        const a = toSite(across[0]![0], across[0]![1])
        const b = toSite(across[1]![0], across[1]![1])
        const d = unit(sub(b, a))
        // the dimension line sits just inside the driveway, the text toward its middle
        const inward = key === 'throat' ? unit(sub(c, a)) : unit(sub(c, a))
        const n: Pt = [-d[1], d[0]]
        const sign = n[0] * inward[0] + n[1] * inward[1] >= 0 ? 1 : -1
        out.push({
          kind: 'dimension',
          start: a,
          end: b,
          offsetNormal: [n[0] * sign, n[1] * sign],
          offsetDistance: 0.6,
          extensionOvershoot: 0.25,
          stroke: '#334155',
          terminator: 'architectural-tick',
          text: formatFeetInches(len(sub(b, a))),
          metadata: { sitePlan: `driveway-${key}` },
        } as FloorplanGeometry)
      }
    } else {
      // the walk's width along its longest leg
      let best: { at: Pt; angle: number; l: number } | null = null
      const ring = part.ring
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i] as Pt
        const b = ring[(i + 1) % ring.length] as Pt
        const l = len(sub(b, a))
        if (!best || l > best.l)
          best = {
            at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
            angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
            l,
          }
      }
      const width = typeof dims.widthM === 'number' ? dims.widthM : null
      const text = width ? `${formatFeetInches(width)} CONC. WALK` : 'CONC. WALK'
      if (best) {
        // on the walk's centre line, along its longest leg
        const inward = unit(sub(c, best.at))
        const d = unit([Math.cos(best.angle), Math.sin(best.angle)])
        const n: Pt = [-d[1], d[0]]
        const sign = n[0] * inward[0] + n[1] * inward[1] >= 0 ? 1 : -1
        const half = (width ?? 1.2) / 2
        out.push(
          runLabel(
            add(best.at, mul(n, sign * half)),
            best.angle,
            text,
            fontSize * 0.8,
            INK,
            { sitePlan: 'walk-label' },
            600,
          ),
        )
      }
    }
  }
  return out
}

/* ========================================================= utilities */

export type ServiceRole = 'electric' | 'water' | 'sewer'

type ServicePoint = { role: ServiceRole | 'ac' | 'pole'; at: Pt; normal: Pt | null }

/** The Bones service points of the building's ground storey, in site metres. */
export function servicePoints(
  scene: SceneSnapshot,
  level: LevelNode | null,
  building: BuildingNode | null,
  outline: readonly Pt[][],
): ServicePoint[] {
  if (!level) return []
  const toSite = siteFrame(building)
  const out: ServicePoint[] = []
  const byType = new Map<string, Record<string, unknown>[]>()
  for (const node of Object.values(scene.nodes) as unknown as Record<string, unknown>[]) {
    if (node?.type !== 'bones:service' || node.parentId !== level.id || node.visible === false)
      continue
    const type = String(node.serviceType ?? '')
    const list = byType.get(type)
    if (list) list.push(node)
    else byType.set(type, [node])
  }
  const place = (node: Record<string, unknown>): { at: Pt; normal: Pt | null } | null => {
    const pos = Array.isArray(node.position) ? (node.position as number[]) : [0, 0, 0]
    const placed = Math.abs(pos[0] ?? 0) > 1e-6 || Math.abs(pos[2] ?? 0) > 1e-6
    if (!placed && typeof node.wallId === 'string') {
      const wall = scene.nodes[node.wallId as AnyNodeId] as
        | { start?: number[]; end?: number[]; thickness?: number }
        | undefined
      if (!wall?.start || !wall.end) return null
      const t = typeof node.wallT === 'number' ? node.wallT : 0.5
      const p = toSite(
        (wall.start[0] ?? 0) + ((wall.end[0] ?? 0) - (wall.start[0] ?? 0)) * t,
        (wall.start[1] ?? 0) + ((wall.end[1] ?? 0) - (wall.start[1] ?? 0)) * t,
      )
      const a = toSite(wall.start[0] ?? 0, wall.start[1] ?? 0)
      const b = toSite(wall.end[0] ?? 0, wall.end[1] ?? 0)
      const d = unit(sub(b, a))
      let n: Pt = [-d[1], d[0]]
      const probe = add(p, mul(n, 0.4))
      if (outline.some((ring) => pointInPolygon(ring, probe[0], probe[1]))) n = [-n[0], -n[1]]
      return { at: add(p, mul(n, (wall.thickness ?? 0.15) / 2)), normal: n }
    }
    // a floor-placed point on (or just off) a wall — the sewer exit — leaves
    // square from the nearest face; one standing clear of the house has no face
    const at = toSite(pos[0] ?? 0, pos[2] ?? 0)
    let near: { d: number; foot: Pt; n: Pt } | null = null
    for (const ring of outline) {
      for (let i = 0; i < ring.length; i++) {
        const foot = footOn(at, ring[i] as Pt, ring[(i + 1) % ring.length] as Pt)
        const d = len(sub(at, foot))
        if (!near || d < near.d) near = { d, foot, n: outwardNormal(ring, i) }
      }
    }
    return near && near.d <= 0.6
      ? { at: add(near.foot, mul(near.n, 0.02)), normal: near.n }
      : { at, normal: null }
  }
  const first = (...types: string[]) => {
    for (const t of types) {
      const node = byType.get(t)?.[0]
      if (node) return node
    }
    return undefined
  }
  const roles: [ServicePoint['role'], string[]][] = [
    ['electric', ['electric-meter', 'power-entry']],
    ['water', ['water-entry']],
    ['sewer', ['sewer-exit']],
    ['ac', ['heat-pump']],
    ['pole', ['utility-pole']],
  ]
  for (const [role, types] of roles) {
    const node = first(...types)
    if (!node) continue
    const spot = place(node)
    if (spot) out.push({ role, ...spot })
  }
  return out
}

/** The service entrance Bones frames for the storey: its framing node's choice, else the building's, else Bones' default (overhead). */
export function serviceEntranceOf(
  scene: SceneSnapshot,
  level: LevelNode | null,
  building: BuildingNode | null,
): {
  kind: 'overhead' | 'underground'
  source: 'bones' | 'building' | 'default'
} {
  for (const node of Object.values(scene.nodes) as unknown as Record<string, unknown>[]) {
    if (node?.type !== 'bones:framing' || node.parentId !== level?.id) continue
    if (node.serviceEntrance === 'overhead' || node.serviceEntrance === 'underground')
      return { kind: node.serviceEntrance, source: 'bones' }
  }
  const services = (building?.metadata as { services?: { serviceEntrance?: unknown } } | undefined)
    ?.services
  if (services?.serviceEntrance === 'overhead' || services?.serviceEntrance === 'underground')
    return { kind: services.serviceEntrance, source: 'building' }
  return { kind: 'overhead', source: 'default' }
}

const SERVICE_STYLE: Record<ServiceRole, { color: string; dash: string }> = {
  electric: { color: '#dc2626', dash: '0.6 0.25' },
  water: { color: '#2563eb', dash: '0.45 0.2' },
  sewer: { color: '#65a30d', dash: '0.9 0.25' },
}

/**
 * A schematic route from a service point to the street: out square from
 * the wall, then to the nearest point of a street edge — around the house
 * (a dogleg past its end) when the straight run would cross it.
 */
export function serviceRoute(
  from: Pt,
  normal: Pt | null,
  lot: readonly Pt[],
  streetEdges: readonly number[],
  outline: readonly Pt[][],
): Pt[] | null {
  const start = normal ? add(from, mul(normal, 0.9)) : from
  const candidates: Pt[][] = []
  const hull = outline.flat()
  const b = hull.length > 0 ? polygonBounds(hull) : null
  for (const i of streetEdges) {
    const a = lot[i]
    const c = lot[(i + 1) % lot.length]
    if (!a || !c) continue
    const direct = footOn(start, a, c)
    if (!crossesRings(start, direct, outline)) {
      candidates.push(normal ? [from, start, direct] : [from, direct])
      continue
    }
    // a dogleg past either end of the house, along the wall's run
    if (!b) continue
    const run: Pt = normal ? [-normal[1], normal[0]] : unit(sub(c, a))
    for (const s of [1, -1]) {
      const r = mul(run, s)
      // how far along `r` the house reaches past the start, plus a yard
      let reach = 0
      for (const p of hull)
        reach = Math.max(reach, (p[0] - start[0]) * r[0] + (p[1] - start[1]) * r[1])
      const corner = add(start, mul(r, reach + 1.2))
      const end = footOn(corner, a, c)
      if (crossesRings(start, corner, outline) || crossesRings(corner, end, outline)) continue
      candidates.push(normal ? [from, start, corner, end] : [from, corner, end])
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((p, q) => polylineLength(p) - polylineLength(q))
  return candidates[0] as Pt[]
}

/**
 * The utility services Bones placed, drawn schematically to the street:
 * the electric service from the meter (to the utility pole overhead, or
 * underground to the street), the water service from its entry to a meter
 * box at the property line, the sewer lateral from its exit to a cleanout at
 * the property line, and the A/C condenser on its pad. Sizes are the common
 * residential ones and say "verify"; the utility sets the real ones.
 */
export function servicePrimitives(args: {
  scene: SceneSnapshot
  level: LevelNode | null
  building: BuildingNode | null
  lot: readonly Pt[]
  streetEdges: readonly number[]
  outline: readonly Pt[][]
  fontSize: number
}): {
  primitives: FloorplanGeometry[]
  drawn: ServiceRole[]
  entrance: 'overhead' | 'underground'
  /** The condenser pad's ring, for the marks that should keep off it. */
  pad: Pt[] | null
} {
  const { scene, level, building, lot, streetEdges, outline, fontSize } = args
  const points = servicePoints(scene, level, building, outline)
  const entrance = serviceEntranceOf(scene, level, building)
  const out: FloorplanGeometry[] = []
  const drawn: ServiceRole[] = []
  // a utility the scene already runs as its own line (plugin-utilities) is not drawn twice
  const hasLine = (type: string) =>
    Object.values(scene.nodes).some((n) => (n as { type?: string }).type === type)
  const pole = points.find((p) => p.role === 'pole')

  const labels: Record<ServiceRole, string> = {
    electric: `ELECTRIC SERVICE (${entrance.kind.toUpperCase()})`,
    water: 'WATER SERVICE 3/4" (VERIFY)',
    sewer: 'SEWER LATERAL 4" (VERIFY)',
  }
  for (const role of ['electric', 'water', 'sewer'] as const) {
    const point = points.find((p) => p.role === role)
    if (!point) continue
    if (
      hasLine(
        role === 'electric'
          ? 'utilities:electric-line'
          : role === 'water'
            ? 'utilities:water-line'
            : 'utilities:sewer-line',
      )
    )
      continue
    const route =
      role === 'electric' && pole
        ? entrance.kind === 'overhead'
          ? [point.at, pole.at]
          : (serviceRoute(point.at, point.normal, lot, streetEdges, outline) ?? [point.at, pole.at])
        : serviceRoute(point.at, point.normal, lot, streetEdges, outline)
    if (!route || route.length < 2) continue
    drawn.push(role)
    const style = SERVICE_STYLE[role]
    out.push({
      kind: 'polyline',
      points: route,
      fill: 'none',
      stroke: style.color,
      strokeWidth: 0.06,
      strokeDasharray: style.dash,
      metadata: { sitePlan: 'service', role },
    })
    // the label on the longest run
    let best = { i: 1, l: 0 }
    for (let i = 1; i < route.length; i++) {
      const l = len(sub(route[i] as Pt, route[i - 1] as Pt))
      if (l > best.l) best = { i, l }
    }
    const a = route[best.i - 1] as Pt
    const b = route[best.i] as Pt
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    const n = unit([-(b[1] - a[1]), b[0] - a[0]])
    out.push(
      runLabel(
        add(mul(add(a, b), 0.5), mul(n, fontSize * 0.75)),
        angle,
        labels[role],
        fontSize,
        style.color,
        { sitePlan: 'service-label', role },
      ),
    )
    // the ends: the meter at the house (electric), the meter box / cleanout at the line
    const end = route[route.length - 1] as Pt
    const tag = (at: Pt, text: string, circle: boolean) => {
      const r = fontSize * 0.75
      out.push(
        circle
          ? {
              kind: 'circle',
              cx: at[0],
              cy: at[1],
              r,
              fill: HALO,
              stroke: style.color,
              strokeWidth: 0.04,
            }
          : {
              kind: 'rect',
              x: at[0] - r,
              y: at[1] - r * 0.75,
              width: r * 2,
              height: r * 1.5,
              fill: HALO,
              stroke: style.color,
              strokeWidth: 0.04,
            },
      )
      out.push({
        kind: 'text',
        x: at[0],
        y: at[1],
        text,
        fontSize: fontSize * 0.7,
        fill: style.color,
        fontWeight: 700,
        textAnchor: 'middle',
        dominantBaseline: 'middle',
        upright: true,
      })
    }
    if (role === 'electric') tag(point.at, 'EM', false)
    if (role === 'water') tag(end, 'WM', false)
    if (role === 'sewer') {
      tag(point.at, 'CO', true)
      tag(end, 'CO', true)
    }
  }
  if (pole && drawn.includes('electric')) {
    out.push({
      kind: 'circle',
      cx: pole.at[0],
      cy: pole.at[1],
      r: 0.25,
      fill: INK,
      stroke: INK,
      strokeWidth: 0.02,
    })
    out.push({
      kind: 'text',
      x: pole.at[0],
      y: pole.at[1] - fontSize * 1.1,
      text: entrance.kind === 'overhead' ? 'UTILITY POLE (VERIFY)' : 'PAD TRANSFORMER (VERIFY)',
      fontSize: fontSize * 0.8,
      fill: INK_SOFT,
      fontWeight: 600,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
      upright: true,
      stroke: HALO,
      strokeWidth: fontSize * 0.2,
      paintOrder: 'stroke',
    })
  }
  const ac = points.find((p) => p.role === 'ac')
  let pad: Pt[] | null = null
  if (ac) {
    const s = 0.9144 // a 36 in pad
    pad = [
      [ac.at[0] - s / 2, ac.at[1] - s / 2],
      [ac.at[0] + s / 2, ac.at[1] - s / 2],
      [ac.at[0] + s / 2, ac.at[1] + s / 2],
      [ac.at[0] - s / 2, ac.at[1] + s / 2],
    ]
    out.push({
      kind: 'rect',
      x: ac.at[0] - s / 2,
      y: ac.at[1] - s / 2,
      width: s,
      height: s,
      fill: '#f3f4f6',
      stroke: INK,
      strokeWidth: 0.03,
      metadata: { sitePlan: 'ac-pad' },
    })
    out.push({
      kind: 'line',
      x1: ac.at[0] - s / 2,
      y1: ac.at[1] - s / 2,
      x2: ac.at[0] + s / 2,
      y2: ac.at[1] + s / 2,
      stroke: INK,
      strokeWidth: 0.015,
    })
    out.push({
      kind: 'line',
      x1: ac.at[0] - s / 2,
      y1: ac.at[1] + s / 2,
      x2: ac.at[0] + s / 2,
      y2: ac.at[1] - s / 2,
      stroke: INK,
      strokeWidth: 0.015,
    })
    // the label away from the house
    const c = outline[0] ? polygonCentroid(outline[0]) : ac.at
    const away = unit(sub(ac.at, c))
    out.push({
      kind: 'text',
      x: ac.at[0] + away[0] * (s * 0.6 + fontSize * 2.6),
      y: ac.at[1] + away[1] * (s * 0.6 + fontSize * 1.2),
      text: 'A/C CONDENSER ON 36" PAD',
      fontSize: fontSize * 0.8,
      fill: INK,
      fontWeight: 600,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
      upright: true,
      stroke: HALO,
      strokeWidth: fontSize * 0.2,
      paintOrder: 'stroke',
      metadata: { sitePlan: 'ac-label' },
    })
  }
  return { primitives: out, drawn, entrance: entrance.kind, pad }
}

/* ========================================================== drainage */

/**
 * Drainage arrows off every face of the house: the finish grade falls away
 * from the foundation — 6 in in the first 10 ft (FBC-R / IRC R401.3) — so
 * each arrow runs from the wall out 10 ft. One arrow carries the rule.
 */
export function drainagePrimitives(
  outline: readonly Pt[][],
  fontSize: number,
  obstacles: readonly Pt[][] = [],
): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const raw = [...outline].sort((a, b) => polygonArea(b) - polygonArea(a))[0]
  if (!raw || raw.length < 3) return out
  // one arrow per face: a vertex in the middle of a straight run is not a corner
  const ring = raw.filter((p, i) => {
    const prev = raw[(i - 1 + raw.length) % raw.length] as Pt
    const next = raw[(i + 1) % raw.length] as Pt
    const d1 = unit(sub(p, prev))
    const d2 = unit(sub(next, p))
    return Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) > 0.05
  })
  if (ring.length < 3) return out
  const tenFt = 10 * FT
  // the rule rides the arrow off the longest face
  let longest = -1
  let longestLen = 0
  for (let i = 0; i < ring.length; i++) {
    const l = len(sub(ring[(i + 1) % ring.length] as Pt, ring[i] as Pt))
    if (l > longestLen) {
      longest = i
      longestLen = l
    }
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Pt
    const b = ring[(i + 1) % ring.length] as Pt
    if (len(sub(b, a)) < 4) continue
    const n = outwardNormal(ring, i)
    // off the face where it crosses no porch, deck or paving (and clear of
    // the yard dimension off the face's middle)
    const run = (t: number) => {
      const base = add(a, mul(sub(b, a), t))
      return { tail: add(base, mul(n, 0.5)), tip: add(base, mul(n, tenFt)) }
    }
    const free = (r: { tail: Pt; tip: Pt }) =>
      !crossesRings(r.tail, r.tip, obstacles) &&
      !obstacles.some((o) => pointInPolygon(o, r.tail[0], r.tail[1]))
    const spot = [0.36, 0.64, 0.22, 0.78, 0.12, 0.88].map(run).find(free)
    if (!spot) continue
    const { tail, tip } = spot
    const d = unit(sub(tip, tail))
    const side: Pt = [-d[1], d[0]]
    const head = 0.45
    out.push({
      kind: 'line',
      x1: tail[0],
      y1: tail[1],
      x2: tip[0],
      y2: tip[1],
      stroke: '#0e7490',
      strokeWidth: 0.04,
      metadata: { sitePlan: 'drainage' },
    })
    out.push({
      kind: 'polygon',
      points: [
        tip,
        add(sub(tip, mul(d, head)), mul(side, head * 0.4)),
        add(sub(tip, mul(d, head)), mul(side, -head * 0.4)),
      ],
      fill: '#0e7490',
      stroke: '#0e7490',
      strokeWidth: 0.01,
      metadata: { sitePlan: 'drainage' },
    })
    if (i === longest) {
      out.push(
        runLabel(
          add(mul(add(tail, tip), 0.5), mul(side, fontSize * 0.75)),
          Math.atan2(d[1], d[0]),
          '6" MIN. FALL IN 10\'',
          fontSize * 0.75,
          '#0e7490',
          { sitePlan: 'drainage-label' },
        ),
      )
    }
  }
  return out
}

/* ========================================================= elevations */

/** "174.25'" from an absolute elevation in feet, or "+0.42'" relative to the site datum. */
export function formatElevation(relM: number, datumFt: number | null): string {
  const ft = relM / FT
  return datumFt !== null
    ? `${(datumFt + ft).toFixed(2)}'`
    : `${ft >= 0 ? '+' : ''}${ft.toFixed(2)}'`
}

/**
 * Spot grades: an × and its elevation at each lot corner and just off each
 * corner of the house (the finish grade the pad grading left), read from
 * the site's terrain.
 */
export function spotElevationPrimitives(args: {
  field: TerrainField
  datumFt: number | null
  lot: readonly Pt[]
  outline: readonly Pt[][]
  fontSize: number
}): FloorplanGeometry[] {
  const { field, datumFt, lot, outline, fontSize } = args
  const out: FloorplanGeometry[] = []
  const spot = (at: Pt, labelAt: Pt, kind: string) => {
    const s = fontSize * 0.35
    out.push({
      kind: 'line',
      x1: at[0] - s,
      y1: at[1] - s,
      x2: at[0] + s,
      y2: at[1] + s,
      stroke: INK,
      strokeWidth: 0.02,
    })
    out.push({
      kind: 'line',
      x1: at[0] - s,
      y1: at[1] + s,
      x2: at[0] + s,
      y2: at[1] - s,
      stroke: INK,
      strokeWidth: 0.02,
    })
    out.push({
      kind: 'text',
      x: labelAt[0],
      y: labelAt[1],
      text: formatElevation(heightAt(field, at[0], at[1]), datumFt),
      fontSize,
      fill: INK,
      fontWeight: 500,
      fontFamily: 'Helvetica, Arial, sans-serif',
      textAnchor: 'middle',
      dominantBaseline: 'middle',
      upright: true,
      stroke: HALO,
      strokeWidth: fontSize * 0.25,
      paintOrder: 'stroke',
      metadata: { sitePlan: 'spot-elevation', at: kind },
    })
  }
  // lot corners: the × just inside the corner, its number further in
  const lc = lot.length >= 3 ? polygonCentroid(lot) : null
  if (lc) {
    for (const p of lot) {
      const inward = unit(sub(lc, p))
      spot(add(p, mul(inward, 0.9)), add(p, mul(inward, 0.9 + fontSize * 2.2)), 'lot')
    }
  }
  // house corners: out along the corner's bisector
  const ring = [...outline].sort((a, b) => polygonArea(b) - polygonArea(a))[0]
  if (ring && ring.length >= 3) {
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i - 1 + ring.length) % ring.length] as Pt
      const p = ring[i] as Pt
      const next = ring[(i + 1) % ring.length] as Pt
      const d1 = unit(sub(p, prev))
      const d2 = unit(sub(next, p))
      // a collinear vertex is not a corner
      if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 0.2) continue
      const n1 = outwardNormal(ring, (i - 1 + ring.length) % ring.length)
      const n2 = outwardNormal(ring, i)
      const bis = unit(add(n1, n2))
      // a re-entrant corner's bisector points into the house: skip it
      const probe = add(p, mul(bis, 0.3))
      if (outline.some((r) => pointInPolygon(r, probe[0], probe[1]))) continue
      const at = add(p, mul(bis, 0.8))
      spot(at, add(at, mul(bis, fontSize * 2.4)), 'house')
    }
  }
  return out
}

/** The storey slab's top — the finish floor — level-local metres, and the garage pad's. */
export function floorTops(
  scene: SceneSnapshot,
  level: LevelNode | null,
): { floor: number | null; garage: number | null } {
  let floor: number | null = null
  let garage: number | null = null
  for (const childId of level?.children ?? []) {
    const n = scene.nodes[childId as AnyNodeId] as
      | (AnyNode & { elevation?: number; metadata?: { floor?: unknown } })
      | undefined
    if (n?.type !== 'slab') continue
    // the driveway and walks are paving at grade, never the finish floor
    if (flatworkKindOf(n)) continue
    const tag = n.metadata?.floor
    const top = typeof n.elevation === 'number' ? n.elevation : 0.05
    if (tag === 'garage-slab-at-grade') garage = garage === null ? top : Math.min(garage, top)
    else if (tag === 'slab-on-grade' || tag === 'platform' || tag === undefined) {
      if (tag === undefined && (n.metadata as { porch?: unknown } | undefined)?.porch) continue
      floor = floor === null ? top : Math.max(floor, top)
    }
  }
  return { floor, garage }
}
