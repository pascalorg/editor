import type { AnyNode, CeilingNode, SlabNode } from '../schema'

/**
 * The rooms whose construction a derived surface IS, among `plates` (the level's floor plates as
 * they stand after the edit): a ceiling's room, and the rooms a plate is the floor of. A shared base
 * plate also lists the rooms that stand on plates of their own (a porch or deck a step down, a raised
 * platform), but it is not their floor, so losing it leaves theirs. Without this, deleting the house's
 * plate took every porch and deck floor on the level with it.
 */
export function surfaceIntentZoneIds(
  node: SlabNode | CeilingNode,
  plates: readonly AnyNode[],
): string[] {
  const ids = [
    ...new Set(node.type === 'slab' ? (node.zoneIds ?? []) : node.zoneId ? [node.zoneId] : []),
  ]
  if (node.type !== 'slab' || node.plateRole !== 'base') return ids
  const own = new Set(
    plates.flatMap((plate) =>
      plate.type === 'slab' && plate.id !== node.id && plate.plateRole && plate.plateRole !== 'base'
        ? (plate.zoneIds ?? [])
        : [],
    ),
  )
  return ids.filter((id) => !own.has(id))
}
