import type { SlabNode } from '../schema'
import { pointInPolygon, SUPPORT_ELEVATION_EPSILON } from '../systems/slab/slab-support'
import { itemOverlapsPolygon } from './item-polygon-overlap'

type Footprint = {
  position: [number, number, number]
  dimensions: [number, number, number]
  rotation: [number, number, number]
}

export function slabSupportsItemFootprint(
  slab: SlabNode,
  footprint: Footprint,
  renderedPolygon: [number, number][],
): boolean {
  const { position, dimensions, rotation } = footprint
  return (
    slab.polygon.length >= 3 &&
    itemOverlapsPolygon(position, dimensions, rotation, renderedPolygon, 0.01) &&
    !(slab.holes ?? []).some(
      (hole) => hole.length >= 3 && pointInPolygon(position[0], position[2], hole),
    )
  )
}

/** Rendered polygons may come from the placement cache or a headless scene snapshot. */
export function selectSlabSupportForItem(
  slabs: Iterable<SlabNode>,
  footprint: Footprint,
  renderedPolygon: (slab: SlabNode) => [number, number][],
  options: { maxElevation?: number | null; preferredSlabId?: string | null } = {},
): SlabNode | undefined {
  const { maxElevation, preferredSlabId } = options
  if (maxElevation == null && preferredSlabId === 'ground') return
  let highest: SlabNode | undefined
  let preferred: SlabNode | undefined
  let covering: SlabNode | undefined
  let prefersBase = false
  for (const slab of slabs) {
    if (slab.id === preferredSlabId && slab.plateRole === 'base') prefersBase = true
    const elevation = slab.elevation ?? 0.05
    if (maxElevation != null && elevation > maxElevation + SUPPORT_ELEVATION_EPSILON) continue
    if (!slabSupportsItemFootprint(slab, footprint, renderedPolygon(slab))) continue
    if (!highest || elevation > (highest.elevation ?? 0.05)) highest = slab
    if (slab.id === preferredSlabId) preferred = slab
    if (slab.plateRole === 'platform' && (!covering || elevation > (covering.elevation ?? 0.05)))
      covering = slab
  }
  if (maxElevation == null) {
    if (prefersBase && covering) return covering
    if (preferred) return preferred
  }
  return highest
}
