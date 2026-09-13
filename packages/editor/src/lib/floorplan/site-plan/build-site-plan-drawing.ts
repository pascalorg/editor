import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  calculateLevelMiters,
  type FloorplanGeometry,
  getWallPlanFootprint,
  type LevelNode,
  migrateSiteMetadata,
  type SceneSnapshot,
  type SiteNode,
  terrainFieldOf,
  unionPolygons,
  type WallNode, terrainContours, envelopeFrontEdge, sightTriangle, streetCorners } from '@pascal-app/core'
import {
  type Bounds,
  boundsInsidePolygon,
  pointInPolygon,
  castYardDimensionsOriented,
  classifyEdges,
  compassLabel,
  edgeHeadingDeg,
  edgeLength,
  formatFeetInches,
  METRES_PER_FOOT,
  outwardNormal,
  polygonArea,
  polygonBounds,
  type Pt,
  resolveFrontEdge,
  setbackEnvelope,
  setbackForRole,
  type YardDimension,
} from './geometry'
import { sitePlanContributions } from './contributors'

/** Contract shared by every drawing producer (see docs/construction-documents.md). */
export interface SitePlanDrawing {
  primitives: FloorplanGeometry[]
  bounds: Bounds
  /** What the drawing could not take from the model — printed on the sheet, never silent. */
  warnings?: string[]
  /** Live values the panel / sheets reuse without re-deriving them. */
  meta: {
    site: SiteNode | null
    frontEdge: number
    lot: Pt[]
    envelope: Pt[]
    /** The envelope edge behind the lot's front line (the envelope has its own vertex count now). */
    envelopeFrontEdge: number
    /** The corner sight triangles (corner, leg end A, leg end B), site metres. */
    sightTriangles: Pt[][]
    /** Per-wall footprint bands of the lowest level, in SITE metres. */
    footprintLoops: Pt[][]
    footprintBounds: Bounds | null
    yards: YardDimension[]
    buildingId: AnyNodeId | null
  }
}

const LOT_STROKE_WIDTH = 0.12
const ENVELOPE_STROKE_WIDTH = 0.05
const LABEL_SIZE = 0.9

// Plan ink. The floor-plan surface is the light plan sheet the panel paints
// behind the scene group, where the app's `currentColor` foreground is
// near-white and therefore invisible. Kinds hard-code their plan ink for the
// same reason; these match `nodes/src/wall/floorplan.ts`.
const INK = '#111827'
const INK_SOFT = '#4b5563'
/** Contour lines: the survey's brown. */
const CONTOUR_INK = '#8b5a2b'
/** The house on the lot: a light body under a heavy edge, so its label and the roof line read. */
const FOOTPRINT_FILL = '#d1d5db'
const FOOTPRINT_STROKE = '#111827'
const DIMENSION_STROKE = '#334155'

export interface SitePlanEdge {
  index: number
  headingDeg: number
  compass: string
  lengthM: number
  label: string
}

/** Lot edges with their compass heading — feeds the panel's front-edge picker. */
export function describeSiteEdges(site: SiteNode | null | undefined): SitePlanEdge[] {
  const lot = (site?.polygon?.points ?? []) as Pt[]
  if (lot.length < 3) return []
  const north = site?.northRotation ?? 0
  return lot.map((_, i) => {
    const headingDeg = edgeHeadingDeg(lot, i, north)
    const lengthM = edgeLength(lot, i)
    const compass = compassLabel(headingDeg)
    return {
      index: i,
      headingDeg,
      compass,
      lengthM,
      label: `Edge ${i + 1} — faces ${compass} (${Math.round(headingDeg)}°), ${formatFeetInches(lengthM)}`,
    }
  })
}

/**
 * The scene's site node, with legacy `metadata.setbacks / zone / apn` lifted
 * onto the real fields. This is a READ-side lift only — nothing is written
 * back to the store, so a scene that was never re-saved keeps its metadata.
 * A persistence-side migration would belong in
 * `packages/core/src/utils/scene-migrations.ts` (not owned by this
 * workstream); see the note in `migrateSiteMetadata`.
 */
function findSite(scene: SceneSnapshot): SiteNode | null {
  for (const node of Object.values(scene.nodes)) {
    if (node.type !== 'site') continue
    const site = node as SiteNode
    const patch = migrateSiteMetadata(site)
    return Object.keys(patch).length > 0 ? { ...site, ...patch } : site
  }
  return null
}

