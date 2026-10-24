import { liftedManualSlab } from '../lib/floor-construction-lift'
import { withHostedCutterHoles } from '../lib/object-cuts'
import { area, difference, intersection, type Ring } from '../lib/polygon-boolean'
import { getRenderableSlabPolygon, slabPolygonContextForLevel } from '../lib/slab-polygon'
import type { AnyNode, ItemNode, SlabNode } from '../schema'
import { resolveCeilingHeight } from '../services/level-height'
import { CEILING_DRAW_OFFSET, getLevelElevations } from '../services/storey'
import { scriptItemBoundsInLevel } from './layout-clearance'
import { queryNodes } from './scene-queries'

type BoundsEvidence = {
  severity?: 'info'
  itemId: string
  ceilingId: string
  levelId: string
  coordinateFrame: 'building'
  bounds: { min: [number, number, number]; max: [number, number, number] }
}

export type CeilingObjectObservation =
  | (BoundsEvidence & {
      type: 'item_above_ceiling'
      message: string
      aboveAttachmentMeters: number
      attachmentElevation: number
    })
  | (BoundsEvidence & {
      type: 'item_covering_slab_overlap'
      message: string
      slabId: string
      slabLevelId: string
      slabBottomY: number
      slabTopY: number
      overlapHeightMeters: number
      overlapAreaSquareMeters: number
    })

function projectedHull(corners: [number, number, number][]): Ring {
  const sorted = corners
    .map(([x, , z]): [number, number] => [x, z])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((point, i, points) => !i || point.some((v, axis) => v !== points[i - 1]![axis]))
  const cross = (a: Ring[number], b: Ring[number], c: Ring[number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = (points: Ring) => {
    const hull: Ring = []
    for (const point of points) {
      while (hull.length >= 2 && cross(hull.at(-2)!, hull.at(-1)!, point) <= 0) hull.pop()
      hull.push(point)
    }
    return hull.slice(0, -1)
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/** Static script bounds, not mesh intersections. All comparisons stay in the shared building frame. */
export function ceilingObjectObservations(
  nodes: Record<string, AnyNode>,
): CeilingObjectObservation[] {
  const observations: CeilingObjectObservation[] = []
  const elevations = getLevelElevations(nodes)
  for (const item of queryNodes<ItemNode>(nodes, { type: 'item' })) {
    if (item.asset.attachTo !== 'ceiling') continue
    const ceiling = item.parentId ? nodes[item.parentId] : undefined
    if (ceiling?.type !== 'ceiling') continue
    const resolved = scriptItemBoundsInLevel(item, nodes)
    if (!resolved) continue
    const level = elevations.get(resolved.levelId)
    if (!level || !Number.isFinite(level.baseY)) continue
    const attachment = level.baseY + resolveCeilingHeight(ceiling, nodes) - CEILING_DRAW_OFFSET
    const bounds = {
      min: [...resolved.bounds.min] as [number, number, number],
      max: [...resolved.bounds.max] as [number, number, number],
    }
    bounds.min[1] += level.baseY
    bounds.max[1] += level.baseY
    const evidence: BoundsEvidence = {
      itemId: item.id,
      ceilingId: ceiling.id,
      levelId: resolved.levelId,
      coordinateFrame: 'building',
      bounds,
    }
    const above = bounds.max[1] - attachment
    if (above > 1e-6)
      observations.push({
        ...evidence,
        type: 'item_above_ceiling',
        message: `Object ${item.id} bounds extend ${above.toFixed(3)} m above ceiling attachment ${ceiling.id}`,
        aboveAttachmentMeters: above,
        attachmentElevation: attachment,
      })
    const footprint = projectedHull(resolved.corners)
    for (const original of queryNodes<SlabNode>(nodes, { type: 'slab' })) {
      if (original.recessed || !original.parentId) continue
      const slabLevel = elevations.get(original.parentId)
      // Unlinked legacy levels are not evidence that two different storeys share a building.
      if (
        !slabLevel ||
        (original.parentId !== resolved.levelId &&
          (!level.buildingId || slabLevel.buildingId !== level.buildingId))
      )
        continue
      try {
        const slab = liftedManualSlab(nodes, original)
        const top = slabLevel.baseY + slab.elevation
        const bottom = top - slab.thickness
        const height = Math.min(bounds.max[1], top) - Math.max(bounds.min[1], bottom)
        if (top <= level.baseY + 1e-6 || !Number.isFinite(height) || height <= 1e-6) continue
        const slabParent = nodes[original.parentId]
        if (slabParent?.type !== 'level') continue
        const polygon = getRenderableSlabPolygon(
          slab,
          slabPolygonContextForLevel(slabParent, (id) => nodes[id]),
        )
        const holes = withHostedCutterHoles(original, nodes).holes
        // Subtract holes as a union, including overlapping stored and derived openings.
        const solid = holes.length
          ? difference(
              polygon,
              holes.map((outer) => ({ outer, holes: [] })),
              { throwOnError: true },
            )
          : polygon
        const overlap = area(intersection(footprint, solid))
        if (overlap <= 1e-6) continue
        observations.push({
          ...evidence,
          type: 'item_covering_slab_overlap',
          message: `Object ${item.id} bounds overlap covering slab ${slab.id} over ${height.toFixed(3)} m vertically and ${overlap.toFixed(3)} m² in plan; bounds overlap is not an exact mesh intersection`,
          slabId: slab.id,
          slabLevelId: original.parentId,
          slabBottomY: bottom,
          slabTopY: top,
          overlapHeightMeters: height,
          overlapAreaSquareMeters: overlap,
        })
      } catch {
        // Unsupported or malformed slab geometry is not collision evidence.
      }
    }
  }
  return observations
}
