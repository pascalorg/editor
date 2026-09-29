import { GROUND_SUPPORT_ID } from '../../hooks/spatial-grid/support-host-id'
import { itemOverlapsPolygon } from '../../lib/item-polygon-overlap'
import { resolveLevelId } from '../../lib/node-ancestry'
import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import { levelBaseElevationAt } from '../../lib/terrain-support-query'
import type { AnyNode, SlabNode, StairNode, WallNode } from '../../schema'
import { pointInPolygon } from '../slab/slab-support'
import { getStairFloorPlacedFootprints } from './stair-floor-footprints'

export function stairBaseElevation(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  levelId: string | null,
) {
  const parent = stair.parentId ? nodes[stair.parentId] : undefined
  if ((stair.parentId && !parent) || (parent && parent.type !== 'level')) return stair.position[1]
  const level = parent?.type === 'level' ? parent.id : levelId
  if (!level) return stair.position[1]
  const ground = levelBaseElevationAt(nodes, level, stair.position[0], stair.position[2])
  if (stair.supportSlabId === GROUND_SUPPORT_ID) return stair.position[1] + ground
  const slabs: SlabNode[] = []
  const walls: WallNode[] = []
  for (const node of Object.values(nodes)) {
    if ((node.type !== 'slab' && node.type !== 'wall') || resolveLevelId(node, nodes) !== level)
      continue
    if (node.type === 'slab') slabs.push(node)
    else walls.push(node)
  }
  const polygons = new Map(
    slabs.map((slab) => [
      slab.id,
      getRenderableSlabPolygon(slab, {
        walls,
        siblingSlabs: slabs.filter((other) => other.id !== slab.id),
      }),
    ]),
  )
  const footprints = getStairFloorPlacedFootprints(stair, nodes)
  const supports = (slab: SlabNode, footprint: (typeof footprints)[number]) => {
    const position = footprint.position ?? stair.position
    return (
      itemOverlapsPolygon(
        position,
        footprint.dimensions,
        footprint.rotation,
        polygons.get(slab.id)!,
        0.01,
      ) && !(slab.holes ?? []).some((hole) => pointInPolygon(position[0], position[2], hole))
    )
  }
  const elevation = (slab: SlabNode) =>
    Number.isFinite(slab.elevation ?? 0.05) ? (slab.elevation ?? 0.05) : 0
  const host = slabs.find((slab) => slab.id === stair.supportSlabId)
  if (host && footprints.some((footprint) => supports(host, footprint)))
    return stair.position[1] + elevation(host)
  const lifts = footprints.map((footprint) => {
    const supported = slabs.filter((slab) => supports(slab, footprint))
    return supported.length ? Math.max(...supported.map(elevation)) : ground
  })
  return stair.position[1] + (lifts.length ? Math.max(...lifts) : ground)
}
