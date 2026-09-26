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
  calculateLevelMiters,
  getWallPlanFootprint,
  type LevelNode,
  migrateSiteMetadata,
  type SceneSnapshot,
  type SiteNode,
  unionPolygons,
  type WallNode,
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
  for (const childId of level.children ?? []) {
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
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      ) {
        hit = !hit
      }
    }
    return hit
  }
  return rings.filter(
    (ring, i) =>
      !rings.some((other, j) => j !== i && ring[0] !== undefined && inside(ring[0], other)),
  )
}

/** A three.js Y rotation of a plan point: local (x, z) turned by `yaw`. */
export function turn(x: number, z: number, yaw: number): Pt {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [c * x + s * z, -s * x + c * z]
}

export function yawOf(rotation: unknown): number {
  if (typeof rotation === 'number') return rotation
  if (Array.isArray(rotation)) return Number(rotation[1] ?? 0) || 0
  return 0
}

/** Level-local plan (x, z) → site metres, through the building's placement (see `levelFootprintLoops`). */
export function siteFrame(building: BuildingNode | null): (x: number, z: number) => Pt {
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