function findBuilding(scene: SceneSnapshot, site: SiteNode | null): BuildingNode | null {
  if (site) {
    for (const childId of site.children) {
      const child = scene.nodes[childId as AnyNodeId]
      if (child?.type === 'building') return child as BuildingNode
    }
  }
  for (const node of Object.values(scene.nodes)) {
    if (node.type === 'building') return node as BuildingNode
  }
  return null
}

/** Lowest `level` number among the building's level children. */
function findLowestLevel(scene: SceneSnapshot, building: BuildingNode | null): LevelNode | null {
  if (!building) return null
  let best: LevelNode | null = null
  for (const childId of building.children) {
    const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
    if (child?.type !== 'level') continue
    const level = child as LevelNode
    if (!best || level.level < best.level) best = level
  }
  return best
}

/**
 * Per-wall plan footprints for a level, mitred, then transformed by the
 * building's site placement. `position` is `[x, y, z]` in site metres (y is
 * height, ignored in plan); `rotation[1]` is the yaw in radians.
 */
export function levelFootprintLoops(
  scene: SceneSnapshot,
  level: LevelNode | null,
  building: BuildingNode | null,
): Pt[][] {
  if (!level) return []
  const walls: WallNode[] = []
  for (const childId of level.children) {
    const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
    if (child?.type === 'wall') walls.push(child as WallNode)
  }
  if (walls.length === 0) return []

  const miters = calculateLevelMiters(walls)
  const yaw = building?.rotation?.[1] ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const ox = building?.position?.[0] ?? 0
  const oz = building?.position?.[2] ?? 0

  const loops: Pt[][] = []
  for (const wall of walls) {
    const poly = getWallPlanFootprint(wall, miters)
    if (poly.length < 3) continue
    // three.js Y rotation, the convention BuildingRenderer applies:
    // world = (cos·lx + sin·lz, −sin·lx + cos·lz) + position
    loops.push(poly.map((p) => [ox + p.x * cos + p.y * sin, oz - p.x * sin + p.y * cos] as Pt))
  }
  return loops
}

/**
 * The outer ring(s) of a set of wall bands: their union, minus any ring that
 * lies inside another (a room enclosed by partitions is a hole in the union,
 * not a second building). Falls back to the bands themselves when the union
 * yields nothing.
 */
export function footprintOutline(loops: readonly Pt[][]): Pt[][] {
  const rings = unionPolygons(loops.map((loop) => loop.map((p) => [p[0], p[1]]))) as Pt[][]
  if (rings.length === 0) return [...loops]
  const inside = (p: Pt, ring: Pt[]): boolean => {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i] as Pt
      const b = ring[j] as Pt
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
        hit = !hit
      }
    }
    return hit
  }
  return rings.filter((ring, i) =>
    !rings.some((other, j) => j !== i && ring[0] !== undefined && inside(ring[0], other)),
  )
}

function unionBounds(loops: readonly Pt[][]): Bounds | null {
  const all: Pt[] = []
  for (const loop of loops) all.push(...loop)
  if (all.length === 0) return null
  return polygonBounds(all)
}

function padBounds(b: Bounds, pad: number): Bounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }
}

function northArrow(at: Pt, northRotation: number, size: number): FloorplanGeometry {
  const [cx, cy] = at
  // Local frame: up is −y, rotated clockwise by `northRotation`.
  const cos = Math.cos(northRotation)
  const sin = Math.sin(northRotation)
  const rot = (x: number, y: number): Pt => [cx + x * cos - y * sin, cy + x * sin + y * cos]
  const tip = rot(0, -size)
  const tail = rot(0, size * 0.55)
  const left = rot(-size * 0.28, -size * 0.35)
  const right = rot(size * 0.28, -size * 0.35)
  const labelAt = rot(0, size * 0.95)
  return {
    kind: 'group',
    children: [
      {
        kind: 'line',
        x1: tail[0],
        y1: tail[1],
        x2: tip[0],
        y2: tip[1],
        stroke: INK,
        strokeWidth: 1.4,
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'polygon',
        points: [tip, left, right],
        fill: INK,
        stroke: INK,
        strokeWidth: 1,
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'text',
        x: labelAt[0],
        y: labelAt[1],
        text: 'N',
        fontSize: size * 0.55,
        fill: INK,
        fontWeight: 600,
        textAnchor: 'middle',
        dominantBaseline: 'hanging',
        upright: true,
      },
    ],
  }
}

