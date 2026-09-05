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
  unionPolygons,
  type WallNode,
} from '@pascal-app/core'
import {
  type Bounds,
  boundsInsidePolygon,
  castYardDimensions,
  compassLabel,
  edgeHeadingDeg,
  edgeLength,
  formatFeetInches,
  METRES_PER_FOOT,
  polygonArea,
  polygonBounds,
  type Pt,
  resolveFrontEdge,
  setbackEnvelope,
  type YardDimension,
} from './geometry'
import { sitePlanContributions } from './contributors'

/** Contract shared by every drawing producer (see docs/construction-documents.md). */
export interface SitePlanDrawing {
  primitives: FloorplanGeometry[]
  bounds: Bounds
  /** Live values the panel / sheets reuse without re-deriving them. */
  meta: {
    site: SiteNode | null
    frontEdge: number
    lot: Pt[]
    envelope: Pt[]
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
const FOOTPRINT_FILL = '#374151'
const FOOTPRINT_STROKE = '#1f2937'
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
    bounds: footprintBounds ?? { minX: -15, minY: -15, maxX: 15, maxY: 15 },
    meta: {
      site,
      frontEdge,
      lot,
      envelope: [],
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

  // ── Setback envelope — dashed, offset inward per edge ────────────────
  const envelope = site?.setbacks ? setbackEnvelope(lot, site.setbacks, frontEdge) : []
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
  for (const loop of footprintOutline(footprintLoops)) {
    primitives.push({
      kind: 'polygon',
      points: loop,
      fill: FOOTPRINT_FILL,
      fillOpacity: 0.9,
      stroke: FOOTPRINT_STROKE,
      strokeWidth: 0.03,
      metadata: { sitePlan: 'building-footprint', buildingId: building?.id ?? null },
    })
  }

  // ── Yard dimensions — bbox edge midpoints out to the lot line ────────
  const yards = footprintBounds ? castYardDimensions(lot, footprintBounds) : []
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
    bounds: padBounds(combined, Math.max(2, arrowSize * 1.8)),
    meta: {
      site,
      frontEdge,
      lot,
      envelope,
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
