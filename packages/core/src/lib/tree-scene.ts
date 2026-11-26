import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, AnyNodeId, BuildingNode, TreeNode } from '../schema'
import { footprintOutline, levelFootprintLoops } from './building-footprint'
import { groundLevelOf } from './ground-level'
import { type GroundRead, resolveGroundSlab, resolveSiteGround } from './ground-read'
import type { PlantingPoint } from './planting-outline'
import { roofSegmentFrame } from './roof-frame'
import { buildRoofSegmentCoveringTriangles } from './roof-surface-geometry'
import { isSiteFlatwork } from './site-flatwork'
import { levelLocalToWorldXZ } from './terrain-support-query'

type Nodes = Readonly<Record<string, AnyNode>>
export type TreeBuildingFootprint = {
  buildingId: string
  outer: PlantingPoint[]
  holes: PlantingPoint[][]
}
export type TreeSiteRead = {
  ground: GroundRead
  lot: PlantingPoint[]
  buildings: TreeBuildingFootprint[]
  roofs: { roofId: string; polygons: PlantingPoint[][] }[]
}

export function resolveTreeGround(node: Pick<TreeNode, 'parentId'>, nodes: Nodes): GroundRead {
  return resolveSiteGround(node.parentId, nodes)
}

function buildingFootprints(nodes: Nodes, building: BuildingNode): TreeBuildingFootprint[] {
  const ground = groundLevelOf(nodes as Record<AnyNodeId, AnyNode>, building.id)?.level
  if (!ground) return []
  const toSite = ([x, z]: PlantingPoint) => levelLocalToWorldXZ(building, x, z)
  const floors = queryNodes(nodes, { type: 'slab', parentId: ground.id }).flatMap((slab) =>
    slab.type === 'slab' && !slab.recessed && !isSiteFlatwork(slab)
      ? [resolveGroundSlab(slab, nodes)]
      : [],
  )
  const courtyards = floors.flatMap((floor) => floor.holes.map((hole) => hole.map(toSite)))
  const walls = queryNodes(nodes, { type: 'wall', parentId: ground.id })
  const loops = levelFootprintLoops(
    nodes,
    {
      ...ground,
      children: walls.map((wall) => wall.id) as typeof ground.children,
    },
    building,
  )
  return [
    ...footprintOutline(loops).map((ring) => ({
      buildingId: building.id,
      outer: ring.map(([x, z]): PlantingPoint => [x, z]),
      holes: courtyards,
    })),
    ...loops.map((ring) => ({
      buildingId: building.id,
      outer: ring.map(([x, z]): PlantingPoint => [x, z]),
      holes: [],
    })),
    ...floors.map((floor) => ({
      buildingId: building.id,
      outer: floor.polygon.map(toSite),
      holes: floor.holes.map((hole) => hole.map(toSite)),
    })),
  ]
}

function roofFootprints(nodes: Nodes, siteId: string | null | undefined): TreeSiteRead['roofs'] {
  return queryNodes(nodes, { type: 'roof' }).flatMap((roof) => {
    if (roof.type !== 'roof') return []
    const level = roof.parentId ? nodes[roof.parentId] : undefined
    const building = level?.parentId ? nodes[level.parentId] : undefined
    if (level?.type !== 'level' || building?.type !== 'building' || building.parentId !== siteId)
      return []
    const polygons = queryNodes(nodes, { type: 'roof-segment', parentId: roof.id }).flatMap(
      (segment) => {
        if (segment.type !== 'roof-segment') return []
        const frame = roofSegmentFrame(roof, segment)
        return buildRoofSegmentCoveringTriangles(roof, segment, nodes).map(({ vertices }) =>
          vertices.map(([x, , z]) => {
            const point = frame.toPlan([x, z])
            return levelLocalToWorldXZ(building, point[0], point[1])
          }),
        )
      },
    )
    return [{ roofId: roof.id, polygons }]
  })
}

export function readTreeSite(siteId: string | null | undefined, nodes: Nodes): TreeSiteRead {
  const site = siteId ? nodes[siteId] : undefined
  const buildings =
    site?.type === 'site'
      ? queryNodes(nodes, { type: 'building', parentId: site.id }).flatMap((building) =>
          building.type === 'building' ? buildingFootprints(nodes, building) : [],
        )
      : []
  return {
    ground: resolveSiteGround(siteId, nodes),
    lot: site?.type === 'site' ? site.polygon.points : [],
    buildings,
    roofs: roofFootprints(nodes, siteId),
  }
}