/** A survey bearing for the run (dx, dy): quadrant, degrees and minutes — "N 81°42' E". */
function bearingOf(dx: number, dy: number, northRotation: number): string {
  // plan up (−y) is north and +x is east; `northRotation` turns true north
  // clockwise from plan up (the north arrow's own convention)
  let az = ((Math.atan2(dx, -dy) - northRotation) * 180) / Math.PI
  az = ((az % 360) + 360) % 360
  const ns = az <= 90 || az >= 270 ? 'N' : 'S'
  const ew = az <= 180 ? 'E' : 'W'
  const off = az <= 90 ? az : az <= 180 ? 180 - az : az <= 270 ? az - 180 : 360 - az
  let deg = Math.floor(off)
  let min = Math.round((off - deg) * 60)
  if (min === 60) {
    deg += 1
    min = 0
  }
  return `${ns} ${deg}°${String(min).padStart(2, '0')}' ${ew}`
}

/** An angle a label reads at: within a quarter turn of the paper's horizontal. */
function readableAngle(a: number): number {
  let r = a
  while (r > Math.PI / 2) r -= Math.PI
  while (r <= -Math.PI / 2) r += Math.PI
  return r
}

/** "2544 Beatrice Ln" → "BEATRICE LN"; null when the address carries no street. */
function streetNameOf(street: string | undefined): string | null {
  if (!street) return null
  const name = street.replace(/^\s*\d+[A-Za-z]?(?:[-–]\d+)?\s+/, '').trim()
  return name.length > 0 ? name.toUpperCase() : null
}

/** A label laid ALONG a run — a group turned to the run's readable angle, the text centred on `at`. */
function alongLabel(
  at: Pt,
  angle: number,
  text: string,
  fontSize: number,
  style: { fill: string; fontWeight?: number },
  metadata: Record<string, unknown>,
): FloorplanGeometry {
  return {
    kind: 'group',
    transform: { translate: at, rotate: readableAngle(angle) },
    children: [
      {
        kind: 'text',
        x: 0,
        y: 0,
        text,
        fontSize,
        fill: style.fill,
        fontWeight: style.fontWeight ?? 500,
        textAnchor: 'middle',
        dominantBaseline: 'middle',
      },
    ],
    metadata,
  }
}

/** A three.js Y rotation of a plan point: local (x, z) turned by `yaw`. */
function turn(x: number, z: number, yaw: number): Pt {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [c * x + s * z, -s * x + c * z]
}

function yawOf(rotation: unknown): number {
  if (typeof rotation === 'number') return rotation
  if (Array.isArray(rotation)) return Number(rotation[1] ?? 0) || 0
  return 0
}

/** Level-local plan (x, z) → site metres, through the building's placement (see `levelFootprintLoops`). */
function siteFrame(building: BuildingNode | null): (x: number, z: number) => Pt {
  const yaw = building?.rotation?.[1] ?? 0
  const ox = building?.position?.[0] ?? 0
  const oz = building?.position?.[2] ?? 0
  return (x, z) => {
    const [tx, tz] = turn(x, z, yaw)
    return [ox + tx, oz + tz]
  }
}

/**
 * The roof's outline on the lot — every roof segment's plan rectangle plus
 * its overhang, through the segment's, the roof's and the building's turns,
 * unioned into the outer ring(s). Dashed on the site plan: what the eye sees
 * from above is the roof, and the setback is measured to the wall under it.
 */
export function roofOutlineRings(
  scene: SceneSnapshot,
  level: LevelNode | null,
  building: BuildingNode | null,
): Pt[][] {
  if (!level) return []
  const toSite = siteFrame(building)
  const roofs = new Map<string, { position?: number[]; rotation?: unknown }>()
  for (const childId of level.children) {
    const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
    if (child?.type === 'roof') roofs.set(String(child.id), child as { position?: number[]; rotation?: unknown })
  }
  if (roofs.size === 0) return []
  const rects: Pt[][] = []
  for (const node of Object.values(scene.nodes)) {
    if (node.type !== 'roof-segment') continue
    const roof = roofs.get(String((node as { parentId?: unknown }).parentId))
    if (!roof) continue
    const seg = node as unknown as {
      position?: number[]
      rotation?: unknown
      width?: number
      depth?: number
      overhang?: number
    }
    const w = (seg.width ?? 0) / 2 + (seg.overhang ?? 0)
    const d = (seg.depth ?? 0) / 2 + (seg.overhang ?? 0)
    if (w <= 0 || d <= 0) continue
    const segYaw = yawOf(seg.rotation)
    const roofYaw = yawOf(roof.rotation)
    const sx = seg.position?.[0] ?? 0
    const sz = seg.position?.[2] ?? 0
    const rx = roof.position?.[0] ?? 0
    const rz = roof.position?.[2] ?? 0
    const local: Pt[] = [
      [-w, -d],
      [w, -d],
      [w, d],
      [-w, d],
    ]
    rects.push(
      local.map(([lx, lz]) => {
        const [ax, az] = turn(lx, lz, segYaw)
        const [bx, bz] = turn(ax + sx, az + sz, roofYaw)
        return toSite(bx + rx, bz + rz)
      }),
    )
  }
  if (rects.length === 0) return []
  const rings = unionPolygons(rects.map((r) => r.map((p) => [p[0], p[1]]))) as Pt[][]
  return rings.length > 0 ? rings : rects
}

