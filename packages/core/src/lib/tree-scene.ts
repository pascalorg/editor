import { queryNodes } from '../runtime/node-queries'
import type {
  AnyNode,
  AnyNodeId,
  BuildingNode,
  RoofNode,
  RoofSegmentNode,
  TreeNode,
} from '../schema'
import {
  getConicalRoofCoverage,
  getRoofSegmentVisibleTopBounds,
  normalizeRoofSegmentTrim,
} from '../schema/nodes/roof-segment'
import { footprintOutline, levelFootprintLoops } from './building-footprint'
import { groundLevelOf } from './ground-level'
import { type GroundRead, resolveGroundSlab, resolveSiteGround } from './ground-read'
import type { PlantingPoint } from './planting-outline'
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

function roofSegmentLocalToLevelXZ(
  roof: Pick<RoofNode, 'position' | 'rotation'>,
  segment: Pick<RoofSegmentNode, 'position' | 'rotation'>,
  x: number,
  z: number,
): PlantingPoint {
  const segCos = Math.cos(segment.rotation)
  const segSin = Math.sin(segment.rotation)
  const roofX = segment.position[0] + x * segCos + z * segSin
  const roofZ = segment.position[2] - x * segSin + z * segCos
  const roofCos = Math.cos(roof.rotation)
  const roofSin = Math.sin(roof.rotation)
  return [
    roof.position[0] + roofX * roofCos + roofZ * roofSin,
    roof.position[2] - roofX * roofSin + roofZ * roofCos,
  ]
}

function dedupePlanPolygon(points: readonly PlantingPoint[]): PlantingPoint[] {
  const deduped: PlantingPoint[] = []
  for (const point of points) {
    const prev = deduped[deduped.length - 1]
    if (!prev || Math.hypot(point[0] - prev[0], point[1] - prev[1]) > 1e-9) {
      deduped.push([point[0], point[1]])
    }
  }
  while (deduped.length > 1) {
    const first = deduped[0]
    const last = deduped[deduped.length - 1]
    if (!first || !last || Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-9) break
    deduped.pop()
  }
  return deduped.length < 3 ? [] : deduped
}

function roofSegmentLocalPlanPolygon(segment: RoofSegmentNode): PlantingPoint[] {
  const { minX, maxX, minZ, maxZ } = getRoofSegmentVisibleTopBounds(segment)
  if (segment.roofType === 'conical') {
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    const rx = (maxX - minX) / 2
    const rz = (maxZ - minZ) / 2
    if (rx <= 1e-9 || rz <= 1e-9) return []
    const { fullCircle, startAngle, sweepAngle } = getConicalRoofCoverage(segment)
    const steps = 24
    const points: PlantingPoint[] = fullCircle ? [] : [[cx, cz]]
    const lastStep = fullCircle ? steps - 1 : steps
    for (let i = 0; i <= lastStep; i += 1) {
      const angle = startAngle + (sweepAngle * i) / steps
      points.push([cx + Math.cos(angle) * rx, cz + Math.sin(angle) * rz])
    }
    return dedupePlanPolygon(points)
  }

  const trim = normalizeRoofSegmentTrim(segment)
  const clampX = (x: number) => Math.min(maxX, Math.max(minX, x))
  const clampZ = (z: number) => Math.min(maxZ, Math.max(minZ, z))
  const points: PlantingPoint[] = []

  if (trim.backLeftX > 0 && trim.backLeftZ > 0) {
    points.push([minX, clampZ(minZ + trim.backLeftZ)], [clampX(minX + trim.backLeftX), minZ])
  } else {
    points.push([minX, minZ])
  }

  if (trim.backRightX > 0 && trim.backRightZ > 0) {
    points.push([clampX(maxX - trim.backRightX), minZ], [maxX, clampZ(minZ + trim.backRightZ)])
  } else {
    points.push([maxX, minZ])
  }

  if (trim.frontRightX > 0 && trim.frontRightZ > 0) {
    points.push([maxX, clampZ(maxZ - trim.frontRightZ)], [clampX(maxX - trim.frontRightX), maxZ])
  } else {
    points.push([maxX, maxZ])
  }

  if (trim.frontLeftX > 0 && trim.frontLeftZ > 0) {
    points.push([clampX(minX + trim.frontLeftX), maxZ], [minX, clampZ(maxZ - trim.frontLeftZ)])
  } else {
    points.push([minX, maxZ])
  }

  return dedupePlanPolygon(points)
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
        const local = roofSegmentLocalPlanPolygon(segment)
        if (local.length < 3) return []
        return [
          local.map(([x, z]) => {
            const [px, pz] = roofSegmentLocalToLevelXZ(roof, segment, x, z)
            return levelLocalToWorldXZ(building, px, pz)
          }),
        ]
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
