import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, AnyNodeId, PlantingNode } from '../schema'
import { footprintOutline, levelFootprintLoops } from './building-footprint'
import { groundLevelOf } from './ground-level'
import {
  type GroundRead,
  resolveGroundSlab,
  resolveSiteGround,
  SITE_GROUND_DEPENDENCY_TYPES,
} from './ground-read'
import { type PlantingPoint, plantingContains, plantingEdgeDistance } from './planting-outline'
import type { PlantingAccept } from './planting-scatter'
import { isSiteFlatwork } from './site-flatwork'
import { levelLocalToWorldXZ } from './terrain-support-query'

type Nodes = Readonly<Record<string, AnyNode>>
type Bed = Pick<PlantingNode, 'parentId'>
type Obstacle = { outer: PlantingPoint[]; holes: PlantingPoint[][] }

/** Scene kinds that can change the scatter or its ground; shared with node invalidation. */
export const PLANTING_SCENE_DEPENDENCY_TYPES = SITE_GROUND_DEPENDENCY_TYPES

/** Headless facts and rendered plants share persisted Site ground and slab support. */
export function resolvePlantingGround(node: Bed, nodes: Nodes): GroundRead {
  return resolveSiteGround(node.parentId, nodes)
}

function obstaclesOf(node: Bed, nodes: Nodes): Obstacle[] {
  if (!node.parentId) return []
  const obstacles: Obstacle[] = []
  for (const building of queryNodes(nodes, { type: 'building', parentId: node.parentId })) {
    if (building.type !== 'building') continue
    const levels = queryNodes(nodes, { type: 'level', parentId: building.id })
      .filter((level) => level.type === 'level')
      .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))
    const ground = groundLevelOf(nodes as Record<AnyNodeId, AnyNode>, building.id)?.level
    if (ground) {
      const walls = queryNodes(nodes, { type: 'wall', parentId: ground.id })
      const loops = levelFootprintLoops(
        nodes,
        {
          ...ground,
          children: walls.map((wall) => wall.id) as typeof ground.children,
        },
        building,
      )
      const courtyards = queryNodes(nodes, { type: 'slab', parentId: ground.id }).flatMap((slab) =>
        slab.type === 'slab' && slab.polygon.length >= 3 && !slab.recessed && !isSiteFlatwork(slab)
          ? resolveGroundSlab(slab, nodes).holes.map((hole) =>
              hole.map(([x, z]) => levelLocalToWorldXZ(building, x, z)),
            )
          : [],
      )
      // Every shell keeps its enclosed interior, whether or not another shell has a floor.
      // Stored and hosted-cutter floor openings preserve courtyards; wall bands remain obstacles.
      for (const ring of footprintOutline(loops)) {
        obstacles.push({ outer: ring.map(([x, z]) => [x, z]), holes: courtyards })
      }
      for (const ring of loops) {
        obstacles.push({ outer: ring.map(([x, z]) => [x, z]), holes: [] })
      }
    }
    for (const level of levels) {
      for (const slab of queryNodes(nodes, { type: 'slab', parentId: level.id })) {
        if (slab.type !== 'slab' || slab.polygon.length < 3) continue
        // add_site_surface persists paths as slabs with flatwork='walk'; lawns stay plantable.
        const paving = ['walk', 'path', 'driveway', 'patio'].includes(
          String(slab.metadata?.flatwork),
        )
        if (level.id !== ground?.id) continue
        if (!paving && isSiteFlatwork(slab)) continue
        const surface = resolveGroundSlab(slab, nodes)
        const toSite = ([x, z]: PlantingPoint) => levelLocalToWorldXZ(building, x, z)
        obstacles.push({
          outer: surface.polygon.map(toSite),
          holes: surface.holes.map((hole) => hole.map(toSite)),
        })
      }
    }
  }
  // A directly Site-owned paving slab already uses Site coordinates.
  for (const slab of queryNodes(nodes, { type: 'slab', parentId: node.parentId })) {
    if (slab.type === 'slab' && slab.polygon.length >= 3 && slab.metadata?.flatwork !== 'lawn') {
      const surface = resolveGroundSlab(slab, nodes)
      obstacles.push({ outer: surface.polygon, holes: surface.holes })
    }
  }
  return obstacles
}

function touchesObstacle(obstacle: Obstacle, x: number, z: number, radius: number): boolean {
  if (plantingEdgeDistance(obstacle.outer, x, z) <= radius) return true
  if (!plantingContains(obstacle.outer, x, z)) return false
  // A disk wholly within a courtyard/cutout is not on the solid slab.
  return !obstacle.holes.some(
    (hole) => plantingContains(hole, x, z) && plantingEdgeDistance(hole, x, z) > radius,
  )
}

/**
 * Shared by rendered geometry, plan symbols and headless facts. `radius` is the mature crown
 * clearance supplied by the scatter, not merely its Poisson spacing radius. Polygon edges are
 * checked analytically: a narrow path cannot hide between probes.
 * Pass live ground for rendering; omission reads the same persisted ground as the operation.
 */
export function resolvePlantingAccept(
  node: Pick<PlantingNode, 'parentId' | 'plants'>,
  nodes: Nodes,
  ground: GroundRead = resolvePlantingGround(node, nodes),
): PlantingAccept {
  const obstacles = obstaclesOf(node, nodes)
  return (x, z, radius) => {
    if (![x, z, radius].every(Number.isFinite) || radius < 0) return false
    if (obstacles.some((obstacle) => touchesObstacle(obstacle, x, z, radius))) return false
    if (ground.regionAt) {
      const home = ground.regionAt(x, z)
      for (let side = 0; side < 8; side++) {
        const angle = (side * Math.PI) / 4
        if (ground.regionAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius) !== home)
          return false
      }
    }
    return true
  }
}
