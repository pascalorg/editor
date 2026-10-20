/**
 * Where a building stands on its site: the building node's pose turns its levels' plan
 * coordinates into site metres, and its walls' bands, unioned, are the footprint the site plan
 * draws and the setbacks are measured to. Pure: no store.
 */
import type { AnyNode, BuildingNode, LevelNode, WallNode } from '../schema'
import { getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { calculateLevelMiters } from '../systems/wall/wall-mitering'
import { unionPolygons } from './polygon-union'

type Pt = readonly [number, number]
type Nodes = Readonly<Record<string, AnyNode>>

/** A three.js Y rotation of a plan point: local (x, z) turned by `yaw`. */
export function turnPlanPoint(x: number, z: number, yaw: number): Pt {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [c * x + s * z, -s * x + c * z]
}

export function yawOf(rotation: unknown): number {
  if (typeof rotation === 'number') return rotation
  if (Array.isArray(rotation)) return Number(rotation[1] ?? 0) || 0
  return 0
}

/**
 * Level-local plan (x, z) → site metres, through the building's placement: three.js Y rotation,
 * the convention BuildingRenderer applies, `site = position + (c·x + s·z, −s·x + c·z)`.
 */
export function siteFrame(
  building: Pick<BuildingNode, 'position' | 'rotation'> | null,
): (x: number, z: number) => Pt {
  const yaw = building?.rotation?.[1] ?? 0
  const ox = building?.position?.[0] ?? 0
  const oz = building?.position?.[2] ?? 0
  return (x, z) => {
    const [tx, tz] = turnPlanPoint(x, z, yaw)
    return [ox + tx, oz + tz]
  }
}

/** Site metres → the building's level-local plan (x, z): `siteFrame` inverted. */
export function levelFrame(
  building: Pick<BuildingNode, 'position' | 'rotation'> | null,
): (x: number, z: number) => Pt {
  const yaw = building?.rotation?.[1] ?? 0
  const ox = building?.position?.[0] ?? 0
  const oz = building?.position?.[2] ?? 0
  return (x, z) => turnPlanPoint(x - ox, z - oz, -yaw)
}

/**
 * Per-wall plan footprints for a level, mitred, then transformed by the building's site
 * placement (`siteFrame`); with no building, in the level's own coordinates. `only` keeps the
 * named walls, still mitred against every wall on the level.
 */
export function levelFootprintLoops(
  nodes: Nodes,
  level: LevelNode | null,
  building: BuildingNode | null,
  only?: ReadonlySet<string>,
): Pt[][] {
  if (!level) return []
  const walls: WallNode[] = []
  for (const childId of level.children ?? []) {
    const child = nodes[childId]
    if (child?.type === 'wall') walls.push(child)
  }
  if (walls.length === 0) return []

  const miters = calculateLevelMiters(walls)
  const toSite = siteFrame(building)
  const loops: Pt[][] = []
  for (const wall of walls) {
    if (only && !only.has(wall.id)) continue
    const poly = getWallPlanFootprint(wall, miters)
    if (poly.length < 3) continue
    loops.push(poly.map((p) => toSite(p.x, p.y)))
  }
  return loops
}

/**
 * The outer ring(s) of a set of wall bands: their union, minus any ring that
 * lies inside another (a room enclosed by partitions is a hole in the union,
 * not a second building). Falls back to the bands themselves when the union
 * yields nothing.
 */
export function footprintOutline(loops: readonly (readonly Pt[])[]): Pt[][] {
  const rings = unionPolygons(loops.map((loop) => loop.map((p) => [p[0], p[1]]))) as Pt[][]
  if (rings.length === 0) return loops.map((loop) => [...loop])
  const inside = (p: Pt, ring: readonly Pt[]): boolean => {
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
