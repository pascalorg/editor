import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, AnyNodeId } from '../schema'
import type { LawnNode } from '../schema/nodes/lawn'
import { footprintOutline, levelFootprintLoops } from './building-footprint'
import { groundLevelOf } from './ground-level'
import { resolveGroundSlab } from './ground-read'
import { plantingAreaOutline, plantingOrganicOutline } from './planting-outline'
import {
  area,
  difference,
  intersection,
  type MultiPolygon,
  type Polygon,
  union,
} from './polygon-boolean'
import { isSiteFlatwork } from './site-flatwork'
import { levelLocalToWorldXZ } from './terrain-support-query'

export type LawnExclusion = {
  id: string
  category: 'property' | 'building' | 'paving' | 'planting'
  areaM2: number
}
type Obstacle = { id: string; category: LawnExclusion['category']; polygons: MultiPolygon }
type Nodes = Readonly<Record<string, AnyNode>>

function buildingObstacles(siteId: string, nodes: Nodes): Obstacle[] {
  const obstacles: Obstacle[] = []
  for (const building of queryNodes(nodes, { type: 'building', parentId: siteId })) {
    if (building.type !== 'building') continue
    const ground = groundLevelOf(nodes as Record<AnyNodeId, AnyNode>, building.id)?.level
    if (!ground) continue
    const walls = queryNodes(nodes, { type: 'wall', parentId: ground.id })
    const loops = levelFootprintLoops(
      nodes,
      { ...ground, children: walls.map((wall) => wall.id) as typeof ground.children },
      building,
    )
    const slabs = queryNodes(nodes, { type: 'slab', parentId: ground.id })
    const courtyards = slabs.flatMap((slab) =>
      slab.type === 'slab' && !slab.recessed && !isSiteFlatwork(slab)
        ? resolveGroundSlab(slab, nodes).holes.map((hole) =>
            hole.map(([x, z]) => levelLocalToWorldXZ(building, x, z)),
          )
        : [],
    )
    const shells: Polygon[] = footprintOutline(loops).map((ring) => ({
      outer: ring.map(([x, z]) => [x, z]),
      holes: courtyards,
    }))
    const bands: Polygon[] = loops.map((ring) => ({
      outer: ring.map(([x, z]) => [x, z]),
      holes: [],
    }))
    obstacles.push({
      id: building.id,
      category: 'building',
      polygons: union([...shells, ...bands]),
    })
    for (const slab of slabs) {
      if (slab.type !== 'slab' || slab.polygon.length < 3) continue
      const paving = ['walk', 'path', 'driveway', 'patio'].includes(String(slab.metadata?.flatwork))
      if (!paving && isSiteFlatwork(slab)) continue
      const surface = resolveGroundSlab(slab, nodes)
      const toSite = ([x, z]: [number, number]) => levelLocalToWorldXZ(building, x, z)
      obstacles.push({
        id: paving ? slab.id : building.id,
        category: paving ? 'paving' : 'building',
        polygons: [
          {
            outer: surface.polygon.map(toSite),
            holes: surface.holes.map((hole) => hole.map(toSite)),
          },
        ],
      })
    }
  }
  return obstacles
}

function siteObstacles(siteId: string, nodes: Nodes): Obstacle[] {
  const obstacles = buildingObstacles(siteId, nodes)
  for (const node of queryNodes(nodes, { parentId: siteId }).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (node.type === 'slab' && node.polygon.length >= 3 && node.metadata?.flatwork !== 'lawn') {
      const slab = resolveGroundSlab(node, nodes)
      obstacles.push({
        id: node.id,
        category: 'paving',
        polygons: [{ outer: slab.polygon, holes: slab.holes }],
      })
    }
    if (node.type === 'planting') {
      const outline = plantingOrganicOutline(
        node.outline ?? plantingAreaOutline(node.area ?? 0, node.center),
        node.seed,
      )
      obstacles.push({
        id: node.id,
        category: 'planting',
        polygons: [{ outer: outline, holes: [] }],
      })
    }
  }
  return obstacles
}

export function retainedLawn(node: LawnNode, nodes: Nodes) {
  const requested = union([node.outline])
  const site = node.parentId ? nodes[node.parentId] : undefined
  const insideProperty =
    site?.type === 'site' && site.polygon.points.length >= 3
      ? intersection(requested, site.polygon.points)
      : requested
  const obstacles = node.parentId ? siteObstacles(node.parentId, nodes) : []
  const grouped = new Map<string, Obstacle>()
  for (const obstacle of obstacles) {
    const key = `${obstacle.category}:${obstacle.id}`
    const previous = grouped.get(key)
    grouped.set(
      key,
      previous
        ? { ...obstacle, polygons: union([previous.polygons, obstacle.polygons]) }
        : obstacle,
    )
  }
  const exclusions: LawnExclusion[] = []
  const propertyLoss = area(requested) - area(insideProperty)
  if (propertyLoss > 1e-6 && site)
    exclusions.push({ id: site.id, category: 'property', areaM2: propertyLoss })
  for (const obstacle of grouped.values()) {
    const areaM2 = area(intersection(insideProperty, obstacle.polygons))
    if (areaM2 > 1e-6) exclusions.push({ id: obstacle.id, category: obstacle.category, areaM2 })
  }
  const occupied = union([...grouped.values()].map((obstacle) => obstacle.polygons))
  const polygons = difference(insideProperty, occupied, { throwOnError: true })
  return { polygons, exclusions, requestedAreaM2: area(requested), retainedAreaM2: area(polygons) }
}