/** The porches and landings on the lot (the level's slabs other than the house's own), site metres. */
function porchRings(
  scene: SceneSnapshot,
  level: LevelNode | null,
  building: BuildingNode | null,
): { ring: Pt[]; label: string; area: number }[] {
  if (!level) return []
  const toSite = siteFrame(building)
  const out: { ring: Pt[]; label: string; area: number }[] = []
  for (const childId of level.children) {
    const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
    if (child?.type !== 'slab') continue
    const slab = child as unknown as { polygon?: number[][]; metadata?: Record<string, unknown>; name?: string }
    const floor = String(slab.metadata?.floor ?? '')
    // the house's own slab is the footprint; a porch beam is not a floor
    if (floor === 'slab-on-grade' || /beam/i.test(floor) || /beam/i.test(slab.name ?? '')) continue
    const poly = slab.polygon ?? []
    if (poly.length < 3) continue
    const porch = slab.metadata?.porch as { policy?: string } | undefined
    const label =
      porch?.policy === 'entry' ? 'PORCH' : porch?.policy === 'landing' ? 'LANDING' : (slab.name ?? 'SLAB').toUpperCase()
    const ring = poly.map((p) => toSite(p[0] ?? 0, p[1] ?? 0))
    out.push({ ring, label, area: Math.abs(polygonArea(ring)) })
  }
  return out
}

/** The exterior steps as tread lines (three, a tread apart), site metres. */
function stairTreads(scene: SceneSnapshot, level: LevelNode | null, building: BuildingNode | null): FloorplanGeometry[] {
  if (!level) return []
  const toSite = siteFrame(building)
  const out: FloorplanGeometry[] = []
  for (const childId of level.children) {
    const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
    if (child?.type !== 'stair') continue
    const stair = child as unknown as { position?: number[]; rotation?: unknown; width?: number }
    const x = stair.position?.[0] ?? 0
    const z = stair.position?.[2] ?? 0
    const r = yawOf(stair.rotation)
    const half = (stair.width ?? 1) / 2
    // the run climbs toward the floor it serves: +local z turned by the yaw
    const dir: Pt = [Math.sin(r), Math.cos(r)]
    const across: Pt = [Math.cos(r), -Math.sin(r)]
    for (let k = 0; k < 3; k++) {
      const cx = x + dir[0] * k * 0.28
      const cz = z + dir[1] * k * 0.28
      const a = toSite(cx - across[0] * half, cz - across[1] * half)
      const b = toSite(cx + across[0] * half, cz + across[1] * half)
      out.push({
        kind: 'line',
        x1: a[0],
        y1: a[1],
        x2: b[0],
        y2: b[1],
        stroke: INK,
        strokeWidth: 0.02,
        metadata: { sitePlan: 'steps' },
      })
    }
  }
  return out
}

/**
 * Build the site-plan drawing from the scene.
 *
 * Everything is recomputed from the current snapshot, so the drawing is live:
 * move the building or edit a setback and the next call reflects it.
 * Returns an empty drawing (no primitives) when the scene has no site polygon.
 */
