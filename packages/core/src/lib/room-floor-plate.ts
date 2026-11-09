import type { AnyNode, AnyNodeId, SlabNode, ZoneNode } from '../schema'

export function roomFloorPlate(slabs: readonly SlabNode[], zoneId: string): SlabNode | undefined {
  const owned = slabs.filter((slab) => slab.zoneIds?.includes(zoneId))
  return owned.find((slab) => slab.plateRole !== 'base') ?? owned[0]
}

/** A dedicated plate's room; shared base plates do not inherit one room's outdoor type. */
export function floorPlateRoom(
  slab: Pick<SlabNode, 'zoneIds' | 'plateRole'>,
  resolve: (id: AnyNodeId) => AnyNode | undefined,
): ZoneNode | undefined {
  if (slab.plateRole === 'base' || slab.zoneIds?.length !== 1) return undefined
  const zone = resolve(slab.zoneIds[0]! as AnyNodeId)
  return zone?.type === 'zone' ? zone : undefined
}
