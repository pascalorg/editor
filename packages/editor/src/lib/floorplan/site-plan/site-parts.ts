/**
 * What the site plan reads off the scene — the site, the building on it, its
 * storeys, the walls' outline, the roof's outline and the outdoor slabs
 * (porches, decks, patios, and the flatwork: driveway and walks) — in SITE
 * metres. Shared by the drawing (`build-site-plan-drawing.ts`) and the
 * coverage / impervious-area figures (`coverage.ts`) so both read the same
 * parts. Pure: no store.
 */
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  getRoofSegmentDeckReach,
  type LevelNode,
  migrateSiteMetadata,
  type RoofSegmentNode,
  type SceneSnapshot,
  type SiteNode,
  siteFrame,
  turnPlanPoint,
  unionPolygons,
  yawOf,
} from '@pascal-app/core'
import { type Pt, pointInPolygon, polygonArea, polygonBounds } from './geometry'

/**
 * The scene's site node, with legacy `metadata.setbacks / zone / apn` lifted
 * onto the real fields. This is a READ-side lift only — nothing is written
 * back to the store, so a scene that was never re-saved keeps its metadata.
 * A persistence-side migration would belong in
 * `packages/core/src/utils/scene-migrations.ts` (not owned by this
 * workstream); see the note in `migrateSiteMetadata`.
 */
export function findSite(scene: SceneSnapshot): SiteNode | null {
  for (const node of Object.values(scene.nodes)) {
    if (node.type !== 'site') continue
    const site = node as SiteNode
    const patch = migrateSiteMetadata(site)
    return Object.keys(patch).length > 0 ? { ...site, ...patch } : site
  }
  return null
}

