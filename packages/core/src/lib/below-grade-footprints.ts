import type { AnyNode, AnyNodeId } from '../schema'
import { getLevelElevations, isLevelBelowGrade } from '../services/storey'
import { type Point2D, unionPolygons } from './polygon-union'
import { levelLocalToWorldXZ } from './terrain-support-query'

/**
 * Where the ground meets the levels below grade, in the site's plan: each such level's floor slabs
 * joined into outlines, placed where its building stands. The 3D view draws its grade ring along
 * them while the ground is veiled. An automatic floor follows the walls' centrelines, so an outline
 * runs half a wall inside the outer faces.
 */
export function belowGradeFootprints(nodes: Record<AnyNodeId, AnyNode>): Point2D[][] {
  const elevations = getLevelElevations(nodes)
  const outlines: Point2D[][] = []
  for (const level of Object.values(nodes)) {
    if (level.type !== 'level' || !isLevelBelowGrade(nodes, level.id)) continue
    const buildingId = elevations.get(level.id)?.buildingId
    const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
    const placed = building?.type === 'building' ? building : null
    const floors = level.children.flatMap((childId) => {
      const slab = nodes[childId as AnyNodeId]
      return slab?.type === 'slab' && slab.recessed !== true ? [slab.polygon] : []
    })
    for (const ring of unionPolygons(floors))
      outlines.push(ring.map(([x, z]) => levelLocalToWorldXZ(placed, x, z)))
  }
  return outlines
}
