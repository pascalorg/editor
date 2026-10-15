import { type AnyNode, type AnyNodeId, findLevelAncestorId } from '@pascal-app/core'

type Nodes = Readonly<Record<string, AnyNode>>

/**
 * Kinds that stand outdoors whatever hosts them: seen from outside, never from a cutaway into a
 * room. A roof and what stands on it, the ground and what is cut into it, a fence, a facade.
 */
const OUTDOOR_KINDS: ReadonlySet<string> = new Set([
  'roof',
  'roof-segment',
  'dormer',
  'skylight',
  'chimney',
  'cupola',
  'solar-panel',
  'gutter',
  'downspout',
  'eyebrow-vent',
  'ridge-vent',
  'turbine-vent',
  'box-vent',
  'lean-to-extension',
  'fence',
  'fence-feature',
  'ramp',
  'rock',
  'terrain-tile',
  'terrain-break',
  'site',
  'facade',
])

/** Whether a wall has an outdoor face: the cutaway treats it as a wall seen from outside or inside. */
function exteriorWall(node: AnyNode): boolean {
  if (node.type !== 'wall') return false
  return node.frontSide === 'exterior' || node.backSide === 'exterior'
}

/**
 * Whether a change to this node is seen from outside: a wall with an exterior face, an opening in
 * one, a roof or what stands on it, the terrain, a facade part, or anything standing in no
 * building's storey (outdoor furnishing, plants). A sofa, an interior wall and a finish inside are
 * not: they are looked at through a cutaway.
 */
export function isExteriorNode(nodes: Nodes, id: string): boolean {
  const node = nodes[id]
  if (!node) return false
  if (OUTDOOR_KINDS.has(node.type)) return true
  if (node.type === 'wall') return exteriorWall(node)
  if (node.type === 'door' || node.type === 'window') {
    if ((node as { roofSegmentId?: string | null }).roofSegmentId) return true
    const host = nodes[(node as { wallId?: string | null }).wallId ?? node.parentId ?? '']
    return host ? exteriorWall(host) : false
  }
  // A manual outdoor surface (a patio, a path) follows the ground.
  if (node.type === 'slab' && (node as { terrainMode?: string }).terrainMode !== undefined)
    return true
  // Standing under a node that is outdoors (a dormer's window, a chimney's cap).
  for (
    let at = node.parentId ? nodes[node.parentId] : undefined, guard = 0;
    at && guard < 16;
    at = at.parentId ? nodes[at.parentId] : undefined, guard += 1
  )
    if (OUTDOOR_KINDS.has(at.type) && at.type !== 'site') return true
  // Furnishing outdoors: no storey of a building to stand in.
  if (node.type === 'level' || node.type === 'building' || node.type === 'zone') return false
  return findLevelAncestorId(id as AnyNodeId, nodes as never) === null
}

/** Whether any of `ids` is a change seen from outside. */
export function anyExterior(nodes: Nodes, ids: readonly string[]): boolean {
  return ids.some((id) => isExteriorNode(nodes, id))
}
