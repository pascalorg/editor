import type { BuildingNode, LevelNode, SlabNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { getLevelElevations } from '../services/storey'
import { polygonArea } from './polygon-relations'

export type SiteZoningReading = {
  footprintArea: number
  totalFloorArea: number
  maxHeight: number
  maxFloors: number
}

export function readSiteZoning(nodes: Record<AnyNodeId, AnyNode>): SiteZoningReading {
  let footprintArea = 0
  let totalFloorArea = 0
  let maxHeight = 0
  let maxFloors = 0

  const elevations = getLevelElevations(nodes)
  const buildings = Object.values(nodes).filter((n): n is BuildingNode => n?.type === 'building')

  for (const building of buildings) {
    const levelIds = building.children.filter((id) => nodes[id]?.type === 'level')
    if (levelIds.length === 0) continue

    const levels = levelIds.map((id) => nodes[id] as LevelNode).sort((a, b) => a.level - b.level)

    // Floors count is the number of levels
    maxFloors = Math.max(maxFloors, levels.length)

    // Height calculation
    let buildingMinY = Number.POSITIVE_INFINITY
    let buildingMaxY = Number.NEGATIVE_INFINITY
    for (const level of levels) {
      const elevation = elevations.get(level.id)
      if (elevation) {
        buildingMinY = Math.min(buildingMinY, elevation.baseY)
        buildingMaxY = Math.max(buildingMaxY, elevation.baseY + elevation.height)
      }
    }
    if (buildingMaxY > buildingMinY) {
      maxHeight = Math.max(maxHeight, buildingMaxY - buildingMinY)
    }

    // Areas
    if (levels[0]) {
      // Footprint = sum of slabs on the lowest level
      const lowestLevelId = levels[0].id
      for (const node of Object.values(nodes)) {
        if (node?.type === 'slab' && node.parentId === lowestLevelId) {
          const slab = node as SlabNode
          footprintArea += polygonArea(slab.polygon)
        }
      }
    }

    // Total floor area = sum of all slabs in the building
    for (const level of levels) {
      for (const node of Object.values(nodes)) {
        if (node?.type === 'slab' && node.parentId === level.id) {
          const slab = node as SlabNode
          totalFloorArea += polygonArea(slab.polygon)
        }
      }
    }
  }

  // Also include levels not assigned to any building
  const floatingLevels = Object.values(nodes).filter(
    (n): n is LevelNode =>
      n?.type === 'level' && !n.parentId && !buildings.some((b) => b.children.includes(n.id)),
  )
  if (floatingLevels.length > 0) {
    maxFloors = Math.max(maxFloors, floatingLevels.length)
    let floatingMinY = Number.POSITIVE_INFINITY
    let floatingMaxY = Number.NEGATIVE_INFINITY
    for (const level of floatingLevels) {
      const elevation = elevations.get(level.id)
      if (elevation) {
        floatingMinY = Math.min(floatingMinY, elevation.baseY)
        floatingMaxY = Math.max(floatingMaxY, elevation.baseY + elevation.height)
      }
    }
    if (floatingMaxY > floatingMinY) {
      maxHeight = Math.max(maxHeight, floatingMaxY - floatingMinY)
    }

    // Sort to find lowest
    floatingLevels.sort((a, b) => a.level - b.level)
    if (floatingLevels[0]) {
      const lowestLevelId = floatingLevels[0].id
      for (const node of Object.values(nodes)) {
        if (node?.type === 'slab' && node.parentId === lowestLevelId) {
          const slab = node as SlabNode
          footprintArea += polygonArea(slab.polygon)
        }
      }
    }

    for (const level of floatingLevels) {
      for (const node of Object.values(nodes)) {
        if (node?.type === 'slab' && node.parentId === level.id) {
          const slab = node as SlabNode
          totalFloorArea += polygonArea(slab.polygon)
        }
      }
    }
  }

  return {
    footprintArea,
    totalFloorArea,
    maxHeight,
    maxFloors,
  }
}
