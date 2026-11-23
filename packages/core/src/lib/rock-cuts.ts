import type { AnyNode, AnyNodeId, RockNode, SlabNode } from '../schema'
import { getLevelElevations } from '../services/storey'
import { liftedManualSlab } from './floor-construction-lift'
import { intersection, type Ring } from './polygon-boolean'
import { rockSections } from './rock-form-builder'
import { rockSpan } from './rock-ground'
import { FLAT_GROUND_Y } from './site-ground-height'
import { persistedTerrainFieldOf } from './terrain-source-persisted'

type Nodes = Readonly<Record<string, AnyNode>>

/** A slab's place in its Site: the level and building above it, and the Site itself. */
type SiteChain = NonNullable<ReturnType<typeof siteChain>>

function siteChain(slab: SlabNode, nodes: Nodes) {
  const level = slab.parentId ? nodes[slab.parentId] : undefined
  const building = level?.parentId ? nodes[level.parentId] : undefined
  const site = building?.parentId ? nodes[building.parentId] : undefined
  if (level?.type !== 'level' || building?.type !== 'building' || site?.type !== 'site') return null
  if (Math.abs(building.rotation[0]) > 1e-9 || Math.abs(building.rotation[2]) > 1e-9) return null
  return { level, building, site }
}

/** Cut callers supply authored slabs; resolve their construction lift without changing them. */
function slabTopY(slab: SlabNode, nodes: Nodes, chain: SiteChain) {
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  return (
    chain.building.position[1] +
    (elevations.get(chain.level.id)?.baseY ?? 0) +
    liftedManualSlab(nodes, slab).elevation
  )
}

/** Site-frame plan points to the slab's level frame: the inverse of the building's placement. */
function toLevelFrame(
  building: { position: number[]; rotation: number[] },
  [x, z]: [number, number],
) {
  const angle = building.rotation[1] ?? 0
  const [dx, dz] = [x - (building.position[0] ?? 0), z - (building.position[2] ?? 0)]
  return [
    Math.cos(angle) * dx - Math.sin(angle) * dz,
    Math.sin(angle) * dx + Math.cos(angle) * dz,
  ] as [number, number]
}

export function rocksOf(siteId: string, nodes: Nodes): RockNode[] {
  return Object.values(nodes).filter(
    (node): node is RockNode =>
      node.type === 'rock' && node.parentId === siteId && node.visible !== false,
  )
}

/** The hole one rock leaves in a slab: its cross-section at the slab's top, kept to the slab. */
function holeOf(rock: RockNode, slab: SlabNode, nodes: Nodes, chain: SiteChain): Ring[] {
  // Only terrain supports the rock: climbing this slab would erase the intended cut.
  const { footY, topY } = rockSpan(rock, persistedTerrainFieldOf(chain.site), FLAT_GROUND_Y)
  const top = slabTopY(slab, nodes, chain)
  if (top < footY || top > topY) return []
  const sections = rockSections(rock, (top - footY) / (topY - footY), { footY, topY })
  return sections.flatMap((section) =>
    intersection(
      section.map((point) => toLevelFrame(chain.building, point)),
      slab.polygon,
    ).map((polygon) => polygon.outer),
  )
}

/** The holes a rock leaves in the slabs of its Site, with the slab each is in. */
export function rockHolesIn(slab: SlabNode, rock: RockNode, nodes: Nodes): Ring[] {
  const chain = siteChain(slab, nodes)
  return chain && rock.parentId === chain.site.id ? holeOf(rock, slab, nodes, chain) : []
}

/**
 * The holes the rocks that rise through a slab leave in it: each rock's cross-section at the
 * slab's top, in the slab's frame, kept to the slab's own outline. A rock that ends below the top
 * or starts above it leaves none. Derived, so moving or deleting a rock cannot leave a stale one.
 */
export function rockSlabHoles(slab: SlabNode, nodes: Nodes): Ring[] {
  const chain = siteChain(slab, nodes)
  if (!chain) return []
  return rocksOf(chain.site.id, nodes).flatMap((rock) => holeOf(rock, slab, nodes, chain))
}
