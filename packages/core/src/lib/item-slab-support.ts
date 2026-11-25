import type { SlabNode } from '../schema'
import { getSlabElevationAtPoint, hasSlabSlope } from '../systems/slab/slab-slope'
import { pointInPolygon, SUPPORT_ELEVATION_EPSILON } from '../systems/slab/slab-support'
import { itemOverlapsPolygon } from './item-polygon-overlap'
import { planFootprintCorners } from './plan-footprint'

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

/** Lowest walking-surface elevation of `slab` across the item's plan footprint. */
export function getSlabMinElevationForFootprint(slab: SlabNode, footprint: Footprint): number {
  const [px, , pz] = footprint.position
  const originElevation = getSlabElevationAtPoint(slab, px, pz)
  if (!hasSlabSlope(slab)) return originElevation
  const corners = planFootprintCorners(
    footprint.position,
    footprint.dimensions,
    footprint.rotation[1],
  )
  let minElevation = originElevation
  for (const [cx, cz] of corners) {
    const cornerElevation = getSlabElevationAtPoint(slab, cx, cz)
    if (cornerElevation < minElevation) minElevation = cornerElevation
  }
  return minElevation
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
  const [px, , pz] = footprint.position
  let highest: SlabNode | undefined
  let highestElevation = Number.NEGATIVE_INFINITY
  let preferred: SlabNode | undefined
  let covering: SlabNode | undefined
  let coveringElevation = Number.NEGATIVE_INFINITY
  let prefersBase = false
  for (const slab of slabs) {
    if (slab.id === preferredSlabId && slab.plateRole === 'base') prefersBase = true
    const elevation = getSlabElevationAtPoint(slab, px, pz)
    // On a sloped slab, grabbing slightly downhill from the item's origin puts
    // the pointer cap below the origin elevation; compare against the lowest
    // point of the slab under the footprint so the host ramp stays eligible
    // while overhead decks/ramps are still rejected.
    const capElevation = getSlabMinElevationForFootprint(slab, footprint)
    if (maxElevation != null && capElevation > maxElevation + SUPPORT_ELEVATION_EPSILON) continue
    if (!slabSupportsItemFootprint(slab, footprint, renderedPolygon(slab))) continue
    if (!highest || elevation > highestElevation) {
      highest = slab
      highestElevation = elevation
    }
    if (slab.id === preferredSlabId) preferred = slab
    if (slab.plateRole === 'platform' && (!covering || elevation > coveringElevation)) {
      covering = slab
      coveringElevation = elevation
    }
  }
  if (maxElevation == null) {
    if (prefersBase && covering) return covering
    if (preferred) return preferred
  }
  return highest
}
