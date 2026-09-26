import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  envelopeFrontEdge,
  type FloorplanGeometry,
  type LevelNode,
  type SceneSnapshot,
  type SiteNode,
  sightTriangle,
  streetCorners,
  terrainFieldOf,
} from '@pascal-app/core'
import { sitePlanContributions } from './contributors'
import {
  computeSiteCoverage,
  formatCoveragePercent,
  formatSqFt,
  type SiteCoverage,
} from './coverage'
import {
  type Bounds,
  boundsInsidePolygon,
  castYardDimensionsOriented,
  classifyEdges,
  compassLabel,
  edgeHeadingDeg,
  edgeLength,
  formatFeetInches,
  METRES_PER_FOOT,
  outwardNormal,
  type Pt,
  polygonBounds,
  resolveFrontEdge,
  setbackEnvelope,
  setbackForRole,
  type YardDimension,
} from './geometry'
import {
  contourPrimitives,
  drainagePrimitives,
  flatworkPrimitives,
  floorTops,
  formatElevation,
  servicePrimitives,
  spotElevationPrimitives,
  streetEdgeNames,
} from './site-annotations'
import {
  findBuilding,
  findLowestLevel,
  findSite,
  footprintOutline,
  levelFootprintLoops,
  roofOutlineRings,
  siteFrame,
  yawOf,
} from './site-parts'

export { footprintOutline, levelFootprintLoops, roofOutlineRings }

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
    /** Building coverage and impervious area — the figures the lot label and the sheets print. */
    coverage?: SiteCoverage
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

