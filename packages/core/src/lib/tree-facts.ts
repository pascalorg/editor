import type { AnyNode, TreeNode } from '../schema'
import { type PlantingPoint, plantingContains, plantingEdgeDistance } from './planting-outline'
import { defaultTreeSpread } from './tree-form'
import { readTreeSite, type TreeBuildingFootprint, type TreeSiteRead } from './tree-scene'

export type TreeFacts = {
  heightM: number
  spreadM: number
  crownCoverM2: number
  nearestBuildingDistanceM: number | null
  roofOverhangIds: string[]
  crossesLotLine: boolean
  trunkBuildingId: string | null
  groundY: number
}

function buildingDistance(shape: TreeBuildingFootprint, x: number, z: number): number {
  const distance = plantingEdgeDistance(shape.outer, x, z)
  if (distance <= 1e-9) return 0
  if (!plantingContains(shape.outer, x, z)) return distance
  const courtyard = shape.holes.find((hole) => plantingContains(hole, x, z))
  return courtyard ? plantingEdgeDistance(courtyard, x, z) : 0
}

function crownTouches(polygon: PlantingPoint[], x: number, z: number, radius: number): boolean {
  return plantingContains(polygon, x, z) || plantingEdgeDistance(polygon, x, z) < radius
}

export function treeFacts(
  node: TreeNode,
  nodes: Readonly<Record<string, AnyNode>>,
  site: TreeSiteRead = readTreeSite(node.parentId, nodes),
): TreeFacts {
  const [x, , z] = node.position
  const spreadM = node.spreadM ?? defaultTreeSpread(node.form, node.heightM)
  const radius = spreadM / 2
  let nearest = Infinity
  let trunkBuildingId: string | null = null
  for (const shape of site.buildings) {
    const distance = buildingDistance(shape, x, z)
    nearest = Math.min(nearest, distance)
    if (distance === 0) trunkBuildingId ??= shape.buildingId
  }
  return {
    heightM: node.heightM,
    spreadM,
    crownCoverM2: Math.PI * radius ** 2,
    nearestBuildingDistanceM: Number.isFinite(nearest) ? Math.round(nearest * 1000) / 1000 : null,
    roofOverhangIds: site.roofs
      .filter((roof) => roof.polygons.some((polygon) => crownTouches(polygon, x, z, radius)))
      .map((roof) => roof.roofId),
    crossesLotLine:
      site.lot.length >= 3 &&
      (!plantingContains(site.lot, x, z) || plantingEdgeDistance(site.lot, x, z) < radius),
    trunkBuildingId,
    groundY: site.ground.heightAt(x, z),
  }
}