export function findBuilding(scene: SceneSnapshot, site: SiteNode | null): BuildingNode | null {
  if (site) {
    for (const childId of site.children ?? []) {
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
export function findLowestLevel(
  scene: SceneSnapshot,
  building: BuildingNode | null,
): LevelNode | null {
  if (!building) return null
  let best: LevelNode | null = null
  for (const childId of building.children ?? []) {
    const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
    if (child?.type !== 'level') continue
    const level = child as LevelNode
    if (!best || level.level < best.level) best = level
  }
  return best
}

/**
 * The roof's outline on the lot — every roof segment's plan rectangle out to
 * its deck's reach at its eaves and rakes, through the segment's, the roof's
 * and the building's turns, unioned into the outer ring(s). Dashed on the site plan: what the eye sees
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
  for (const childId of level.children ?? []) {
    const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
    if (child?.type === 'roof')
      roofs.set(String(child.id), child as { position?: number[]; rotation?: unknown })
  }
  if (roofs.size === 0) return []
  const rects: Pt[][] = []
  for (const node of Object.values(scene.nodes)) {
    if (node.type !== 'roof-segment') continue
    const roof = roofs.get(String((node as { parentId?: unknown }).parentId))
    if (!roof) continue
    const seg = node as RoofSegmentNode
    const reach = getRoofSegmentDeckReach(seg)
    const w = (seg.width ?? 0) / 2 + reach.x
    const d = (seg.depth ?? 0) / 2 + reach.z
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
        const [ax, az] = turnPlanPoint(lx, lz, segYaw)
        const [bx, bz] = turnPlanPoint(ax + sx, az + sz, roofYaw)
        return toSite(bx + rx, bz + rz)
      }),
    )
  }
  if (rects.length === 0) return []
  const rings = unionPolygons(rects.map((r) => r.map((p) => [p[0], p[1]]))) as Pt[][]
  return rings.length > 0 ? rings : rects
}

/** Every storey of the building at or above grade (level ≥ 0), lowest first. */
export function aboveGradeLevels(scene: SceneSnapshot, building: BuildingNode | null): LevelNode[] {
  if (!building) return []
  const out: LevelNode[] = []
  for (const childId of building.children ?? []) {
    const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
    if (child?.type === 'level' && (child as LevelNode).level >= 0) out.push(child as LevelNode)
  }
  return out.sort((a, b) => a.level - b.level)
}

/* ------------------------------------------------------ outdoor slabs */

/** What an outdoor slab is on the site plan and in the impervious table. */
export type OutdoorKind = 'porch' | 'deck' | 'patio' | 'landing' | 'driveway' | 'walk'

export interface OutdoorPart {
  id: string
  kind: OutdoorKind
  /** Upper-case label for the plan ("PORCH", "REAR DECK", "DRIVEWAY"). */
  label: string
  ring: Pt[]
  /** Plan area, m². */
  area: number
  /** Under a roof (≥ half its area inside a roof outline): building coverage, not open paving. */
  covered: boolean
  /** Wood decking (a deck): open boards over grade. */
  wood: boolean
}

/**
 * Flatwork: a slab that is site paving, not part of the building — the
 * generator's driveway and walks (`metadata.flatwork`), and a hand-drawn slab
 * named like one (the floor plans leave the same slabs out).
 */
const HARDSCAPE =
  /driveway|drive\s*way|\bdrive\b|approach|walkway|sidewalk|\bwalk\b|\bpath\b|apron|parking|\bpavers?\b/i
export function flatworkKindOf(node: {
  type?: string
  name?: unknown
  metadata?: unknown
}): 'driveway' | 'walk' | null {
  if (node.type !== 'slab') return null
  const meta = (node.metadata ?? {}) as { flatwork?: unknown; floor?: unknown }
  if (meta.flatwork === 'driveway' || meta.flatwork === 'walk') return meta.flatwork
  const name = typeof node.name === 'string' ? node.name : ''
  const floor = typeof meta.floor === 'string' ? meta.floor : ''
  const text = `${name} ${floor}`
  if (!HARDSCAPE.test(text)) return null
  return /drive|approach|apron|parking/i.test(text) ? 'driveway' : 'walk'
}

/** The house's own floors: the storey slab, a raised platform, the garage pad, an upper floor. */
const HOUSE_FLOORS = new Set(['slab-on-grade', 'platform', 'garage-slab-at-grade', 'floor'])

/** Share of `ring`'s area inside any of `covers` (a 6 × 6 sample grid). */
function coveredShare(ring: readonly Pt[], covers: readonly Pt[][]): number {
  if (covers.length === 0) return 0
  const b = polygonBounds(ring)
  let inside = 0
  let under = 0
  const N = 6
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = b.minX + ((i + 0.5) / N) * (b.maxX - b.minX)
      const y = b.minY + ((j + 0.5) / N) * (b.maxY - b.minY)
      if (!pointInPolygon(ring, x, y)) continue
      inside++
      if (covers.some((c) => pointInPolygon(c, x, y))) under++
    }
  }
  return inside > 0 ? under / inside : 0
}

/**
 * The level's outdoor slabs in site metres: porches, decks, patios and
 * landings (a generator `metadata.porch`, or a deck / porch-slab floor, or a
 * slab lying outside the house's walls) and the flatwork. The house's own
 * floors (the storey slab, a raised platform, the garage pad) and a porch
 * cover's beam are not outdoor parts. `roofs` decides which are covered.
 */
export function outdoorParts(
  scene: SceneSnapshot,
  level: LevelNode | null,
  building: BuildingNode | null,
  walls: readonly Pt[][],
  roofs: readonly Pt[][],
): OutdoorPart[] {
  if (!level) return []
  const toSite = siteFrame(building)
  const out: OutdoorPart[] = []
  for (const childId of level.children ?? []) {
    const child = scene.nodes[childId as AnyNodeId] as AnyNode | undefined
    if (child?.type !== 'slab' || child.visible === false) continue
    const slab = child as unknown as {
      id: string
      polygon?: number[][]
      metadata?: Record<string, unknown>
      name?: string
    }
    const poly = slab.polygon ?? []
    if (poly.length < 3) continue
    const ring = poly.map((p) => toSite(p[0] ?? 0, p[1] ?? 0))
    const area = polygonArea(ring)
    const meta = slab.metadata ?? {}
    const floor = typeof meta.floor === 'string' ? meta.floor : ''
    const flat = flatworkKindOf(child as never)
    if (flat) {
      out.push({
        id: slab.id,
        kind: flat,
        label: flat === 'driveway' ? 'DRIVEWAY' : 'WALK',
        ring,
        area,
        covered: false,
        wood: false,
      })
      continue
    }
    // a porch cover's beam box is not a floor
    if (/beam/i.test(floor) || /beam/i.test(slab.name ?? '')) continue
    const porch = meta.porch as { policy?: string; entrance?: string } | undefined
    const outdoorFloor = floor === 'deck' || floor === 'porch-slab'
    if (!porch && !outdoorFloor) {
      // a hand-drawn slab: the house's floor when it lies under the walls
      if (HOUSE_FLOORS.has(floor)) continue
      const c = ring.reduce<[number, number]>(
        (s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length],
        [0, 0],
      )
      if (walls.length === 0 || walls.some((w) => pointInPolygon(w, c[0], c[1]))) continue
    }
    const wood = floor === 'deck'
    const policy = porch?.policy ?? ''
    const kind: OutdoorKind =
      policy === 'deck' || (wood && policy !== 'full' && policy !== 'entry')
        ? 'deck'
        : policy === 'landing'
          ? 'landing'
          : policy === 'patio'
            ? 'patio'
            : 'porch'
    const label =
      porch?.policy === 'entry'
        ? 'PORCH'
        : porch?.policy === 'landing'
          ? 'LANDING'
          : (slab.name ?? kind).toUpperCase()
    out.push({
      id: slab.id,
      kind,
      label,
      ring,
      area,
      covered: coveredShare(ring, roofs) >= 0.5,
      wood,
    })
  }
  return out
}
