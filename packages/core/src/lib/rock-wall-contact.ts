import type { AnyNode, AnyNodeId, BuildingNode, LevelNode, RockNode, WallNode } from '../schema'
import { getLevelElevations, getWallTop } from '../services/storey'
import { sampleWallCenterline } from '../systems/wall/wall-curve'
import { wallSupportForNodes } from './opening-floor-datum'
import { containsPoint, type MultiPolygon, type Ring, union } from './polygon-boolean'
import { rockForm, rockSections } from './rock-form-builder'
import type { RockSpan } from './rock-ground'
import { levelLocalToWorldXZ } from './terrain-support-query'

type Nodes = Readonly<Record<string, AnyNode>>
type Point = [number, number]

/** Where along a segment (0 to 1) it crosses the edges of the rings. */
function crossings(a: Point, b: Point, rings: readonly Ring[]): number[] {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
  const found: number[] = []
  for (const ring of rings)
    ring.forEach(([cx, cz], i) => {
      const [ex, ez] = ring[(i + 1) % ring.length] ?? [cx, cz]
      const [fx, fz] = [ex - cx, ez - cz]
      const denominator = dx * fz - dz * fx
      if (Math.abs(denominator) < 1e-12) return
      const t = ((cx - a[0]) * fz - (cz - a[1]) * fx) / denominator
      const u = ((cx - a[0]) * dz - (cz - a[1]) * dx) / denominator
      if (t > 0 && t < 1 && u >= 0 && u <= 1) found.push(t)
    })
  return found
}

/** How much of a segment stands inside a region: cut at every edge it crosses, each part tested. */
export function lengthInsideRegion(a: Point, b: Point, region: MultiPolygon): number {
  const rings = region.flatMap((polygon) => [polygon.outer, ...polygon.holes])
  const stops = [0, ...crossings(a, b, rings).sort((x, y) => x - y), 1]
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  return stops.slice(1).reduce((sum, stop, i) => {
    const start = stops[i] ?? 0
    const middle = (start + stop) / 2
    const point: Point = [a[0] + (b[0] - a[0]) * middle, a[1] + (b[1] - a[1]) * middle]
    return containsPoint(region, point) ? sum + (stop - start) * length : sum
  }, 0)
}

/**
 * Everything the rock occupies in plan between two heights: its sections at both heights, at every
 * ring between them and halfway between those, united. A rock narrows upward unevenly, so a wall
 * touches it wherever any height of the wall does.
 */
export function footprintBetween(
  rock: RockNode,
  { footY, topY }: RockSpan,
  low: number,
  high: number,
): MultiPolygon {
  // Project the actual near triangles clipped to the wall's vertical interval.
  // Sampling a few sections misses tilted shoulders and non-monotone joint lips.
  const mesh = rockForm.build({ ...rock, footY, topY }, 'near')
  if (!mesh || high < footY || low > topY || high < low) return []
  type Vertex = [number, number, number]
  const clip = (polygon: Vertex[], y: number, above: boolean): Vertex[] => {
    const result: Vertex[] = []
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!
      const insideA = above ? a[1] >= y : a[1] <= y
      const insideB = above ? b[1] >= y : b[1] <= y
      if (insideA) result.push(a)
      if (insideA !== insideB) {
        const t = (y - a[1]) / (b[1] - a[1])
        result.push([a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t])
      }
    })
    return result
  }
  const projections: Ring[] = []
  for (let i = 0; i < mesh.index.length; i += 3) {
    const triangle = [0, 1, 2].map((offset): Vertex => {
      const v = mesh.index[i + offset]! * 3
      return [mesh.position[v]!, mesh.position[v + 1]!, mesh.position[v + 2]!]
    })
    const clipped = clip(clip(triangle, low, true), high, false)
    if (clipped.length >= 3) projections.push(clipped.map(([x, , z]) => [x, z]))
  }
  // Clipping the closed shell also creates two horizontal caps. Without them the
  // projection would be an annulus and miss a wall wholly inside the rock's body.
  for (const y of [Math.max(low, footY), Math.min(high, topY)])
    projections.push(...rockSections(rock, (y - footY) / (topY - footY), { footY, topY }))
  return union(projections)
}

/** A wall's lowest and highest points in the Site's frame, from where it stands on its support. */
function wallVerticalSpan(wall: WallNode, level: LevelNode, building: BuildingNode, nodes: Nodes) {
  const levelBase =
    getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(level.id)?.baseY ?? 0
  const base = building.position[1] + levelBase
  const { elevation } = wallSupportForNodes(wall, nodes)
  // Preserve the source's lowest whole-wall top: a sloped top is linear along its chord.
  const top = Math.min(
    getWallTop(wall, level.id, nodes as Record<AnyNodeId, AnyNode>, elevation, 0),
    getWallTop(wall, level.id, nodes as Record<AnyNodeId, AnyNode>, elevation, 1),
  )
  return { bottom: base + elevation, top: base + top }
}

export type WallContact = {
  wallId: string
  insideLengthM: number
  wallType: 'standard' | 'curtain' | 'railing'
}

/**
 * The walls of a level the rock meets: where the wall stands on its support, over the heights it
 * and the rock share, and how long a part of its centreline is inside what the rock occupies there.
 */
export function wallContacts(
  rock: RockNode,
  span: RockSpan,
  building: BuildingNode,
  level: LevelNode,
  nodes: Nodes,
  walls: readonly WallNode[],
): WallContact[] {
  // Walls of a storey mostly share their heights: unite the rock's sections once for each.
  const regions = new Map<string, MultiPolygon>()
  const regionBetween = (low: number, high: number) => {
    const key = `${low.toFixed(3)}:${high.toFixed(3)}`
    const known = regions.get(key)
    if (known) return known
    const region = footprintBetween(rock, span, low, high)
    regions.set(key, region)
    return region
  }
  return walls.flatMap((wall) => {
    const { bottom, top } = wallVerticalSpan(wall, level, building, nodes)
    const [low, high] = [Math.max(bottom, span.footY), Math.min(top, span.topY)]
    if (!(high > low)) return []
    const region = regionBetween(low, high)
    const points = sampleWallCenterline(wall).map(({ x, y }) => levelLocalToWorldXZ(building, x, y))
    const inside = points
      .slice(1)
      .reduce((sum, end, i) => sum + lengthInsideRegion(points[i] ?? end, end, region), 0)
    return inside > 0.05
      ? [{ wallId: wall.id, insideLengthM: inside, wallType: wall.wallType ?? 'standard' }]
      : []
  })
}