export function buildSitePlanDrawing(scene: SceneSnapshot): SitePlanDrawing {
  const site = findSite(scene)
  const lot = (site?.polygon?.points ?? []) as Pt[]
  const building = findBuilding(scene, site)
  const level = findLowestLevel(scene, building)
  const footprintLoops = levelFootprintLoops(scene, level, building)
  const footprintBounds = unionBounds(footprintLoops)
  const northRotation = site?.northRotation ?? 0
  const frontEdge = resolveFrontEdge(lot, site?.frontEdge, northRotation)

  const empty: SitePlanDrawing = {
    primitives: [],
    warnings: [],
    bounds: footprintBounds ?? { minX: -15, minY: -15, maxX: 15, maxY: 15 },
    meta: {
      site,
      frontEdge,
      lot,
      envelope: [],
      envelopeFrontEdge: 0,
      sightTriangles: [],
      footprintLoops,
      footprintBounds,
      yards: [],
      buildingId: (building?.id as AnyNodeId) ?? null,
    },
  }
  if (lot.length < 3) return empty

  const primitives: FloorplanGeometry[] = []

  // ── Lot line — the heaviest line on the sheet ────────────────────────
  primitives.push({
    kind: 'polygon',
    points: lot,
    fill: 'none',
    stroke: INK,
    strokeWidth: LOT_STROKE_WIDTH,
    strokeLinejoin: 'miter',
    metadata: { sitePlan: 'lot-line' },
  })

  // ── Terrain contours — the ground's lines, at the site's interval ─────
  // (site.contourIntervalIn, default 12 in; 0 = none): thin brown lines,
  // every fifth heavier and labelled in feet above the survey datum when
  // the terrain sample carries one (USGS EPQS at the lot centre), else
  // above the site datum.
  {
    const intervalIn = typeof site?.contourIntervalIn === 'number' ? site.contourIntervalIn : 12
    const field = site && intervalIn > 0 ? terrainFieldOf(site as never) : null
    if (field) {
      const sample = (site?.metadata as { terrainSample?: { datumFt?: unknown } } | undefined)?.terrainSample
      const datumFt = typeof sample?.datumFt === 'number' ? sample.datumFt : null
      // the SURVEYED lines (the dossier's 3DEP set, NAVD88 feet) when the
      // site carries them and the interval is a whole number of their
      // own; the heightfield's contours otherwise
      const surveyed = site?.terrainContours
      const stepFt = intervalIn / 12
      const useSurveyed =
        surveyed !== undefined &&
        surveyed.lines.length > 0 &&
        Math.abs(stepFt / surveyed.intervalFt - Math.round(stepFt / surveyed.intervalFt)) < 1e-9
      const contours = useSurveyed
        ? surveyed.lines
            .filter((l) => Math.abs(l.elevationFt / stepFt - Math.round(l.elevationFt / stepFt)) < 1e-9)
            .map((l) => ({
              levelM: (l.elevationFt - (datumFt ?? 0)) * METRES_PER_FOOT,
              points: l.points.filter((p) => lot.length < 3 || pointInPolygon(lot, p[0], p[1])) as Pt[],
              index: Math.abs(l.elevationFt / (stepFt * 5) - Math.round(l.elevationFt / (stepFt * 5))) < 1e-9,
            }))
            .filter((c) => c.points.length >= 2)
        : terrainContours(field, intervalIn * 0.0254, lot)
      const lines: FloorplanGeometry[] = []
      for (const c of contours) {
        lines.push({
          kind: 'polyline',
          points: c.points,
          stroke: CONTOUR_INK,
          strokeWidth: c.index ? 0.045 : 0.02,
          opacity: c.index ? 0.85 : 0.6,
          fill: 'none',
          metadata: { sitePlan: 'contour', levelM: c.levelM },
        })
        if (c.index && c.points.length >= 2) {
          const mid = c.points[Math.floor(c.points.length / 2)] as Pt
          const ft = c.levelM / METRES_PER_FOOT + (datumFt ?? 0)
          lines.push({
            kind: 'text',
            x: mid[0],
            y: mid[1],
            text: `${ft.toFixed(datumFt !== null ? 0 : 1)}${datumFt !== null ? '' : ' ft'}`,
            fontSize: LABEL_SIZE * 0.45,
            fill: CONTOUR_INK,
            fontWeight: 500,
            textAnchor: 'middle',
            dominantBaseline: 'middle',
            upright: true,
          })
        }
      }
      if (lines.length > 0) primitives.push({ kind: 'group', children: lines })
    }
  }

  // ── Setback envelope — dashed, offset inward per edge ────────────────
  const streetEdges = (site?.streetEdges ?? []).filter((i) => Number.isFinite(i))
  const sightTriangleM = typeof site?.sightTriangleFt === 'number' && site.sightTriangleFt > 0 ? site.sightTriangleFt * METRES_PER_FOOT : 0
  const envelope = site?.setbacks ? setbackEnvelope(lot, site.setbacks, frontEdge, { streetEdges, sightTriangleM }) : []
  // the corner sight triangles (clear-vision at a street intersection):
  // dashed, labelled with the leg — the ordinance's figure, verify locally
  const sightTriangles: Pt[][] = []
  if (sightTriangleM > 0) {
    for (const [a, b] of streetCorners(lot, [frontEdge, ...streetEdges])) {
      const tri = sightTriangle(lot, a, b, sightTriangleM)
      if (!tri) continue
      const ring: Pt[] = [tri.corner, tri.a, tri.b]
      sightTriangles.push(ring)
      primitives.push({
        kind: 'polygon',
        points: ring,
        fill: 'none',
        stroke: INK_SOFT,
        strokeWidth: ENVELOPE_STROKE_WIDTH,
        strokeDasharray: '0.3 0.2',
        opacity: 0.75,
        metadata: { sitePlan: 'sight-triangle' },
      })
      const cx = (tri.corner[0] + tri.a[0] + tri.b[0]) / 3
      const cz = (tri.corner[1] + tri.a[1] + tri.b[1]) / 3
      primitives.push({
        kind: 'text',
        x: cx,
        y: cz,
        text: `SIGHT TRIANGLE ${site?.sightTriangleFt}' (VERIFY)`,
        fontSize: 0.6,
        fill: INK_SOFT,
        textAnchor: 'middle',
        metadata: { sitePlan: 'sight-triangle-label' },
      })
    }
  }
  if (envelope.length >= 3) {
    primitives.push({
      kind: 'polygon',
      points: envelope,
      fill: 'none',
      stroke: INK_SOFT,
      strokeWidth: ENVELOPE_STROKE_WIDTH,
      strokeDasharray: '0.9 0.45',
      opacity: 0.75,
      metadata: { sitePlan: 'setback-envelope' },
    })
  }

  // ── Building footprint — the OUTLINE of the level-0 walls ─────────────
  // A site plan shows the building's edge on the lot; the partitions inside
  // it are the floor plan's business, so the wall bands are unioned and only
  // the outer rings are kept.
  const outerRings = footprintOutline(footprintLoops)
  let footprintArea = 0
  for (const loop of outerRings) {
    footprintArea += Math.abs(polygonArea(loop))
    primitives.push({
      kind: 'polygon',
      points: loop,
      fill: FOOTPRINT_FILL,
      fillOpacity: 0.7,
      stroke: FOOTPRINT_STROKE,
      strokeWidth: 0.06,
      metadata: { sitePlan: 'building-footprint', buildingId: building?.id ?? null },
    })
  }

  // ── Yard dimensions — the house's own faces, square out to the lot line ──
  const yards = footprintLoops.length
    ? castYardDimensionsOriented(lot, footprintLoops, building?.rotation?.[1] ?? 0)
    : []
  for (const yard of yards) {
    const dx = yard.to[0] - yard.from[0]
    const dy = yard.to[1] - yard.from[1]
    const len = Math.hypot(dx, dy) || 1
    // Offset normal is perpendicular to the measured run; zero offset keeps
    // the dimension line on the yard itself, which is how site plans read.
    primitives.push({
      kind: 'dimension',
      start: yard.from,
      end: yard.to,
      offsetNormal: [-dy / len, dx / len],
      offsetDistance: 0,
      extensionOvershoot: 0.35,
      stroke: DIMENSION_STROKE,
      terminator: 'architectural-tick',
      text: formatFeetInches(yard.distance),
      metadata: { sitePlan: 'yard-dimension', side: yard.side },
    } as FloorplanGeometry)
  }

  const lotBounds = polygonBounds(lot)
  const warnings: string[] = []

  // ── Property lines: bearing and length along each edge, outside the lot ──
  for (let i = 0; i < lot.length; i++) {
    const p = lot[i] as Pt
    const q = lot[(i + 1) % lot.length] as Pt
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy)
    if (len < 0.5) continue
    const out = outwardNormal(lot, i)
    primitives.push(
      alongLabel(
        [(p[0] + q[0]) / 2 + out[0] * 0.55, (p[1] + q[1]) / 2 + out[1] * 0.55],
        Math.atan2(dy, dx),
        `${bearingOf(dx, dy, northRotation)}   ${(len / METRES_PER_FOOT).toFixed(2)}'`,
        LABEL_SIZE * 0.48,
        { fill: INK, fontWeight: 600 },
        { sitePlan: 'lot-edge-label', edge: i },
      ),
    )
  }

  // ── Setback labels, in each yard along its lot edge ───────────────────
  if (site?.setbacks && envelope.length >= 3) {
    const roles = classifyEdges(lot, frontEdge, streetEdges)
    const NAME = { front: 'FRONT', rear: 'REAR', street: 'STREET SIDE', left: 'SIDE', right: 'SIDE' } as const
    for (let i = 0; i < lot.length; i++) {
      const role = roles[i]
      if (!role) continue
      const s = setbackForRole(site.setbacks, role)
      if (!(s > 0)) continue
      const p = lot[i] as Pt
      const q = lot[(i + 1) % lot.length] as Pt
      const dx = q[0] - p[0]
      const dy = q[1] - p[1]
      if (Math.hypot(dx, dy) < 1) continue
      const out = outwardNormal(lot, i)
      // a third of the way along the edge, halfway into the yard — clear of
      // the yard dimension that stands square off the house
      primitives.push(
        alongLabel(
          [p[0] + dx * 0.32 - out[0] * (s / 2), p[1] + dy * 0.32 - out[1] * (s / 2)],
          Math.atan2(dy, dx),
          `${formatFeetInches(s)} ${NAME[role]} SETBACK`,
          Math.min(LABEL_SIZE * 0.4, s * 0.45),
          { fill: INK_SOFT },
          { sitePlan: 'setback-label', edge: i, role },
        ),
      )
    }
  }

  // ── The street, named beyond every street edge ───────────────────────
  const streetName = streetNameOf(site?.address?.street)
  if (streetName) {
    for (const i of new Set([frontEdge, ...streetEdges])) {
      const p = lot[i]
      const q = lot[(i + 1) % lot.length]
      if (!p || !q) continue
      const out = outwardNormal(lot, i)
      primitives.push(
        alongLabel(
          [(p[0] + q[0]) / 2 + out[0] * 2.2, (p[1] + q[1]) / 2 + out[1] * 2.2],
          Math.atan2(q[1] - p[1], q[0] - p[0]),
          streetName,
          LABEL_SIZE * 0.85,
          { fill: INK, fontWeight: 700 },
          { sitePlan: 'street-name', edge: i },
        ),
      )
    }
  }

  // ── The roof line, dashed over the footprint ─────────────────────────
  for (const ring of roofOutlineRings(scene, level, building)) {
    primitives.push({
      kind: 'polygon',
      points: ring,
      fill: 'none',
      stroke: INK_SOFT,
      strokeWidth: 0.035,
      strokeDasharray: '0.5 0.25',
      opacity: 0.9,
      metadata: { sitePlan: 'roof-outline' },
    })
  }

  // ── Porches, landings and their steps ────────────────────────────────
  let porchArea = 0
  for (const porch of porchRings(scene, level, building)) {
    porchArea += porch.area
    primitives.push({
      kind: 'polygon',
      points: porch.ring,
      fill: '#f3f4f6',
      fillOpacity: 0.95,
      stroke: FOOTPRINT_STROKE,
      strokeWidth: 0.03,
      metadata: { sitePlan: 'porch' },
    })
    const b = polygonBounds(porch.ring)
    primitives.push({
      kind: 'text',
      x: (b.minX + b.maxX) / 2,
      y: (b.minY + b.maxY) / 2,
      text: porch.label,
      fontSize: Math.min(LABEL_SIZE * 0.4, Math.max(0.2, (b.maxY - b.minY) * 0.35)),
      fill: INK,
      fontWeight: 600,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
      upright: true,
      metadata: { sitePlan: 'porch-label' },
    })
  }
  primitives.push(...stairTreads(scene, level, building))

  // ── The house, named on its footprint ────────────────────────────────
  if (footprintBounds && footprintArea > 0) {
    let storeys = 0
    for (const childId of building?.children ?? []) {
      const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
      if (child?.type === 'level' && (child as LevelNode).level >= 0) storeys++
    }
    const cx = (footprintBounds.minX + footprintBounds.maxX) / 2
    const cy = (footprintBounds.minY + footprintBounds.maxY) / 2
    const lines = [
      `${Math.max(1, storeys)}-STORY RESIDENCE`,
      `${Math.round(footprintArea / (METRES_PER_FOOT * METRES_PER_FOOT)).toLocaleString('en-US')} SF FOOTPRINT`,
    ]
    lines.forEach((text, i) => {
      primitives.push({
        kind: 'text',
        x: cx,
        y: cy + (i - (lines.length - 1) / 2) * LABEL_SIZE * 0.9,
        text,
        fontSize: LABEL_SIZE * 0.6,
        fill: INK,
        fontWeight: 700,
        textAnchor: 'middle',
        dominantBaseline: 'middle',
        upright: true,
        metadata: { sitePlan: 'building-label' },
      })
    })
  }

  if (site?.setbacksSource && /draft|verify|default/i.test(site.setbacksSource)) {
    warnings.push(`Setbacks: ${site.setbacksSource}`)
  }
  const paved = (level?.children ?? []).some((childId) => {
    const child = scene.nodes[childId as AnyNodeId] as (AnyNode & { name?: string }) | undefined
    return /driveway|walk|path/i.test(child?.name ?? '')
  })
  if (!paved) warnings.push('No driveway or walk in the model — the site plan draws none.')

  // ── North arrow, top-right of the lot ────────────────────────────────
  const arrowSize = Math.max(1.2, Math.min(2.2, (lotBounds.maxY - lotBounds.minY) * 0.07))
  primitives.push(
    northArrow(
      [lotBounds.maxX + arrowSize * 1.4, lotBounds.minY + arrowSize * 1.2],
      northRotation,
      arrowSize,
    ),
  )

  // ── Lot area / APN label under the lot ───────────────────────────────
  const areaSqFt =
    site?.parcel?.lotAreaSqFt ?? polygonArea(lot) / (METRES_PER_FOOT * METRES_PER_FOOT)
  const bits = [`LOT AREA ${Math.round(areaSqFt).toLocaleString('en-US')} SF`]
  const lotAreaM2 = Math.abs(polygonArea(lot))
  if (footprintArea > 0 && lotAreaM2 > 0) {
    const covered = footprintArea + porchArea
    bits.push(
      `LOT COVERAGE ${Math.round(covered / (METRES_PER_FOOT * METRES_PER_FOOT)).toLocaleString('en-US')} SF (${((covered / lotAreaM2) * 100).toFixed(1)}%)`,
    )
  }
  if (site?.parcel?.apn) bits.push(`APN ${site.parcel.apn}`)
  if (site?.zone) bits.push(`ZONE ${site.zone}`)
  primitives.push({
    kind: 'text',
    x: (lotBounds.minX + lotBounds.maxX) / 2,
    y: lotBounds.maxY + LABEL_SIZE * 1.6,
    text: bits.join('   ·   '),
    fontSize: LABEL_SIZE,
    fill: INK,
    fontWeight: 600,
    textAnchor: 'middle',
    dominantBaseline: 'hanging',
    upright: true,
    metadata: { sitePlan: 'lot-label' },
  })

  const combined = footprintBounds
    ? {
        minX: Math.min(lotBounds.minX, footprintBounds.minX),
        minY: Math.min(lotBounds.minY, footprintBounds.minY),
        maxX: Math.max(lotBounds.maxX, footprintBounds.maxX),
        maxY: Math.max(lotBounds.maxY, footprintBounds.maxY),
      }
    : lotBounds

  // Plugin kinds that live in site metres (utilities …) — see contributors.ts.
  primitives.push(...sitePlanContributions(scene))

  return {
    primitives,
    warnings,
    bounds: padBounds(combined, Math.max(2, arrowSize * 1.8)),
    meta: {
      site,
      frontEdge,
      lot,
      envelope,
      envelopeFrontEdge: envelope.length >= 3 ? envelopeFrontEdge(lot, frontEdge, envelope) : 0,
      sightTriangles,
      footprintLoops,
      footprintBounds,
      yards,
      buildingId: (building?.id as AnyNodeId) ?? null,
    },
  }
}

/**
 * Translation (site metres, `[dx, dz]`) that centres the building's footprint
 * on the lot centroid. `null` when there is nothing to move or the footprint
 * already sits inside the ring.
 */
export function buildingRecentreOffset(
  lot: readonly Pt[],
  footprintBounds: Bounds | null,
): [number, number] | null {
  if (lot.length < 3 || !footprintBounds) return null
  if (boundsInsidePolygon(lot, footprintBounds)) return null
  const lotB = polygonBounds(lot)
  const lotCx = (lotB.minX + lotB.maxX) / 2
  const lotCy = (lotB.minY + lotB.maxY) / 2
  const fpCx = (footprintBounds.minX + footprintBounds.maxX) / 2
  const fpCy = (footprintBounds.minY + footprintBounds.maxY) / 2
  return [lotCx - fpCx, lotCy - fpCy]
}
