import { GROUND_SUPPORT_ID } from '../../hooks/spatial-grid/support-host-id'
import { floorConstructionLift } from '../../lib/floor-construction-lift'
import { selectSlabSupportForItem } from '../../lib/item-slab-support'
import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import { levelBaseElevationAt } from '../../lib/terrain-support-query'
import type { AnyNode, SlabNode, WallNode } from '../../schema'
import type { Nodes } from './walls'

type Footprint = {
  position: [number, number, number]
  dimensions: [number, number, number]
  rotation: [number, number, number]
}

type LevelSlabs = { slabs: SlabNode[]; polygons: Map<string, [number, number][]> }

/** Per-level slabs and their rendered outlines, built once per query. */
export type SupportCache = Map<string, LevelSlabs>

function slabsOf(nodes: Nodes, levelId: string, cache: SupportCache): LevelSlabs {
  const hit = cache.get(levelId)
  if (hit) return hit
  const on = Object.values(nodes).filter((node) => node.parentId === levelId)
  const slabs = on.filter((node): node is SlabNode => node.type === 'slab')
  const walls = on.filter((node): node is WallNode => node.type === 'wall')
  const polygons = new Map(
    slabs.map((slab) => [
      slab.id,
      getRenderableSlabPolygon(slab, {
        walls,
        siblingSlabs: slabs.filter((other) => other.id !== slab.id),
      }),
    ]),
  )
  const made = { slabs, polygons }
  cache.set(levelId, made)
  return made
}

/**
 * The level-local height of the floor under a floor-placed node, by the election the editor makes:
 * the slab its footprint overlaps (the one it is pinned to, else the highest), else the ground.
 */
export function floorUnder(
  node: AnyNode & { supportSlabId?: string },
  footprint: Footprint,
  nodes: Nodes,
  levelId: string,
  cache: SupportCache,
): number {
  const [x, , z] = footprint.position
  const ground = () =>
    levelBaseElevationAt(nodes as Record<string, AnyNode>, levelId, x, z) +
    floorConstructionLift(nodes, node)
  if (node.supportSlabId === GROUND_SUPPORT_ID) return ground()
  const { slabs, polygons } = slabsOf(nodes, levelId, cache)
  const winner = selectSlabSupportForItem(slabs, footprint, (slab) => polygons.get(slab.id)!, {
    preferredSlabId: node.supportSlabId,
  })
  return winner ? winner.elevation : ground()
}

/** Whether a node, or anything it hangs from, is hidden. */
export function isHidden(node: AnyNode, nodes: Nodes): boolean {
  for (
    let current: AnyNode | undefined = node;
    current;
    current = current.parentId ? nodes[current.parentId] : undefined
  )
    if (current.visible === false && current.type !== 'site') return true
  return false
}
