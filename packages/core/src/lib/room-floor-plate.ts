import type { SlabNode } from '../schema'

export function roomFloorPlate(slabs: readonly SlabNode[], zoneId: string): SlabNode | undefined {
  const owned = slabs.filter((slab) => slab.zoneIds?.includes(zoneId))
  return owned.find((slab) => slab.plateRole !== 'base') ?? owned[0]
}