/** The exterior steps as tread lines (three, a tread apart), site metres. */
function stairTreads(
  scene: SceneSnapshot,
  level: LevelNode | null,
  building: BuildingNode | null,
): FloorplanGeometry[] {
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
 * The setbacks line the site plan prints when the yards are not the zoning
 * code's own: worded for a plans examiner from the site's numbers — never the
 * internal source tag a lot drop-in stored (QA 2026-09-23 printed
 * "PlanCrafters SITE.DEFAULT_SETBACKS" on A1.0). A cited code prints nothing.
 */
export function setbacksWarning(
  site: Pick<SiteNode, 'setbacks' | 'setbacksSource'> | null,
): string | null {
  const source = site?.setbacksSource ?? ''
  const s = site?.setbacks
  if (!s || !/draft|verify|default|by hand/i.test(source)) return null
  const ft = (m: number) => `${Math.round((m / METRES_PER_FOOT) * 2) / 2} ft`
  const yards = `front ${ft(s.front)}, side ${ft(s.side)}, rear ${ft(s.rear)}`
  if (/by hand/i.test(source))
    return `Setbacks: set by hand (${yards}) — confirm with the zoning district.`
  if (/default/i.test(source))
    return `Setbacks: planning defaults (${yards}) — confirm with the zoning district.`
  return `Setbacks: ${source}`
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
  // the coverage figures and the outdoor parts, from the one shared reading
  // (coverage.ts) — the cover's PROJECT DATA prints the same numbers
  const coverage = computeSiteCoverage(scene)

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
  // (site.contourIntervalIn, default 12 in; 0 = none): thin brown lines at
  // whole elevations above the survey datum when the terrain sample carries
  // one (USGS EPQS at the lot centre, NAVD88), every fifth heavier, each
  // elevation labelled once or twice (site-annotations.ts).
  const field = site ? terrainFieldOf(site as never) : null
  const datumFt = (() => {
    const sample = (site?.metadata as { terrainSample?: { datumFt?: unknown } } | undefined)
      ?.terrainSample
    return typeof sample?.datumFt === 'number' ? sample.datumFt : null
  })()
  {
    const intervalIn = typeof site?.contourIntervalIn === 'number' ? site.contourIntervalIn : 12
    if (site && field && intervalIn > 0) {
      const lines = contourPrimitives({
        site,
        lot,
        field,
        intervalIn,
        datumFt,
        fontSize: LABEL_SIZE * 0.45,
        // no elevation printed on the house, a porch or the paving
        avoid: [...coverage.outline, ...coverage.parts.map((p) => p.ring)],
      })
      if (lines.length > 0) primitives.push({ kind: 'group', children: lines })
    }
  }

  // ── The driveway and walks, under the yards' labels and dimensions ────
  primitives.push(...flatworkPrimitives(scene, building, coverage.parts, LABEL_SIZE * 0.42))

  // ── Setback envelope — dashed, offset inward per edge ────────────────
  const streetEdges = (site?.streetEdges ?? []).filter((i) => Number.isFinite(i))
  const sightTriangleM =
    typeof site?.sightTriangleFt === 'number' && site.sightTriangleFt > 0
      ? site.sightTriangleFt * METRES_PER_FOOT
      : 0
  const envelope = site?.setbacks
    ? setbackEnvelope(lot, site.setbacks, frontEdge, { streetEdges, sightTriangleM })
    : []
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
  for (const loop of outerRings) {
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
    const NAME = {
      front: 'FRONT',
      rear: 'REAR',
      street: 'STREET SIDE',
      left: 'SIDE',
      right: 'SIDE',
    } as const
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

  // ── The streets, each named beyond the edge it runs along ─────────────
  // (only the edges that front a street; the name the lot drop-in stored
  // for that edge — site-annotations.ts `streetEdgeNames`)
  if (site) {
    for (const [i, name] of streetEdgeNames(site, frontEdge)) {
      const p = lot[i]
      const q = lot[(i + 1) % lot.length]
      if (!p || !q) continue
      const out = outwardNormal(lot, i)
      primitives.push(
        alongLabel(
          [(p[0] + q[0]) / 2 + out[0] * 2.2, (p[1] + q[1]) / 2 + out[1] * 2.2],
          Math.atan2(q[1] - p[1], q[0] - p[0]),
          name,
          LABEL_SIZE * (name.length > 24 ? 0.6 : 0.85),
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

  // ── Porches, patios, decks, landings and their steps ─────────────────
  for (const porch of coverage.parts) {
    if (porch.kind === 'driveway' || porch.kind === 'walk') continue
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
      text: porch.covered ? porch.label : `${porch.label} (OPEN)`,
      fontSize: Math.min(
        LABEL_SIZE * 0.4,
        Math.max(0.2, Math.min(b.maxY - b.minY, b.maxX - b.minX) * 0.3),
      ),
      fill: INK,
      fontWeight: 600,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
      upright: true,
      metadata: { sitePlan: 'porch-label' },
    })
  }
  primitives.push(...stairTreads(scene, level, building))

  // ── The utility services Bones placed, run schematically to the street ─
  const streetSide = [...new Set([frontEdge, ...streetEdges])]
  const services = servicePrimitives({
    scene,
    level,
    building,
    lot,
    streetEdges: streetSide,
    outline: outerRings,
    fontSize: LABEL_SIZE * 0.4,
  })
  primitives.push(...services.primitives)

  // ── Drainage: the grade falls away from every face of the house ──────
  primitives.push(
    ...drainagePrimitives(outerRings, LABEL_SIZE * 0.42, [
      ...coverage.parts.map((p) => p.ring),
      ...(services.pad ? [services.pad] : []),
    ]),
  )

  // ── Spot grades at the lot and house corners (the terrain's) ─────────
  if (field) {
    primitives.push(
      ...spotElevationPrimitives({
        field,
        datumFt,
        lot,
        outline: outerRings,
        fontSize: LABEL_SIZE * 0.34,
      }),
    )
  }

  // ── The house, named on its footprint, with its finish floor ─────────
  if (footprintBounds && coverage.buildingSqFt > 0) {
    let storeys = 0
    for (const childId of building?.children ?? []) {
      const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
      if (child?.type === 'level' && (child as LevelNode).level >= 0) storeys++
    }
    const cx = (footprintBounds.minX + footprintBounds.maxX) / 2
    const cy = (footprintBounds.minY + footprintBounds.maxY) / 2
    const lines = [
      `${Math.max(1, storeys)}-STORY RESIDENCE`,
      `${formatSqFt(coverage.buildingSqFt)} FOOTPRINT`,
    ]
    // the finish floor (and the garage pad) above the survey datum: the
    // building's datum plus the storey slab's top
    const tops = floorTops(scene, level)
    const base = (building?.position?.[1] ?? 0) + (level?.baseElevation ?? 0)
    if (tops.floor !== null) lines.push(`FF EL. ${formatElevation(base + tops.floor, datumFt)}`)
    if (tops.garage !== null)
      lines.push(`GARAGE SLAB EL. ${formatElevation(base + tops.garage, datumFt)}`)
    lines.forEach((text, i) => {
      primitives.push({
        kind: 'text',
        x: cx,
        y: cy + (i - (lines.length - 1) / 2) * LABEL_SIZE * 0.9,
        text,
        fontSize: LABEL_SIZE * (i < 2 ? 0.6 : 0.5),
        fill: INK,
        fontWeight: i < 2 ? 700 : 600,
        textAnchor: 'middle',
        dominantBaseline: 'middle',
        upright: true,
        metadata: { sitePlan: i < 2 ? 'building-label' : 'floor-elevation' },
      })
    })
  }

  const setbacksNote = setbacksWarning(site)
  if (setbacksNote) warnings.push(setbacksNote)
  if (!coverage.parts.some((p) => p.kind === 'driveway' || p.kind === 'walk'))
    warnings.push('No driveway or walk is drawn — none is shown on the site plan.')

  // ── North arrow, top-right of the lot ────────────────────────────────
  const arrowSize = Math.max(1.2, Math.min(2.2, (lotBounds.maxY - lotBounds.minY) * 0.07))
  primitives.push(
    northArrow(
      [lotBounds.maxX + arrowSize * 1.4, lotBounds.minY + arrowSize * 1.2],
      northRotation,
      arrowSize,
    ),
  )

  // ── Lot area / APN, and the coverage figures, under the lot ──────────
  const lotLine = [
    coverage.lotSqFt !== null ? `LOT AREA ${formatSqFt(coverage.lotSqFt)}` : '',
    site?.parcel?.apn ? `APN ${site.parcel.apn}` : '',
    site?.zone ? `ZONE ${site.zone}` : '',
  ].filter(Boolean)
  const coverageLine =
    coverage.buildingSqFt > 0
      ? [
          `BUILDING COVERAGE ${formatSqFt(coverage.buildingCoverageSqFt)} (${formatCoveragePercent(coverage.buildingCoverageRatio)})`,
          `IMPERVIOUS ${formatSqFt(coverage.imperviousSqFt)} (${formatCoveragePercent(coverage.imperviousRatio)})`,
        ]
      : []
  ;[lotLine, coverageLine].forEach((bits, i) => {
    if (bits.length === 0) return
    primitives.push({
      kind: 'text',
      x: (lotBounds.minX + lotBounds.maxX) / 2,
      y: lotBounds.maxY + LABEL_SIZE * (1.6 + i * 1.25),
      text: bits.join('   ·   '),
      fontSize: LABEL_SIZE * (i === 0 ? 1 : 0.85),
      fill: INK,
      fontWeight: 600,
      textAnchor: 'middle',
      dominantBaseline: 'hanging',
      upright: true,
      metadata: { sitePlan: i === 0 ? 'lot-label' : 'coverage-label' },
    })
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
      coverage,
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
